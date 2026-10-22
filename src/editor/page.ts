// Geometría de la hoja en px a partir de los ajustes del documento (que van en pt, como en Word).
import type { DocSettings, PageSetup } from '../lib/store'

export const PT_TO_PX = 4 / 3
export const PAGE_GAP = 28

export const PAPER: Record<'a4' | 'letter', { width: number; height: number }> = {
  a4: { width: 595.3, height: 841.9 },
  letter: { width: 612, height: 792 },
}

export function pageSetup(s: DocSettings): Required<PageSetup> {
  const size = PAPER[s.paper === 'letter' ? 'letter' : 'a4']
  return { ...size, top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36, ...s.page } as Required<PageSetup>
}

export interface PageBox {
  w: number
  h: number
  top: number
  right: number
  bottom: number
  left: number
  header: number
  footer: number
}

export function pageBox(s: DocSettings): PageBox {
  const p = pageSetup(s)
  const px = (v: number) => Math.round(v * PT_TO_PX * 10) / 10
  return {
    w: px(p.width),
    h: px(p.height),
    top: px(p.top),
    right: px(p.right),
    bottom: px(p.bottom),
    left: px(p.left),
    header: px(p.header),
    footer: px(p.footer),
  }
}

export function fillPageTokens(text: string, page: number, pages: number): string {
  return text.replace(/\{pagina\}/gi, String(page)).replace(/\{paginas\}/gi, String(pages))
}
