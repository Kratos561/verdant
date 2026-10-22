// Colaboración en tiempo real sin servidor propio: cada cambio del editor es una actualización
// Yjs (CRDT) que se guarda en la base de datos; los demás clientes la recogen sondeando cada
// ~0,6 s. La presencia (quién está y dónde tiene el cursor) viaja igual, como estado de awareness.
// Yjs es idempotente y conmutativo: aplicar dos veces o en otro orden da el mismo documento.
// Este módulo no depende del DOM ni de la tienda: el transporte se inyecta (Neon o IndexedDB).
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'

export interface UpdateRow {
  id: number
  client_id: number
  data: string
}

export interface PresenceRow {
  client_id: number
  state: string
}

export interface Snapshot {
  ydoc: string | null
  ydoc_seq: number
}

export interface SyncTransport {
  loadSnapshot(docId: string): Promise<Snapshot>
  /** Guarda el estado inicial solo si el documento aún no tiene uno. Devuelve si lo guardó. */
  seedSnapshot(docId: string, data: string): Promise<boolean>
  /** Sustituye el estado compactado solo si `seq` es mayor que el guardado. */
  saveSnapshot(docId: string, data: string, seq: number): Promise<void>
  pruneUpdates(docId: string, uptoSeq: number, olderThan: Date): Promise<void>
  pushUpdate(docId: string, clientId: number, data: string): Promise<number>
  pullUpdates(docId: string, afterId: number, limit: number): Promise<UpdateRow[]>
  putPresence(docId: string, clientId: number, state: string): Promise<void>
  pullPresence(docId: string): Promise<PresenceRow[]>
  dropPresence(docId: string, clientId: number): Promise<void>
}

export type SyncStatus = 'connecting' | 'live' | 'pending' | 'offline'

/** Origen de las transacciones que llegan de otros clientes (no se reenvían). */
export const REMOTE = 'verdant-remote'

const PAGE = 500
// Margen ante inserciones que se confirman fuera de orden: se vuelve a pedir esta ventana de ids.
const LOOKBACK = 50
const COMPACT_AFTER = 200
const PRUNE_AGE_MS = 10 * 60 * 1000

export interface SyncOptions {
  pollMs?: number
  idlePollMs?: number
  hiddenPollMs?: number
  presenceMs?: number
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export class DocSync {
  readonly doc: Y.Doc
  readonly docId: string
  readonly awareness: Awareness
  status: SyncStatus = 'connecting'

  private t: SyncTransport
  private opts: Required<SyncOptions>
  private lastSeq = 0
  private snapshotSeq = 0
  private sinceSnapshot = 0
  private seen = new Set<number>()
  private queue: Uint8Array[] = []
  private pushing = false
  private pushTimer: ReturnType<typeof setTimeout> | undefined
  private pullTimer: ReturnType<typeof setTimeout> | undefined
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private presenceDirty = false
  private presenceSending = false
  private failures = 0
  private stopped = false
  private listeners = new Set<(s: SyncStatus) => void>()

  constructor(doc: Y.Doc, docId: string, transport: SyncTransport, options: SyncOptions = {}) {
    this.doc = doc
    this.docId = docId
    this.t = transport
    this.opts = { pollMs: 600, idlePollMs: 2000, hiddenPollMs: 5000, presenceMs: 2000, ...options }
    this.awareness = new Awareness(doc)
  }

  /** Carga el estado y empieza a sincronizar. `seed` crea el contenido inicial si el documento es nuevo para Yjs. */
  async start(seed: () => Y.Doc): Promise<void> {
    let snap = await this.t.loadSnapshot(this.docId)
    if (!snap.ydoc) {
      const initial = toBase64(Y.encodeStateAsUpdate(seed()))
      snap = (await this.t.seedSnapshot(this.docId, initial)) ? { ydoc: initial, ydoc_seq: 0 } : await this.t.loadSnapshot(this.docId)
    }
    if (snap.ydoc) Y.applyUpdate(this.doc, fromBase64(snap.ydoc), REMOTE)
    this.lastSeq = this.snapshotSeq = snap.ydoc_seq
    await this.pull(true)
    if (this.stopped) return
    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    this.setStatus('live')
    this.schedulePull()
    this.presenceLoop()
  }

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Envía lo pendiente y deja de sincronizar. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearTimeout(this.pushTimer)
    clearTimeout(this.pullTimer)
    clearTimeout(this.presenceTimer)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    await Promise.allSettled([this.flush(), this.t.dropPresence(this.docId, this.doc.clientID)])
    this.awareness.destroy()
  }

  /** Fuerza el envío inmediato de los cambios locales en cola. */
  async flush(): Promise<void> {
    clearTimeout(this.pushTimer)
    await this.push()
  }

