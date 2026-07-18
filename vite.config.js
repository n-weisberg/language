import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { elevenLabsTtsPlugin } from './server/elevenlabsTts.js'
import { listeningRegenPlugin } from './server/listeningRegenPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), elevenLabsTtsPlugin(), listeningRegenPlugin()],
})
