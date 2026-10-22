// Barra flotante: menús de aplicación + controles de formato.
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CheckSquare, ChevronDown, Eraser, Highlighter, Image as ImageIcon,
  Italic, Link2, List, ListOrdered, MessageSquarePlus, Minus, MoreHorizontal, Plus, Redo2, Strikethrough, Table as TableIcon,
  Type, Underline as UnderlineIcon, Undo2,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Menu, MenuButton, Popover } from '../components/ui'
import type { MenuEntry } from '../components/ui'
import { COURIER_STACK, COURIER_VARIANTS, FONTS, FONT_SIZES, fontLabel } from '../lib/fonts'
import type { DocSettings } from '../lib/store'
import type { ExportFormat } from '../lib/io-lazy'
import { BLOCK_COMMANDS, pickImage } from './commands'

export type EditorMode = 'edit' | 'view'

export interface ToolbarActions {
  newDoc: () => void
  copyDoc: () => void
  goHome: () => void
  importInto: () => void
  exportAs: (f: ExportFormat) => void
  rename: () => void
  trash: () => void
  pageSetup: () => void
  find: () => void
  wordCount: () => void
  shortcuts: () => void
  comment: () => void
  link: () => void
  toggleOutline: () => void
  togglePanel: () => void
  toggleFocus: () => void
  setMode: (m: EditorMode) => void
  saveVersion: () => void
  error: (msg: string) => void
}

interface Props {
  editor: Editor
  mode: EditorMode
  settings: DocSettings
  setSettings: (p: Partial<DocSettings>) => void
  spellcheck: boolean
  setSpellcheck: (v: boolean) => void
  actions: ToolbarActions
}

const SWATCHES = ['#e8efe9', '#a9b6ad', '#3ddc97', '#5ec8f2', '#b59cff', '#ff8fa3', '#ffb86b', '#f2c94c', '#ff6b6b', '#0b110e']
const HIGHLIGHTS = ['#2f6b4f', '#1d5a6b', '#5b4a8a', '#7a3550', '#7a5a1d', '#6b6b1d']
const STYLES = [
  { label: 'Texto normal', level: 0 },
  { label: 'Título 1', level: 1 },
  { label: 'Título 2', level: 2 },
  { label: 'Título 3', level: 3 },
  { label: 'Título 4', level: 4 },
] as const