  private setStatus(s: SyncStatus) {
    if (s === this.status) return
    this.status = s
    this.listeners.forEach((cb) => cb(s))
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return
    this.queue.push(update)
    this.setStatus(this.failures ? 'offline' : 'pending')
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => this.push(), 150)
  }

  private async push(): Promise<void> {
    if (this.pushing || !this.queue.length) return
    this.pushing = true
    const merged = Y.mergeUpdates(this.queue.splice(0))
    try {
      const id = await this.t.pushUpdate(this.docId, this.doc.clientID, toBase64(merged))
      this.seen.add(id)
      this.sinceSnapshot++
      this.failures = 0
    } catch {
      this.queue.unshift(merged)
      this.failures++
      this.setStatus('offline')
    } finally {
      this.pushing = false
    }
    if (this.queue.length && !this.stopped) {
      this.pushTimer = setTimeout(() => this.push(), this.failures ? Math.min(15000, 1000 * 2 ** this.failures) : 50)
    } else if (!this.queue.length) {
      this.setStatus('live')
    }
  }

  private async pull(initial = false): Promise<void> {
    let after = initial ? this.snapshotSeq : Math.max(this.snapshotSeq, this.lastSeq - LOOKBACK)
    for (;;) {
      const rows = await this.t.pullUpdates(this.docId, after, PAGE)
      for (const row of rows) {
        if (row.id > this.lastSeq) this.lastSeq = row.id
        if (this.seen.has(row.id)) continue
        this.seen.add(row.id)
        if (row.client_id !== this.doc.clientID) Y.applyUpdate(this.doc, fromBase64(row.data), REMOTE)
        this.sinceSnapshot++
      }
      if (rows.length < PAGE) break
      after = rows[rows.length - 1].id
    }
    for (const id of this.seen) if (id < this.lastSeq - 4 * LOOKBACK) this.seen.delete(id)
  }

  private peers(): number[] {
    return [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
  }

  private schedulePull() {
    if (this.stopped) return
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const wait = hidden ? this.opts.hiddenPollMs : this.peers().length ? this.opts.pollMs : this.opts.idlePollMs
    this.pullTimer = setTimeout(async () => {
      try {
        await this.pull()
        if (this.failures === 0 && !this.queue.length) this.setStatus('live')
        await this.maybeCompact()
      } catch {
        this.setStatus('offline')
      }
      this.schedulePull()
    }, wait)
  }

  /** El cliente con el id más bajo entre los presentes guarda un estado compacto y poda lo viejo. */
  private async maybeCompact() {
    if (this.sinceSnapshot < COMPACT_AFTER || this.peers().some((id) => id < this.doc.clientID)) return
    const seq = Math.max(this.snapshotSeq, this.lastSeq - LOOKBACK)
    if (seq <= this.snapshotSeq) return
    await this.t.saveSnapshot(this.docId, toBase64(Y.encodeStateAsUpdate(this.doc)), seq)
    this.snapshotSeq = seq
    this.sinceSnapshot = 0
    await this.t.pruneUpdates(this.docId, seq, new Date(Date.now() - PRUNE_AGE_MS)).catch(() => {})
  }

  private onAwarenessUpdate = (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE) return
    const mine = this.doc.clientID
    if (![...changes.added, ...changes.updated].includes(mine)) return
    this.presenceDirty = true
    void this.sendPresence()
  }

  private async sendPresence() {
    if (this.presenceSending || this.stopped || !this.presenceDirty) return
    this.presenceSending = true
    this.presenceDirty = false
    try {
      await this.t.putPresence(this.docId, this.doc.clientID, toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])))
    } catch {
      this.presenceDirty = true
    } finally {
      // Como mucho un envío cada 250 ms; lo que cambie mientras tanto sale en el siguiente.
      setTimeout(() => {
        this.presenceSending = false
        void this.sendPresence()
      }, 250)
    }
  }

  private presenceLoop = async () => {
    if (this.stopped) return
    try {
      const rows = await this.t.pullPresence(this.docId)
      const live = new Set<number>()
      for (const row of rows) {
        if (row.client_id === this.doc.clientID) continue
        live.add(row.client_id)
        applyAwarenessUpdate(this.awareness, fromBase64(row.state), REMOTE)
      }
      const gone = this.peers().filter((id) => !live.has(id))
      if (gone.length) removeAwarenessStates(this.awareness, gone, REMOTE)
    } catch {
      // La presencia es secundaria: un fallo puntual no cambia el estado de sincronización.
    }
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    this.presenceTimer = setTimeout(this.presenceLoop, hidden ? this.opts.hiddenPollMs : this.opts.presenceMs)
  }
}
