// Importador de Word (.docx) → JSON de Tiptap que conserva el formato: fuentes, tamaños, colores,
// resaltado, alineación, sangrías, espaciado, interlineado, listas, tablas, imágenes, enlaces,
// notas al pie, saltos de línea y de página y párrafos vacíos. Lee el XML del paquete directamente
// (estilos con herencia, tema, numeración y relaciones) en lugar de pasar por un HTML simplificado.
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/core'
import { COURIER_STACK, FONTS } from './fonts'
import type { DocSettings, HeaderFooter, PageSetup } from './store'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const V = 'urn:schemas-microsoft-com:vml'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

export interface DocxResult {
  content: JSONContent
  settings: Partial<DocSettings>
  warnings: string[]
}

// ---------- XML ----------

const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : []
const kid = (el: Element | null | undefined, name: string): Element | null => kids(el, name)[0] ?? null
const attr = (el: Element | null | undefined, name: string): string | null =>
  el ? (el.getAttributeNS(W, name) || el.getAttribute(`w:${name}`) || null) : null
const relId = (el: Element | null | undefined, name: string): string | null =>
  el ? (el.getAttributeNS(R, name) || el.getAttribute(`r:${name}`) || null) : null

/** Propiedad booleana de Word: presente sin valor = activa; val="0|false|off" = inactiva. */
function flag(el: Element | null): boolean | undefined {
  if (!el) return undefined
  const v = attr(el, 'val')
  return v === null || !['0', 'false', 'off', 'none'].includes(v)
}

const twipsToPt = (v: string | null): number | undefined => (v === null || v === '' ? undefined : Math.round(Number(v) / 2) / 10)

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}

// ---------- Propiedades ----------

interface RunProps {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: string
  shading?: string
  font?: string
  size?: number
  vert?: 'superscript' | 'subscript' | 'baseline'
  caps?: boolean
  hidden?: boolean
}

interface ParaProps {
  align?: 'left' | 'center' | 'right' | 'justify'
  indLeft?: number
  indRight?: number
  firstLine?: number
  hanging?: number
  before?: number
  after?: number
  line?: number
  lineRule?: string
  numId?: string
  ilvl?: number
  outline?: number
  pageBreakBefore?: boolean
}

function merge<T extends object>(...parts: (T | undefined)[]): T {
  const out: Record<string, unknown> = {}
  for (const p of parts) if (p) for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = v
  return out as T
}

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
}

interface Theme {
  major?: string
  minor?: string
}

function parseRPr(rPr: Element | null, theme: Theme): RunProps {
  if (!rPr) return {}
  const u = kid(rPr, 'u')
  const color = attr(kid(rPr, 'color'), 'val')
  const hl = attr(kid(rPr, 'highlight'), 'val')
  const fill = attr(kid(rPr, 'shd'), 'fill')
  const fonts = kid(rPr, 'rFonts')
  const themeFont = attr(fonts, 'asciiTheme') ?? attr(fonts, 'hAnsiTheme')
  const font =
    attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? (themeFont ? (themeFont.startsWith('major') ? theme.major : theme.minor) : undefined) ?? attr(fonts, 'cs') ?? undefined
  const sz = attr(kid(rPr, 'sz'), 'val')
  const vert = attr(kid(rPr, 'vertAlign'), 'val')
  const strike = flag(kid(rPr, 'strike'))
  const dstrike = flag(kid(rPr, 'dstrike'))
  return {
    bold: flag(kid(rPr, 'b')),
    italic: flag(kid(rPr, 'i')),
    underline: u ? attr(u, 'val') !== 'none' : undefined,
    strike: strike ?? dstrike,
    color: color && color !== 'auto' ? `#${color.toLowerCase()}` : undefined,
    highlight: hl && hl !== 'none' ? HIGHLIGHT[hl] : undefined,
    shading: fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : undefined,
    font: font ?? undefined,
    size: sz ? Number(sz) / 2 : undefined,
    vert: vert === 'superscript' || vert === 'subscript' || vert === 'baseline' ? vert : undefined,
    caps: flag(kid(rPr, 'caps')),
    hidden: flag(kid(rPr, 'vanish')),
  }
}