export default function Toolbar({ editor, mode, settings, setSettings, spellcheck, setSpellcheck, actions: a }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle')
      let level = 0
      for (const l of [1, 2, 3, 4, 5, 6] as const) if (e.isActive('heading', { level: l })) level = l
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        table: e.isActive('table'),
        sub: e.isActive('subscript'),
        sup: e.isActive('superscript'),
        align: (['center', 'right', 'justify'] as const).find((x) => e.isActive({ textAlign: x })) ?? 'left',
        font: style.fontFamily as string | undefined,
        size: style.fontSize as string | undefined,
        color: style.color as string | undefined,
        level,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        empty: e.state.selection.empty,
      }
    },
  })

  const ro = mode === 'view'
  const c = () => editor.chain().focus()
  const docFont = settings.font ?? COURIER_STACK
  const currentFont = s.font ?? docFont
  const currentSize = s.size ? parseInt(s.size, 10) : (settings.fontSize ?? 12)

  const setSize = (n: number) => {
    const v = Math.max(6, Math.min(96, n))
    c().setFontSize(`${v}pt`).run()
  }

  const fileMenu: MenuEntry[] = [
    { label: 'Nuevo documento', onSelect: a.newDoc },
    { label: 'Hacer una copia', onSelect: a.copyDoc },
    { label: 'Volver a la biblioteca', onSelect: a.goHome },
    { separator: true },
    { label: 'Importar archivo aquí…', onSelect: a.importInto, disabled: ro },
    { heading: 'Descargar' },
    { label: 'Word (.docx)', onSelect: () => a.exportAs('docx') },
    { label: 'PDF (.pdf)', onSelect: () => a.exportAs('pdf') },
    { label: 'Markdown (.md)', onSelect: () => a.exportAs('md') },
    { label: 'Página web (.html)', onSelect: () => a.exportAs('html') },
    { label: 'Texto sin formato (.txt)', onSelect: () => a.exportAs('txt') },
    { separator: true },
    { label: 'Guardar versión', onSelect: a.saveVersion },
    { label: 'Renombrar', onSelect: a.rename },
    { label: 'Configurar página', onSelect: a.pageSetup },
    { label: 'Imprimir', kbd: 'Ctrl+P', onSelect: () => a.exportAs('pdf') },
    { separator: true },
    { label: 'Mover a la papelera', onSelect: a.trash, danger: true },
  ]

  const editMenu: MenuEntry[] = [
    { label: 'Deshacer', kbd: 'Ctrl+Z', onSelect: () => c().undo().run(), disabled: ro || !s.canUndo },
    { label: 'Rehacer', kbd: 'Ctrl+Y', onSelect: () => c().redo().run(), disabled: ro || !s.canRedo },
    { separator: true },
    { label: 'Seleccionar todo', kbd: 'Ctrl+A', onSelect: () => c().selectAll().run() },
    { label: 'Buscar y reemplazar', kbd: 'Ctrl+H', onSelect: a.find },
  ]

  const viewMenu: MenuEntry[] = [
    { label: 'Modo edición', onSelect: () => a.setMode('edit'), checked: mode === 'edit' },
    { label: 'Modo lectura', onSelect: () => a.setMode('view'), checked: mode === 'view' },
    { separator: true },
    { label: 'Diseño sin páginas', onSelect: () => setSettings({ pageMode: 'pageless' }), checked: settings.pageMode !== 'paged' },
    { label: 'Diseño con páginas', onSelect: () => setSettings({ pageMode: 'paged' }), checked: settings.pageMode === 'paged' },
    { separator: true },
    { label: 'Hoja oscura', onSelect: () => setSettings({ sheet: 'dark' }), checked: settings.sheet !== 'paper' },
    { label: 'Hoja de papel', onSelect: () => setSettings({ sheet: 'paper' }), checked: settings.sheet === 'paper' },
    { separator: true },
    { label: 'Esquema del documento', onSelect: a.toggleOutline },
    { label: 'Panel lateral', onSelect: a.togglePanel },
    { label: 'Modo enfoque', kbd: 'Ctrl+Shift+F', onSelect: a.toggleFocus },
  ]

  const insertMenu: MenuEntry[] = [
    ...BLOCK_COMMANDS.filter((b) => !['p', 'h1', 'h2', 'h3'].includes(b.id)).map((b) => ({
      label: b.title,
      icon: b.icon,
      onSelect: () => (b.id === 'image' ? pickImage(editor, a.error) : b.run(editor)),
      disabled: ro,
    })),
    { separator: true },
    { label: 'Salto de página', kbd: 'Ctrl+Intro', onSelect: () => c().setPageBreak().run(), disabled: ro },
    { label: 'Enlace', kbd: 'Ctrl+K', onSelect: a.link, disabled: ro },
    { label: 'Comentario', kbd: 'Ctrl+Alt+M', onSelect: a.comment, disabled: s.empty },
  ]

  const formatMenu: MenuEntry[] = [
    { heading: 'Courier New' },
    ...COURIER_VARIANTS.map((v) => ({
      label: v.label,
      disabled: ro,
      onSelect: () => {
        let ch = c().setFontFamily(COURIER_STACK)
        ch = v.bold ? ch.setBold() : ch.unsetBold()
        ch = v.italic ? ch.setItalic() : ch.unsetItalic()
        ch.run()
      },
    })),
    { separator: true },
    { label: 'Superíndice', kbd: 'Ctrl+.', onSelect: () => c().toggleSuperscript().run(), checked: s.sup, disabled: ro },
    { label: 'Subíndice', kbd: 'Ctrl+,', onSelect: () => c().toggleSubscript().run(), checked: s.sub, disabled: ro },
    { heading: 'Interlineado' },
    ...['1', '1.15', '1.5', '2'].map((lh) => ({ label: lh, onSelect: () => c().setLineHeight(lh).run(), disabled: ro })),
    ...(s.table
      ? [
          { heading: 'Tabla' },
          { label: 'Insertar fila debajo', onSelect: () => c().addRowAfter().run() },
          { label: 'Insertar columna a la derecha', onSelect: () => c().addColumnAfter().run() },
          { label: 'Eliminar fila', onSelect: () => c().deleteRow().run() },
          { label: 'Eliminar columna', onSelect: () => c().deleteColumn().run() },
          { label: 'Combinar o dividir celdas', onSelect: () => c().mergeOrSplit().run() },
          { label: 'Eliminar tabla', onSelect: () => c().deleteTable().run(), danger: true },
        ]
      : []),
    { separator: true },
    { label: 'Borrar formato', kbd: 'Ctrl+\\', onSelect: () => c().unsetAllMarks().clearNodes().run(), disabled: ro },
  ]

  const toolsMenu: MenuEntry[] = [
    { label: 'Contador de palabras', kbd: 'Ctrl+Shift+C', onSelect: a.wordCount },
    { label: 'Revisión ortográfica', onSelect: () => setSpellcheck(!spellcheck), checked: spellcheck },
    { label: 'Atajos de teclado', kbd: 'Ctrl+/', onSelect: a.shortcuts },
  ]

  const fontItems: MenuEntry[] = [
    { heading: 'Courier New y variantes' },
    ...FONTS.filter((f) => f.group === 'Courier New').map((f) => fontEntry(f.label, f.value)),
    { heading: 'Otras fuentes' },
    ...FONTS.filter((f) => f.group === 'Otras').map((f) => fontEntry(f.label, f.value)),
  ]
  function fontEntry(label: string, value: string): MenuEntry {
    return {
      label,
      checked: fontLabel(currentFont) === label,
      icon: <span style={{ fontFamily: value, width: 18, textAlign: 'center' }}>Aa</span>,
      onSelect: () => c().setFontFamily(value).run(),
    }
  }

  return (
    <div className="tb glass" role="toolbar" aria-label="Barra de herramientas">
      <nav className="tb-menus" aria-label="Menús">
        <MenuButton className="tb-menu" items={fileMenu}>Archivo</MenuButton>
        <MenuButton className="tb-menu" items={editMenu}>Editar</MenuButton>
        <MenuButton className="tb-menu" items={viewMenu}>Ver</MenuButton>
        <MenuButton className="tb-menu" items={insertMenu}>Insertar</MenuButton>
        <MenuButton className="tb-menu" items={formatMenu}>Formato</MenuButton>
        <MenuButton className="tb-menu" items={toolsMenu}>Herramientas</MenuButton>
      </nav>
      <span className="tb-sep" />
      <fieldset className="tb-tools" disabled={ro}>
        <Btn label="Deshacer (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!s.canUndo}><Undo2 size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Rehacer (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!s.canRedo}><Redo2 size={16} strokeWidth={1.75} /></Btn>
        <span className="tb-sep" />
        <MenuButton
          className="tb-select"
          title="Estilo de párrafo"
          items={STYLES.map((st) => ({
            label: st.label,
            checked: s.level === st.level,
            onSelect: () => (st.level === 0 ? c().setParagraph().run() : c().setHeading({ level: st.level }).run()),
          }))}
        >
          <span>{STYLES.find((x) => x.level === s.level)?.label ?? `Título ${s.level}`}</span>
          <ChevronDown size={14} />
        </MenuButton>
        <MenuButton className="tb-select tb-font" title="Fuente" items={fontItems}>
          <span style={{ fontFamily: currentFont }}>{fontLabel(currentFont)}</span>
          <ChevronDown size={14} />
        </MenuButton>
        <div className="tb-size" role="group" aria-label="Tamaño de fuente">
          <Btn label="Reducir tamaño" onClick={() => setSize(currentSize - 1)}><Minus size={14} /></Btn>
          <SizePicker value={currentSize} onPick={setSize} />
          <Btn label="Aumentar tamaño" onClick={() => setSize(currentSize + 1)}><Plus size={14} /></Btn>
        </div>
        <span className="tb-sep" />
        <Btn label="Negrita (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}><Bold size={16} strokeWidth={2} /></Btn>
        <Btn label="Cursiva (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Subrayado (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()}><UnderlineIcon size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Tachado" active={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={16} strokeWidth={1.75} /></Btn>
        <ColorPicker
          label="Color del texto"
          icon={<Type size={16} strokeWidth={1.75} />}
          bar={s.color ?? 'var(--text)'}
          colors={SWATCHES}
          onPick={(col) => (col ? c().setColor(col).run() : c().unsetColor().run())}
        />
        <ColorPicker
          label="Resaltado"
          icon={<Highlighter size={16} strokeWidth={1.75} />}
          bar="var(--accent)"
          colors={HIGHLIGHTS}
          onPick={(col) => (col ? c().setHighlight({ color: col }).run() : c().unsetHighlight().run())}
        />
        <span className="tb-sep" />
        <Btn label="Enlace (Ctrl+K)" active={s.link} onClick={a.link}><Link2 size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Comentar (Ctrl+Alt+M)" onClick={a.comment} disabled={s.empty}><MessageSquarePlus size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Imagen" onClick={() => pickImage(editor, a.error)}><ImageIcon size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Tabla" active={s.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} strokeWidth={1.75} /></Btn>
        <span className="tb-sep" />
        <MenuButton
          className="icon-btn"
          title="Alineación"
          items={[
            { label: 'Izquierda', icon: <AlignLeft size={16} />, kbd: 'Ctrl+Shift+L', checked: s.align === 'left', onSelect: () => c().setTextAlign('left').run() },
            { label: 'Centro', icon: <AlignCenter size={16} />, kbd: 'Ctrl+Shift+E', checked: s.align === 'center', onSelect: () => c().setTextAlign('center').run() },
            { label: 'Derecha', icon: <AlignRight size={16} />, kbd: 'Ctrl+Shift+R', checked: s.align === 'right', onSelect: () => c().setTextAlign('right').run() },
            { label: 'Justificado', icon: <AlignJustify size={16} />, kbd: 'Ctrl+Shift+J', checked: s.align === 'justify', onSelect: () => c().setTextAlign('justify').run() },
          ]}
        >
          {{ left: <AlignLeft size={16} strokeWidth={1.75} />, center: <AlignCenter size={16} strokeWidth={1.75} />, right: <AlignRight size={16} strokeWidth={1.75} />, justify: <AlignJustify size={16} strokeWidth={1.75} /> }[s.align]}
        </MenuButton>
        <Btn label="Lista con viñetas" active={s.bullet} onClick={() => c().toggleBulletList().run()}><List size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Lista numerada" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Lista de tareas" active={s.task} onClick={() => c().toggleTaskList().run()}><CheckSquare size={16} strokeWidth={1.75} /></Btn>
        <Btn label="Borrar formato" onClick={() => c().unsetAllMarks().clearNodes().run()}><Eraser size={16} strokeWidth={1.75} /></Btn>
        <MenuButton className="icon-btn" title="Más" align="end" items={[...formatMenu.slice(5)]}>
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </MenuButton>
      </fieldset>
    </div>
  )
}

