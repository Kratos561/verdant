import { useCallback, useEffect, useState } from 'react'
import { currentUser } from './lib/auth'
import type { User } from './lib/auth'
import { ToastProvider, useHashRoute } from './components/ui'
import Library from './pages/Library'
import Login from './pages/Login'
import Editor from './pages/Editor'

export default function App() {
  const route = useHashRoute()
  const [user, setUser] = useState<User | null | undefined>(undefined)

  const refresh = useCallback(() => {
    currentUser()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])
  useEffect(refresh, [refresh])

  const docId = route.match(/^\/d\/([\w-]+)/)?.[1]

  return (
    <ToastProvider>
      <div className="vd-backdrop" aria-hidden="true">
        <span />
      </div>
      {user === undefined ? (
        <div className="center-screen">
          <div className="spinner" aria-label="Cargando" />
        </div>
      ) : user === null ? (
        <Login onSignedIn={refresh} />
      ) : docId ? (
        <Editor key={docId} id={docId} user={user} />
      ) : (
        <Library user={user} />
      )}
    </ToastProvider>
  )
}
