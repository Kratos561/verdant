// Extensiones de Tiptap que definen qué puede contener un documento de Verdant.
// Las usan el editor y la conversión HTML → JSON al importar archivos.
import { Mark, mergeAttributes, generateJSON } from '@tiptap/core'
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

export function baseExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
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
  ]
}

export function editorExtensions(placeholder = 'Escribe, o pulsa «/» para insertar…'): Extensions {
  return [...baseExtensions(), Placeholder.configure({ placeholder }), CharacterCount]
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
