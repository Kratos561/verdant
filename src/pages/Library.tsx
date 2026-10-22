// Biblioteca: inicio de la app. Documentos, carpetas, papelera, importación y búsqueda.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { generateHTML } from '@tiptap/core'
import {
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Home,
  LayoutGrid,
  LogOut,
  Clock,
  List,
  Menu as MenuIcon,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  SearchX,
  Star,
  StarOff,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { avatarColor, initials, MenuButton, Modal, navigate, timeAgo, useTick, useToast } from '../components/ui'
import type { MenuEntry } from '../components/ui'
import { isLocalMode, signOut } from '../lib/auth'
import type { User } from '../lib/auth'
import { store, UNTITLED } from '../lib/store'
import type { DocMeta, DocPatch, Folder } from '../lib/store'
import { exportDocument, importFile, IMPORT_ACCEPT } from '../lib/io-lazy'
import type { ExportFormat } from '../lib/io-lazy'
import { COURIER_STACK } from '../lib/fonts'
import { baseExtensions, contentToText, htmlToContent } from '../editor/extensions'
import { TEMPLATES } from '../lib/templates'
import '../styles/library.css'

type View = 'home' | 'recent' | 'starred' | 'trash' | `folder:${string}`
type Layout = 'grid' | 'list'
type Dialog =
  | { kind: 'newFolder' }
  | { kind: 'renameFolder'; f: Folder }
  | { kind: 'deleteFolder'; f: Folder }
  | { kind: 'renameDoc'; d: DocMeta }
  | { kind: 'moveDoc'; d: DocMeta }
  | { kind: 'purge'; d: DocMeta }
  | { kind: 'emptyTrash' }

const ICON = { size: 16, strokeWidth: 1.75 } as const

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="lib-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M8.5 9.5 16 23l7.5-13.5" fill="none" stroke="var(--accent-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Normaliza para comparar sin mayúsculas ni tildes. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Algo salió mal')

export default function Library({ user }: { user: User }) {
  const toast = useToast()
  useTick(30000)
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [view, setView] = useState<View>('home')
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem('verdant.layout') === 'list' ? 'list' : 'grid'))
  const [query, setQuery] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeDialog = useCallback(() => setDialog(null), [])

  const refresh = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([store.listDocs(), store.listFolders()])
      setDocs(d)
      setFolders(f)
    } catch (e) {
      setDocs((cur) => cur ?? [])
      toast(errMsg(e), { error: true })
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    localStorage.setItem('verdant.layout', layout)
  }, [layout])

  // Ctrl+K enfoca el buscador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const folderId = view.startsWith('folder:') ? view.slice(7) : null
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const currentFolder = folderId ? folderById.get(folderId) : undefined

  // ---------- Importación ----------

  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setImporting(true)
      let ok = 0
      let lastId = ''
      for (const file of files) {
        try {
          const { title, html } = await importFile(file)
          const content = htmlToContent(html)
          const d = await store.createDoc({
            title,
            content,
            text_plain: contentToText(content),
            folder_id: folderId,
            settings: { font: COURIER_STACK },
          })
          ok++
          lastId = d.id
        } catch (e) {
          toast(`${file.name}: ${errMsg(e)}`, { error: true })
        }
      }
      setImporting(false)
      if (files.length === 1 && ok === 1) navigate('/d/' + lastId)
      else if (ok > 0) {
        toast(ok === 1 ? '1 documento importado' : `${ok} documentos importados`)
        void refresh()
      }
    },
    [folderId, refresh, toast],
  )

  // Arrastrar y soltar en cualquier parte
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void importFiles([...(e.dataTransfer?.files ?? [])])
    }
    addEventListener('dragenter', enter)
    addEventListener('dragleave', leave)
    addEventListener('dragover', over)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragleave', leave)
      removeEventListener('dragover', over)
      removeEventListener('drop', drop)
    }
  }, [importFiles])

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    void importFiles(files)
  }

  // ---------- Acciones sobre documentos ----------

  const createDoc = async (tpl?: (typeof TEMPLATES)[number]) => {
    try {
      const d = await store.createDoc({
        title: tpl?.title ?? UNTITLED,
        ...(tpl ? { content: tpl.content, text_plain: contentToText(tpl.content) } : {}),
        folder_id: folderId,
        settings: { font: COURIER_STACK },
      })
      navigate('/d/' + d.id)
    } catch (e) {
      toast(errMsg(e), { error: true })
    }
  }

  /** Actualiza el estado local al instante y revierte si el store falla. */
  const patchDoc = async (id: string, patch: DocPatch, then?: () => void) => {
    const prev = docs?.find((d) => d.id === id)
    if (!prev) return
    const { content: _c, settings: _s, ...local } = patch
    setDocs((cur) => cur && cur.map((d) => (d.id === id ? { ...d, ...local, updated_at: new Date().toISOString() } : d)))
    try {
      await store.updateDoc(id, patch)
      then?.()
    } catch (e) {
      setDocs((cur) => cur && cur.map((d) => (d.id === id ? prev : d)))
      toast(errMsg(e), { error: true })
    }
  }

  const trashDoc = (d: DocMeta) =>
    void patchDoc(d.id, { trashed_at: new Date().toISOString() }, () =>
      toast('Movido a la papelera', { action: { label: 'Deshacer', run: () => void patchDoc(d.id, { trashed_at: null }) } }),
    )

  const download = async (d: DocMeta, fmt: ExportFormat) => {
    try {
      const doc = await store.getDoc(d.id)
      if (!doc) throw new Error('No se encontró el documento')
      const html = generateHTML(doc.content, baseExtensions())
      await exportDocument(fmt, { title: doc.title, json: doc.content, html, text: doc.text_plain })
    } catch (e) {
      toast(errMsg(e), { error: true })
    }
  }

  const purge = async (ids: string[]) => {
    const prev = docs
    setDocs((cur) => cur && cur.filter((d) => !ids.includes(d.id)))
    try {
      for (const id of ids) await store.deleteDoc(id)
      toast(ids.length === 1 ? 'Documento eliminado' : 'Papelera vaciada')
    } catch (e) {
      setDocs(prev)
      toast(errMsg(e), { error: true })
      void refresh()
    }
  }

  const docMenu = (d: DocMeta): MenuEntry[] => [
    { label: 'Abrir', icon: <ExternalLink {...ICON} />, onSelect: () => navigate('/d/' + d.id) },
    { label: 'Renombrar', icon: <Pencil {...ICON} />, onSelect: () => setDialog({ kind: 'renameDoc', d }) },
    {
      label: d.starred ? 'Quitar de destacados' : 'Destacar',
      icon: d.starred ? <StarOff {...ICON} /> : <Star {...ICON} />,
      onSelect: () => void patchDoc(d.id, { starred: !d.starred }),
    },
    { label: 'Mover a carpeta', icon: <FolderInput {...ICON} />, onSelect: () => setDialog({ kind: 'moveDoc', d }) },
    { separator: true },
    { heading: 'Descargar' },
    { label: 'Word (.docx)', icon: <Download {...ICON} />, onSelect: () => void download(d, 'docx') },
    { label: 'PDF', icon: <Download {...ICON} />, onSelect: () => void download(d, 'pdf') },
    { label: 'Markdown (.md)', icon: <Download {...ICON} />, onSelect: () => void download(d, 'md') },
    { separator: true },
    { label: 'Mover a la papelera', icon: <Trash2 {...ICON} />, danger: true, onSelect: () => trashDoc(d) },
  ]

  // ---------- Carpetas ----------

  const createFolder = async (name: string) => {
    try {
      const f = await store.createFolder(name)
      setFolders((cur) => [...cur, f].sort((a, b) => a.name.localeCompare(b.name)))
      setView(`folder:${f.id}`)
    } catch (e) {
      toast(errMsg(e), { error: true })
    }
  }

  const renameFolder = async (f: Folder, name: string) => {
    const prev = folders
    setFolders((cur) => cur.map((x) => (x.id === f.id ? { ...x, name } : x)).sort((a, b) => a.name.localeCompare(b.name)))
    try {
      await store.renameFolder(f.id, name)
    } catch (e) {
      setFolders(prev)
      toast(errMsg(e), { error: true })
    }
  }

  const deleteFolder = async (f: Folder) => {
    const prevF = folders
    const prevD = docs
    setFolders((cur) => cur.filter((x) => x.id !== f.id))
    setDocs((cur) => cur && cur.map((d) => (d.folder_id === f.id ? { ...d, folder_id: null } : d)))
    if (folderId === f.id) setView('home')
    try {
      await store.deleteFolder(f.id)
    } catch (e) {
      setFolders(prevF)
      setDocs(prevD)
      toast(errMsg(e), { error: true })
    }
  }

  // ---------- Derivados ----------

  const live = useMemo(() => (docs ?? []).filter((d) => !d.trashed_at), [docs])
  const trashed = useMemo(() => (docs ?? []).filter((d) => d.trashed_at), [docs])
  const sorted = (a: DocMeta, b: DocMeta) => b.updated_at.localeCompare(a.updated_at)

  const visible = useMemo(() => {
    let list: DocMeta[]
    if (view === 'trash') list = trashed
    else if (view === 'starred') list = live.filter((d) => d.starred)
    else if (folderId) list = live.filter((d) => d.folder_id === folderId)
    else list = live
    const q = fold(query.trim())
    if (q) list = list.filter((d) => fold(d.title).includes(q) || fold(d.text_plain).includes(q))
    return [...list].sort(sorted)
  }, [view, live, trashed, folderId, query])

  const searching = query.trim().length > 0
  const showStart = view === 'home' && !searching

  const titleOf: Record<string, string> = { home: 'Inicio', recent: 'Recientes', starred: 'Destacados', trash: 'Papelera' }
  const heading = currentFolder ? currentFolder.name : (titleOf[view] ?? 'Biblioteca')

  const go = (v: View) => {
    setView(v)
    setDrawer(false)
  }

  // ---------- Render ----------

  const empty = (): ReactNode => {
    if (searching) return <Empty icon={<SearchX size={40} strokeWidth={1.25} />} title="Sin resultados" text={`Nada coincide con «${query.trim()}».`} action={<button className="btn" onClick={() => setQuery('')}>Borrar búsqueda</button>} />
    if (view === 'trash') return <Empty icon={<Trash2 size={40} strokeWidth={1.25} />} title="La papelera está vacía" text="Los documentos que elimines aparecerán aquí." />
    if (view === 'starred') return <Empty icon={<Star size={40} strokeWidth={1.25} />} title="Aún no hay destacados" text="Marca un documento con la estrella para tenerlo siempre a mano." />
    return (
      <Empty
        icon={<FileText size={40} strokeWidth={1.25} />}
        title="Aún no hay documentos"
        text={currentFolder ? 'Esta carpeta está vacía.' : 'Crea tu primer documento o importa uno que ya tengas.'}
        action={
          <button className="btn btn-primary" onClick={() => void createDoc()}>
            <FilePlus2 {...ICON} /> Nuevo documento
          </button>
        }
      />
    )
  }

  const isTrash = view === 'trash'
  const recentTitle = showStart ? 'Documentos recientes' : searching ? `Resultados (${visible.length})` : null
  const shown = showStart ? visible.slice(0, 12) : visible

  return (
    <div className="lib-root">
      <input ref={fileRef} type="file" hidden multiple accept={IMPORT_ACCEPT} onChange={onPick} />

      {drawer && <div className="lib-scrim" onClick={() => setDrawer(false)} />}
      <aside className={`lib-side glass${drawer ? ' is-open' : ''}`} aria-label="Navegación">
        <div className="lib-brand">
          <Logo />
          <span>Verdant</span>
          <button className="icon-btn lib-close" aria-label="Cerrar menú" onClick={() => setDrawer(false)}>
            <X {...ICON} />
          </button>
        </div>
        <button className="btn btn-primary lib-new" onClick={() => void createDoc()}>
          <FilePlus2 {...ICON} /> Nuevo documento
        </button>

        <nav className="lib-nav">
          <NavItem icon={<Home {...ICON} />} label="Inicio" active={view === 'home'} onClick={() => go('home')} />
          <NavItem icon={<Clock {...ICON} />} label="Recientes" active={view === 'recent'} count={live.length} onClick={() => go('recent')} />
          <NavItem icon={<Star {...ICON} />} label="Destacados" active={view === 'starred'} count={live.filter((d) => d.starred).length} onClick={() => go('starred')} />
          <NavItem icon={<Trash2 {...ICON} />} label="Papelera" active={view === 'trash'} count={trashed.length} onClick={() => go('trash')} />
        </nav>

        <div className="lib-sec">
          <span>Carpetas</span>
          <button className="icon-btn" aria-label="Nueva carpeta" onClick={() => setDialog({ kind: 'newFolder' })}>
            <FolderPlus {...ICON} />
          </button>
        </div>
        <div className="lib-folders">
          {folders.length === 0 && <p className="lib-hint">Organiza tus documentos en carpetas.</p>}
          {folders.map((f) => (
            <div key={f.id} className={`lib-folder${folderId === f.id ? ' is-active' : ''}`}>
              <button className="lib-folder-main" onClick={() => go(`folder:${f.id}`)}>
                <FolderIcon {...ICON} />
                <span>{f.name}</span>
                <em>{live.filter((d) => d.folder_id === f.id).length || ''}</em>
              </button>
              <MenuButton
                className="icon-btn lib-folder-menu"
                title={`Opciones de ${f.name}`}
                align="end"
                items={[
                  { label: 'Renombrar', icon: <Pencil {...ICON} />, onSelect: () => setDialog({ kind: 'renameFolder', f }) },
                  { label: 'Eliminar', icon: <Trash2 {...ICON} />, danger: true, onSelect: () => setDialog({ kind: 'deleteFolder', f }) },
                ]}
              >
                <MoreHorizontal {...ICON} />
              </MenuButton>
            </div>
          ))}
        </div>

        <div className="lib-user-wrap">
          {isLocalMode && <div className="lib-pill">Modo local · se guarda en este navegador</div>}
          <MenuButton
            className="lib-user"
            align="start"
            items={[
              {
                label: 'Cerrar sesión',
                icon: <LogOut {...ICON} />,
                onSelect: () => {
                  void signOut().finally(() => location.reload())
                },
              },
            ]}
          >
            <span className="avatar" style={{ background: avatarColor(user.id || user.email) }}>
              {initials(user.name)}
            </span>
            <span className="lib-user-txt">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </MenuButton>
        </div>
      </aside>

      <main className="lib-main">
        <header className="lib-head">
          <button className="icon-btn lib-burger" aria-label="Abrir menú" onClick={() => setDrawer(true)}>
            <MenuIcon size={18} strokeWidth={1.75} />
          </button>
          <label className="lib-search">
            <Search size={18} strokeWidth={1.75} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en tus documentos" autoComplete="off" aria-label="Buscar documentos" />
            {query ? (
              <button type="button" className="icon-btn" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
                <X {...ICON} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </label>
          <div className="lib-seg" role="group" aria-label="Vista">
            <button className={layout === 'grid' ? 'is-on' : ''} aria-label="Cuadrícula" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
              <LayoutGrid {...ICON} />
            </button>
            <button className={layout === 'list' ? 'is-on' : ''} aria-label="Lista" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
              <List {...ICON} />
            </button>
          </div>
        </header>

        <div className="lib-body">
          {showStart && (
            <section className="lib-section">
              <h2>Empezar nuevo</h2>
              <div className="lib-start">
                <StartCard onClick={() => void createDoc()} name="Documento en blanco" sub="Empieza de cero">
                  <FilePlus2 size={22} strokeWidth={1.5} />
                </StartCard>
                {TEMPLATES.map((t) => (
                  <StartCard key={t.id} onClick={() => void createDoc(t)} name={t.name} sub={t.description}>
                    <FileText size={22} strokeWidth={1.5} />
                  </StartCard>
                ))}
                <StartCard onClick={() => fileRef.current?.click()} name="Subir archivo" sub=".docx, .md, .txt, .html" busy={importing}>
                  <Upload size={22} strokeWidth={1.5} />
                </StartCard>
              </div>
            </section>
          )}

          <section className="lib-section">
            <div className="lib-sec-head">
              <h2>{recentTitle ?? heading}</h2>
              {isTrash && trashed.length > 0 && (
                <button className="btn btn-danger" onClick={() => setDialog({ kind: 'emptyTrash' })}>
                  <Trash2 {...ICON} /> Vaciar papelera
                </button>
              )}
            </div>

            {docs === null ? (
              <Skeletons layout={layout} />
            ) : shown.length === 0 ? (
              empty()
            ) : layout === 'grid' && !isTrash ? (
              <div className="lib-grid">
                {shown.map((d) => (
                  <DocCard key={d.id} d={d} items={docMenu(d)} onStar={() => void patchDoc(d.id, { starred: !d.starred })} />
                ))}
              </div>
            ) : (
              <div className="lib-table" role="table" aria-label="Documentos">
                <div className="lib-row lib-row-head" role="row">
                  <span role="columnheader">Nombre</span>
                  <span role="columnheader" className="lib-col-folder">Carpeta</span>
                  <span role="columnheader">{isTrash ? 'Eliminado' : 'Última modificación'}</span>
                  <span />
                </div>
                {shown.map((d) => (
                  <DocRow
                    key={d.id}
                    d={d}
                    folder={d.folder_id ? folderById.get(d.folder_id)?.name : undefined}
                    trash={isTrash}
                    items={docMenu(d)}
                    onRestore={() => void patchDoc(d.id, { trashed_at: null })}
                    onPurge={() => setDialog({ kind: 'purge', d })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {dragging && (
        <div className="lib-drop glass-float" aria-hidden="true">
          <div>
            <Upload size={44} strokeWidth={1.25} />
            <p>Suelta para importar</p>
            <small>.docx, .md, .txt o .html</small>
          </div>
        </div>
      )}

      <Dialogs
        dialog={dialog}
        onClose={closeDialog}
        folders={folders}
        onNewFolder={(n) => void createFolder(n)}
        onRenameFolder={(f, n) => void renameFolder(f, n)}
        onDeleteFolder={(f) => void deleteFolder(f)}
        onRenameDoc={(d, n) => void patchDoc(d.id, { title: n })}
        onMoveDoc={(d, fid) => void patchDoc(d.id, { folder_id: fid })}
        onPurge={(ids) => void purge(ids)}
        trashedIds={trashed.map((d) => d.id)}
      />
    </div>
  )
}

// ---------- Piezas ----------

function NavItem(props: { icon: ReactNode; label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button className={`lib-navitem${props.active ? ' is-active' : ''}`} aria-current={props.active ? 'page' : undefined} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {!!props.count && <em>{props.count}</em>}
    </button>
  )
}

function StartCard(props: { name: string; sub: string; children: ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button className="lib-startcard glass" onClick={props.onClick} disabled={props.busy}>
      <span className="lib-startcard-ico">{props.busy ? <span className="spinner" /> : props.children}</span>
      <strong>{props.name}</strong>
      <small>{props.sub}</small>
    </button>
  )
}

function Empty(props: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="lib-empty">
      {props.icon}
      <h3>{props.title}</h3>
      <p>{props.text}</p>
      {props.action}
    </div>
  )
}

function Skeletons({ layout }: { layout: Layout }) {
  return layout === 'grid' ? (
    <div className="lib-grid" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="lib-card lib-skel" style={{ height: 238 }} />
      ))}
    </div>
  ) : (
    <div className="lib-skel-list" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="lib-skel" style={{ height: 46 }} />
      ))}
    </div>
  )
}