function parsePPr(pPr: Element | null): ParaProps {
  if (!pPr) return {}
  const jc = attr(kid(pPr, 'jc'), 'val')
  const ind = kid(pPr, 'ind')
  const sp = kid(pPr, 'spacing')
  const numPr = kid(pPr, 'numPr')
  const outline = attr(kid(pPr, 'outlineLvl'), 'val')
  const ilvl = attr(kid(numPr, 'ilvl'), 'val')
  const align =
    jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' || jc === 'mediumKashida' || jc === 'highKashida' || jc === 'lowKashida' || jc === 'thaiDistribute' ? 'justify' : jc === 'left' || jc === 'start' ? 'left' : undefined
  return {
    align,
    indLeft: twipsToPt(attr(ind, 'left') ?? attr(ind, 'start')),
    indRight: twipsToPt(attr(ind, 'right') ?? attr(ind, 'end')),
    firstLine: twipsToPt(attr(ind, 'firstLine')),
    hanging: twipsToPt(attr(ind, 'hanging')),
    before: twipsToPt(attr(sp, 'before')),
    after: twipsToPt(attr(sp, 'after')),
    line: attr(sp, 'line') ? Number(attr(sp, 'line')) : undefined,
    lineRule: attr(sp, 'lineRule') ?? undefined,
    numId: attr(kid(numPr, 'numId'), 'val') ?? undefined,
    ilvl: ilvl !== null ? Number(ilvl) : undefined,
    outline: outline !== null ? Number(outline) : undefined,
    pageBreakBefore: flag(kid(pPr, 'pageBreakBefore')),
  }
}

// ---------- Estilos ----------

interface Style {
  type: string
  name: string
  basedOn: string | null
  ppr: ParaProps
  rpr: RunProps
}

class Styles {
  private map = new Map<string, Style>()
  private defaultPara: string | null = null
  defaults: { ppr: ParaProps; rpr: RunProps } = { ppr: {}, rpr: {} }

  constructor(doc: Document | null, theme: Theme) {
    if (!doc) return
    const root = doc.documentElement
    const dd = kid(root, 'docDefaults')
    this.defaults = {
      rpr: parseRPr(kid(kid(dd, 'rPrDefault'), 'rPr'), theme),
      ppr: parsePPr(kid(kid(dd, 'pPrDefault'), 'pPr')),
    }
    for (const s of kids(root, 'style')) {
      const id = attr(s, 'styleId')
      if (!id) continue
      const type = attr(s, 'type') ?? 'paragraph'
      this.map.set(id, {
        type,
        name: (attr(kid(s, 'name'), 'val') ?? id).toLowerCase(),
        basedOn: attr(kid(s, 'basedOn'), 'val'),
        ppr: parsePPr(kid(s, 'pPr')),
        rpr: parseRPr(kid(s, 'rPr'), theme),
      })
      if (type === 'paragraph' && ['1', 'true', 'on'].includes(attr(s, 'default') ?? '')) this.defaultPara ??= id
    }
  }

  /** Cadena de estilos desde el más general al más concreto. */
  private chain(id: string | null): Style[] {
    const out: Style[] = []
    const seen = new Set<string>()
    let cur = id
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const s = this.map.get(cur)
      if (!s) break
      out.unshift(s)
      cur = s.basedOn
    }
    return out
  }

  paragraph(styleId: string | null) {
    const chain = this.chain(styleId ?? this.defaultPara)
    let level = 0
    for (const s of [...chain].reverse()) {
      const m = s.name.match(/^heading\s*([1-6])$/)
      if (m) {
        level = Number(m[1])
        break
      }
      if (s.name === 'title') {
        level = 1
        break
      }
    }
    return {
      ppr: merge<ParaProps>(this.defaults.ppr, ...chain.map((s) => s.ppr)),
      rpr: merge<RunProps>(this.defaults.rpr, ...chain.map((s) => s.rpr)),
      level,
    }
  }

  character(styleId: string | null): RunProps {
    return styleId ? merge<RunProps>(...this.chain(styleId).map((s) => s.rpr)) : {}
  }
}

// ---------- Numeración ----------

interface Level {
  fmt: string
  start: number
  text: string
}

class Numbering {
  private abstract = new Map<string, Map<number, Level>>()
  private nums = new Map<string, { abs: string; starts: Map<number, number> }>()

  constructor(doc: Document | null) {
    if (!doc) return
    const root = doc.documentElement
    for (const a of kids(root, 'abstractNum')) {
      const levels = new Map<number, Level>()
      for (const l of kids(a, 'lvl')) {
        levels.set(Number(attr(l, 'ilvl') ?? 0), {
          fmt: attr(kid(l, 'numFmt'), 'val') ?? 'decimal',
          start: Number(attr(kid(l, 'start'), 'val') ?? 1),
          text: attr(kid(l, 'lvlText'), 'val') ?? '',
        })
      }
      this.abstract.set(attr(a, 'abstractNumId') ?? '', levels)
    }
    for (const n of kids(root, 'num')) {
      const starts = new Map<number, number>()
      for (const o of kids(n, 'lvlOverride')) {
        const s = attr(kid(o, 'startOverride'), 'val')
        if (s !== null) starts.set(Number(attr(o, 'ilvl') ?? 0), Number(s))
      }
      this.nums.set(attr(n, 'numId') ?? '', { abs: attr(kid(n, 'abstractNumId'), 'val') ?? '', starts })
    }
  }

  level(numId: string, ilvl: number): Level | null {
    const n = this.nums.get(numId)
    const lvl = n && this.abstract.get(n.abs)?.get(ilvl)
    if (!n || !lvl) return null
    return { ...lvl, start: n.starts.get(ilvl) ?? lvl.start }
  }
}

