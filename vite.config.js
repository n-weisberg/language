import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { elevenLabsTtsPlugin } from './server/elevenlabsTts.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), elevenLabsTtsPlugin()],
})