function DocCard({ d, items, onStar }: { d: DocMeta; items: MenuEntry[]; onStar: () => void }) {
  return (
    <article className="lib-card glass">
      <button className="lib-card-open" onClick={() => navigate('/d/' + d.id)} aria-label={`Abrir ${d.title || UNTITLED}`}>
        <div className="lib-thumb" aria-hidden="true">
          <p>{d.text_plain.slice(0, 220)}</p>
        </div>
        <div className="lib-card-meta">
          <strong>{d.title || UNTITLED}</strong>
          <small>Editado {timeAgo(d.updated_at)}</small>
        </div>
      </button>
      {d.starred && (
        <button className="lib-star is-on" aria-label="Quitar de destacados" onClick={onStar}>
          <Star size={14} strokeWidth={1.75} fill="currentColor" />
        </button>
      )}
      <MenuButton className="icon-btn lib-card-menu" title="Más acciones" align="end" items={items}>
        <MoreHorizontal {...ICON} />
      </MenuButton>
    </article>
  )
}

function DocRow(props: {
  d: DocMeta
  folder?: string
  trash: boolean
  items: MenuEntry[]
  onRestore: () => void
  onPurge: () => void
}) {
  const { d } = props
  const when = props.trash && d.trashed_at ? d.trashed_at : d.updated_at
  return (
    <div className="lib-row" role="row">
      <button className="lib-row-name" role="cell" onClick={() => navigate('/d/' + d.id)} disabled={props.trash} title={props.trash ? 'Restaura el documento para abrirlo' : undefined}>
        <FileText {...ICON} />
        <span>{d.title || UNTITLED}</span>
        {d.starred && <Star size={13} strokeWidth={1.75} fill="currentColor" className="lib-star-inline" aria-label="Destacado" />}
      </button>
      <span role="cell" className="lib-col-folder">{props.folder ?? '—'}</span>
      <span role="cell" className="lib-col-when">{timeAgo(when)}</span>
      <span className="lib-row-actions">
        {props.trash ? (
          <>
            <button className="icon-btn" aria-label="Restaurar" title="Restaurar" onClick={props.onRestore}>
              <RotateCcw {...ICON} />
            </button>
            <button className="icon-btn lib-danger" aria-label="Eliminar para siempre" title="Eliminar para siempre" onClick={props.onPurge}>
              <Trash2 {...ICON} />
            </button>
          </>
        ) : (
          <MenuButton className="icon-btn" title="Más acciones" align="end" items={props.items}>
            <MoreHorizontal {...ICON} />
          </MenuButton>
        )}
      </span>
    </div>
  )
}

