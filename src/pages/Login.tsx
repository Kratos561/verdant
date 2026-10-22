// Pantalla de acceso. Verdant es privado: no hay alta de cuentas desde la web.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { signIn, signOut } from '../lib/auth'
import { Logo } from './Library'
import '../styles/library.css'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
      setBusy(false)
    }
  }

  return (
    <main className="login-wrap">
      <div className="login-card glass-float">
        <div className="login-brand">
          <Logo size={34} />
          <h1>Verdant</h1>
          <p>Espacio privado. Entra con la cuenta que tiene acceso.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="login-field">
            <span>Correo</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
          </label>
          <label className="login-field">
            <span>Contraseña</span>
            <div className="login-pass">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="icon-btn" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow((s) => !s)}>
                {show ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </div>
          </label>

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy && <span className="spinner login-spin" />}
            Entrar
          </button>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
        </form>
        <p className="login-private">
          <Lock size={13} strokeWidth={1.75} /> El registro está cerrado. Solo las cuentas autorizadas pueden entrar.
        </p>
      </div>
    </main>
  )
}

/** Sesión válida pero sin permiso: RLS ya bloquea los datos; aquí se explica y se ofrece salir. */
export function AccessDenied({ email }: { email: string }) {
  return (
    <main className="login-wrap">
      <div className="login-card glass-float">
        <div className="login-brand">
          <Logo size={34} />
          <h1>Sin acceso</h1>
          <p>La cuenta {email} no está autorizada para usar este Verdant.</p>
        </div>
        <button className="btn btn-primary login-submit" onClick={() => signOut().then(() => location.reload())}>
          Cerrar sesión
        </button>
      </div>
    </main>
  )
}
