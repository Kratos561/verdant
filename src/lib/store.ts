// Acceso a datos. Con VITE_NEON_URL habla con la Data API de Neon (RLS por usuario);
// sin ella guarda todo en IndexedDB para que Verdant funcione en local y sin conexión.
import type { JSONContent } from '@tiptap/react'
import { neonClient } from './auth'
import type { PresenceRow, SyncTransport, UpdateRow } from './sync'
import { neonTransport } from './transport-neon'

export interface DocSettings {
  font?: string
  /** Tamaño base del texto en pt (12 si no se indica). */
  fontSize?: number
  /** Interlineado base (multiplicador CSS). */
  lineHeight?: number
  /** Separación entre párrafos en pt; sin valor, la de Verdant (0,7 em). */
  paragraphGap?: number
  pageMode?: 'pageless' | 'paged'
  paper?: 'a4' | 'letter'
  /** Color de la hoja: oscura (Verdant) o papel (como en Word). */
  sheet?: 'dark' | 'paper'
  /** 'word': títulos y espaciado salen del propio documento (importado de Word), no del estilo de Verdant. */
  layout?: 'verdant' | 'word'
  /** Tamaño y márgenes de la hoja en pt; sin valor, A4 o Carta con márgenes de 2,54 cm. */
  page?: PageSetup
  /** Encabezado y pie de cada hoja; {pagina} y {paginas} se sustituyen al mostrarlos. */
  header?: HeaderFooter
  footer?: HeaderFooter
}

export interface PageSetup {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
  /** Distancia del borde al encabezado y al pie. */
  header?: number
  footer?: number
}

export interface HeaderFooter {
  text: string
  align?: 'left' | 'center' | 'right'
}

export interface DocMeta {
  id: string
  title: string
  text_plain: string
  starred: boolean
  trashed_at: string | null
  folder_id: string | null
  created_at: string
  updated_at: string
}

export interface Doc extends DocMeta {
  content: JSONContent
  settings: DocSettings
  /** Estado Yjs compactado (base64) y última actualización que incluye; los gestiona sync.ts. */
  ydoc?: string | null
  ydoc_seq?: number
}

export interface Folder {
  id: string
  name: string
  parent_id: string | null
  created_at: string
}

export interface Version {
  id: string
  document_id: string
  label: string | null
  title: string
  content: JSONContent
  created_at: string
}

export interface Comment {
  id: string
  document_id: string
  parent_id: string | null
  author_name: string
  quote: string
  body: string
  resolved: boolean
  created_at: string
}

export type DocPatch = Partial<Pick<Doc, 'title' | 'content' | 'text_plain' | 'settings' | 'starred' | 'trashed_at' | 'folder_id'>>
export type NewDoc = Partial<Pick<Doc, 'title' | 'content' | 'folder_id' | 'settings' | 'text_plain'>>
export type NewComment = Pick<Comment, 'document_id' | 'quote' | 'body' | 'author_name'> & { parent_id?: string | null }

