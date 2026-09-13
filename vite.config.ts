import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Where the built site will be served from.
  //
  // GitHub Pages serves a project site under `/<repo>/`, not the domain root,
  // so every asset URL has to carry that prefix or the page loads and then
  // 404s on its own JS and CSS — a white screen with no error in the UI. Hosts
  // that serve at the root (Vercel, Netlify, `vite preview`) need `/`.
  //
  // The deploy workflow sets VITE_BASE; local dev and preview get the default.
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
  },
})
