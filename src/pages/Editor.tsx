// Página del editor: barra superior, barra de herramientas, esquema, hoja y panel lateral.
import { generateHTML } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold, Cloud, CloudOff, FolderInput, Italic, Link2, Loader2, MessageSquare, MessageSquarePlus, PanelLeft, Share2,
  Star, Strikethrough, Underline as UnderlineIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { MenuButton, Modal, avatarColor, initials, navigate, timeAgo, useTick, useToast } from '../components/ui'
import type { User } from '../lib/auth'
import { COURIER_STACK } from '../lib/fonts'
import { IMPORT_ACCEPT, exportDocument, importFile } from '../lib/io-lazy'
import type { ExportFormat } from '../lib/io-lazy'
import { EMPTY_DOC, UNTITLED, store } from '../lib/store'
import type { Doc, DocSettings, Folder, Version } from '../lib/store'
import { DocSync, REMOTE } from '../lib/sync'
import type { SyncStatus } from '../lib/sync'
import { baseExtensions, contentToText, contentToYDoc, editorExtensions, htmlToContent } from '../editor/extensions'
import FindReplace from '../editor/FindReplace'
import Outline from '../editor/Outline'
import SidePanel from '../editor/SidePanel'
import type { CommentDraft } from '../editor/SidePanel'
import { SlashCommand } from '../editor/SlashCommand'
import Toolbar from '../editor/Toolbar'
import { PAGINATION_REFRESH, Pagination } from '../editor/Pagination'
import type { PageGeometry } from '../editor/Pagination'
import { PAGE_GAP, PAPER, fillPageTokens, pageBox, pageSetup } from '../editor/page'
import type { EditorMode } from '../editor/Toolbar'
import { Logo } from './Library'
import '../styles/editor.css'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type Dialog = null | 'rename' | 'page' | 'words' | 'shortcuts' | 'link' | 'share' | 'move' | 'trash'

const SAVE_DELAY = 700
const SNAPSHOT_EVERY = 10 * 60 * 1000

interface Live {
  doc: Doc
  ydoc: Y.Doc
  sync: DocSync
}

interface Peer {
  id: number
  name: string
  color: string
}

/** Estado Yjs inicial: contenido del documento + título y ajustes compartidos en el mapa `meta`. */
function seedYDoc(doc: Doc): Y.Doc {
  let ydoc: Y.Doc
  try {
    ydoc = contentToYDoc(doc.content ?? EMPTY_DOC)
  } catch {
    // Si el JSON no encaja con el esquema, se repara pasando por HTML; si tampoco, se aborta
    // (mejor un error visible que guardar un documento vacío encima del contenido).
    ydoc = contentToYDoc(htmlToContent(generateHTML(doc.content, baseExtensions())))
  }
  const meta = ydoc.getMap('meta')
  meta.set('title', doc.title)
  meta.set('settings', doc.settings ?? {})
  return ydoc
}

export default function EditorPage({ id, user }: { id: string; user: User }) {
  const [live, setLive] = useState<Live | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    let sync: DocSync | null = null
    ;(async () => {
      const doc = await store.getDoc(id)
      if (!doc || doc.trashed_at) return void (cancelled || setLive(null))
      const ydoc = new Y.Doc()
      sync = new DocSync(ydoc, doc.id, store.transport)
      // El editor se monta cuando el estado ya está cargado; si no, Yjs duplicaría el párrafo inicial.
      await sync.start(() => seedYDoc(doc))
      if (cancelled) return void sync.stop()
      setLive({ doc, ydoc, sync })
    })().catch(() => cancelled || setLive(null))
    return () => {
      cancelled = true
      void sync?.stop()
    }
  }, [id])

  if (live === undefined) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-label="Abriendo documento" />
      </div>
    )
  }
  if (live === null) {
    return (
      <div className="center-screen">
        <div className="glass-float modal">
          <h2>No pudimos abrir este documento</h2>
          <p>Puede que se haya eliminado, que esté en la papelera o que no haya conexión.</p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => navigate('/')}>Ir a la biblioteca</button>
          </div>
        </div>
      </div>
    )
  }
  return <Workspace live={live} user={user} />
}

