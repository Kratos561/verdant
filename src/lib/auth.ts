// Sesión de usuario. Neon Auth (Better Auth gestionado) firma el JWT que la Data API
// usa para RLS; neon-js lo adjunta solo a cada consulta.
import { createClient } from '@neondatabase/neon-js'

const NEON_URL = import.meta.env.VITE_NEON_URL as string | undefined

export const neonClient = NEON_URL ? createClient(NEON_URL) : null

export interface User {
  id: string
  name: string
  email: string
}

const LOCAL_USER: User = { id: 'local', name: 'Tú', email: 'modo local' }

interface AuthResult {
  data: unknown
  error: { message?: string; status?: number } | null
}

function toUser(u: { id: string; name?: string | null; email?: string | null }): User {
  const email = u.email ?? ''
  return { id: u.id, email, name: u.name || email.split('@')[0] || 'Usuario' }
}

function check(r: AuthResult): void {
  if (r.error) throw new Error(translate(r.error.message ?? 'No se pudo completar la operación'))
}

function translate(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid email or password')) return 'Correo o contraseña incorrectos.'
  if (m.includes('already exists')) return 'Ya existe una cuenta con ese correo.'
  if (m.includes('password') && m.includes('short')) return 'La contraseña debe tener al menos 8 caracteres.'
  if (m.includes('invalid email')) return 'El correo no es válido.'
  return msg
}

export async function currentUser(): Promise<User | null> {
  if (!neonClient) return LOCAL_USER
  const r = (await neonClient.auth.getSession()) as AuthResult
  const user = (r.data as { user?: { id: string; name?: string; email?: string } } | null)?.user
  return user ? toUser(user) : null
}

export async function signIn(email: string, password: string): Promise<void> {
  check((await neonClient!.auth.signIn.email({ email, password })) as AuthResult)
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  check((await neonClient!.auth.signUp.email({ name, email, password })) as AuthResult)
}

export async function signOut(): Promise<void> {
  if (neonClient) await neonClient.auth.signOut()
}

export const isLocalMode = !neonClient
