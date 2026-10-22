// Pantalla de acceso: iniciar sesión o crear cuenta.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { signIn, signUp } from '../lib/auth'
import { Logo } from './Library'
import '../styles/library.css'

type Mode = 'in' | 'up'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (mode === 'up' && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'in') await signIn(email.trim(), password)
      else await signUp(name.trim() || email.trim().split('@')[0], email.trim(), password)
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la operación.')
      setBusy(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
  }

  return (
    <main className="login-wrap">
      <div className="login-card glass-float">
        <div className="login-brand">
          <Logo size={34} />
          <h1>Bienvenido a Verdant</h1>
          <p>{mode === 'in' ? 'Qué bueno verte de nuevo. Tus documentos te esperan.' : 'Crea tu cuenta y empieza a escribir en segundos.'}</p>
        </div>

        <div className="login-tabs" role="tablist" aria-label="Acceso">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'is-on' : ''} onClick={() => switchMode('in')}>
            Iniciar sesión
          </button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'is-on' : ''} onClick={() => switchMode('up')}>
            Crear cuenta
          </button>
        </div>

        <form className="login-form" onSubmit={submit}>
          {mode === 'up' && (
            <label className="login-field">
              <span>Nombre</span>
              <input className="input" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cómo te llamas" required />
            </label>
          )}
          <label className="login-field">
            <span>Correo</span>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
          </label>
          <label className="login-field">
            <span>Contraseña</span>
            <div className="login-pass">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                minLength={8}
                required
              />
              <button type="button" className="icon-btn" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow((s) => !s)}>
                {show ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </div>
          </label>

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy && <span className="spinner login-spin" />}
            {mode === 'in' ? 'Entrar' : 'Crear cuenta'}
          </button>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
        </form>
      </div>
    </main>
  )
}
