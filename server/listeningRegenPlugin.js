import { loadEnv } from 'vite'
import { regenerateListeningLine } from './listeningRegen.js'

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

export function createListeningRegenHandler(env) {
  return async function listeningRegenHandler(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end('')
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let body = {}
    try {
      body = await readJson(req)
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }

    const dialogId = typeof body.dialogId === 'string' ? body.dialogId.trim() : ''
    const lineId = typeof body.lineId === 'string' ? body.lineId.trim() : ''

    if (!dialogId || !lineId) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'dialogId and lineId are required' }))
      return
    }

    try {
      const result = await regenerateListeningLine({
        env,
        dialogId,
        lineId,
        upload: body.upload !== false,
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    } catch (error) {
      console.error('[listening-regen]', error)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: error.message || 'Regeneration failed' }))
    }
  }
}

/**
 * Vite plugin: POST /api/listening/regenerate-line
 * { dialogId, lineId } -> { dialog, line, audioPath }
 */
export function listeningRegenPlugin() {
  return {
    name: 'listening-regen-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      const handler = createListeningRegenHandler(env)
      server.middlewares.use('/api/listening/regenerate-line', handler)
    },
    configurePreviewServer(server) {
      const env = loadEnv('production', server.config.root, '')
      const handler = createListeningRegenHandler(env)
      server.middlewares.use('/api/listening/regenerate-line', handler)
    },
  }
}
