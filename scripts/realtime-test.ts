// Prueba del tiempo real y del acceso privado contra Neon, con el mismo código que usa la web
// (src/lib/sync.ts + src/lib/transport-neon.ts). Crea dos cuentas temporales —una miembro y otra
// no— y lo borra todo al terminar. Uso: node scripts/realtime-test.ts
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import * as Y from 'yjs'
import { createClient } from '@neondatabase/neon-js'
import { DocSync } from '../src/lib/sync.ts'
import { neonTransport } from '../src/lib/transport-neon.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = 'long-fog-74067914'
const ORIGIN = 'https://kratos561.github.io'
const KEY = readFileSync(join(homedir(), '.verdant', 'secrets.env'), 'utf8').match(/^NEON_API_KEY=(.*)$/m)![1].trim()
const NEON_URL = readFileSync(join(ROOT, '.env.production'), 'utf8').match(/^VITE_NEON_URL=(.*)$/m)![1].trim()
const base = new URL(NEON_URL)
const [endpoint, ...rest] = base.host.split('.')
const AUTH = `https://${endpoint}.neonauth.${rest.join('.')}${base.pathname}/auth`
const DATA = `https://${endpoint}.apirest.${rest.join('.')}${base.pathname}/rest/v1`

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'OK ' : 'FALLO'} ${name}${extra ? ` (${extra})` : ''}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, timeoutMs: number): Promise<number> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) return -1
    await sleep(25)
  }
  return Date.now() - t0
}

async function neon(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : {}
}

const { branches } = await neon('GET', '/branches')
const branch = branches.find((b: { default: boolean }) => b.default)
const B = `/branches/${branch.id}`
const { uri } = await neon('GET', `/connection_uri?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner`)
const owner = new pg.Client({ connectionString: uri.replace('sslmode=require', 'sslmode=verify-full') })
await owner.connect()

interface TempUser {
  id: string
  jwt: string
}

async function signUp(tag: string) {
  return fetch(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: `rt-${tag}-${randomBytes(4).toString('hex')}@example.com`, password: randomBytes(12).toString('base64url'), name: `Prueba ${tag}` }),
  })
}

async function session(r: Response): Promise<TempUser> {
  const body = await r.json()
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const s = await fetch(`${AUTH}/get-session`, { headers: { Cookie: cookie, Origin: ORIGIN } })
  return { id: body.user.id, jwt: s.headers.get('set-auth-jwt')! }
}

