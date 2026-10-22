import type { JSONContent } from '@tiptap/react'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { IRunOptions, ParagraphChild } from 'docx'
import mammoth from 'mammoth'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { docxToContent } from './docx-import'
import type { DocSettings } from './store'
import { validContent } from '../editor/extensions'

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'md' | 'txt'

export interface ExportInput {
  title: string
  html: string
  json: JSONContent
  text: string
  settings?: DocSettings
}

export interface ImportResult {
  title: string
  /** JSON del editor ya listo (Word); si no viene, se convierte `html`. */
  content?: JSONContent
  html?: string
  settings?: Partial<DocSettings>
  warnings?: string[]
}

export const IMPORT_ACCEPT = '.docx,.md,.markdown,.txt,.html,.htm'

const DEFAULT_FONT = '"Courier New", "Courier Prime", Courier, monospace'

// ---------------------------------------------------------------- utilidades

function sanitizeFileName(title: string): string {
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  return clean || 'Sin título'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function fullHtml(title: string, body: string, settings: DocSettings = {}): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 2.2cm }
  body { font-family: ${settings.font ?? DEFAULT_FONT}; font-size: ${settings.fontSize ?? 12}pt; line-height: ${settings.lineHeight ?? 1.5}; color: #111; max-width: 800px; margin: 0 auto; padding: 1rem }
  p { margin: 0 0 ${settings.paragraphGap ?? 8}pt }
  .vd-page-break { break-after: page; page-break-after: always; height: 0 }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; page-break-after: avoid }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #999; color: #444 }
  pre { background: #f4f4f4; padding: .75em; white-space: pre-wrap; page-break-inside: avoid }
  code { font-family: "Courier New", monospace }
  table { border-collapse: collapse; width: 100% }
  th, td { border: 1px solid #999; padding: 4px 8px; vertical-align: top }
  th { background: #eee }
  img { max-width: 100% }
  hr { border: 0; border-top: 1px solid #999 }
  ul[data-type="taskList"] { list-style: none; padding-left: 0 }
  ul[data-type="taskList"] li { display: flex; gap: .5em }
  mark { background: #fff59d }
  @media print { body { max-width: none; padding: 0 } }
</style>
</head>
<body>
${body}
</body>
</html>`
}

// ------------------------------------------------------------------ exportar

function toMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  td.addRule('taskItemLabel', {
    filter: (node) =>
      node.nodeName === 'LABEL' && node.parentElement?.getAttribute('data-type') === 'taskItem',
    replacement: () => '',
  })
  td.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true'
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/g, '\n  ')
      return `- [${checked ? 'x' : ' '}] ${body}\n`
    },
  })
  return td.turndown(html)
}

function printPdf(title: string, html: string, settings?: DocSettings): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    let removed = false
    const cleanup = () => {
      if (removed) return
      removed = true
      iframe.remove()
      resolve()
    }
    iframe.onload = () => {
      const win = iframe.contentWindow
      if (!win) return cleanup()
      win.addEventListener('afterprint', cleanup)
      win.focus()
      win.print()
      setTimeout(cleanup, 60000)
    }
    iframe.srcdoc = fullHtml(title, html, settings)
    document.body.appendChild(iframe)
  })
}

export async function exportDocument(format: ExportFormat, doc: ExportInput): Promise<void> {
  const base = sanitizeFileName(doc.title)
  switch (format) {
    case 'html':
      download(
        new Blob([fullHtml(base, doc.html, doc.settings)], { type: 'text/html;charset=utf-8' }),
        `${base}.html`,
      )
      return
    case 'md':
      download(
        new Blob([toMarkdown(doc.html)], { type: 'text/markdown;charset=utf-8' }),
        `${base}.md`,
      )
      return
    case 'txt':
      download(new Blob([doc.text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`)
      return
    case 'pdf':
      await printPdf(base, doc.html, doc.settings)
      return
    case 'docx':
      download(await toDocxBlob(doc.json, doc.settings), `${base}.docx`)
      return
  }
}

// --------------------------------------------------------------------- docx

type DocxBlock = Paragraph | Table

interface Ctx {
  /** Profundidad de lista (0 = fuera de lista). */
  depth: number
  quote: boolean
  list?: { kind: 'bullet' | 'ordered' | 'task'; instance: number }
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const MONO = 'Courier New'
const MAX_IMG_WIDTH = 600
const ROOT: Ctx = { depth: 0, quote: false }

function numberingLevels(format: 'bullet' | 'decimal') {
  const bullets = ['•', '◦', '▪']
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: format === 'bullet' ? LevelFormat.BULLET : LevelFormat.DECIMAL,
    text: format === 'bullet' ? bullets[level % 3] : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))
}

function parseFontSize(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = value.trim().match(/^([\d.]+)\s*(pt|px)$/i)
  if (!m) return undefined
  const n = parseFloat(m[1])
  const halfPoints = m[2].toLowerCase() === 'pt' ? n * 2 : n * 1.5
  return Math.max(2, Math.round(halfPoints))
}

function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = value.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (!m) return undefined
  const h = m[1]
  return (h.length === 3 ? [...h].map((c) => c + c).join('') : h).toUpperCase()
}

