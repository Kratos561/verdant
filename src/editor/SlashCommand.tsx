// Menú «/»: escribe una barra para insertar bloques sin tocar la barra de herramientas.
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { filterCommands } from './commands'
import type { BlockCommand } from './commands'

interface ListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean
}

const SlashList = forwardRef<ListHandle, SuggestionProps<BlockCommand>>(function SlashList(props, ref) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setIndex(0), [props.items])
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      const n = props.items.length
      if (!n) return false
      if (event.key === 'ArrowDown') return setIndex((i) => (i + 1) % n), true
      if (event.key === 'ArrowUp') return setIndex((i) => (i - 1 + n) % n), true
      if (event.key === 'Enter' || event.key === 'Tab') {
        props.command(props.items[index])
        return true
      }
      return false
    },
  }))

  return (
    <div ref={listRef} className="menu glass-float slash-menu" style={{ position: 'static' }} role="listbox">
      <div className="menu-label">Insertar bloque</div>
      {props.items.length === 0 && <div className="slash-empty">Sin resultados</div>}
      {props.items.map((item, i) => (
        <button
          key={item.id}
          role="option"
          aria-selected={i === index}
          className={`menu-item${i === index ? ' is-selected' : ''}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            props.command(item)
          }}
        >
          {item.icon}
          <span>{item.title}</span>
          <span className="kbd">{item.hint}</span>
        </button>
      ))}
    </div>
  )
})

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockCommand>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        allowSpaces: false,
        items: ({ query }) => filterCommands(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<ListHandle, SuggestionProps<BlockCommand>> | null = null
          let host: HTMLDivElement | null = null

          const place = (props: SuggestionProps<BlockCommand>) => {
            const rect = props.clientRect?.()
            if (!rect || !host) return
            const h = host.offsetHeight || 320
            const below = rect.bottom + 8 + h < innerHeight
            host.style.left = `${Math.min(rect.left, innerWidth - 300)}px`
            host.style.top = `${below ? rect.bottom + 8 : Math.max(8, rect.top - h - 8)}px`
          }

          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashList, { props, editor: props.editor })
              host = document.createElement('div')
              host.className = 'slash-host'
              host.appendChild(renderer.element)
              document.body.appendChild(host)
              requestAnimationFrame(() => place(props))
            },
            onUpdate: (props) => {
              renderer?.updateProps(props)
              place(props)
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                host?.remove()
                return true
              }
              return renderer?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              host?.remove()
              renderer?.destroy()
              host = null
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
