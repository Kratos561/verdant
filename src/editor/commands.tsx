// Acciones de inserción compartidas por el menú «/», la barra y el menú Insertar.
import type { Editor, Range } from '@tiptap/core'
import {
  CheckSquare, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Pilcrow,
  Quote, Table as TableIcon, CalendarDays,
} from 'lucide-react'
import type { ReactNode } from 'react'

export interface BlockCommand {
  id: string
  title: string
  hint: string
  keywords: string
  icon: ReactNode
  run: (editor: Editor, range?: Range) => void
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** Abre el selector de archivos e inserta la imagen como data URL. */
export function pickImage(editor: Editor, onError?: (msg: string) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,image/webp'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      onError?.('La imagen supera 3 MB. Redúcela e inténtalo de nuevo.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result), alt: file.name }).run()
    reader.readAsDataURL(file)
  }
  input.click()
}

const chainAt = (editor: Editor, range?: Range) => {
  const c = editor.chain().focus()
  return range ? c.deleteRange(range) : c
}

const icon = (Icon: typeof Pilcrow) => <Icon size={16} strokeWidth={1.75} />

export const BLOCK_COMMANDS: BlockCommand[] = [
  { id: 'p', title: 'Texto', hint: 'Párrafo normal', keywords: 'texto parrafo normal', icon: icon(Pilcrow), run: (e, r) => chainAt(e, r).setParagraph().run() },
  { id: 'h1', title: 'Título 1', hint: 'Encabezado grande', keywords: 'titulo h1 encabezado', icon: icon(Heading1), run: (e, r) => chainAt(e, r).setHeading({ level: 1 }).run() },
  { id: 'h2', title: 'Título 2', hint: 'Encabezado de sección', keywords: 'titulo h2 encabezado', icon: icon(Heading2), run: (e, r) => chainAt(e, r).setHeading({ level: 2 }).run() },
  { id: 'h3', title: 'Título 3', hint: 'Subsección', keywords: 'titulo h3 encabezado', icon: icon(Heading3), run: (e, r) => chainAt(e, r).setHeading({ level: 3 }).run() },
  { id: 'ul', title: 'Lista con viñetas', hint: 'Lista simple', keywords: 'lista viñetas bullet', icon: icon(List), run: (e, r) => chainAt(e, r).toggleBulletList().run() },
  { id: 'ol', title: 'Lista numerada', hint: '1, 2, 3…', keywords: 'lista numerada ordenada', icon: icon(ListOrdered), run: (e, r) => chainAt(e, r).toggleOrderedList().run() },
  { id: 'todo', title: 'Lista de tareas', hint: 'Casillas de verificación', keywords: 'tareas checklist casillas todo', icon: icon(CheckSquare), run: (e, r) => chainAt(e, r).toggleTaskList().run() },
  { id: 'quote', title: 'Cita', hint: 'Bloque de cita', keywords: 'cita quote', icon: icon(Quote), run: (e, r) => chainAt(e, r).toggleBlockquote().run() },
  { id: 'code', title: 'Bloque de código', hint: 'Texto monoespaciado', keywords: 'codigo code', icon: icon(Code2), run: (e, r) => chainAt(e, r).toggleCodeBlock().run() },
  { id: 'table', title: 'Tabla', hint: '3 × 3 con encabezado', keywords: 'tabla table', icon: icon(TableIcon), run: (e, r) => chainAt(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  {
    id: 'image', title: 'Imagen', hint: 'Desde tu equipo', keywords: 'imagen foto image', icon: icon(ImageIcon),
    run: (e, r) => {
      chainAt(e, r).run()
      pickImage(e)
    },
  },
  { id: 'hr', title: 'Separador', hint: 'Línea horizontal', keywords: 'separador linea divider', icon: icon(Minus), run: (e, r) => chainAt(e, r).setHorizontalRule().run() },
  {
    id: 'date', title: 'Fecha de hoy', hint: 'Inserta la fecha', keywords: 'fecha hoy date', icon: icon(CalendarDays),
    run: (e, r) => chainAt(e, r).insertContent(new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })).run(),
  },
]

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filterCommands(query: string): BlockCommand[] {
  const q = fold(query.trim())
  if (!q) return BLOCK_COMMANDS
  return BLOCK_COMMANDS.filter((c) => fold(`${c.title} ${c.keywords}`).includes(q))
}
