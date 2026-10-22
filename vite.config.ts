import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Rutas relativas: la app vive en https://<usuario>.github.io/verdant/ y navega con hash.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5180 },
})
