import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Rutas relativas: la app vive en https://<usuario>.github.io/verdant/ y navega con hash.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Yjs y React deben existir una sola vez: dos copias rompen la colaboración y los hooks.
  resolve: { dedupe: ['yjs', 'react', 'react-dom'] },
  server: { port: 5180 },
})
