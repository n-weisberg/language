import { runTtsRequest } from '../server/ttsCore.js'

/**
 * Vercel serverless function — same contract as local Vite middleware:
 * POST /api/tts  { text, speed?, voiceId? } -> audio/mpeg
 */
export default async function handler(req, res) {
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }
  }

  const result = await runTtsRequest({
    env: process.env,
    method: req.method,
    body: body ?? {},
  })

  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value)
  }

  if (typeof result.body === 'string') {
    res.status(result.status).send(result.body)
    return
  }

  res.status(result.status).send(result.body)
}