function formatNumber(n: number, fmt: string): string {
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let out = ''
    for (const [v, s] of t) while (x >= v) (out += s), (x -= v)
    return out
  }
  const letter = (x: number) => {
    let out = ''
    while (x > 0) (out = String.fromCharCode(97 + ((x - 1) % 26)) + out), (x = Math.floor((x - 1) / 26))
    return out
  }
  switch (fmt) {
    case 'lowerRoman': return roman(n)
    case 'upperRoman': return roman(n).toUpperCase()
    case 'lowerLetter': return letter(n)
    case 'upperLetter': return letter(n).toUpperCase()
    case 'decimalZero': return String(n).padStart(2, '0')
    default: return String(n)
  }
}

const LIST_TYPE: Record<string, string> = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' }

// ---------- Fuentes ----------

const SERIF = /times|georgia|cambria|garamond|book antiqua|palatino|baskerville|bodoni|century|constantia|didot|merriweather|lora|caladea|serif/i
const MONO = /courier|consolas|mono|menlo|lucida console|source code/i
const ALIASES: Record<string, string> = { calibri: 'Carlito', cambria: 'Caladea' }

export function fontStack(name: string): string {
  if (/^courier new$/i.test(name)) return COURIER_STACK
  const known = FONTS.find((f) => f.label.toLowerCase() === name.toLowerCase())
  if (known) return known.value
  const alias = ALIASES[name.toLowerCase()]
  const generic = MONO.test(name) ? 'monospace' : SERIF.test(name) ? 'serif' : 'sans-serif'
  return `"${name}"${alias ? `, "${alias}"` : ''}, ${generic}`
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ---------- Imágenes ----------

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }
const MAX_IMAGE_BYTES = 900 * 1024
const MAX_IMAGE_SIDE = 1600

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Reduce imágenes grandes para que el documento siga siendo ligero de sincronizar. */
async function shrink(bytes: Uint8Array, mime: string): Promise<string> {
  const original = `data:${mime};base64,${bytesToBase64(bytes)}`
  if (bytes.length <= MAX_IMAGE_BYTES || mime === 'image/gif' || mime === 'image/svg+xml' || typeof createImageBitmap !== 'function') return original
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const smaller = canvas.toDataURL('image/webp', 0.85)
    return smaller.length < original.length ? smaller : original
  } catch {
    return original
  }
}

