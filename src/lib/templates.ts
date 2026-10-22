// Plantillas de documento (contenido Tiptap en JSON).
import type { JSONContent } from '@tiptap/react'

export interface Template {
  id: string
  name: string
  description: string
  title: string
  content: JSONContent
}

const t = (text: string): JSONContent => ({ type: 'text', text })
const p = (text?: string): JSONContent => (text ? { type: 'paragraph', content: [t(text)] } : { type: 'paragraph' })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const bullets = (...items: string[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
})
const tasks = (...items: [string, boolean][]): JSONContent => ({
  type: 'taskList',
  content: items.map(([text, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })),
})
const table = (head: string[], rows: string[][]): JSONContent => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [p(c)] })) })),
  ],
})
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

export const TEMPLATES: Template[] = [
  {
    id: 'notas-reunion',
    name: 'Notas de reunión',
    description: 'Asistentes, temas, acuerdos y tareas',
    title: 'Notas de reunión',
    content: doc(
      h(1, 'Notas de reunión'),
      p('Fecha: '),
      p('Asistentes: '),
      h(2, 'Orden del día'),
      bullets('Primer tema', 'Segundo tema', 'Ruegos y preguntas'),
      h(2, 'Notas'),
      p('Escribe aquí lo más importante que se dijo.'),
      h(2, 'Acuerdos'),
      bullets('Acuerdo 1', 'Acuerdo 2'),
      h(2, 'Próximos pasos'),
      tasks(['Enviar el resumen al equipo', false], ['Agendar la próxima reunión', false], ['Revisar los acuerdos', true]),
    ),
  },
  {
    id: 'propuesta-proyecto',
    name: 'Propuesta de proyecto',
    description: 'Objetivos, alcance, plazos y presupuesto',
    title: 'Propuesta de proyecto',
    content: doc(
      h(1, 'Propuesta de proyecto'),
      p('Un resumen breve de qué quieres lograr y por qué importa.'),
      h(2, 'Objetivos'),
      bullets('Objetivo principal', 'Objetivos secundarios'),
      h(2, 'Alcance'),
      p('Describe qué incluye el proyecto y qué queda fuera.'),
      h(2, 'Plazos'),
      table(
        ['Fase', 'Inicio', 'Entrega'],
        [
          ['Descubrimiento', 'Semana 1', 'Semana 2'],
          ['Desarrollo', 'Semana 3', 'Semana 8'],
          ['Revisión final', 'Semana 9', 'Semana 10'],
        ],
      ),
      p(),
      h(2, 'Presupuesto'),
      table(
        ['Concepto', 'Horas', 'Importe'],
        [
          ['Diseño', '40', '0 €'],
          ['Desarrollo', '120', '0 €'],
          ['Total', '160', '0 €'],
        ],
      ),
      p(),
      h(2, 'Siguientes pasos'),
      tasks(['Revisar la propuesta', false], ['Confirmar el presupuesto', false]),
    ),
  },
  {
    id: 'carta',
    name: 'Carta',
    description: 'Una carta formal lista para completar',
    title: 'Carta',
    content: doc(
      p('Tu nombre'),
      p('Tu dirección'),
      p(),
      p('Fecha'),
      p(),
      p('Estimado/a destinatario/a:'),
      p(),
      p('Me dirijo a usted para comunicarle lo siguiente. Explica aquí el motivo de la carta de forma clara y breve.'),
      p('En el segundo párrafo puedes añadir los detalles que sean necesarios y lo que esperas como respuesta.'),
      p('Quedo a su disposición para cualquier aclaración.'),
      p(),
      p('Atentamente,'),
      p(),
      p('Tu nombre'),
    ),
  },
]