interface DialogsProps {
  dialog: Dialog | null
  onClose: () => void
  folders: Folder[]
  trashedIds: string[]
  onNewFolder: (name: string) => void
  onRenameFolder: (f: Folder, name: string) => void
  onDeleteFolder: (f: Folder) => void
  onRenameDoc: (d: DocMeta, name: string) => void
  onMoveDoc: (d: DocMeta, folderId: string | null) => void
  onPurge: (ids: string[]) => void
}

function Dialogs(p: DialogsProps) {
  const dlg = p.dialog
  const close = p.onClose
  return (
    <>
      <Modal open={dlg?.kind === 'newFolder'} onClose={close} title="Nueva carpeta" width={400}>
        <NameForm initial="" label="Nombre de la carpeta" cta="Crear" onCancel={close} onSubmit={(n) => { p.onNewFolder(n); close() }} />
      </Modal>
      <Modal open={dlg?.kind === 'renameFolder'} onClose={close} title="Renombrar carpeta" width={400}>
        {dlg?.kind === 'renameFolder' && (
          <NameForm initial={dlg.f.name} label="Nombre de la carpeta" cta="Guardar" onCancel={close} onSubmit={(n) => { p.onRenameFolder(dlg.f, n); close() }} />
        )}
      </Modal>
      <Modal open={dlg?.kind === 'renameDoc'} onClose={close} title="Renombrar documento" width={420}>
        {dlg?.kind === 'renameDoc' && (
          <NameForm initial={dlg.d.title} label="Título" cta="Guardar" onCancel={close} onSubmit={(n) => { p.onRenameDoc(dlg.d, n); close() }} />
        )}
      </Modal>
      <Modal open={dlg?.kind === 'moveDoc'} onClose={close} title="Mover a carpeta" width={400}>
        {dlg?.kind === 'moveDoc' && (
          <>
            <div className="lib-pick">
              <button className={dlg.d.folder_id === null ? 'is-on' : ''} onClick={() => { p.onMoveDoc(dlg.d, null); close() }}>
                <FileText {...ICON} /> Sin carpeta
              </button>
              {p.folders.map((f) => (
                <button key={f.id} className={dlg.d.folder_id === f.id ? 'is-on' : ''} onClick={() => { p.onMoveDoc(dlg.d, f.id); close() }}>
                  <FolderIcon {...ICON} /> {f.name}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={close}>Cancelar</button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={dlg?.kind === 'deleteFolder'} onClose={close} title="Eliminar carpeta" width={420}>
        {dlg?.kind === 'deleteFolder' && (
          <Confirm text={`«${dlg.f.name}» se eliminará. Sus documentos no se borran: pasarán a «Sin carpeta».`} cta="Eliminar" onCancel={close} onOk={() => { p.onDeleteFolder(dlg.f); close() }} />
        )}
      </Modal>
      <Modal open={dlg?.kind === 'purge'} onClose={close} title="Eliminar para siempre" width={420}>
        {dlg?.kind === 'purge' && (
          <Confirm text={`«${dlg.d.title || UNTITLED}» se eliminará definitivamente. No se puede deshacer.`} cta="Eliminar" onCancel={close} onOk={() => { p.onPurge([dlg.d.id]); close() }} />
        )}
      </Modal>
      <Modal open={dlg?.kind === 'emptyTrash'} onClose={close} title="Vaciar papelera" width={420}>
        <Confirm text={`Se eliminarán ${p.trashedIds.length} documentos para siempre. No se puede deshacer.`} cta="Vaciar" onCancel={close} onOk={() => { p.onPurge(p.trashedIds); close() }} />
      </Modal>
    </>
  )
}

function NameForm(props: { initial: string; label: string; cta: string; onCancel: () => void; onSubmit: (name: string) => void }) {
  const [v, setV] = useState(props.initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const name = v.trim()
    if (name) props.onSubmit(name)
  }
  return (
    <form onSubmit={submit}>
      <label className="lib-label" htmlFor="lib-name">{props.label}</label>
      <input id="lib-name" className="input" value={v} onChange={(e) => setV(e.target.value)} autoFocus onFocus={(e) => e.currentTarget.select()} maxLength={120} />
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={props.onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={!v.trim()}>{props.cta}</button>
      </div>
    </form>
  )
}

function Confirm(props: { text: string; cta: string; onCancel: () => void; onOk: () => void }) {
  return (
    <>
      <p>{props.text}</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={props.onCancel} autoFocus>Cancelar</button>
        <button className="btn lib-btn-danger" onClick={props.onOk}>{props.cta}</button>
      </div>
    </>
  )
}
