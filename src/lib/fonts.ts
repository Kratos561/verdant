// Courier New es la fuente prioritaria de Verdant: va primero y es la de los documentos nuevos.
// Es una fuente del sistema (Windows y macOS); en Linux y Android se usa Courier Prime,
// su equivalente libre servido desde Google Fonts, con las mismas cuatro variantes.
export interface FontOption {
  label: string
  value: string
  group: 'Courier New' | 'Otras'
}

export const COURIER_STACK = '"Courier New", "Courier Prime", Courier, monospace'

export const FONTS: FontOption[] = [
  { label: 'Courier New', value: COURIER_STACK, group: 'Courier New' },
  { label: 'Courier Prime', value: '"Courier Prime", "Courier New", monospace', group: 'Courier New' },
  { label: 'Courier', value: 'Courier, "Courier New", monospace', group: 'Courier New' },
  { label: 'Manrope', value: 'Manrope, system-ui, sans-serif', group: 'Otras' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif', group: 'Otras' },
  { label: 'Merriweather', value: 'Merriweather, Georgia, serif', group: 'Otras' },
  { label: 'Lora', value: 'Lora, Georgia, serif', group: 'Otras' },
  { label: 'Georgia', value: 'Georgia, serif', group: 'Otras' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif', group: 'Otras' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif', group: 'Otras' },
  { label: 'Roboto Mono', value: '"Roboto Mono", monospace', group: 'Otras' },
]

// Variantes de Courier New que ofrece el menú de estilo rápido: combinan peso y cursiva.
export const COURIER_VARIANTS = [
  { label: 'Courier New Regular', bold: false, italic: false },
  { label: 'Courier New Cursiva', bold: false, italic: true },
  { label: 'Courier New Negrita', bold: true, italic: false },
  { label: 'Courier New Negrita cursiva', bold: true, italic: true },
] as const

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]

export function fontLabel(value: string | undefined): string {
  if (!value) return 'Courier New'
  return FONTS.find((f) => f.value === value)?.label ?? value.split(',')[0].replace(/"/g, '')
}
