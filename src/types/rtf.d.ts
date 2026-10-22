// Tipos mínimos de los renderizadores EMF/WMF de rtf.js (paquetes UMD sin tipos propios).
interface MetafileRenderSettings {
  width: string
  height: string
  wExt: number
  hExt: number
  xExt: number
  yExt: number
  mapMode: number
}

declare module 'rtf.js/dist/EMFJS.bundle.min.js' {
  export class Renderer {
    constructor(blob: ArrayBuffer)
    render(info: MetafileRenderSettings): SVGElement
  }
}

declare module 'rtf.js/dist/WMFJS.bundle.min.js' {
  export class Renderer {
    constructor(blob: ArrayBuffer)
    render(info: MetafileRenderSettings): SVGElement
  }
}
