// Panel derecho: comentarios en hilos, sugerencias, historial de versiones y modo.
import type { Editor } from '@tiptap/react'
import { Check, ChevronRight, CornerDownRight, History, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { avatarColor, initials, timeAgo, useTick, useToast } from '../components/ui'
import type { User } from '../lib/auth'
import { store } from '../lib/store'
import type { Comment, Version } from '../lib/store'
import type { EditorMode } from './Toolbar'

export interface CommentDraft {
  quote: string
  from: number
  to: number
}

interface Props {
  editor: Editor
  docId: string
  user: User
  mode: EditorMode
  setMode: (m: EditorMode) => void
  draft: CommentDraft | null
  clearDraft: () => void
  versionsKey: number
  onSaveVersion: () => void
  onPreviewVersion: (v: Version) => void
  onClose: () => void
}

export default function SidePanel(p: Props) {
  useTick()
  const toast = useToast()
  const [comments, setComments] = useState<Comment[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [open, setOpen] = useState({ comments: true, suggestions: false, history: true })

  useEffect(() => {
    store.listComments(p.docId).then(setComments).catch(() => toast('No se pudieron cargar los comentarios', { error: true }))
  }, [p.docId, toast])
  useEffect(() => {
    store.listVersions(p.docId).then(setVersions).catch(() => {})
  }, [p.docId, p.versionsKey])

  const unmark = useCallback(
    (id: string) => {
      const { state } = p.editor
      const type = state.schema.marks.comment
      const tr = state.tr
      state.doc.descendants((node, pos) => {
        node.marks.forEach((m) => {
          if (m.type === type && m.attrs.commentId === id) tr.removeMark(pos, pos + node.nodeSize, m)
        })
      })
      if (tr.docChanged) p.editor.view.dispatch(tr)
    },
    [p.editor],
  )

  const submit = async () => {
    if (!p.draft || !body.trim()) return
    try {
      const c = await store.addComment({ document_id: p.docId, quote: p.draft.quote, body: body.trim(), author_name: p.user.name })
      setComments((all) => [...all, c])
      p.editor.chain().setTextSelection({ from: p.draft.from, to: p.draft.to }).setMark('comment', { commentId: c.id }).run()
      setBody('')
      p.clearDraft()
      toast('Comentario guardado', {
        action: {
          label: 'Deshacer',
          run: () => {
            unmark(c.id)
            store.deleteComment(c.id).catch(() => {})
            setComments((all) => all.filter((x) => x.id !== c.id))
          },
        },
      })
    } catch (e) {
      toast(`No se pudo guardar: ${(e as Error).message}`, { error: true })
    }
  }

  const sendReply = async (parent: Comment) => {
    if (!reply.trim()) return
    try {
      const c = await store.addComment({ document_id: p.docId, quote: '', body: reply.trim(), author_name: p.user.name, parent_id: parent.id })
      setComments((all) => [...all, c])
      setReply('')
      setReplyTo(null)
    } catch (e) {
      toast(`No se pudo responder: ${(e as Error).message}`, { error: true })
    }
  }

  const setResolved = async (c: Comment, resolved: boolean) => {
    setComments((all) => all.map((x) => (x.id === c.id ? { ...x, resolved } : x)))
    try {
      await store.updateComment(c.id, { resolved })
    } catch {
      setComments((all) => all.map((x) => (x.id === c.id ? { ...x, resolved: !resolved } : x)))
      toast('No se pudo actualizar el comentario', { error: true })
    }
  }

  const remove = async (c: Comment) => {
    const before = comments
    setComments((all) => all.filter((x) => x.id !== c.id && x.parent_id !== c.id))
    unmark(c.id)
    try {
      await store.deleteComment(c.id)
    } catch {
      setComments(before)
      toast('No se pudo borrar el comentario', { error: true })
    }
  }

  const focusAnchor = (id: string) => {
    const type = p.editor.state.schema.marks.comment
    let range: { from: number; to: number } | null = null
    p.editor.state.doc.descendants((node, pos) => {
      if (range) return false
      if (node.marks.some((m) => m.type === type && m.attrs.commentId === id)) range = { from: pos, to: pos + node.nodeSize }
    })
    if (range) p.editor.chain().focus().setTextSelection(range).scrollIntoView().run()
  }

  const threads = comments.filter((c) => !c.parent_id && (showResolved || !c.resolved))
  const resolvedCount = comments.filter((c) => !c.parent_id && c.resolved).length

  return (
    <aside className="side glass" aria-label="Comentarios e historial">
      <header className="side-head">
        <h2>Panel</h2>
        <button className="icon-btn" aria-label="Cerrar panel" onClick={p.onClose}><X size={16} /></button>
      </header>

      <div className="side-scroll">
        <Section title="Comentarios" count={threads.length} open={open.comments} toggle={() => setOpen((o) => ({ ...o, comments: !o.comments }))}>
          {p.draft && (
            <div className="composer">
              <blockquote>{p.draft.quote}</blockquote>
              <textarea
                className="input"
                autoFocus
                rows={3}
                placeholder="Escribe un comentario…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
              />
              <div className="row-end">
                <button className="btn btn-ghost" onClick={() => (p.clearDraft(), setBody(''))}>Cancelar</button>
                <button className="btn btn-primary" onClick={submit} disabled={!body.trim()}>Comentar</button>
              </div>
            </div>
          )}
          {threads.length === 0 && !p.draft && (
            <p className="muted">Selecciona texto y pulsa <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> para comentar.</p>
          )}
          {threads.map((c) => (
            <article key={c.id} className={`thread${c.resolved ? ' is-resolved' : ''}`}>
              <button className="thread-quote" onClick={() => focusAnchor(c.id)} title="Ir al texto">
                {c.quote}
              </button>
              <CommentRow c={c} />
              {comments
                .filter((r) => r.parent_id === c.id)
                .map((r) => (
                  <div key={r.id} className="reply">
                    <CornerDownRight size={14} />
                    <CommentRow c={r} />
                  </div>
                ))}
              {replyTo === c.id ? (
                <div className="composer">
                  <textarea className="input" autoFocus rows={2} placeholder="Responder…" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className="row-end">
                    <button className="btn btn-ghost" onClick={() => setReplyTo(null)}>Cancelar</button>
                    <button className="btn btn-primary" onClick={() => sendReply(c)} disabled={!reply.trim()}>Responder</button>
                  </div>
                </div>
              ) : (
                <div className="thread-actions">
                  <button className="btn btn-ghost" onClick={() => (setReplyTo(c.id), setReply(''))}>Responder</button>
                  <button className="btn btn-ghost" onClick={() => setResolved(c, !c.resolved)}>
                    <Check size={14} /> {c.resolved ? 'Reabrir' : 'Resolver'}
                  </button>
                  <button className="icon-btn" aria-label="Borrar comentario" onClick={() => remove(c)}><Trash2 size={14} /></button>
                </div>
              )}
            </article>
          ))}
          {resolvedCount > 0 && (
            <button className="link-btn" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? 'Ocultar resueltos' : `Ver resueltos (${resolvedCount})`}
            </button>
          )}
        </Section>

        <Section title="Sugerencias" open={open.suggestions} toggle={() => setOpen((o) => ({ ...o, suggestions: !o.suggestions }))}>
          <div className="soon">
            <MessageSquare size={16} strokeWidth={1.5} />
            <p>El modo sugerencia (cambios propuestos con aceptar y rechazar) llega con la colaboración en tiempo real.</p>
          </div>
        </Section>

        <Section title="Historial" count={versions.length} open={open.history} toggle={() => setOpen((o) => ({ ...o, history: !o.history }))}>
          <button className="btn" onClick={p.onSaveVersion}><History size={14} /> Guardar versión ahora</button>
          <ol className="timeline">
            {versions.map((v) => (
              <li key={v.id}>
                <button onClick={() => p.onPreviewVersion(v)}>
                  <strong>{v.label || 'Guardado automático'}</strong>
                  <span>{timeAgo(v.created_at)}</span>
                </button>
                <RotateCcw size={13} aria-hidden />
              </li>
            ))}
            {versions.length === 0 && <li className="muted">Las versiones se guardan solas cada 10 minutos de edición.</li>}
          </ol>
        </Section>
      </div>

      <footer className="side-mode">
        <span>Modo</span>
        <div className="seg" role="radiogroup" aria-label="Modo del documento">
          <button role="radio" aria-checked={p.mode === 'edit'} className={p.mode === 'edit' ? 'is-on' : ''} onClick={() => p.setMode('edit')}>
            Editar
          </button>
          <button role="radio" aria-checked={false} disabled title="Llega con la colaboración en tiempo real">
            Sugerir
          </button>
          <button role="radio" aria-checked={p.mode === 'view'} className={p.mode === 'view' ? 'is-on' : ''} onClick={() => p.setMode('view')}>
            Ver
          </button>
        </div>
      </footer>
    </aside>
  )
}

function Section(props: { title: string; count?: number; open: boolean; toggle: () => void; children: React.ReactNode }) {
  return (
    <section className={`sec${props.open ? ' is-open' : ''}`}>
      <button className="sec-head" aria-expanded={props.open} onClick={props.toggle}>
        <ChevronRight size={14} className="sec-chev" />
        <span>{props.title}</span>
        {props.count ? <span className="sec-count">{props.count}</span> : null}
      </button>
      {props.open && <div className="sec-body">{props.children}</div>}
    </section>
  )
}

function CommentRow({ c }: { c: Comment }) {
  return (
    <div className="comment">
      <span className="avatar" style={{ background: avatarColor(c.author_name || 'x'), width: 24, height: 24, fontSize: 11 }}>
        {initials(c.author_name || '?')}
      </span>
      <div>
        <div className="comment-meta">
          <strong>{c.author_name || 'Anónimo'}</strong>
          <span>{timeAgo(c.created_at)}</span>
        </div>
        <p>{c.body}</p>
      </div>
    </div>
  )
}
