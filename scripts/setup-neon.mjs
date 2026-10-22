// Prepara Neon para Verdant: proyecto, Neon Auth, Data API, dominio de confianza y migraciones.
// Lee NEON_API_KEY del entorno o de %USERPROFILE%\.verdant\secrets.env y nunca la imprime.
// Es idempotente: se puede volver a ejecutar para aplicar migraciones nuevas.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://console.neon.tech/api/v2'
const PROJECT_NAME = 'verdant'
const DATABASE = 'neondb'
const ROLE = 'neondb_owner'
const TRUSTED_DOMAINS = (process.env.VERDANT_DOMAINS ?? 'https://kratos561.github.io').split(',')

function secret(name) {
  if (process.env[name]) return process.env[name]
  const file = join(homedir(), '.verdant', 'secrets.env')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim()
}

const KEY = secret('NEON_API_KEY')
if (!KEY) throw new Error('Falta NEON_API_KEY (entorno o ~/.verdant/secrets.env)')

async function neon(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  return { ok: res.ok, status: res.status, data }
}

async function must(method, path, body) {
  const r = await neon(method, path, body)
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${r.data?.message ?? ''}`)
  return r.data
}

async function waitOperations(projectId) {
  for (let i = 0; i < 60; i++) {
    const { operations = [] } = await must('GET', `/projects/${projectId}/operations?limit=20`)
    if (operations.every((o) => ['finished', 'skipped', 'cancelled'].includes(o.status))) return
    await new Promise((r) => setTimeout(r, 2000))
  }
}

// 1 · Proyecto (las cuentas con organización exigen org_id)
const { organizations = [] } = (await neon('GET', '/users/me/organizations')).data
const orgId = process.env.NEON_ORG_ID ?? organizations[0]?.id
const orgQuery = orgId ? `&org_id=${orgId}` : ''
const { projects } = await must('GET', `/projects?search=${PROJECT_NAME}&limit=50${orgQuery}`)
let project = projects.find((p) => p.name === PROJECT_NAME)
if (!project) {
  const created = await must('POST', '/projects', {
    project: { name: PROJECT_NAME, region_id: 'aws-us-east-1', pg_version: 17, ...(orgId ? { org_id: orgId } : {}) },
  })
  project = created.project
  console.log(`Proyecto creado: ${project.id}`)
} else {
  console.log(`Proyecto existente: ${project.id}`)
}
await waitOperations(project.id)

const { branches } = await must('GET', `/projects/${project.id}/branches`)
const branch = branches.find((b) => b.default) ?? branches[0]
const base = `/projects/${project.id}/branches/${branch.id}`

// 2 · Neon Auth (Better Auth gestionado)
let auth = await neon('GET', `${base}/auth`)
if (!auth.ok) {
  await must('POST', `${base}/auth`, { auth_provider: 'better_auth', database_name: DATABASE })
  await waitOperations(project.id)
  auth = await neon('GET', `${base}/auth`)
  console.log('Neon Auth activado')
}

// 3 · Data API con Neon Auth (crea el esquema auth y auth.user_id())
let dataApi = await neon('GET', `${base}/data-api/${DATABASE}`)
if (!dataApi.ok) {
  dataApi = { data: await must('POST', `${base}/data-api/${DATABASE}`, { auth_provider: 'neon_auth' }) }
  await waitOperations(project.id)
  console.log('Data API activada')
}

// 4 · Dominios de confianza para redirecciones de Auth
const { domains = [] } = (await neon('GET', `${base}/auth/domains`)).data
for (const domain of TRUSTED_DOMAINS) {
  if (!domains.some((d) => d.domain === domain)) {
    await must('POST', `${base}/auth/domains`, { domain, auth_provider: 'better_auth' })
    console.log(`Dominio de confianza: ${domain}`)
  }
}

// 5 · Migraciones
const { uri } = await must(
  'GET',
  `/projects/${project.id}/connection_uri?branch_id=${branch.id}&database_name=${DATABASE}&role_name=${ROLE}`,
)
const db = new pg.Client({ connectionString: uri })
await db.connect()
await db.query('create table if not exists _migrations (name text primary key, applied_at timestamptz default now())')
const done = new Set((await db.query('select name from _migrations')).rows.map((r) => r.name))
const dir = join(ROOT, 'db', 'migrations')
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue
  await db.query('begin')
  try {
    await db.query(readFileSync(join(dir, file), 'utf8'))
    await db.query('insert into _migrations(name) values ($1)', [file])
    await db.query('commit')
    console.log(`Migración aplicada: ${file}`)
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}
await db.end()

// 6 · Refrescar la caché de esquema de la Data API
await neon('PATCH', `${base}/data-api/${DATABASE}`, {})

// 7 · URL pública para el cliente (no es un secreto)
const dataUrl = new URL(dataApi.data.url)
const neonUrl = `https://${dataUrl.host.replace('.apirest.', '.')}/${DATABASE}`
writeFileSync(join(ROOT, '.env.local'), `VITE_NEON_URL=${neonUrl}\n`, 'utf8')
console.log(`VITE_NEON_URL=${neonUrl}`)
console.log(`auth: ${auth.data?.base_url ?? '(ver consola de Neon)'}`)
