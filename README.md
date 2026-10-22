# Verdant

Editor de documentos al estilo Google Docs, con estética dark glassmorphism y Courier New como fuente principal.
Es una SPA estática en GitHub Pages que guarda los datos en Neon (Postgres) a través de Neon Auth y la Data API.

## Qué hace hoy

- **Acceso privado:**
  - El registro está cerrado y solo entran las cuentas de la tabla `app_members`.
  - RLS en Postgres lo impone en cada consulta, así que aunque alguien consiguiera una sesión no vería ni tocaría nada.
  - Los miembros comparten un mismo espacio de documentos.
- **Tiempo real, sin servidor propio:**
  - El editor usa Yjs (CRDT). Cada cambio se guarda como actualización en `doc_updates` y los demás clientes lo recogen sondeando la Data API (≈0,6 s con más gente presente).
  - La presencia viaja por `doc_presence`: avatares, cursores con nombre y selección.
  - Título, ajustes, comentarios y versiones también se sincronizan.
  - Un cliente compacta el estado cada 200 cambios.
  - En modo local hace lo mismo entre pestañas del navegador.
- **Biblioteca:** crear, buscar (Ctrl+K), destacar, renombrar, carpetas, papelera con restaurar y vaciar, plantillas y vista en cuadrícula o lista.
- **Editor (Tiptap):**
  - Formato: títulos 1–6, fuentes (Courier New y sus variantes primero), tamaño, color, resaltado, alineación, interlineado, superíndice y subíndice.
  - Contenido: listas, tareas, tablas, imágenes, enlaces, citas y código.
  - Productividad: menú «/», burbuja al seleccionar, buscar y reemplazar, contador de palabras, esquema, modo lectura, modo enfoque y diseño con o sin páginas.
- **Guardado:** autoguardado, versiones automáticas cada 10 minutos de edición, versiones con nombre, vista previa y restauración.
- **Comentarios:** anclados al texto, con respuestas, resolver y reabrir.
- **Archivos:** importa .docx, .md, .txt y .html; exporta a .docx, .pdf (vía impresión), .md, .html y .txt.
- **Modo local:** sin `VITE_NEON_URL`, todo se guarda en IndexedDB del navegador.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc + vite build → dist/
```

`.env.production` contiene la URL pública de Neon. Para desarrollar contra Neon, copia el valor en `.env.local`. Para el modo local, deja `VITE_NEON_URL` vacía.

## Base de datos y acceso

- Migraciones: `db/migrations/*.sql`. `npm run setup:neon` las aplica y prepara el proyecto (Neon Auth, Data API y dominio de confianza).
- `node scripts/access.mjs` gestiona quién entra:
  - `crear-cuenta <email> [nombre]` genera la contraseña, hace miembro a la cuenta y cierra el registro.
  - `miembros`, `quitar <email>` y `registro <abrir|cerrar>`.
  - Las credenciales generadas se guardan en `%USERPROFILE%\.verdant\cuenta-verdant.txt`.
- `node scripts/realtime-test.ts` prueba contra Neon el acceso privado y el tiempo real con el mismo código de la web. Usa dos cuentas temporales y lo borra todo al terminar.

Los scripts leen `NEON_API_KEY` de `%USERPROFILE%\.verdant\secrets.env` y nunca la imprimen.

## Despliegue

Cada push a `main` compila y publica en GitHub Pages (`.github/workflows/deploy.yml`).

## Próximas fases

5. Modo sugerencia, pestañas, smart chips con `@`, building blocks, notas al pie y ecuaciones.
6. Paginación exacta con encabezados, pies y numeración.
7. Asistente de IA y PWA instalable sin conexión.