export interface Store {
  mode: 'neon' | 'local'
  transport: SyncTransport
  listDocs(): Promise<DocMeta[]>
  getDoc(id: string): Promise<Doc | null>
  createDoc(init?: NewDoc): Promise<Doc>
  updateDoc(id: string, patch: DocPatch): Promise<void>
  deleteDoc(id: string): Promise<void>
  listFolders(): Promise<Folder[]>
  createFolder(name: string): Promise<Folder>
  renameFolder(id: string, name: string): Promise<void>
  deleteFolder(id: string): Promise<void>
  listVersions(documentId: string): Promise<Version[]>
  createVersion(documentId: string, v: { title: string; content: JSONContent; label?: string | null }): Promise<Version>
  listComments(documentId: string): Promise<Comment[]>
  addComment(c: NewComment): Promise<Comment>
  updateComment(id: string, patch: Partial<Pick<Comment, 'body' | 'resolved'>>): Promise<void>
  deleteComment(id: string): Promise<void>
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
export const UNTITLED = 'Documento sin título'
const META = 'id,title,text_plain,starred,trashed_at,folder_id,created_at,updated_at'
const FULL = `${META},content,settings`

// ---------- Neon (Data API) ----------

interface PgResult<T> {
  data: T | null
  error: { message: string } | null
}

function unwrap<T>(r: PgResult<T>): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

function neonStore(): Store {
  const db = neonClient!
  return {
    mode: 'neon',
    transport: neonTransport(db),
    async listDocs() {
      return unwrap<DocMeta[]>(await db.from('documents').select(META).order('updated_at', { ascending: false }))
    },
    async getDoc(id) {
      return unwrap<Doc | null>(await db.from('documents').select(FULL).eq('id', id).maybeSingle())
    },
    async createDoc(init = {}) {
      const row = { title: UNTITLED, content: EMPTY_DOC, settings: {}, ...init }
      return unwrap<Doc>(await db.from('documents').insert(row).select(FULL).single())
    },
    async updateDoc(id, patch) {
      unwrap(await db.from('documents').update(patch).eq('id', id))
    },
    async deleteDoc(id) {
      unwrap(await db.from('documents').delete().eq('id', id))
    },
    async listFolders() {
      return unwrap<Folder[]>(await db.from('folders').select('id,name,parent_id,created_at').order('name'))
    },
    async createFolder(name) {
      return unwrap<Folder>(await db.from('folders').insert({ name }).select('id,name,parent_id,created_at').single())
    },
    async renameFolder(id, name) {
      unwrap(await db.from('folders').update({ name }).eq('id', id))
    },
    async deleteFolder(id) {
      unwrap(await db.from('folders').delete().eq('id', id))
    },
    async listVersions(documentId) {
      return unwrap<Version[]>(
        await db.from('doc_versions').select('*').eq('document_id', documentId).order('created_at', { ascending: false }).limit(100),
      )
    },
    async createVersion(documentId, v) {
      return unwrap<Version>(await db.from('doc_versions').insert({ document_id: documentId, ...v }).select('*').single())
    },
    async listComments(documentId) {
      return unwrap<Comment[]>(await db.from('comments').select('*').eq('document_id', documentId).order('created_at'))
    },
    async addComment(c) {
      return unwrap<Comment>(await db.from('comments').insert(c).select('*').single())
    },
    async updateComment(id, patch) {
      unwrap(await db.from('comments').update(patch).eq('id', id))
    },
    async deleteComment(id) {
      unwrap(await db.from('comments').delete().eq('id', id))
    },
  }
}

// ---------- Local (IndexedDB) ----------

type Collection = 'documents' | 'folders' | 'versions' | 'comments' | 'updates' | 'presence'

let dbPromise: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('verdant', 2)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of ['documents', 'folders', 'versions', 'comments']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('updates')) {
        db.createObjectStore('updates', { keyPath: 'id', autoIncrement: true }).createIndex('doc', 'doc_id')
      }
      if (!db.objectStoreNames.contains('presence')) db.createObjectStore('presence', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(name: Collection, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(name, mode).objectStore(name))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

const all = <T>(name: Collection) => tx<T[]>(name, 'readonly', (s) => s.getAll())
const one = <T>(name: Collection, id: string) => tx<T | undefined>(name, 'readonly', (s) => s.get(id))
const put = <T>(name: Collection, value: T) => tx<IDBValidKey>(name, 'readwrite', (s) => s.put(value))
const remove = (name: Collection, id: IDBValidKey) => tx<undefined>(name, 'readwrite', (s) => s.delete(id))
const now = () => new Date().toISOString()

interface LocalUpdate extends UpdateRow {
  doc_id: string
  created_at: number
}

interface LocalPresence extends PresenceRow {
  key: string
  doc_id: string
  updated_at: number
}

const updatesOf = (docId: string) =>
  tx<LocalUpdate[]>('updates', 'readonly', (s) => s.index('doc').getAll(IDBKeyRange.only(docId)))

/** Lee y reescribe un documento en una sola transacción (otras pestañas no se cuelan en medio). */
async function rewriteDoc(id: string, fn: (d: Doc) => Doc | null): Promise<boolean> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const t = db.transaction('documents', 'readwrite')
    const s = t.objectStore('documents')
    let changed = false
    const get = s.get(id)
    get.onsuccess = () => {
      const next = get.result ? fn(get.result as Doc) : null
      if (next) {
        s.put(next)
        changed = true
      }
    }
    t.oncomplete = () => resolve(changed)
    t.onerror = () => reject(t.error)
  })
}

