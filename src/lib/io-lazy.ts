// Puerta de entrada ligera a io.ts: mammoth, docx, marked y turndown pesan ~1 MB,
// así que solo se descargan la primera vez que alguien importa o exporta.
import type { ExportFormat, ExportInput } from './io'

export type { ExportFormat, ExportInput }

export const IMPORT_ACCEPT = '.docx,.md,.markdown,.txt,.html,.htm'

export async function exportDocument(format: ExportFormat, doc: ExportInput): Promise<void> {
  return (await import('./io')).exportDocument(format, doc)
}

export async function importFile(file: File): Promise<{ title: string; html: string }> {
  return (await import('./io')).importFile(file)
}
