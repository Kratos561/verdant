// Panel izquierdo: esquema de títulos y detalles del documento.
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { ListTree } from 'lucide-react'
import { useState } from 'react'
import { fontLabel } from '../lib/fonts'
import type { Doc } from '../lib/store'
import { timeAgo } from '../components/ui'

interface Heading {
  level: number
  text: string
  pos: number
}

export default function Outline({ editor, doc, storage }: { editor: Editor; doc: Doc; storage: 'neon' | 'local' }) {
  const [tab, setTab] = useState<'outline' | 'details'>('outline')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const headings: Heading[] = []
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent.trim()) {
          headings.push({ level: node.attrs.level as number, text: node.textContent, pos })
        }
        return node.isBlock && node.type.name !== 'heading'
      })
      const at = e.state.selection.from
      let active = -1
      headings.forEach((h, i) => h.pos <= at && (active = i))
      const cc = e.storage.characterCount as { words: () => number; characters: () => number }
      return { headings, active, words: cc.words(), chars: cc.characters() }
    },
  })
  const minLevel = Math.min(...state.headings.map((h) => h.level), 6)

  const jump = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run()
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <aside className="outline glass" aria-label="Esquema del documento">
      <div className="seg seg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'outline'} className={tab === 'outline' ? 'is-on' : ''} onClick={() => setTab('outline')}>
          Esquema
        </button>
        <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'is-on' : ''} onClick={() => setTab('details')}>
          Detalles
        </button>
      </div>

      {tab === 'outline' ? (
        state.headings.length ? (
          <nav className="outline-list">
            {state.headings.map((h, i) => (
              <button
                key={`${h.pos}-${i}`}
                className={`outline-item${i === state.active ? ' is-active' : ''}`}
                style={{ paddingLeft: 10 + (h.level - minLevel) * 14 }}
                onClick={() => jump(h.pos)}
                title={h.text}
              >
                {h.text}
              </button>
            ))}
          </nav>
        ) : (
          <div className="panel-empty">
            <ListTree size={22} strokeWidth={1.5} />
            <p>Los títulos que añadas aparecerán aquí para saltar entre secciones.</p>
          </div>
        )
      ) : (
        <dl className="details">
          <dt>Palabras</dt>
          <dd>{state.words.toLocaleString('es')}</dd>
          <dt>Caracteres</dt>
          <dd>{state.chars.toLocaleString('es')}</dd>
          <dt>Fuente</dt>
          <dd>{fontLabel(doc.settings.font)}</dd>
          <dt>Diseño</dt>
          <dd>{doc.settings.pageMode === 'paged' ? 'Con páginas' : 'Sin páginas'}</dd>
          <dt>Creado</dt>
          <dd>{new Date(doc.created_at).toLocaleDateString('es', { dateStyle: 'medium' })}</dd>
          <dt>Modificado</dt>
          <dd>{timeAgo(doc.updated_at)}</dd>
          <dt>Almacenamiento</dt>
          <dd>{storage === 'neon' ? 'Neon (nube)' : 'Este navegador'}</dd>
        </dl>
      )}
    </aside>
  )
}