const users: TempUser[] = []
let docId: string | null = null
try {
  // Cuentas temporales: el registro se abre unos segundos y se vuelve a cerrar.
  await neon('PATCH', `${B}/auth/email_and_password`, { disable_sign_up: false })
  let member: TempUser, outsider: TempUser
  try {
    member = await session(await signUp('miembro'))
    outsider = await session(await signUp('ajeno'))
  } finally {
    await neon('PATCH', `${B}/auth/email_and_password`, { disable_sign_up: true })
  }
  users.push(member, outsider)
  await owner.query('insert into app_members(user_id, note) values ($1, $2)', [member.id, 'prueba temporal'])

  const closed = await signUp('cerrado')
  check('con el registro cerrado nadie puede crear cuentas', !closed.ok, `status ${closed.status}`)

  const rest = (jwt: string | null, path: string, init: RequestInit = {}) =>
    fetch(`${DATA}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    })

  const created = await rest(member.jwt, 'documents', { method: 'POST', body: JSON.stringify({ title: 'Prueba tiempo real' }) })
  docId = ((await created.json()) as { id: string }[])[0]?.id ?? null
  check('el miembro crea un documento', created.status === 201 && !!docId, `status ${created.status}`)

  // Una cuenta válida que no es miembro no ve ni toca nada.
  const memberRpc = await (await rest(member.jwt, 'rpc/is_member', { method: 'POST', body: '{}' })).json()
  const outsiderRpc = await (await rest(outsider.jwt, 'rpc/is_member', { method: 'POST', body: '{}' })).json()
  check('is_member(): miembro sí, ajeno no', memberRpc === true && outsiderRpc === false, `${memberRpc}/${outsiderRpc}`)
  const seen = (await (await rest(outsider.jwt, 'documents?select=id')).json()) as unknown[]
  check('el ajeno no ve documentos', Array.isArray(seen) && seen.length === 0)
  const injected = await rest(outsider.jwt, 'doc_updates', { method: 'POST', body: JSON.stringify({ doc_id: docId, client_id: 1, data: 'AA==' }) })
  check('el ajeno no puede inyectar cambios', injected.status >= 400, `status ${injected.status}`)
  const own = await rest(outsider.jwt, 'documents', { method: 'POST', body: JSON.stringify({ title: 'intruso' }) })
  check('el ajeno no puede crear documentos', own.status >= 400, `status ${own.status}`)
  const members = await rest(member.jwt, 'app_members?select=user_id')
  check('la lista de miembros no es accesible desde la API', members.status >= 400, `status ${members.status}`)

  // Tiempo real entre dos clientes con el código de la web.
  const transport = () => neonTransport(createClient({ dataApi: { url: DATA, getToken: async () => member.jwt } }))
  const seed = () => {
    const d = new Y.Doc()
    d.getText('t').insert(0, 'Hola')
    return d
  }
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  const a = new DocSync(docA, docId!, transport())
  const b = new DocSync(docB, docId!, transport())
  await Promise.all([a.start(seed), b.start(seed)])
  const tA = docA.getText('t')
  const tB = docB.getText('t')
  check('arranque simultáneo sin duplicar el contenido inicial', tA.toString() === 'Hola' && tB.toString() === 'Hola', `${tA}|${tB}`)

  a.awareness.setLocalStateField('user', { name: 'A', color: '#3ddc97' })
  b.awareness.setLocalStateField('user', { name: 'B', color: '#b59cff' })
  const presence = await until(() => b.awareness.getStates().get(docA.clientID)?.user?.name === 'A' && a.awareness.getStates().has(docB.clientID), 8000)
  check('cada cliente ve la presencia del otro', presence >= 0, `${presence} ms`)

  const lat: number[] = []
  for (let i = 0; i < 5; i++) {
    tA.insert(tA.length, ` a${i}`)
    lat.push(await until(() => tB.toString() === tA.toString(), 6000))
  }
  lat.sort((x, y) => x - y)
  check('A → B en tiempo real', lat.every((l) => l >= 0), `mediana ${lat[2]} ms, máx ${lat[4]} ms`)

  tA.insert(0, '[A]')
  tB.insert(tB.length, '[B]')
  const merged = await until(() => tA.toString() === tB.toString() && tA.toString().includes('[A]') && tA.toString().includes('[B]'), 8000)
  check('ediciones simultáneas convergen al mismo texto', merged >= 0, `${merged} ms`)

  b.awareness.setLocalStateField('cursor', { anchor: 3 })
  const cursor = await until(() => a.awareness.getStates().get(docB.clientID)?.cursor?.anchor === 3, 8000)
  check('el cursor de B llega a A', cursor >= 0, `${cursor} ms`)

  // Más de 200 actualizaciones → un cliente guarda un estado compacto.
  for (let i = 0; i < 205; i++) {
    tA.insert(tA.length, '.')
    await a.flush()
  }
  let seq = 0
  for (let i = 0; i < 40 && seq === 0; i++) {
    await sleep(500)
    seq = Number((await owner.query('select ydoc_seq from documents where id = $1', [docId])).rows[0].ydoc_seq)
  }
  check('se guarda un estado compacto tras 200 cambios', seq > 0, `ydoc_seq ${seq}`)

  await until(() => tB.toString() === tA.toString(), 10000)
  const docC = new Y.Doc()
  const c = new DocSync(docC, docId!, transport())
  await c.start(seed)
  check('un cliente nuevo carga estado compacto + cambios y coincide', docC.getText('t').toString() === tA.toString(), `${docC.getText('t').length}/${tA.length} caracteres`)

  await b.stop()
  const left = await until(() => !a.awareness.getStates().has(docB.clientID), 8000)
  check('al salir B, A deja de verlo', left >= 0, `${left} ms`)
  await Promise.all([a.stop(), c.stop()])
} finally {
  if (docId) await owner.query('delete from documents where id = $1', [docId])
  for (const u of users) {
    await owner.query('delete from app_members where user_id = $1', [u.id])
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}/auth/users/${u.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}` } })
    check('cuenta temporal eliminada', r.ok, `status ${r.status}`)
  }
  const cfg = await neon('GET', `${B}/auth/email_and_password`)
  check('el registro queda cerrado', cfg.disable_sign_up === true)
  await owner.end()
}
process.exit(failures ? 1 : 0)