function Btn(props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`icon-btn${props.active ? ' is-active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      disabled={props.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function SizePicker({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const [el, setEl] = useState<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <>
      <input
        ref={setEl}
        className="tb-size-input"
        aria-label="Tamaño en puntos"
        value={draft ?? String(value)}
        inputMode="numeric"
        onFocus={() => setOpen(true)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft) {
            onPick(Number(draft))
            setDraft(null)
            setOpen(false)
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <Menu
        anchor={el}
        open={open}
        onClose={() => setOpen(false)}
        items={FONT_SIZES.map((n) => ({ label: `${n}`, checked: n === value, onSelect: () => onPick(n) }))}
      />
    </>
  )
}

function ColorPicker(props: { label: string; icon: ReactNode; bar: string; colors: string[]; onPick: (c: string | null) => void }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={setEl}
        type="button"
        className="icon-btn tb-color"
        aria-label={props.label}
        title={props.label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {props.icon}
        <span className="tb-color-bar" style={{ background: props.bar }} />
      </button>
      <Popover anchor={el} open={open} onClose={() => setOpen(false)}>
        <div className="swatches" role="group" aria-label={props.label}>
          {props.colors.map((col) => (
            <button
              key={col}
              type="button"
              className="swatch"
              style={{ background: col }}
              aria-label={col}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (props.onPick(col), setOpen(false))}
            />
          ))}
        </div>
        <button type="button" className="menu-item" onClick={() => (props.onPick(null), setOpen(false))}>
          Quitar color
        </button>
      </Popover>
    </>
  )
}
