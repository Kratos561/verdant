import { useCallback, useEffect, useState } from 'react'
import { currentUser, isMember } from './lib/auth'
import type { User } from './lib/auth'
import { ToastProvider, useHashRoute } from './components/ui'
import Library from './pages/Library'
import Login, { AccessDenied } from './pages/Login'
import Editor from './pages/Editor'

type Session = { user: User; member: boolean } | null

export default function App() {
  const route = useHashRoute()
  const [session, setSession] = useState<Session | undefined>(undefined)

  const refresh = useCallback(() => {
    currentUser()
      .then(async (user) => setSession(user ? { user, member: await isMember() } : null))
      .catch(() => setSession(null))
  }, [])
  useEffect(refresh, [refresh])

  const docId = route.match(/^\/d\/([\w-]+)/)?.[1]

  return (
    <ToastProvider>
      <div className="vd-backdrop" aria-hidden="true">
        <span />
      </div>
      {session === undefined ? (
        <div className="center-screen">
          <div className="spinner" aria-label="Cargando" />
        </div>
      ) : session === null ? (
        <Login onSignedIn={refresh} />
      ) : !session.member ? (
        <AccessDenied email={session.user.email} />
      ) : docId ? (
        <Editor key={docId} id={docId} user={session.user} />
      ) : (
        <Library user={session.user} />
      )}
    </ToastProvider>
  )
}
