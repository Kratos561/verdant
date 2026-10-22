// Extensiones de Tiptap que definen qué puede contener un documento de Verdant.
// Las usan el editor y la conversión HTML → JSON al importar archivos.
import { Extension, Mark, Node, getSchema, mergeAttributes, generateJSON } from '@tiptap/core'
import type { Extensions, JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/** Marca que ancla un comentario a un fragmento de texto. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'vd-comment' }), 0]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType
    }
  }
}

/** Valor CSS de longitud → puntos (lo que usa Word). */
function toPt(value: string | null | undefined): number | null {
  if (!value) return null
  const n = parseFloat(value)
  if (Number.isNaN(n)) return null
  if (value.endsWith('px')) return Math.round(n * 7.5) / 10
  if (value.endsWith('em')) return Math.round(n * 120) / 10
  return n
}

function cssAttr(name: string, css: string) {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => toPt(el.style.getPropertyValue(css)),
    renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { style: `${css}: ${attrs[name]}pt` }),
  }
}

/** Formato de párrafo de procesador de textos: sangrías, espaciado e interlineado (en pt). */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indentLeft: cssAttr('indentLeft', 'margin-left'),
          indentRight: cssAttr('indentRight', 'margin-right'),
          textIndent: cssAttr('textIndent', 'text-indent'),
          spaceBefore: cssAttr('spaceBefore', 'margin-top'),
          spaceAfter: cssAttr('spaceAfter', 'margin-bottom'),
          lineSpacing: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.style.lineHeight
              return v && /^[\d.]+$/.test(v) ? Number(v) : null
            },
            renderHTML: (attrs: Record<string, unknown>) => (attrs.lineSpacing == null ? {} : { style: `line-height: ${attrs.lineSpacing}` }),
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          cellBackground: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-background') || el.style.backgroundColor || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.cellBackground
                ? { 'data-background': attrs.cellBackground, style: `background-color: ${attrs.cellBackground}; --cell-bg: ${attrs.cellBackground}` }
                : {},
          },
        },
      },
    ]
  },
})

/** Salto de página (Ctrl+Enter), como en Google Docs y Word. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'vd-page-break' })]
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }
  },
})

export function baseExtensions(history = true): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      // Con Yjs el deshacer lo lleva Collaboration (solo deshace los cambios propios).
      ...(history ? {} : { undoRedo: false as const }),
    }),
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Subscript,
    Superscript,
    CommentMark,
    BlockFormat,
    PageBreak,
  ]
}

export interface CollabUser {
  name: string
  color: string
}

export function editorExtensions(ydoc: Y.Doc, awareness: Awareness, user: CollabUser): Extensions {
  return [
    ...baseExtensions(false),
    Placeholder.configure({ placeholder: 'Escribe, o pulsa «/» para insertar…' }),
    CharacterCount,
    Collaboration.configure({ document: ydoc, field: 'default' }),
    CollaborationCaret.configure({
      provider: { awareness },
      user,
      render: (u) => {
        const caret = document.createElement('span')
        caret.className = 'vd-caret'
        caret.style.setProperty('--c', u.color)
        const label = document.createElement('span')
        label.className = 'vd-caret-label'
        label.textContent = u.name
        caret.append(label)
        return caret
      },
      selectionRender: (u) => ({ nodeName: 'span', class: 'vd-caret-sel', style: `background-color: ${u.color}38` }),
    }),
  ]
}

/** Comprueba un JSON contra el esquema del editor y lo devuelve normalizado; lanza si no es válido. */
export function validContent(json: JSONContent): JSONContent {
  const node = getSchema(baseExtensions()).nodeFromJSON(json)
  node.check()
  return node.toJSON() as JSONContent
}

/** Construye el estado Yjs inicial de un documento a partir de su JSON de Tiptap. */
export function contentToYDoc(content: JSONContent): Y.Doc {
  return prosemirrorJSONToYDoc(getSchema(baseExtensions()), content, 'default')
}

export function htmlToContent(html: string): JSONContent {
  return generateJSON(html, baseExtensions())
}

/** Texto plano para búsqueda y vistas previas. */
export function contentToText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  const inner = (node.content ?? []).map(contentToText)
  const block = ['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'tableRow', 'blockquote']
  return block.includes(node.type ?? '') ? inner.join('') + '\n' : inner.join(node.type === 'tableRow' ? ' ' : '')
}
