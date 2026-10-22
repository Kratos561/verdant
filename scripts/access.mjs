// Gestión del acceso privado a Verdant (Neon Auth + tabla app_members).
//   node scripts/access.mjs crear-cuenta <email> [nombre]   crea la cuenta, la hace miembro y cierra el registro
//   node scripts/access.mjs miembros                         lista los miembros
//   node scripts/access.mjs quitar <email>                   quita el acceso a una cuenta
//   node scripts/access.mjs registro <abrir|cerrar>          abre o cierra el alta de cuentas nuevas
// Lee NEON_API_KEY de ~/.verdant/secrets.env. La contraseña generada se guarda en
// ~/.verdant/cuenta-verdant.txt y nunca se imprime.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import pg from 'pg'

const PROJECT = process.env.NEON_PROJECT_ID ?? 'long-fog-74067914'
const ORIGIN = 'https://kratos561.github.io'
const SECRETS = join(homedir(), '.verdant')
const KEY = process.env.NEON_API_KEY ?? readFileSync(join(SECRETS, 'secrets.env'), 'utf8').match(/^NEON_API_KEY=(.*)$/m)?.[1]?.trim()
if (!KEY) throw new Error('Falta NEON_API_KEY')

async function neon(method, path, body) {
  const r = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

const { branches } = await neon('GET', '/branches')
const branch = branches.find((b) => b.default) ?? branches[0]
const B = `/branches/${branch.id}`
const auth = await neon('GET', `${B}/auth`)
const { uri } = await neon('GET', `/connection_uri?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner`)
const db = new pg.Client({ connectionString: uri.replace('sslmode=require', 'sslmode=verify-full') })
await db.connect()

const mask = (email) => email.replace(/^(.).*(@.*)$/, '$1***$2')
const setSignUp = (open) => neon('PATCH', `${B}/auth/email_and_password`, { disable_sign_up: !open })

function password() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''))
  return groups.join('-')
}

const [cmd, arg, ...rest] = process.argv.slice(2)
try {
  if (cmd === 'crear-cuenta') {
    if (!arg) throw new Error('Uso: crear-cuenta <email> [nombre]')
    const email = arg.toLowerCase()
    const name = rest.join(' ') || email.split('@')[0]
    const exists = await db.query('select id from neon_auth."user" where lower(email) = $1', [email])
    if (exists.rowCount) throw new Error(`Ya existe una cuenta ${mask(email)}`)
    const pass = password()
    await setSignUp(true)
    let userId
    try {
      const r = await fetch(`${auth.base_url}/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email, password: pass, name }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(`alta ${r.status}: ${body.message ?? ''}`)
      userId = body.user.id
    } finally {
      await setSignUp(false)
    }
    await db.query('insert into app_members(user_id, note) values ($1, $2) on conflict do nothing', [userId, `cuenta principal ${mask(email)}`])
    const file = join(SECRETS, 'cuenta-verdant.txt')
    writeFileSync(
      file,
      `Cuenta de Verdant\nWeb: https://kratos561.github.io/verdant/\nCorreo: ${email}\nContraseña: ${pass}\n`,
      { encoding: 'utf8', flag: existsSync(file) ? 'w' : 'wx' },
    )
    console.log(`Cuenta creada y con acceso: ${mask(email)} (id ${userId})`)
    console.log(`Credenciales guardadas en ${file}`)
    console.log('Registro de cuentas nuevas: cerrado')
  } else if (cmd === 'miembros') {
    const r = await db.query(
      `select m.user_id, u.email, u.name, m.created_at from app_members m left join neon_auth."user" u on u.id::text = m.user_id order by m.created_at`,
    )
    for (const row of r.rows) console.log(`${row.user_id}  ${row.email ? mask(row.email) : '(sin cuenta)'}  ${row.name ?? ''}`)
    const others = await db.query(`select count(*)::int n from neon_auth."user" u where u.id::text not in (select user_id from app_members)`)
    console.log(`Cuentas sin acceso: ${others.rows[0].n}`)
    const cfg = await neon('GET', `${B}/auth/email_and_password`)
    console.log(`Registro de cuentas nuevas: ${cfg.disable_sign_up ? 'cerrado' : 'ABIERTO'}`)
  } else if (cmd === 'quitar') {
    const r = await db.query(
      `delete from app_members where user_id in (select id::text from neon_auth."user" where lower(email) = $1) returning user_id`,
      [String(arg).toLowerCase()],
    )
    console.log(r.rowCount ? `Acceso retirado a ${mask(arg)}` : 'Esa cuenta no era miembro')
  } else if (cmd === 'registro') {
    if (arg !== 'abrir' && arg !== 'cerrar') throw new Error('Uso: registro <abrir|cerrar>')
    await setSignUp(arg === 'abrir')
    console.log(`Registro de cuentas nuevas: ${arg === 'abrir' ? 'ABIERTO' : 'cerrado'}`)
  } else {
    console.log('Comandos: crear-cuenta <email> [nombre] · miembros · quitar <email> · registro <abrir|cerrar>')
  }
} finally {
  await db.end()
}
