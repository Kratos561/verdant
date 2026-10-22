// Paginación visual como en Word: mide cada bloque del documento y, cuando uno no cabe en la hoja
// actual (o tras un salto de página), inserta antes un espaciador que lo lleva al principio de la
// siguiente. El espaciador cubre el margen inferior, el hueco entre hojas y el margen superior; las
// hojas se dibujan detrás (Editor.tsx) a partir del número de páginas que se notifica.
// Es solo presentación: no toca el documento ni viaja por Yjs.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface PageGeometry {
  /** Alto de la hoja, márgenes superior e inferior y hueco entre hojas, en px. */
  height: number
  marginTop: number
  marginBottom: number
  gap: number
}

export interface PaginationOptions {
  geometry: () => PageGeometry | null
  onPages: (pages: number) => void
}

interface PluginState {
  decorations: DecorationSet
  rev: number
}

export const paginationKey = new PluginKey<PluginState>('pagination')
export const PAGINATION_REFRESH = 'pagination-refresh'

interface Spacer {
  pos: number
  height: number
}

function measure(view: EditorView, g: PageGeometry): { spacers: Spacer[]; pages: number } {
  const dom = view.dom as HTMLElement
  const contentH = g.height - g.marginTop - g.marginBottom
  const P = g.height + g.gap
  // Medidas fraccionarias (offsetTop redondea y el error se acumularía hoja tras hoja); se deshace
  // el escalado de la hoja si está reducida para caber en pantalla.
  const base = dom.getBoundingClientRect()
  const scale = dom.offsetHeight ? base.height / dom.offsetHeight || 1 : 1
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { top: (r.top - base.top) / scale, height: r.height / scale }
  }
  // Los espaciadores ya insertados no cuentan: se calcula sobre la posición "natural" de cada bloque.
  const gaps = Array.from(dom.querySelectorAll<HTMLElement>(':scope > .vd-page-gap')).map((el) => ({ top: rel(el).top, h: parseFloat(el.style.height) || 0 }))
  const items: { pos: number; top: number; height: number; mt: number; isBreak: boolean }[] = []
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset)
    if (!(el instanceof HTMLElement)) return
    const box = rel(el)
    let top = box.top
    for (const s of gaps) if (s.top < box.top - 0.1) top -= s.h
    items.push({ pos: offset, top, height: box.height, mt: parseFloat(getComputedStyle(el).marginTop) || 0, isBreak: node.type.name === 'pageBreak' })
  })

  const spacers: Spacer[] = []
  let S = 0
  let q = 0
  let forceNext = false
  const moveTo = (it: (typeof items)[number], page: number) => {
    const h = page * P + it.mt - (it.top + S)
    if (h > 0.5) {
      spacers.push({ pos: it.pos, height: Math.round(h * 100) / 100 })
      S += h
    }
    q = page
  }
  for (const it of items) {
    const top = it.top + S
    if (forceNext) {
      moveTo(it, Math.max(q + 1, Math.floor((top - it.mt) / P) + 1))
      forceNext = false
    } else if (top >= q * P + contentH) {
      // Empieza por debajo de la hoja actual (tras un bloque más alto que una hoja).
      const page = Math.floor(top / P)
      if (top - page * P < contentH) q = page
      else moveTo(it, page + 1)
    } else if (top + it.height > q * P + contentH && top - it.mt > q * P + 0.5 && it.height <= contentH) {
      moveTo(it, q + 1)
    }
    if (it.isBreak) forceNext = true
  }
  return { spacers, pages: q + 1 }
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return { geometry: () => null, onPages: () => {} }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<PluginState>({
        key: paginationKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, rev: 0 }),
          apply(tr, value) {
            const next = tr.getMeta(paginationKey) as DecorationSet | undefined
            if (next) return { decorations: next, rev: value.rev }
            const rev = tr.getMeta(PAGINATION_REFRESH) ? value.rev + 1 : value.rev
            return { decorations: value.decorations.map(tr.mapping, tr.doc), rev }
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.decorations,
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined
          let signature = ''
          let pages = 1
          const run = () => {
            timer = undefined
            if (!view.dom.isConnected) return
            const g = options.geometry()
            const result = g ? measure(view, g) : { spacers: [], pages: 1 }
            if (result.pages !== pages) {
              pages = result.pages
              options.onPages(pages)
            }
            const sig = JSON.stringify(result.spacers)
            if (sig === signature) return
            signature = sig
            const decorations = DecorationSet.create(
              view.state.doc,
              result.spacers.map((s) =>
                Decoration.widget(
                  s.pos,
                  () => {
                    const el = document.createElement('div')
                    el.className = 'vd-page-gap'
                    el.style.height = `${s.height}px`
                    el.contentEditable = 'false'
                    el.setAttribute('aria-hidden', 'true')
                    return el
                  },
                  { side: -1, key: `gap:${s.pos}:${s.height}`, ignoreSelection: true },
                ),
              ),
            )
            view.dispatch(view.state.tr.setMeta(paginationKey, decorations).setMeta('addToHistory', false))
          }
          // Temporizador corto en lugar de requestAnimationFrame: también mide en pestañas en segundo plano.
          const schedule = () => {
            timer ??= setTimeout(run, 30)
          }
          const resize = new ResizeObserver(schedule)
          resize.observe(view.dom)
          document.fonts?.ready.then(schedule).catch(() => {})
          schedule()
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc || paginationKey.getState(v.state)?.rev !== paginationKey.getState(prev)?.rev) schedule()
            },
            destroy() {
              clearTimeout(timer)
              resize.disconnect()
            },
          }
        },
      }),
    ]
  },
})
