// Piezas de interfaz compartidas: menú desplegable, modal, toasts y router por hash.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// ---------- Router ----------

export function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function navigate(path: string): void {
  location.hash = path
}

// ---------- Menú ----------

export interface MenuEntry {
  label?: string
  icon?: ReactNode
  kbd?: string
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  heading?: string
  checked?: boolean
}

interface MenuProps {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  items: MenuEntry[]
  align?: 'start' | 'end'
}

export function Menu({ anchor, open, onClose, items, align = 'start' }: MenuProps) {
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} align={align} role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : it.heading ? (
          <div key={i} className="menu-label">{it.heading}</div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className="menu-item"
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              onClose()
              it.onSelect?.()
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.checked && <span className="kbd" style={{ color: 'var(--accent)' }}>✓</span>}
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </Popover>
  )
}

/** Capa flotante anclada a un elemento; se cierra al pulsar fuera o con Escape. */
export function Popover(props: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  align?: 'start' | 'end'
  role?: string
  children: ReactNode
}) {
  const { anchor, open, onClose, align = 'start' } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return
    const a = anchor.getBoundingClientRect()
    const m = ref.current.getBoundingClientRect()
    let left = align === 'end' ? a.right - m.width : a.left
    left = Math.max(8, Math.min(left, innerWidth - m.width - 8))
    let top = a.bottom + 6
    if (top + m.height > innerHeight - 8) top = Math.max(8, a.top - m.height - 6)
    setPos({ top, left })
  }, [open, anchor, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div ref={ref} className="menu glass-float" role={props.role} style={pos}>
      {props.children}
    </div>,
    document.body,
  )
}

/** Botón que abre un menú anclado a sí mismo. */
export function MenuButton(props: {
  items: MenuEntry[]
  children: ReactNode
  className?: string
  title?: string
  align?: 'start' | 'end'
}) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button
        ref={setEl}
        className={props.className}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {props.children}
      </button>
      <Menu anchor={el} open={open} onClose={close} items={props.items} align={props.align} />
    </>
  )
}

// ---------- Modal ----------

export function Modal(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.open, props.onClose])
  if (!props.open) return null
  return createPortal(
    <div className="modal-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal glass-float" role="dialog" aria-modal="true" aria-label={props.title} style={props.width ? { width: `min(${props.width}px, 100%)` } : undefined}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>,
    document.body,
  )
}

// ---------- Toasts ----------

interface Toast {
  id: number
  text: string
  error?: boolean
  action?: { label: string; run: () => void }
}

type ToastFn = (text: string, opts?: { error?: boolean; action?: Toast['action'] }) => void
const ToastCtx = createContext<ToastFn>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback<ToastFn>((text, opts) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast glass-float${t.error ? ' is-error' : ''}`}>
              <span className="toast-dot" />
              <span>{t.text}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.run()
                    setToasts((all) => all.filter((x) => x.id !== t.id))
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

// ---------- Utilidades ----------

const AVATAR_COLORS = ['#3ddc97', '#f2c94c', '#b59cff', '#5ec8f2', '#ff8fa3', '#9be15d', '#ffb86b', '#7ee0d2']

export function avatarColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function timeAgo(iso: string | number): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 5) return 'ahora'
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 7) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Re-renderiza cada `ms` para mantener frescos los "hace X". */
export function useTick(ms = 15000): void {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}