function textRuns(node: JSONContent, extra?: IRunOptions): ParagraphChild[] {
  const opts: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {
    text: node.text ?? '',
    ...extra,
  }
  let href: string | undefined
  for (const mark of node.marks ?? []) {
    const attrs = mark.attrs ?? {}
    switch (mark.type) {
      case 'bold':
        opts.bold = true
        break
      case 'italic':
        opts.italics = true
        break
      case 'underline':
        opts.underline = {}
        break
      case 'strike':
        opts.strike = true
        break
      case 'code':
        opts.font = MONO
        break
      case 'subscript':
        opts.subScript = true
        break
      case 'superscript':
        opts.superScript = true
        break
      case 'link':
        if (typeof attrs.href === 'string') href = attrs.href
        break
      case 'highlight':
        opts.shading = {
          type: ShadingType.CLEAR,
          color: 'auto',
          fill: hexColor(attrs.color) ?? 'FFFF00',
        }
        break
      case 'textStyle': {
        const color = hexColor(attrs.color)
        if (color) opts.color = color
        if (typeof attrs.fontFamily === 'string') {
          const family = attrs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
          if (family) opts.font = family
        }
        const size = parseFontSize(attrs.fontSize)
        if (size) opts.size = size
        break
      }
    }
  }
  const run = new TextRun(opts)
  return [href ? new ExternalHyperlink({ link: href, children: [run] }) : run]
}

function dataUrlToBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = src.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/)
  if (!m) return null
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return { bytes, mime: m[1].toLowerCase() }
  } catch {
    return null
  }
}

function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function imageRun(node: JSONContent): Promise<ParagraphChild | null> {
  const src = node.attrs?.src
  if (typeof src !== 'string') return null
  const data = dataUrlToBytes(src)
  if (!data) return null
  const types: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  }
  const type = types[data.mime]
  if (!type) return null
  let width = Number(node.attrs?.width)
  let height = Number(node.attrs?.height)
  if (!(width > 0 && height > 0)) {
    const size = await naturalSize(src)
    if (!size || !size.width || !size.height) return null
    width = size.width
    height = size.height
  }
  if (width > MAX_IMG_WIDTH) {
    height = Math.round((height * MAX_IMG_WIDTH) / width)
    width = MAX_IMG_WIDTH
  }
  return new ImageRun({
    type,
    data: data.bytes,
    transformation: { width: Math.round(width), height: Math.round(height) },
  })
}

async function inline(
  nodes: JSONContent[] | undefined,
  extra?: IRunOptions,
): Promise<ParagraphChild[]> {
  const out: ParagraphChild[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'text') out.push(...textRuns(n, extra))
    else if (n.type === 'hardBreak') out.push(new TextRun({ break: 1 }))
    else if (n.type === 'image') {
      try {
        const run = await imageRun(n)
        if (run) out.push(run)
      } catch {
        // imagen inválida: se omite
      }
    }
  }
  return out
}

const twips = (pt: unknown) => (typeof pt === 'number' ? Math.round(pt * 20) : undefined)

