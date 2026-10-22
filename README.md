# Verdant

Editor de documentos al estilo Google Docs, con estética dark glassmorphism y Courier New como fuente principal.
Es una SPA estática en GitHub Pages que guarda los datos en Neon (Postgres) a través de Neon Auth y la Data API.

## Qué hace hoy (fases 0–3)

- **Cuentas:** registro e inicio de sesión con Neon Auth. Cada usuario solo ve sus documentos gracias a RLS en Postgres.
- **Biblioteca:** crear, buscar (Ctrl+K), destacar, renombrar, carpetas, papelera con restaurar y vaciar, plantillas y vista en cuadrícula o lista.
- **Editor (Tiptap):**
  - Formato: títulos 1–6, fuentes (Courier New y sus variantes primero), tamaño, color, resaltado, alineación, interlineado, superíndice y subíndice.
  - Contenido: listas, tareas, tablas redimensionables, imágenes, enlaces, citas, código y separadores.
  - Productividad: menú «/», burbuja al seleccionar, buscar y reemplazar, contador de palabras, esquema, modo lectura, modo enfoque y diseño con o sin páginas.
- **Guardado:** autoguardado cada 0,7 s, versiones automáticas cada 10 minutos de edición, versiones con nombre, vista previa y restauración.
- **Comentarios:** anclados al texto, con respuestas, resolver y reabrir, y deshacer.
- **Archivos:** importa .docx, .md, .txt y .html; exporta a .docx, .pdf (vía impresión), .md, .html y .txt.
- **Modo local:** sin `VITE_NEON_URL`, todo se guarda en IndexedDB del navegador.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc + vite build → dist/
```

`.env.production` contiene la URL pública de Neon. Para desarrollar contra Neon, copia el valor en `.env.local`. Para el modo local, deja `VITE_NEON_URL` vacía.

## Base de datos

- Migraciones: `db/migrations/*.sql`.
- `npm run setup:neon` crea o reutiliza el proyecto `verdant`, activa Neon Auth y la Data API, añade el dominio de confianza, aplica las migraciones pendientes y escribe `.env.local`. Lee `NEON_API_KEY` del entorno o de `%USERPROFILE%\.verdant\secrets.env` y nunca la imprime.
- `NEON_PROJECT_ID=<id> node scripts/smoke-neon.mjs` es una prueba de humo con dos usuarios temporales: comprueba que RLS aísla los datos y borra los usuarios al terminar.

## Despliegue

Cada push a `main` compila y publica en GitHub Pages (`.github/workflows/deploy.yml`).

## Próximas fases

4. Colaboración en tiempo real (Yjs + relay en Cloudflare Workers), compartir con roles y enlaces.
5. Modo sugerencia, pestañas, smart chips con `@`, building blocks, notas al pie y ecuaciones.
6. Paginación exacta con encabezados, pies y numeración.
7. Asistente de IA y PWA instalable sin conexión.
