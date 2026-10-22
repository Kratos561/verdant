// Transporte de sync.ts sobre la Data API de Neon (PostgREST). RLS limita todo a los miembros.
// Recibe el cliente para poder usarse también desde scripts de Node (pruebas de tiempo real).
import type { PresenceRow, SyncTransport, UpdateRow } from './sync'

type Db = Pick<NonNullable<(typeof import('./auth'))['neonClient']>, 'from'>

interface PgResult<T> {
  data: T | null
  error: { message: string } | null
}

function unwrap<T>(r: PgResult<T>): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export function neonTransport(db: Db): SyncTransport {
  return {
    async loadSnapshot(docId) {
      return unwrap<{ ydoc: string | null; ydoc_seq: number }>(await db.from('documents').select('ydoc,ydoc_seq').eq('id', docId).single())
    },
    async seedSnapshot(docId, data) {
      const rows = unwrap<{ id: string }[]>(
        await db.from('documents').update({ ydoc: data, ydoc_seq: 0 }).eq('id', docId).is('ydoc', null).select('id'),
      )
      return rows.length > 0
    },
    async saveSnapshot(docId, data, seq) {
      unwrap(await db.from('documents').update({ ydoc: data, ydoc_seq: seq }).eq('id', docId).lt('ydoc_seq', seq))
    },
    async pruneUpdates(docId, uptoSeq, olderThan) {
      unwrap(await db.from('doc_updates').delete().eq('doc_id', docId).lte('id', uptoSeq).lt('created_at', olderThan.toISOString()))
    },
    async pushUpdate(docId, clientId, data) {
      return unwrap<{ id: number }>(await db.from('doc_updates').insert({ doc_id: docId, client_id: clientId, data }).select('id').single()).id
    },
    async pullUpdates(docId, afterId, limit) {
      return unwrap<UpdateRow[]>(
        await db.from('doc_updates').select('id,client_id,data').eq('doc_id', docId).gt('id', afterId).order('id').limit(limit),
      )
    },
    async putPresence(docId, clientId, state) {
      unwrap(await db.from('doc_presence').upsert({ doc_id: docId, client_id: clientId, state }, { onConflict: 'doc_id,client_id' }))
    },
    async pullPresence(docId) {
      return unwrap<PresenceRow[]>(await db.from('doc_presence_live').select('client_id,state').eq('doc_id', docId))
    },
    async dropPresence(docId, clientId) {
      unwrap(await db.from('doc_presence').delete().eq('doc_id', docId).eq('client_id', clientId))
    },
  }
}