function paragraphOptions(node: JSONContent, ctx: Ctx) {
  const a = node.attrs ?? {}
  const textIndent = typeof a.textIndent === 'number' ? a.textIndent : undefined
  const hasIndent = a.indentLeft != null || a.indentRight != null || textIndent != null
  const hasSpacing = a.spaceBefore != null || a.spaceAfter != null || a.lineSpacing != null
  return {
    alignment: ALIGN[String(a.textAlign ?? '')],
    ...(hasIndent
      ? {
          indent: {
            left: twips(a.indentLeft),
            right: twips(a.indentRight),
            firstLine: textIndent && textIndent > 0 ? twips(textIndent) : undefined,
            hanging: textIndent && textIndent < 0 ? twips(-textIndent) : undefined,
          },
        }
      : {}),
    ...(hasSpacing
      ? {
          spacing: {
            before: twips(a.spaceBefore),
            after: twips(a.spaceAfter),
            line: typeof a.lineSpacing === 'number' ? Math.round((a.lineSpacing / 1.15) * 240) : undefined,
          },
        }
      : {}),
    ...(ctx.quote
      ? {
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, space: 8, color: '999999' } },
        }
      : {}),
  }
}

async function listItem(item: JSONContent, ctx: Ctx): Promise<DocxBlock[]> {
  const out: DocxBlock[] = []
  const list = ctx.list!
  const prefix = item.attrs?.checked ? '☑ ' : '☐ '
  let first = true
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph' && first) {
      first = false
      const children = await inline(child.content)
      const level = Math.min(ctx.depth - 1, 8)
      if (list.kind === 'task') {
        out.push(
          new Paragraph({
            ...paragraphOptions(child, ctx),
            indent: { left: 720 * ctx.depth, hanging: 360 },
            children: [new TextRun(prefix), ...children],
          }),
        )
      } else {
        out.push(
          new Paragraph({
            ...paragraphOptions(child, ctx),
            numbering:
              list.kind === 'ordered'
                ? { reference: 'verdant-ol', level, instance: list.instance }
                : { reference: 'verdant-ul', level },
            children,
          }),
        )
      }
      continue
    }
    first = false
    out.push(...(await block(child, { ...ctx, list: undefined })))
  }
  if (first) out.push(new Paragraph({ children: list.kind === 'task' ? [new TextRun(prefix)] : [] }))
  return out
}

let orderedInstance = 0

async function block(node: JSONContent, ctx: Ctx): Promise<DocxBlock[]> {
  switch (node.type) {
    case 'paragraph':
      return [
        new Paragraph({ ...paragraphOptions(node, ctx), children: await inline(node.content) }),
      ]
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      return [
        new Paragraph({
          ...paragraphOptions(node, ctx),
          heading: HEADINGS[level - 1],
          children: await inline(node.content),
        }),
      ]
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const kind =
        node.type === 'bulletList' ? 'bullet' : node.type === 'orderedList' ? 'ordered' : 'task'
      const inner: Ctx = {
        ...ctx,
        depth: ctx.depth + 1,
        list: { kind, instance: kind === 'ordered' ? ++orderedInstance : 0 },
      }
      const out: DocxBlock[] = []
      for (const item of node.content ?? []) out.push(...(await listItem(item, inner)))
      return out
    }
    case 'blockquote': {
      const out: DocxBlock[] = []
      for (const child of node.content ?? []) {
        out.push(...(await block(child, { ...ctx, quote: true })))
      }
      return out
    }
    case 'codeBlock': {
      const lines = (node.content ?? [])
        .map((n) => n.text ?? '')
        .join('')
        .split('\n')
      return [
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' },
          children: lines.map(
            (line, i) => new TextRun({ text: line, font: MONO, break: i ? 1 : undefined }),
          ),
        }),
      ]
    }
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })]
    case 'horizontalRule':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '999999' } },
          children: [],
        }),
      ]
    case 'table':
      return [await table(node)]
    case 'image': {
      const run = await imageRun(node).catch(() => null)
      return run ? [new Paragraph({ children: [run] })] : []
    }
    default: {
      // nodo desconocido: se aplana su contenido
      const out: DocxBlock[] = []
      for (const child of node.content ?? []) out.push(...(await block(child, ctx)))
      return out
    }
  }
}

