// Prueba de humo contra Neon: Auth + Data API + RLS con dos usuarios temporales.
// Uso: node scripts/smoke-neon.mjs   (lee VITE_NEON_URL de .env.local y NEON_API_KEY de ~/.verdant)
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const base = new URL(env.VITE_NEON_URL)
const [endpoint, ...rest] = base.host.split('.')
const AUTH = `https://${endpoint}.neonauth.${rest.join('.')}${base.pathname}/auth`
const DATA = `https://${endpoint}.apirest.${rest.join('.')}${base.pathname}/rest/v1`
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:5180'

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK ' : 'FALLO'} ${name}${extra ? ` (${extra})` : ''}`)
  if (!ok) failures++
}

async function newUser(tag) {
  const email = `smoke-${tag}-${randomBytes(4).toString('hex')}@example.com`
  const password = randomBytes(12).toString('base64url')
  const r = await fetch(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password, name: `Smoke ${tag}` }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`sign-up ${r.status}: ${body.message ?? ''}`)
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const s = await fetch(`${AUTH}/get-session`, { headers: { Cookie: cookie, Origin: ORIGIN } })
  const jwt = s.headers.get('set-auth-jwt')
  if (!jwt) throw new Error(`get-session sin JWT (${s.status})`)
  return { id: body.user?.id, jwt }
}

const api = (jwt, path, init = {}) =>
  fetch(`${DATA}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...init.headers },
  })

const a = await newUser('a')
const b = await newUser('b')
check('alta e inicio de sesión de dos usuarios', !!(a.jwt && b.jwt))

const created = await api(a.jwt, 'documents', { method: 'POST', body: JSON.stringify({ title: 'Prueba RLS', text_plain: 'hola' }) })
const [doc] = await created.json()
check('A crea un documento', created.status === 201 && doc?.owner_id === a.id, `status ${created.status}`)

const listA = await (await api(a.jwt, 'documents?select=id,title')).json()
check('A ve su documento', Array.isArray(listA) && listA.some((d) => d.id === doc.id))

const listB = await (await api(b.jwt, 'documents?select=id')).json()
check('B no ve el documento de A', Array.isArray(listB) && !listB.some((d) => d.id === doc.id))

const patchB = await api(b.jwt, `documents?id=eq.${doc.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'hackeado' }) })
const patched = await patchB.json().catch(() => [])
check('B no puede modificar el documento de A', Array.isArray(patched) && patched.length === 0, `status ${patchB.status}`)

const spoof = await api(b.jwt, 'documents', { method: 'POST', body: JSON.stringify({ title: 'suplantado', owner_id: a.id }) })
check('B no puede crear documentos a nombre de A', spoof.status >= 400, `status ${spoof.status}`)

const anon = await api(null, 'documents?select=id')
const anonRows = await anon.json().catch(() => null)
check('sin sesión no se lee nada', anon.status >= 400 || (Array.isArray(anonRows) && anonRows.length === 0), `status ${anon.status}`)

const ver = await api(a.jwt, 'doc_versions', { method: 'POST', body: JSON.stringify({ document_id: doc.id, title: 'v1', content: { type: 'doc' } }) })
check('A guarda una versión', ver.status === 201, `status ${ver.status}`)
const verB = await api(b.jwt, 'doc_versions', { method: 'POST', body: JSON.stringify({ document_id: doc.id, title: 'x', content: {} }) })
check('B no puede añadir versiones al documento de A', verB.status >= 400, `status ${verB.status}`)

const com = await api(a.jwt, 'comments', { method: 'POST', body: JSON.stringify({ document_id: doc.id, body: 'ok', quote: 'q' }) })
check('A comenta su documento', com.status === 201, `status ${com.status}`)

const del = await api(a.jwt, `documents?id=eq.${doc.id}`, { method: 'DELETE' })
check('A borra su documento (y en cascada versiones y comentarios)', del.ok, `status ${del.status}`)

// Limpieza: borrar los usuarios temporales con la API de Neon.
const KEY = process.env.NEON_API_KEY ?? (existsSync(join(homedir(), '.verdant', 'secrets.env'))
  ? readFileSync(join(homedir(), '.verdant', 'secrets.env'), 'utf8').match(/^NEON_API_KEY=(.*)$/m)?.[1]?.trim()
  : undefined)
if (KEY && process.env.NEON_PROJECT_ID) {
  for (const u of [a, b]) {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${process.env.NEON_PROJECT_ID}/auth/users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${KEY}` },
    })
    check('usuario temporal eliminado', r.ok, `status ${r.status}`)
  }
} else {
  console.log('Usuarios temporales sin borrar (define NEON_PROJECT_ID para limpiarlos)')
}

process.exit(failures ? 1 : 0)
