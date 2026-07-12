import { loadEnv } from 'vite'
import { runTtsRequest } from './ttsCore.js'

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

export function createElevenLabsTtsHandler(env) {
  return async function elevenLabsTtsHandler(req, res) {
    let body = {}
    if (req.method === 'POST') {
      try {
        body = await readJson(req)
      } catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }
    }

    const result = await runTtsRequest({
      env,
      method: req.method,
      body,
    })

    res.statusCode = result.status
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value)
    }
    res.end(result.body)
  }
}

/**
 * Vite plugin: POST /api/tts  { text } -> audio/mpeg via ElevenLabs
 */
export function elevenLabsTtsPlugin() {
  return {
    name: 'elevenlabs-tts-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      const handler = createElevenLabsTtsHandler(env)
      server.middlewares.use('/api/tts', handler)
    },
    configurePreviewServer(server) {
      const env = loadEnv('production', server.config.root, '')
      const handler = createElevenLabsTtsHandler(env)
      server.middlewares.use('/api/tts', handler)
    },
  }
}