async function table(node: JSONContent): Promise<Table> {
  const rows: TableRow[] = []
  for (const row of node.content ?? []) {
    const cells: TableCell[] = []
    for (const cell of row.content ?? []) {
      const isHeader = cell.type === 'tableHeader'
      const children: DocxBlock[] = []
      for (const child of cell.content ?? []) {
        if (isHeader && child.type === 'paragraph') {
          children.push(
            new Paragraph({
              ...paragraphOptions(child, ROOT),
              children: await inline(child.content, { bold: true }),
            }),
          )
        } else {
          children.push(...(await block(child, ROOT)))
        }
      }
      if (!children.some((c) => c instanceof Paragraph)) {
        children.push(new Paragraph({ children: [] }))
      }
      const colspan = Number(cell.attrs?.colspan) || 1
      const rowspan = Number(cell.attrs?.rowspan) || 1
      cells.push(
        new TableCell({
          children,
          columnSpan: colspan > 1 ? colspan : undefined,
          rowSpan: rowspan > 1 ? rowspan : undefined,
          shading: cell.attrs?.cellBackground
            ? { type: ShadingType.CLEAR, color: 'auto', fill: String(cell.attrs.cellBackground).replace('#', '') }
            : isHeader
              ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEEEEE' }
              : undefined,
        }),
      )
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

async function toDocxBlob(json: JSONContent, settings: DocSettings = {}): Promise<Blob> {
  const font = (settings.font ?? MONO).split(',')[0].replace(/["']/g, '').trim()
  const size = Math.round((settings.fontSize ?? 12) * 2)
  const line = Math.round(((settings.lineHeight ?? 1.15) / 1.15) * 240)
  orderedInstance = 0
  const children: DocxBlock[] = []
  for (const node of json.content ?? []) children.push(...(await block(node, ROOT)))
  if (!children.length) children.push(new Paragraph({ children: [] }))
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font, size },
          paragraph: { spacing: { line, after: Math.round((settings.paragraphGap ?? 8) * 20) } },
        },
      },
    },
    numbering: {
      config: [
        { reference: 'verdant-ul', levels: numberingLevels('bullet') },
        { reference: 'verdant-ol', levels: numberingLevels('decimal') },
      ],
    },
    sections: [{ children }],
  })
  return Packer.toBlob(doc)
}

// ----------------------------------------------------------------- importar

function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('script, style, iframe, object, embed').forEach((el) => el.remove())
  parsed.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      // eslint-disable-next-line no-control-regex
      const value = attr.value.replace(/[\u0000- ]/g, '').toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    }
  })
  return parsed.body.innerHTML
}

// Convierte listas `- [ ]` de marked en listas de tareas de Tiptap
function markdownTaskLists(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const sel = ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'
  parsed.body.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === 'LI')
    const boxes = items.map((li) => li.querySelector(sel))
    if (!items.length || boxes.some((b) => !b)) return
    ul.setAttribute('data-type', 'taskList')
    items.forEach((li, i) => {
      const box = boxes[i]!
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false')
      box.remove()
    })
  })
  return parsed.body.innerHTML
}

export async function importFile(file: File): Promise<ImportResult> {
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  const title = dot > 0 ? file.name.slice(0, dot) : file.name

  switch (ext) {
    case '.docx': {
      const buffer = await file.arrayBuffer()
      try {
        const r = await docxToContent(buffer)
        return { title, content: validContent(r.content), settings: r.settings, warnings: r.warnings }
      } catch (err) {
        console.warn('Importador de Word: se usa el modo simple', err)
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
        return { title, html: result.value, warnings: ['Este Word se importó en modo simple: parte del formato puede perderse.'] }
      }
    }
    case '.md':
    case '.markdown': {
      const raw = marked.parse(await file.text(), { async: false })
      return { title, html: sanitizeHtml(markdownTaskLists(raw)) }
    }
    case '.txt': {
      const html = (await file.text())
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
        .join('')
      return { title, html }
    }
    case '.html':
    case '.htm':
      return { title, html: sanitizeHtml(await file.text()) }
    default:
      throw new Error(`Formato no soportado: ${ext || file.name}`)
  }
}