function Workspace({ live, user }: { live: Live; user: User }) {
  useTick(5000)
  const toast = useToast()
  const initial = live.doc
  const meta = useMemo(() => live.ydoc.getMap<unknown>('meta'), [live])
  const [doc, setDoc] = useState<Doc>(() => ({
    ...initial,
    title: (meta.get('title') as string | undefined) ?? initial.title,
    settings: (meta.get('settings') as DocSettings | undefined) ?? initial.settings,
  }))
  const [title, setTitle] = useState(doc.title)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(live.sync.status)
  const [peers, setPeers] = useState<Peer[]>([])
  const [commentsRev, setCommentsRev] = useState(0)
  const titleFocused = useRef(false)
  const [save, setSave] = useState<SaveState>('saved')
  const [savedAt, setSavedAt] = useState(Date.parse(initial.updated_at))
  const [mode, setMode] = useState<EditorMode>('edit')
  const [showOutline, setShowOutline] = useState(() => innerWidth > 1100)
  const [showPanel, setShowPanel] = useState(() => innerWidth > 1280)
  const [focusMode, setFocusMode] = useState(false)
  const [finding, setFinding] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [draft, setDraft] = useState<CommentDraft | null>(null)
  const [versionsKey, setVersionsKey] = useState(0)
  const [preview, setPreview] = useState<Version | null>(null)
  const [spellcheck, setSpellcheck] = useState(true)
  const [folders, setFolders] = useState<Folder[]>([])

  const timer = useRef<number | undefined>(undefined)
  const lastSnapshot = useRef(Date.now())
  const editorRef = useRef<TiptapEditor | null>(null)

  const settings = doc.settings
  const docFont = settings.font ?? COURIER_STACK

  const persist = useCallback(async () => {
    const ed = editorRef.current
    if (!ed) return
    clearTimeout(timer.current)
    const content = ed.getJSON()
    setSave('saving')
    try {
      await store.updateDoc(doc.id, { content, text_plain: contentToText(content).slice(0, 20000) })
      setSave('saved')
      setSavedAt(Date.now())
      if (Date.now() - lastSnapshot.current > SNAPSHOT_EVERY) {
        lastSnapshot.current = Date.now()
        await store.createVersion(doc.id, { title, content, label: null })
        setVersionsKey((k) => k + 1)
        meta.set('versionsRev', Date.now())
      }
    } catch {
      setSave('error')
    }
  }, [doc.id, title, meta])

  const persistRef = useRef(persist)
  persistRef.current = persist

  // Paginación: la geometría vive en un ref para que el plugin la lea sin recrear el editor.
  const [pages, setPages] = useState(1)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const canvasRef = useRef<HTMLElement | null>(null)
  const box = pageBox(doc.settings)
  const pagedView = doc.settings.pageMode === 'paged' && innerWidth >= 760
  const geometry = useRef<PageGeometry | null>(null)
  geometry.current = pagedView ? { height: box.h, marginTop: box.top, marginBottom: box.bottom, gap: PAGE_GAP } : null

  const caretUser = useMemo(() => ({ name: user.name, color: avatarColor(`${user.id}:${live.ydoc.clientID}`) }), [user, live])
  const editor = useEditor({
    extensions: [
      ...editorExtensions(live.ydoc, live.sync.awareness, caretUser),
      SlashCommand,
      Pagination.configure({ geometry: () => geometry.current, onPages: setPages }),
    ],
    autofocus: initial.text_plain ? false : 'start',
    editorProps: { attributes: { class: 'vd-prose', spellcheck: 'true', 'aria-label': 'Contenido del documento' } },
    onUpdate: ({ transaction }) => {
      // Los cambios que llegan de otro cliente ya los guarda quien los hizo.
      if ((transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin) return
      setSave('dirty')
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => persistRef.current(), SAVE_DELAY)
    },
  })
  editorRef.current = editor

  // Recalcula las hojas cuando cambian el diseño, el tamaño o los márgenes.
  const geometryKey = JSON.stringify(geometry.current)
  useEffect(() => {
    editor?.view.dispatch(editor.state.tr.setMeta(PAGINATION_REFRESH, true))
  }, [editor, geometryKey])
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  // Estado de la conexión y quién más está en el documento.
  useEffect(() => live.sync.onStatus(setSyncStatus), [live])
  useEffect(() => {
    const aw = live.sync.awareness
    const read = () =>
      setPeers(
        [...aw.getStates()]
          .filter(([id, s]) => id !== live.ydoc.clientID && s.user)
          .map(([id, s]) => ({ id, name: String(s.user.name ?? '?'), color: String(s.user.color ?? '#3ddc97') })),
      )
    aw.on('change', read)
    read()
    return () => aw.off('change', read)
  }, [live])

  // Título, ajustes y avisos de comentarios o versiones viajan por el mapa compartido `meta`.
  useEffect(() => {
    const on = (e: Y.YMapEvent<unknown>) => {
      if (e.transaction.origin !== REMOTE) return
      if (e.keysChanged.has('title') && !titleFocused.current) {
        const t = String(meta.get('title') ?? UNTITLED)
        setTitle(t)
        setDoc((d) => ({ ...d, title: t }))
      }
      if (e.keysChanged.has('settings')) setDoc((d) => ({ ...d, settings: (meta.get('settings') as DocSettings) ?? {} }))
      if (e.keysChanged.has('commentsRev')) setCommentsRev((n) => n + 1)
      if (e.keysChanged.has('versionsRev')) setVersionsKey((n) => n + 1)
    }
    meta.observe(on)
    return () => meta.unobserve(on)
  }, [meta])
  const announce = useCallback((key: 'commentsRev' | 'versionsRev') => meta.set(key, Date.now()), [meta])

  useEffect(() => {
    editor?.setEditable(mode === 'edit')
  }, [editor, mode])
  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])
  useEffect(() => {
    document.title = `${title || UNTITLED} · Verdant`
    return () => {
      document.title = 'Verdant'
    }
  }, [title])

  // Guarda lo pendiente al salir de la página o al ocultar la pestaña.
  useEffect(() => {
    const flush = () => {
      void live.sync.flush()
      if (save !== 'saved') void persistRef.current()
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [save, live])
  useEffect(() => () => void persistRef.current(), [])

  const patchDoc = useCallback(
    async (patch: Partial<Doc>, okMsg?: string) => {
      const before = doc
      setDoc((d) => ({ ...d, ...patch }))
      try {
        await store.updateDoc(doc.id, patch)
        if (okMsg) toast(okMsg)
      } catch (e) {
        setDoc(before)
        toast(`No se pudo guardar: ${(e as Error).message}`, { error: true })
      }
    },
    [doc, toast],
  )

  const setSettings = (p: Partial<DocSettings>) => {
    const next = { ...settings, ...p }
    meta.set('settings', next)
    patchDoc({ settings: next })
  }

  const commitTitle = (value = title) => {
    const t = value.trim() || UNTITLED
    setTitle(t)
    if (t === doc.title) return
    meta.set('title', t)
    patchDoc({ title: t })
  }

  const startComment = useCallback(() => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    if (empty) return toast('Selecciona el texto que quieres comentar')
    setDraft({ from, to, quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 280) })
    setShowPanel(true)
  }, [editor, toast])

  const saveVersion = async () => {
    if (!editor) return
    try {
      await store.createVersion(doc.id, { title, content: editor.getJSON(), label: `Versión del ${new Date().toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}` })
      lastSnapshot.current = Date.now()
      setVersionsKey((k) => k + 1)
      announce('versionsRev')
      setShowPanel(true)
      toast('Versión guardada')
    } catch (e) {
      toast(`No se pudo guardar la versión: ${(e as Error).message}`, { error: true })
    }
  }

  const restore = async (v: Version) => {
    if (!editor) return
    await store.createVersion(doc.id, { title, content: editor.getJSON(), label: 'Antes de restaurar' })
    editor.commands.setContent(v.content, { emitUpdate: true })
    setPreview(null)
    setVersionsKey((k) => k + 1)
    announce('versionsRev')
    toast('Versión restaurada')
  }

  const exportAs = (format: ExportFormat) => {
    if (!editor) return
    exportDocument(format, { title, html: editor.getHTML(), json: editor.getJSON(), text: editor.getText(), settings }).catch((e) =>
      toast(`No se pudo exportar: ${(e as Error).message}`, { error: true }),
    )
  }

  const importInto = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMPORT_ACCEPT
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !editor) return
      try {
        const r = await importFile(file)
        const content = r.content ?? htmlToContent(r.html ?? '')
        editor.chain().focus().insertContent(content.content ?? []).run()
        toast(`«${file.name}» insertado`)
        for (const w of r.warnings ?? []) toast(w)
      } catch (e) {
        toast((e as Error).message, { error: true })
      }
    }
    input.click()
  }

  const newDoc = async () => {
    const d = await store.createDoc({ folder_id: doc.folder_id, settings: { font: docFont } })
    navigate(`/d/${d.id}`)
  }

  const copyDoc = async () => {
    if (!editor) return
    const content = editor.getJSON()
    const d = await store.createDoc({ title: `Copia de ${title}`, content, text_plain: contentToText(content), folder_id: doc.folder_id, settings })
    navigate(`/d/${d.id}`)
    toast('Copia creada')
  }

  const trash = async () => {
    await store.updateDoc(doc.id, { trashed_at: new Date().toISOString() })
    navigate('/')
    toast('Documento movido a la papelera')
  }

  // Atajos globales del editor.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's') (e.preventDefault(), persistRef.current().then(() => toast('Guardado')))
      else if (k === 'h' || (k === 'f' && !e.shiftKey)) (e.preventDefault(), setFinding(true))
      else if (k === 'p') (e.preventDefault(), exportAs('pdf'))
      else if (k === 'k') (e.preventDefault(), setDialog('link'))
      else if (k === '/') (e.preventDefault(), setDialog('shortcuts'))
      else if (e.altKey && k === 'm') (e.preventDefault(), startComment())
      else if (e.shiftKey && k === 'c') (e.preventDefault(), setDialog('words'))
      else if (e.shiftKey && k === 'f') (e.preventDefault(), setFocusMode((f) => !f))
    }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  })

  if (!editor) return null

  const actions = {
    newDoc,
    copyDoc,
    goHome: () => navigate('/'),
    importInto,
    exportAs,
    rename: () => setDialog('rename'),
    trash: () => setDialog('trash'),
    pageSetup: () => setDialog('page'),
    find: () => setFinding(true),
    wordCount: () => setDialog('words'),
    shortcuts: () => setDialog('shortcuts'),
    comment: startComment,
    link: () => setDialog('link'),
    toggleOutline: () => setShowOutline((v) => !v),
    togglePanel: () => setShowPanel((v) => !v),
    toggleFocus: () => setFocusMode((f) => !f),
    setMode,
    saveVersion,
    error: (msg: string) => toast(msg, { error: true }),
  }

  const paged = pagedView
  // Si la hoja no cabe a lo ancho, se reduce (como el zoom de Word) sin alterar la medición.
  const scale = paged && canvasWidth ? Math.min(1, (canvasWidth - 24) / box.w) : 1
  const pagesHeight = pages * (box.h + PAGE_GAP) - PAGE_GAP

  return (
    <div className={`ed${focusMode ? ' is-focus' : ''}${showOutline ? ' has-outline' : ''}${showPanel ? ' has-panel' : ''}`}>
      <header className="ed-top glass">
        <button className="ed-logo" onClick={() => navigate('/')} aria-label="Volver a la biblioteca">
          <Logo />
        </button>
        <div className="ed-title">
          <input
            aria-label="Título del documento"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => {
              titleFocused.current = false
              commitTitle()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget.blur(), editor.commands.focus())
              if (e.key === 'Escape') (setTitle(doc.title), e.currentTarget.blur())
            }}
            style={{ width: `${Math.min(Math.max(title.length, 8), 42)}ch` }}
          />
          <button
            className={`icon-btn${doc.starred ? ' is-star' : ''}`}
            aria-label={doc.starred ? 'Quitar de destacados' : 'Destacar'}
            aria-pressed={doc.starred}
            onClick={() => patchDoc({ starred: !doc.starred })}
          >
            <Star size={16} strokeWidth={1.75} fill={doc.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            className="icon-btn"
            aria-label="Mover a carpeta"
            onClick={() => {
              store.listFolders().then(setFolders).catch(() => {})
              setDialog('move')
            }}
          >
            <FolderInput size={16} strokeWidth={1.75} />
          </button>
        </div>

        <SaveBadge
          state={save}
          sync={syncStatus}
          savedAt={savedAt}
          storage={store.mode}
          onRetry={() => {
            void live.sync.flush()
            void persist()
          }}
        />

        <div className="ed-top-right">
          <button className="icon-btn ed-outline-btn" aria-label="Esquema" aria-pressed={showOutline} onClick={() => setShowOutline((v) => !v)}>
            <PanelLeft size={16} strokeWidth={1.75} />
          </button>
          <div className="avatars" aria-label={`${peers.length + 1} ${peers.length ? 'personas' : 'persona'} en el documento`}>
            {peers.slice(0, 4).map((p) => (
              <span key={p.id} className="avatar avatar-peer" style={{ background: p.color }} title={`${p.name} · en este documento`}>
                {initials(p.name)}
              </span>
            ))}
            {peers.length > 4 && <span className="avatar avatar-more">+{peers.length - 4}</span>}
            <span className="avatar" style={{ background: caretUser.color }} title={`${user.name} (tú)`}>
              {initials(user.name)}
            </span>
          </div>
          <button className={`btn${showPanel ? ' is-on' : ''}`} onClick={() => setShowPanel((v) => !v)} aria-pressed={showPanel}>
            <MessageSquare size={15} strokeWidth={1.75} />
            <span className="hide-sm">Comentarios</span>
          </button>
          <button className="btn btn-primary" onClick={() => setDialog('share')}>
            <Share2 size={15} strokeWidth={2} />
            <span className="hide-sm">Compartir</span>
          </button>
        </div>
      </header>

      <div className="ed-toolbar-wrap">
        <Toolbar
          editor={editor}
          mode={mode}
          settings={settings}
          setSettings={setSettings}
          spellcheck={spellcheck}
          setSpellcheck={setSpellcheck}
          actions={actions}
        />
      </div>

      <div className="ed-body">
        {showOutline && <Outline editor={editor} doc={{ ...doc, title }} storage={store.mode} />}

        <main ref={canvasRef} className="ed-canvas" onMouseDown={(e) => e.target === e.currentTarget && editor.commands.focus('end')}>
          {finding && <FindReplace editor={editor} readOnly={mode === 'view'} onClose={() => setFinding(false)} />}
          <div className="sheet-scaler" style={paged ? { width: box.w * scale, height: pagesHeight * scale } : undefined}>
            <article
              className={`sheet${paged ? ' is-paged' : ''}${settings.sheet === 'paper' ? ' is-paper' : ''}${settings.layout === 'word' ? ' is-word' : ''}`}
              style={
                paged
                  ? {
                      ...sheetVars(settings, docFont),
                      width: box.w,
                      minHeight: pagesHeight,
                      padding: `${box.top}px ${box.right}px 0 ${box.left}px`,
                      transform: scale < 1 ? `scale(${scale})` : undefined,
                    }
                  : sheetVars(settings, docFont)
              }
            >
              {paged && (
                <div className="page-layer" aria-hidden="true">
                  {Array.from({ length: pages }, (_, i) => (
                    <div key={i} className="page" style={{ top: i * (box.h + PAGE_GAP), height: box.h }}>
                      {settings.header?.text && (
                        <div className="page-hf" style={{ top: box.header, left: box.left, right: box.right, textAlign: settings.header.align ?? 'left' }}>
                          {fillPageTokens(settings.header.text, i + 1, pages)}
                        </div>
                      )}
                      {settings.footer?.text && (
                        <div className="page-hf" style={{ bottom: box.footer, left: box.left, right: box.right, textAlign: settings.footer.align ?? 'center' }}>
                          {fillPageTokens(settings.footer.text, i + 1, pages)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <EditorContent editor={editor} />
            </article>
          </div>
        </main>

        {showPanel && (
          <SidePanel
            editor={editor}
            docId={doc.id}
            user={user}
            mode={mode}
            setMode={setMode}
            draft={draft}
            clearDraft={() => setDraft(null)}
            commentsRev={commentsRev}
            onCommentsChanged={() => announce('commentsRev')}
            versionsKey={versionsKey}
            onSaveVersion={saveVersion}
            onPreviewVersion={setPreview}
            onClose={() => setShowPanel(false)}
          />
        )}
      </div>

      {mode === 'edit' && <SelectionBubble editor={editor} onComment={startComment} onLink={() => setDialog('link')} />}

      <RenameDialog open={dialog === 'rename'} title={title} onClose={() => setDialog(null)} onSave={(t) => commitTitle(t)} />
      <PageDialog open={dialog === 'page'} settings={settings} onClose={() => setDialog(null)} onSave={setSettings} />
      <WordsDialog open={dialog === 'words'} editor={editor} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <LinkDialog open={dialog === 'link'} editor={editor} onClose={() => setDialog(null)} />
      <Modal open={dialog === 'share'} onClose={() => setDialog(null)} title="Compartir">
        <p>
          Verdant es privado: solo entran las cuentas autorizadas. Quien abra este documento con una de ellas, en otro
          dispositivo o pestaña, lo edita contigo en tiempo real y verás su cursor.
        </p>
        <div className="share-link">
          <input className="input" readOnly value={location.href} aria-label="Enlace del documento" onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn"
            onClick={() =>
              navigator.clipboard
                .writeText(location.href)
                .then(() => toast('Enlace copiado'))
                .catch(() => toast('No se pudo copiar el enlace', { error: true }))
            }
          >
            Copiar enlace
          </button>
        </div>
        <p>Para enviarlo a alguien sin cuenta, descárgalo:</p>
        <div className="share-formats">
          {(['docx', 'pdf', 'md', 'html'] as const).map((f) => (
            <button key={f} className="btn" onClick={() => (exportAs(f), setDialog(null))}>.{f}</button>
          ))}
        </div>
      </Modal>
      <Modal open={dialog === 'move'} onClose={() => setDialog(null)} title="Mover a carpeta">
        <div className="move-list">
          {[{ id: null as string | null, name: 'Sin carpeta' }, ...folders].map((f) => (
            <button
              key={f.id ?? 'none'}
              className={`menu-item${doc.folder_id === f.id ? ' is-selected' : ''}`}
              onClick={() => (patchDoc({ folder_id: f.id }, `Movido a «${f.name}»`), setDialog(null))}
            >
              {f.name}
            </button>
          ))}
          {folders.length === 0 && <p className="muted">Crea carpetas desde la biblioteca.</p>}
        </div>
      </Modal>
      <Modal open={dialog === 'trash'} onClose={() => setDialog(null)} title="¿Mover a la papelera?">
        <p>Podrás restaurarlo desde la papelera de la biblioteca.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>Cancelar</button>
          <button className="btn btn-danger" onClick={trash}>Mover a la papelera</button>
        </div>
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.label || 'Guardado automático'} width={760}>
        {preview && (
          <>
            <p>{new Date(preview.created_at).toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' })}</p>
            <div className={`version-preview vd-prose${settings.sheet === 'paper' ? ' is-paper' : ''}`} style={sheetVars(settings, docFont)} dangerouslySetInnerHTML={{ __html: generateHTML(preview.content, baseExtensions()) }} />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => restore(preview)} disabled={mode === 'view'}>Restaurar esta versión</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

/** Variables CSS de la hoja a partir de los ajustes del documento. */
function sheetVars(s: DocSettings, font: string): React.CSSProperties {
  const vars: Record<string, string> = { '--doc-font': font }
  if (s.fontSize) vars['--doc-size'] = `${s.fontSize}pt`
  if (s.lineHeight) vars['--doc-line'] = String(s.lineHeight)
  if (s.paragraphGap !== undefined) vars['--doc-gap'] = `${s.paragraphGap}pt`
  return vars as React.CSSProperties
}

function SaveBadge(p: { state: SaveState; sync: SyncStatus; savedAt: number; storage: 'neon' | 'local'; onRetry: () => void }) {
  if (p.sync === 'offline' || p.state === 'error') {
    return (
      <button className="save-badge is-error" onClick={p.onRetry} title="Los cambios siguen en este dispositivo y se enviarán al recuperar la conexión">
        <CloudOff size={14} /> Sin conexión · reintentar
      </button>
    )
  }
  if (p.sync === 'pending' || p.state === 'saving' || p.state === 'dirty') {
    return (
      <span className="save-badge" aria-live="polite">
        <Loader2 size={14} className="spin" /> Guardando…
      </span>
    )
  }
  return (
    <span className="save-badge is-ok" aria-live="polite" title={`Último guardado: ${new Date(p.savedAt).toLocaleString('es')}`}>
      {p.storage === 'neon' ? (
        <>
          <span className="live-dot" aria-hidden /> En vivo · guardado {timeAgo(p.savedAt)}
        </>
      ) : (
        <>
          <Cloud size={14} /> Guardado en este navegador · {timeAgo(p.savedAt)}
        </>
      )}
    </span>
  )
}

function SelectionBubble({ editor, onComment, onLink }: { editor: TiptapEditor; onComment: () => void; onLink: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      link: e.isActive('link'),
    }),
  })
  const b = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => (
    <button className={`icon-btn${active ? ' is-active' : ''}`} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  )
  const c = () => editor.chain().focus()
  return (
    <BubbleMenu
      editor={editor}
      className="bubble glass-float"
      shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive('image')}
    >
      {b('Negrita', s.bold, () => c().toggleBold().run(), <Bold size={15} strokeWidth={2} />)}
      {b('Cursiva', s.italic, () => c().toggleItalic().run(), <Italic size={15} />)}
      {b('Subrayado', s.underline, () => c().toggleUnderline().run(), <UnderlineIcon size={15} />)}
      {b('Tachado', s.strike, () => c().toggleStrike().run(), <Strikethrough size={15} />)}
      <span className="tb-sep" />
      {b('Enlace', s.link, onLink, <Link2 size={15} />)}
      {b('Comentar', false, onComment, <MessageSquarePlus size={15} />)}
      <MenuButton
        className="icon-btn bubble-more"
        title="Estilo"
        items={[
          { label: 'Texto normal', onSelect: () => c().setParagraph().run() },
          { label: 'Título 1', onSelect: () => c().setHeading({ level: 1 }).run() },
          { label: 'Título 2', onSelect: () => c().setHeading({ level: 2 }).run() },
          { label: 'Título 3', onSelect: () => c().setHeading({ level: 3 }).run() },
        ]}
      >
        Aa
      </MenuButton>
    </BubbleMenu>
  )
}

function RenameDialog(p: { open: boolean; title: string; onClose: () => void; onSave: (t: string) => void }) {
  const [v, setV] = useState(p.title)
  useEffect(() => setV(p.title), [p.title, p.open])
  return (
    <Modal open={p.open} onClose={p.onClose} title="Renombrar documento">
      <form onSubmit={(e) => (e.preventDefault(), p.onSave(v), p.onClose())}>
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label="Nuevo título" />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={p.onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function PageDialog(p: { open: boolean; settings: DocSettings; onClose: () => void; onSave: (s: Partial<DocSettings>) => void }) {
  const [s, setS] = useState(p.settings)
  useEffect(() => setS(p.settings), [p.settings, p.open])
  const page = pageSetup(s)
  const cm = (pt: number) => String(Math.round((pt / 28.3465) * 100) / 100)
  const setMargin = (k: 'top' | 'right' | 'bottom' | 'left', v: string) => {
    const n = parseFloat(v.replace(',', '.'))
    if (!Number.isNaN(n) && n >= 0 && n < 10) setS({ ...s, page: { ...page, [k]: Math.round(n * 28.3465 * 10) / 10 } })
  }
  const setPaper = (paper: 'a4' | 'letter') => setS({ ...s, paper, page: { ...page, ...PAPER[paper] } })
  const numbered = /\{pagina\}/i.test(s.footer?.text ?? '') || /\{pagina\}/i.test(s.header?.text ?? '')
  return (
    <Modal open={p.open} onClose={p.onClose} title="Configurar página" width={560}>
      <div className="form-grid">
        <span>Diseño</span>
        <div className="seg">
          <button className={s.pageMode !== 'paged' ? 'is-on' : ''} onClick={() => setS({ ...s, pageMode: 'pageless' })}>Sin páginas</button>
          <button className={s.pageMode === 'paged' ? 'is-on' : ''} onClick={() => setS({ ...s, pageMode: 'paged' })}>Con páginas</button>
        </div>
        <span>Tamaño</span>
        <div className="seg">
          <button className={Math.abs(page.width - PAPER.a4.width) < 2 ? 'is-on' : ''} onClick={() => setPaper('a4')}>A4</button>
          <button className={Math.abs(page.width - PAPER.letter.width) < 2 ? 'is-on' : ''} onClick={() => setPaper('letter')}>Carta</button>
        </div>
        <span>Márgenes (cm)</span>
        <div className="margins">
          {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
            <label key={k}>
              <small>{{ top: 'Superior', bottom: 'Inferior', left: 'Izquierdo', right: 'Derecho' }[k]}</small>
              <input className="input" inputMode="decimal" defaultValue={cm(page[k])} onChange={(e) => setMargin(k, e.target.value)} />
            </label>
          ))}
        </div>
        <span>Encabezado</span>
        <input
          className="input"
          value={s.header?.text ?? ''}
          placeholder="Texto en lo alto de cada hoja"
          onChange={(e) => setS({ ...s, header: { align: s.header?.align ?? 'left', text: e.target.value } })}
        />
        <span>Pie de página</span>
        <input
          className="input"
          value={s.footer?.text ?? ''}
          placeholder="Usa {pagina} y {paginas} para numerar"
          onChange={(e) => setS({ ...s, footer: { align: s.footer?.align ?? 'center', text: e.target.value } })}
        />
        <span />
        <label className="check">
          <input
            type="checkbox"
            checked={numbered}
            onChange={(e) =>
              setS({
                ...s,
                footer: e.target.checked
                  ? { align: s.footer?.align ?? 'center', text: `${s.footer?.text ? `${s.footer.text}  ` : ''}{pagina}` }
                  : { align: s.footer?.align ?? 'center', text: (s.footer?.text ?? '').replace(/\s*\{pagina\}/gi, '') },
              })
            }
          />
          Numerar páginas
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={p.onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => (p.onSave(s), p.onClose())}>Aplicar</button>
      </div>
    </Modal>
  )
}

function WordsDialog({ open, editor, onClose }: { open: boolean; editor: TiptapEditor; onClose: () => void }) {
  const stats = useMemo(() => {
    if (!open) return null
    const text = editor.getText()
    const { from, to, empty } = editor.state.selection
    const sel = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
    const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)
    let paragraphs = 0
    editor.state.doc.descendants((n) => {
      if (n.isTextblock && n.textContent.trim()) paragraphs++
    })
    return {
      words: words(text),
      chars: text.length,
      charsNoSpace: text.replace(/\s/g, '').length,
      paragraphs,
      selWords: words(sel),
      minutes: Math.max(1, Math.round(words(text) / 230)),
    }
  }, [open, editor])
  return (
    <Modal open={open} onClose={onClose} title="Contador de palabras">
      {stats && (
        <dl className="details details-lg">
          <dt>Palabras</dt><dd>{stats.words.toLocaleString('es')}</dd>
          <dt>Caracteres</dt><dd>{stats.chars.toLocaleString('es')}</dd>
          <dt>Caracteres sin espacios</dt><dd>{stats.charsNoSpace.toLocaleString('es')}</dd>
          <dt>Párrafos</dt><dd>{stats.paragraphs.toLocaleString('es')}</dd>
          <dt>Palabras seleccionadas</dt><dd>{stats.selWords.toLocaleString('es')}</dd>
          <dt>Tiempo de lectura</dt><dd>{stats.minutes} min</dd>
        </dl>
      )}
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>Listo</button>
      </div>
    </Modal>
  )
}

function LinkDialog({ open, editor, onClose }: { open: boolean; editor: TiptapEditor; onClose: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (open) setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
  }, [open, editor])
  const apply = () => {
    const href = url.trim()
    const c = editor.chain().focus().extendMarkRange('link')
    if (!href) c.unsetLink().run()
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else c.setLink({ href: /^(https?:|mailto:|#)/.test(href) ? href : `https://${href}` }).run()
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Enlace">
      <form onSubmit={(e) => (e.preventDefault(), apply())}>
        <input className="input" autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Dirección del enlace" />
        <div className="modal-actions">
          {editor.isActive('link') && (
            <button type="button" className="btn btn-danger" onClick={() => (editor.chain().focus().extendMarkRange('link').unsetLink().run(), onClose())}>
              Quitar enlace
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Aplicar</button>
        </div>
      </form>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Negrita / cursiva / subrayado', 'Ctrl+B / I / U'],
  ['Tachado', 'Ctrl+Shift+S'],
  ['Título 1–6', 'Ctrl+Alt+1…6'],
  ['Texto normal', 'Ctrl+Alt+0'],
  ['Lista con viñetas / numerada', 'Ctrl+Shift+8 / 7'],
  ['Lista de tareas', 'Ctrl+Shift+9'],
  ['Insertar bloque', '/'],
  ['Salto de página', 'Ctrl+Intro'],
  ['Enlace', 'Ctrl+K'],
  ['Comentario', 'Ctrl+Alt+M'],
  ['Buscar y reemplazar', 'Ctrl+H'],
  ['Guardar ahora', 'Ctrl+S'],
  ['Imprimir / PDF', 'Ctrl+P'],
  ['Contador de palabras', 'Ctrl+Shift+C'],
  ['Modo enfoque', 'Ctrl+Shift+F'],
  ['Deshacer / rehacer', 'Ctrl+Z / Ctrl+Y'],
]

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Atajos de teclado" width={560}>
      <dl className="details shortcuts">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="shortcut">
            <dt>{what}</dt>
            <dd><kbd>{keys}</kbd></dd>
          </div>
        ))}
      </dl>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>Entendido</button>
      </div>
    </Modal>
  )
}
