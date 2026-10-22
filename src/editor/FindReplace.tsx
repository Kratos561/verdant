// Buscar y reemplazar dentro del documento (coincidencias dentro de cada bloque de texto).
import type { Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface Match {
  from: number
  to: number
}

function findAll(editor: Editor, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const out: Match[] = []
  const needle = caseSensitive ? query : query.toLowerCase()
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Texto del bloque con un mapa de offsets → posiciones del documento.
    let text = ''
    const map: number[] = []
    node.descendants((child, childPos) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + childPos + i)
        text += child.text
      }
    })
    const hay = caseSensitive ? text : text.toLowerCase()
    let i = hay.indexOf(needle)
    while (i !== -1) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1 })
      i = hay.indexOf(needle, i + needle.length)
    }
    return false
  })
  return out
}

export default function FindReplace({ editor, onClose, readOnly }: { editor: Editor; onClose: () => void; readOnly: boolean }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [index, setIndex] = useState(0)
  const [version, setVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    const on = () => setVersion((v) => v + 1)
    editor.on('update', on)
    return () => {
      editor.off('update', on)
    }
  }, [editor])

  const matches = useMemo(() => findAll(editor, query, caseSensitive), [editor, query, caseSensitive, version])
  const current = matches.length ? Math.min(index, matches.length - 1) : -1

  const go = (i: number) => {
    if (!matches.length) return
    const n = (i + matches.length) % matches.length
    setIndex(n)
    editor.chain().setTextSelection(matches[n]).scrollIntoView().run()
  }

  const replaceOne = () => {
    if (current < 0) return
    const m = matches[current]
    editor.chain().focus().insertContentAt(m, replacement).run()
  }

  const replaceAll = () => {
    if (!matches.length) return
    const tr = editor.state.tr
    for (const m of [...matches].reverse()) {
      if (replacement) tr.insertText(replacement, m.from, m.to)
      else tr.delete(m.from, m.to)
    }
    editor.view.dispatch(tr)
  }

  return (
    <div className="find glass-float" role="search" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="find-row">
        <input
          ref={inputRef}
          className="input"
          placeholder="Buscar en el documento"
          autoComplete="off"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setIndex(0))}
          onKeyDown={(e) => e.key === 'Enter' && go(e.shiftKey ? current - 1 : current + 1)}
        />
        <span className="find-count" aria-live="polite">
          {query ? `${matches.length ? current + 1 : 0}/${matches.length}` : ''}
        </span>
        <button className="icon-btn" aria-label="Anterior" onClick={() => go(current - 1)}><ChevronUp size={16} /></button>
        <button className="icon-btn" aria-label="Siguiente" onClick={() => go(current + 1)}><ChevronDown size={16} /></button>
        <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
      </div>
      {!readOnly && (
        <div className="find-row">
          <input className="input" placeholder="Reemplazar por" autoComplete="off" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <button className="btn" onClick={replaceOne} disabled={current < 0}>Reemplazar</button>
          <button className="btn" onClick={replaceAll} disabled={!matches.length}>Todo</button>
        </div>
      )}
      <label className="find-opt">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Distinguir mayúsculas
      </label>
    </div>
  )
}