/** Dibuja un metarchivo de Windows (EMF/WMF) como SVG; el renderizador se descarga solo si hace falta. */
async function metafileToSvg(bytes: Uint8Array, ext: 'emf' | 'wmf', width: number, height: number): Promise<string | null> {
  try {
    const mod = ext === 'emf' ? await import('rtf.js/dist/EMFJS.bundle.min.js') : await import('rtf.js/dist/WMFJS.bundle.min.js')
    const Renderer = mod.Renderer ?? (mod as unknown as { default: { Renderer: typeof mod.Renderer } }).default.Renderer
    const w = Math.round(width || 400)
    const h = Math.round(height || 300)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const svg = new Renderer(buffer).render({ width: `${w}px`, height: `${h}px`, wExt: w, hExt: h, xExt: w, yExt: h, mapMode: 8 })
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const xml = new XMLSerializer().serializeToString(svg)
    return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(xml))}`
  } catch {
    return null
  }
}

// ---------- Conversión ----------

type Mark = { type: string; attrs?: Record<string, unknown> }

interface Para {
  ppr: ParaProps
  rpr: RunProps
  level: number
}

/** Acumula el contenido en línea de un párrafo y lo parte cuando hay saltos de página o imágenes. */
class ParaSink {
  inline: JSONContent[] = []
  out: JSONContent[] = []
  splitters = 0
  private make: (inline: JSONContent[]) => JSONContent

  constructor(make: (inline: JSONContent[]) => JSONContent) {
    this.make = make
  }

  text(text: string, marks: Mark[]) {
    if (!text) return
    const last = this.inline[this.inline.length - 1]
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += text
    else this.inline.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
  }

  hardBreak() {
    this.inline.push({ type: 'hardBreak' })
  }

  block(nodes: JSONContent[]) {
    if (!nodes.length) return
    if (this.inline.length) this.out.push(this.make(this.inline.splice(0)))
    this.out.push(...nodes)
    this.splitters++
  }

  finish(): JSONContent[] {
    // Un párrafo vacío de verdad se conserva (es espacio en blanco del autor); uno que solo traía
    // un salto de página o una imagen no deja un párrafo vacío detrás.
    if (this.inline.length || this.splitters === 0) this.out.push(this.make(this.inline.splice(0)))
    return this.out
  }
}

class ListBuilder {
  private stack: { node: JSONContent; numId: string; ilvl: number; ordered: boolean }[] = []

  close() {
    this.stack = []
  }

  /** Añade un elemento; devuelve la lista raíz cuando empieza una nueva (para insertarla en el flujo). */
  add(numId: string, ilvl: number, level: Level, number: number, blocks: JSONContent[]): JSONContent | null {
    const ordered = level.fmt !== 'bullet' && level.fmt !== 'none'
    if (blocks[0]?.type !== 'paragraph') blocks.unshift({ type: 'paragraph' })
    const item: JSONContent = { type: 'listItem', content: blocks }
    while (this.stack.length && this.stack[this.stack.length - 1].ilvl > ilvl) this.stack.pop()
    const top = this.stack[this.stack.length - 1]
    if (top && top.ilvl === ilvl && top.numId === numId && top.ordered === ordered) {
      top.node.content!.push(item)
      return null
    }
    if (top && top.ilvl === ilvl) this.stack.pop()
    const list: JSONContent = ordered
      ? { type: 'orderedList', attrs: { start: number, ...(LIST_TYPE[level.fmt] ? { type: LIST_TYPE[level.fmt] } : {}) }, content: [item] }
      : { type: 'bulletList', content: [item] }
    const parent = this.stack[this.stack.length - 1]
    this.stack.push({ node: list, numId, ilvl, ordered })
    if (parent) {
      const lastItem = parent.node.content![parent.node.content!.length - 1]
      lastItem.content!.push(list)
      return null
    }
    return list
  }
}

class Converter {
  warnings = new Set<string>()
  private counters = new Map<string, number[]>()
  private fields: ('instr' | 'result')[] = []
  private notes: { n: number; el: Element }[] = []
  private zip: JSZip
  private styles: Styles
  private numbering: Numbering
  private theme: Theme
  private rels: Map<string, { target: string; external: boolean }>
  private footnotes: Map<string, Element>
  private endnotes: Map<string, Element>

  constructor(zip: JSZip, parts: {
    styles: Document | null
    numbering: Document | null
    theme: Theme
    rels: Map<string, { target: string; external: boolean }>
    footnotes: Map<string, Element>
    endnotes: Map<string, Element>
  }) {
    this.zip = zip
    this.theme = parts.theme
    this.styles = new Styles(parts.styles, parts.theme)
    this.numbering = new Numbering(parts.numbering)
    this.rels = parts.rels
    this.footnotes = parts.footnotes
    this.endnotes = parts.endnotes
  }

  async body(body: Element): Promise<JSONContent[]> {
    const out = await this.blocks(body)
    if (this.notes.length) {
      out.push({ type: 'horizontalRule' })
      for (const { n, el } of this.notes) {
        const blocks = await this.blocks(el)
        const first = blocks.find((b) => b.type === 'paragraph')
        if (first) first.content = [{ type: 'text', text: `${n}. ` }, ...(first.content ?? [])]
        else blocks.unshift({ type: 'paragraph', content: [{ type: 'text', text: `${n}.` }] })
        out.push(...blocks)
      }
    }
    return out
  }

  private async blocks(parent: Element | null): Promise<JSONContent[]> {
    const out: JSONContent[] = []
    const lists = new ListBuilder()
    for (const el of kids(parent)) {
      switch (el.localName) {
        case 'p': {
          const p = this.resolve(el)
          const list = this.listInfo(p)
          const blocks = await this.paragraph(el, p, list)
          if (list && !p.level) {
            const root = lists.add(list.numId, list.ilvl, list.level, list.number, blocks)
            if (root) out.push(root)
          } else {
            lists.close()
            out.push(...blocks)
          }
          break
        }
        case 'tbl':
          lists.close()
          out.push(await this.table(el))
          break
        case 'sdt':
          lists.close()
          out.push(...(await this.blocks(kid(el, 'sdtContent'))))
          break
        case 'customXml':
        case 'ins':
          out.push(...(await this.blocks(el)))
          break
        case 'AlternateContent':
          out.push(...(await this.blocks(kid(el, 'Choice') ?? kid(el, 'Fallback'))))
          break
      }
    }
    return out
  }

  private resolve(p: Element): Para {
    const pPr = kid(p, 'pPr')
    const base = this.styles.paragraph(attr(kid(pPr, 'pStyle'), 'val'))
    const ppr = merge<ParaProps>(base.ppr, parsePPr(pPr))
    let level = base.level
    if (!level && ppr.outline !== undefined && ppr.outline < 6) level = ppr.outline + 1
    return { ppr, rpr: base.rpr, level }
  }

  private listInfo(p: Para) {
    const { numId, ilvl = 0 } = p.ppr
    if (!numId || numId === '0') return null
    const level = this.numbering.level(numId, ilvl)
    if (!level) return null
    const counts = this.counters.get(numId) ?? []
    counts[ilvl] = (counts[ilvl] ?? level.start - 1) + 1
    counts.length = ilvl + 1
    this.counters.set(numId, counts)
    const label = level.text.replace(/%(\d)/g, (_, d: string) => {
      const i = Number(d) - 1
      const lv = this.numbering.level(numId, i)
      return formatNumber(counts[i] ?? lv?.start ?? 1, lv?.fmt ?? 'decimal')
    })
    return { numId, ilvl, level, number: counts[ilvl], label }
  }

  private paraNode(p: Para, inline: JSONContent[], inList: boolean): JSONContent {
    const { ppr } = p
    const attrs: Record<string, unknown> = {}
    if (p.level) attrs.level = Math.min(p.level, 6)
    if (ppr.align && ppr.align !== 'left') attrs.textAlign = ppr.align
    if (!inList) {
      if (ppr.indLeft) attrs.indentLeft = ppr.indLeft
      const indent = ppr.hanging ? -ppr.hanging : ppr.firstLine
      if (indent) attrs.textIndent = indent
    }
    if (ppr.indRight) attrs.indentRight = ppr.indRight
    if (ppr.before) attrs.spaceBefore = ppr.before
    attrs.spaceAfter = ppr.after ?? 0
    attrs.lineSpacing = this.lineSpacing(ppr, p.rpr.size ?? 11)
    const node: JSONContent = { type: p.level ? 'heading' : 'paragraph', attrs }
    if (inline.length) node.content = inline
    return node
  }

  private lineSpacing(ppr: ParaProps, size: number): number {
    // La línea "sencilla" de Word mide ~1,15 veces el tamaño de la letra.
    if (!ppr.line) return 1.15
    if (!ppr.lineRule || ppr.lineRule === 'auto') return Math.round((ppr.line / 240) * 1.15 * 100) / 100
    return Math.max(1, Math.round((ppr.line / 20 / size) * 100) / 100)
  }

  private async paragraph(el: Element, p: Para, list: ReturnType<Converter['listInfo']>): Promise<JSONContent[]> {
    const inList = !!list && !p.level
    const sink = new ParaSink((inline) => this.paraNode(p, inline, inList))
    const out: JSONContent[] = []
    if (p.ppr.pageBreakBefore) out.push({ type: 'pageBreak' })
    // Los títulos numerados conservan su número como texto («1.2 Objetivos»).
    if (list && p.level && list.label) sink.text(`${list.label} `, this.marks(p.rpr))
    await this.inlines(el, p.rpr, sink)
    out.push(...sink.finish())
    return out
  }

  private async inlines(parent: Element | null, base: RunProps, sink: ParaSink, link?: string): Promise<void> {
    for (const el of kids(parent)) {
      switch (el.localName) {
        case 'r':
          await this.run(el, base, sink, link)
          break
        case 'hyperlink': {
          const id = relId(el, 'id')
          const rel = id ? this.rels.get(id) : undefined
          await this.inlines(el, base, sink, rel?.external ? rel.target : link)
          break
        }
        case 'ins':
        case 'smartTag':
        case 'customXml':
        case 'fldSimple':
        case 'moveTo':
        case 'dir':
        case 'bdo':
          await this.inlines(el, base, sink, link)
          break
        case 'sdt':
          await this.inlines(kid(el, 'sdtContent'), base, sink, link)
          break
        case 'oMath':
        case 'oMathPara': {
          const text = Array.from(el.getElementsByTagNameNS(M, 't')).map((t) => t.textContent ?? '').join('')
          sink.text(text, this.marks(base, link))
          break
        }
      }
    }
  }

  private async run(r: Element, base: RunProps, sink: ParaSink, link?: string): Promise<void> {
    const rPr = kid(r, 'rPr')
    const rp = merge<RunProps>(base, this.styles.character(attr(kid(rPr, 'rStyle'), 'val')), parseRPr(rPr, this.theme))
    if (rp.hidden) return
    const marks = this.marks(rp, link)
    for (const c of kids(r)) await this.runChild(c, rp, marks, sink)
  }

  private async runChild(c: Element, rp: RunProps, marks: Mark[], sink: ParaSink): Promise<void> {
    const inInstr = this.fields.includes('instr')
    switch (c.localName) {
      case 't':
        if (!inInstr) sink.text(rp.caps ? (c.textContent ?? '').toUpperCase() : (c.textContent ?? ''), marks)
        break
      case 'tab':
        if (!inInstr) sink.text('\t', marks)
        break
      case 'br':
        if (attr(c, 'type') === 'page') sink.block([{ type: 'pageBreak' }])
        else sink.hardBreak()
        break
      case 'cr':
        sink.hardBreak()
        break
      case 'noBreakHyphen':
        sink.text('‑', marks)
        break
      case 'sym': {
        const code = parseInt(attr(c, 'char') ?? '', 16)
        if (!Number.isNaN(code)) sink.text(String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code), marks)
        break
      }
      case 'fldChar': {
        const t = attr(c, 'fldCharType')
        if (t === 'begin') this.fields.push('instr')
        else if (t === 'separate' && this.fields.length) this.fields[this.fields.length - 1] = 'result'
        else if (t === 'end') this.fields.pop()
        break
      }
      case 'footnoteReference':
      case 'endnoteReference': {
        const id = attr(c, 'id') ?? ''
        const note = (c.localName === 'footnoteReference' ? this.footnotes : this.endnotes).get(id)
        if (!note) break
        const n = this.notes.length + 1
        this.notes.push({ n, el: note })
        sink.text(String(n), [...marks.filter((m) => m.type !== 'subscript' && m.type !== 'superscript'), { type: 'superscript' }])
        break
      }
      case 'drawing':
        await this.drawing(c, sink)
        break
      case 'pict':
      case 'object':
        await this.pict(c, sink)
        break
      case 'AlternateContent': {
        const choice = kid(c, 'Choice') ?? kid(c, 'Fallback')
        for (const cc of kids(choice)) await this.runChild(cc, rp, marks, sink)
        break
      }
    }
  }

  private marks(rp: RunProps, link?: string): Mark[] {
    const marks: Mark[] = []
    if (rp.bold) marks.push({ type: 'bold' })
    if (rp.italic) marks.push({ type: 'italic' })
    if (rp.underline) marks.push({ type: 'underline' })
    if (rp.strike) marks.push({ type: 'strike' })
    if (rp.vert === 'superscript') marks.push({ type: 'superscript' })
    if (rp.vert === 'subscript') marks.push({ type: 'subscript' })
    if (link) marks.push({ type: 'link', attrs: { href: link } })
    const background = rp.highlight ?? rp.shading
    let color = rp.color
    // Negro explícito = color automático: así se lee también en la hoja oscura.
    if (color && luminance(color) < 0.02 && !background) color = undefined
    // Texto sin color sobre un fondo claro: se fija oscuro para que siga siendo legible.
    if (!color && background && luminance(background) > 0.4) color = '#1a1a1a'
    const style: Record<string, unknown> = {}
    if (color) style.color = color
    if (rp.font) style.fontFamily = fontStack(rp.font)
    if (rp.size) style.fontSize = `${rp.size}pt`
    if (rp.shading && !rp.highlight) style.backgroundColor = rp.shading
    if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style })
    if (rp.highlight) marks.push({ type: 'highlight', attrs: { color: rp.highlight } })
    return marks
  }

  private async drawing(d: Element, sink: ParaSink): Promise<void> {
    for (const tx of Array.from(d.getElementsByTagNameNS(W, 'txbxContent'))) sink.block(await this.blocks(tx))
    const blip = d.getElementsByTagNameNS(A, 'blip')[0]
    const id = relId(blip, 'embed') ?? relId(blip, 'link')
    if (!id) return
    const extent = d.getElementsByTagNameNS(WP, 'extent')[0]
    const docPr = d.getElementsByTagNameNS(WP, 'docPr')[0]
    const cx = Number(extent?.getAttribute('cx') ?? 0) / 9525
    const cy = Number(extent?.getAttribute('cy') ?? 0) / 9525
    const alt = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || ''
    await this.image(id, alt, cx, cy, sink)
  }

  private async pict(p: Element, sink: ParaSink): Promise<void> {
    for (const tx of Array.from(p.getElementsByTagNameNS(W, 'txbxContent'))) sink.block(await this.blocks(tx))
    const data = p.getElementsByTagNameNS(V, 'imagedata')[0]
    const id = relId(data, 'id')
    if (!id) return
    const shape = data.parentElement
    const style = shape?.getAttribute('style') ?? ''
    const pt = (k: string) => Number(style.match(new RegExp(`${k}:([\\d.]+)pt`))?.[1] ?? 0) * (4 / 3)
    await this.image(id, data.getAttribute('o:title') ?? '', pt('width'), pt('height'), sink)
  }

  private async image(id: string, alt: string, width: number, height: number, sink: ParaSink): Promise<void> {
    const rel = this.rels.get(id)
    if (!rel || rel.external) {
      this.warnings.add('Hay imágenes enlazadas fuera del documento que no se pudieron importar.')
      return
    }
    const path = normalizePath(`word/${rel.target}`)
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = IMAGE_MIME[ext]
    const file = this.zip.file(path)
    let src: string | null = null
    if (file && (ext === 'emf' || ext === 'wmf')) src = await metafileToSvg(await file.async('uint8array'), ext, width, height)
    else if (file && mime) src = await shrink(await file.async('uint8array'), mime)
    if (!src) {
      this.warnings.add(`Algunas imágenes (${ext.toUpperCase() || 'formato desconocido'}) no se pudieron convertir y se omitieron.`)
      return
    }
    const attrs: Record<string, unknown> = { src, alt: alt || null }
    if (width > 0) {
      const w = Math.min(width, 650)
      attrs.width = Math.round(w)
      if (height > 0) attrs.height = Math.round((height * w) / width)
    }
    sink.block([{ type: 'image', attrs }])
  }

  private async table(tbl: Element): Promise<JSONContent> {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Math.round(Number(attr(g, 'w') ?? 0) / 15))
    const rows: JSONContent[] = []
    const open: (JSONContent | null)[] = []
    for (const tr of kids(tbl, 'tr')) {
      const trPr = kid(tr, 'trPr')
      const header = flag(kid(trPr, 'tblHeader')) === true
      let col = Number(attr(kid(trPr, 'gridBefore'), 'val') ?? 0)
      const cells: JSONContent[] = []
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr')
        const span = Math.max(1, Number(attr(kid(tcPr, 'gridSpan'), 'val') ?? 1))
        const vm = kid(tcPr, 'vMerge')
        const merge = vm ? (attr(vm, 'val') ?? 'continue') : null
        const anchor = open[col]
        if (merge === 'continue' && anchor) {
          anchor.attrs!.rowspan = Number(anchor.attrs!.rowspan) + 1
          col += span
          continue
        }
        const content = await this.blocks(tc)
        const fill = attr(kid(tcPr, 'shd'), 'fill')
        const widths = grid.slice(col, col + span)
        const cell: JSONContent = {
          type: header ? 'tableHeader' : 'tableCell',
          attrs: {
            colspan: span,
            rowspan: 1,
            colwidth: widths.length === span && widths.every((w) => w > 0) ? widths : null,
            cellBackground: fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : null,
          },
          content: content.length ? content : [{ type: 'paragraph' }],
        }
        open[col] = merge === 'restart' ? cell : null
        cells.push(cell)
        col += span
      }
      rows.push({ type: 'tableRow', content: cells })
    }
    return { type: 'table', content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] }
  }
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/').replace(/^word\/\/?word\//, 'word/')
}

// ---------- Ajustes del documento ----------

function mode<T>(counts: Map<T, number>): T | undefined {
  let best: T | undefined
  let max = -1
  for (const [k, v] of counts) if (v > max) (best = k), (max = v)
  return best
}

/** La fuente, el tamaño, el interlineado y la separación más usados pasan a ser los del documento. */
function extractDefaults(blocks: JSONContent[]): Partial<DocSettings> {
  const fonts = new Map<string, number>()
  const sizes = new Map<string, number>()
  const lines = new Map<number, number>()
  const gaps = new Map<number, number>()
  const walk = (nodes: JSONContent[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text') {
        const ts = n.marks?.find((m) => m.type === 'textStyle')?.attrs ?? {}
        const len = n.text?.length ?? 0
        if (ts.fontFamily) fonts.set(String(ts.fontFamily), (fonts.get(String(ts.fontFamily)) ?? 0) + len)
        if (ts.fontSize) sizes.set(String(ts.fontSize), (sizes.get(String(ts.fontSize)) ?? 0) + len)
      }
      if (n.type === 'paragraph') {
        const ls = Number(n.attrs?.lineSpacing ?? 1.15)
        lines.set(ls, (lines.get(ls) ?? 0) + 1)
        const gap = Number(n.attrs?.spaceAfter ?? 0)
        gaps.set(gap, (gaps.get(gap) ?? 0) + 1)
      }
      walk(n.content)
    }
  }
  walk(blocks)
  const font = mode(fonts)
  const size = mode(sizes)
  const line = mode(lines) ?? 1.15
  const gap = mode(gaps) ?? 0
  const strip = (nodes: JSONContent[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'text' && n.marks) {
        n.marks = n.marks
          .map((m) => {
            if (m.type !== 'textStyle') return m
            const attrs = { ...m.attrs }
            if (attrs.fontFamily === font) delete attrs.fontFamily
            if (attrs.fontSize === size) delete attrs.fontSize
            return Object.keys(attrs).length ? { ...m, attrs } : null
          })
          .filter((m): m is NonNullable<typeof m> => m !== null)
        if (!n.marks.length) delete n.marks
      }
      if ((n.type === 'paragraph' || n.type === 'heading') && n.attrs) {
        if (n.attrs.lineSpacing === line) delete n.attrs.lineSpacing
        if (n.type === 'paragraph' && n.attrs.spaceAfter === gap) delete n.attrs.spaceAfter
        if (n.attrs.spaceAfter === 0) delete n.attrs.spaceAfter
      }
      strip(n.content)
    }
  }
  strip(blocks)
  return {
    font: font ?? undefined,
    fontSize: size ? parseFloat(size) : undefined,
    lineHeight: line,
    paragraphGap: gap,
    sheet: 'paper',
    layout: 'word',
  }
}

// ---------- Entrada ----------

async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const f = zip.file(path)
  return f ? parseXml(await f.async('string')) : null
}

async function readNotes(zip: JSZip, path: string, tag: string): Promise<Map<string, Element>> {
  const doc = await readXml(zip, path)
  const map = new Map<string, Element>()
  for (const n of kids(doc?.documentElement, tag)) {
    const type = attr(n, 'type')
    if (type && type !== 'normal') continue
    map.set(attr(n, 'id') ?? '', n)
  }
  return map
}

export async function docxToContent(buffer: ArrayBuffer): Promise<DocxResult> {
  const zip = await JSZip.loadAsync(buffer)
  const doc = await readXml(zip, 'word/document.xml')
  const body = kid(doc?.documentElement, 'body')
  if (!doc || !body || doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un documento de Word válido.')

  const relsDoc = await readXml(zip, 'word/_rels/document.xml.rels')
  const rels = new Map<string, { target: string; external: boolean }>()
  for (const r of Array.from(relsDoc?.documentElement.children ?? [])) {
    rels.set(r.getAttribute('Id') ?? '', { target: r.getAttribute('Target') ?? '', external: r.getAttribute('TargetMode') === 'External' })
  }
  const themeDoc = await readXml(zip, 'word/theme/theme1.xml')
  const latin = (tag: string) => themeDoc?.getElementsByTagNameNS(A, tag)[0]?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface') || undefined
  const converter = new Converter(zip, {
    styles: await readXml(zip, 'word/styles.xml'),
    numbering: await readXml(zip, 'word/numbering.xml'),
    theme: { major: latin('majorFont'), minor: latin('minorFont') },
    rels,
    footnotes: await readNotes(zip, 'word/footnotes.xml', 'footnote'),
    endnotes: await readNotes(zip, 'word/endnotes.xml', 'endnote'),
  })

  const blocks = await converter.body(body)
  if (!blocks.length) blocks.push({ type: 'paragraph' })
  const settings: Partial<DocSettings> = { ...extractDefaults(blocks), pageMode: 'paged' }

  const sect = kids(body, 'sectPr').pop() ?? null
  if (sect) {
    const page = parseSection(sect)
    if (page) settings.page = page
    settings.header = await readHeaderFooter(zip, rels, sect, 'headerReference')
    settings.footer = await readHeaderFooter(zip, rels, sect, 'footerReference')
  }
  return { content: { type: 'doc', content: blocks }, settings, warnings: [...converter.warnings] }
}

/** Tamaño y márgenes de la sección (twips → pt). */
function parseSection(sect: Element): PageSetup | undefined {
  const sz = kid(sect, 'pgSz')
  const mar = kid(sect, 'pgMar')
  const pt = (el: Element | null, name: string) => {
    const v = attr(el, name)
    return v === null ? undefined : Math.abs(Number(v)) / 20
  }
  const width = pt(sz, 'w')
  const height = pt(sz, 'h')
  if (!width || !height) return undefined
  return {
    width,
    height,
    top: pt(mar, 'top') ?? 72,
    right: pt(mar, 'right') ?? 72,
    bottom: pt(mar, 'bottom') ?? 72,
    left: pt(mar, 'left') ?? 72,
    header: pt(mar, 'header') ?? 36,
    footer: pt(mar, 'footer') ?? 36,
  }
}

/** Texto del encabezado o pie principal; los campos PAGE y NUMPAGES pasan a {pagina} y {paginas}. */
async function readHeaderFooter(
  zip: JSZip,
  rels: Map<string, { target: string; external: boolean }>,
  sect: Element,
  tag: 'headerReference' | 'footerReference',
): Promise<HeaderFooter | undefined> {
  const refs = kids(sect, tag)
  const ref = refs.find((r) => attr(r, 'type') === 'default') ?? refs[0]
  const rel = ref ? rels.get(relId(ref, 'id') ?? '') : undefined
  if (!rel) return undefined
  const doc = await readXml(zip, normalizePath(`word/${rel.target}`))
  if (!doc) return undefined
  const token = (instr: string) => (/\bNUMPAGES\b/i.test(instr) ? '{paginas}' : /\bPAGE\b/i.test(instr) ? '{pagina}' : '')
  const lines: string[] = []
  let align: HeaderFooter['align']
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let text = ''
    let instr = ''
    let state: 'none' | 'instr' | 'result' = 'none'
    const walk = (el: Element) => {
      for (const c of kids(el)) {
        switch (c.localName) {
          case 'pPr':
          case 'rPr':
            break
          case 'fldSimple':
            text += token(attr(c, 'instr') ?? '')
            break
          case 'fldChar': {
            const t = attr(c, 'fldCharType')
            if (t === 'begin') (state = 'instr'), (instr = '')
            else if (t === 'separate') (text += token(instr)), (state = 'result')
            else if (t === 'end') {
              if (state === 'instr') text += token(instr)
              state = 'none'
            }
            break
          }
          case 'instrText':
            instr += c.textContent ?? ''
            break
          case 't':
            if (state === 'none') text += c.textContent ?? ''
            break
          case 'tab':
            if (state === 'none') text += '\t'
            break
          default:
            walk(c)
        }
      }
    }
    walk(p)
    if (text.trim()) {
      lines.push(text)
      if (!align) {
        const jc = attr(kid(kid(p, 'pPr'), 'jc'), 'val')
        align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left'
      }
    }
  }
  return lines.length ? { text: lines.join('\n'), align } : undefined
}