// Mismo protocolo que Neon sobre IndexedDB: las pestañas del mismo navegador colaboran en vivo.
function localTransport(): SyncTransport {
  return {
    async loadSnapshot(docId) {
      const d = await one<Doc>('documents', docId)
      return { ydoc: d?.ydoc ?? null, ydoc_seq: d?.ydoc_seq ?? 0 }
    },
    seedSnapshot: (docId, data) => rewriteDoc(docId, (d) => (d.ydoc ? null : { ...d, ydoc: data, ydoc_seq: 0 })),
    async saveSnapshot(docId, data, seq) {
      await rewriteDoc(docId, (d) => ((d.ydoc_seq ?? 0) < seq ? { ...d, ydoc: data, ydoc_seq: seq } : null))
    },
    async pruneUpdates(docId, uptoSeq, olderThan) {
      for (const u of await updatesOf(docId)) {
        if (u.id <= uptoSeq && u.created_at < olderThan.getTime()) await remove('updates', u.id)
      }
    },
    async pushUpdate(docId, clientId, data) {
      return Number(await put('updates', { doc_id: docId, client_id: clientId, data, created_at: Date.now() }))
    },
    async pullUpdates(docId, afterId, limit) {
      return (await updatesOf(docId))
        .filter((u) => u.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
    },
    async putPresence(docId, clientId, state) {
      const row: LocalPresence = { key: `${docId}:${clientId}`, doc_id: docId, client_id: clientId, state, updated_at: Date.now() }
      await put('presence', row)
    },
    async pullPresence(docId) {
      const fresh = Date.now() - 30_000
      return (await all<LocalPresence>('presence')).filter((p) => p.doc_id === docId && p.updated_at > fresh)
    },
    async dropPresence(docId, clientId) {
      await remove('presence', `${docId}:${clientId}`)
    },
  }
}

function localStore(): Store {
  return {
    mode: 'local',
    transport: localTransport(),
    async listDocs() {
      const docs = await all<Doc>('documents')
      return docs
        .map(({ content: _c, settings: _s, ...meta }) => meta)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    },
    async getDoc(id) {
      return (await one<Doc>('documents', id)) ?? null
    },
    async createDoc(init = {}) {
      const doc: Doc = {
        id: crypto.randomUUID(),
        title: UNTITLED,
        content: EMPTY_DOC,
        text_plain: '',
        settings: {},
        starred: false,
        trashed_at: null,
        folder_id: null,
        created_at: now(),
        updated_at: now(),
        ...init,
      }
      await put('documents', doc)
      return doc
    },
    async updateDoc(id, patch) {
      const doc = await one<Doc>('documents', id)
      if (doc) await put('documents', { ...doc, ...patch, updated_at: now() })
    },
    async deleteDoc(id) {
      await remove('documents', id)
      for (const u of await updatesOf(id)) await remove('updates', u.id)
      for (const v of await all<Version>('versions')) if (v.document_id === id) await remove('versions', v.id)
      for (const c of await all<Comment>('comments')) if (c.document_id === id) await remove('comments', c.id)
    },
    async listFolders() {
      return (await all<Folder>('folders')).sort((a, b) => a.name.localeCompare(b.name))
    },
    async createFolder(name) {
      const folder: Folder = { id: crypto.randomUUID(), name, parent_id: null, created_at: now() }
      await put('folders', folder)
      return folder
    },
    async renameFolder(id, name) {
      const f = await one<Folder>('folders', id)
      if (f) await put('folders', { ...f, name })
    },
    async deleteFolder(id) {
      await remove('folders', id)
      for (const d of await all<Doc>('documents')) if (d.folder_id === id) await put('documents', { ...d, folder_id: null })
    },
    async listVersions(documentId) {
      return (await all<Version>('versions'))
        .filter((v) => v.document_id === documentId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
    async createVersion(documentId, v) {
      const version: Version = { id: crypto.randomUUID(), document_id: documentId, label: null, created_at: now(), ...v }
      await put('versions', version)
      return version
    },
    async listComments(documentId) {
      return (await all<Comment>('comments'))
        .filter((c) => c.document_id === documentId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    },
    async addComment(c) {
      const comment: Comment = { id: crypto.randomUUID(), parent_id: null, resolved: false, created_at: now(), ...c }
      await put('comments', comment)
      return comment
    },
    async updateComment(id, patch) {
      const c = await one<Comment>('comments', id)
      if (c) await put('comments', { ...c, ...patch })
    },
    async deleteComment(id) {
      await remove('comments', id)
    },
  }
}

export const store: Store = neonClient ? neonStore() : localStore()
