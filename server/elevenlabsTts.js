import { loadEnv } from 'vite'

const MAX_CHARS = 500
const memoryCache = new Map()
const MAX_CACHE_ENTRIES = 200

function cacheKey(voiceId, modelId, text, speed) {
  return `${voiceId}::${modelId}::${speed}::${text}`
}

function clampSpeed(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed)) return 1
  return Math.min(1.2, Math.max(0.7, Math.round(speed * 100) / 100))
}

function remember(key, buffer) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value
    memoryCache.delete(oldest)
  }
  memoryCache.set(key, buffer)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function voiceScore(voice) {
  const hay = `${voice.name} ${voice.description ?? ''} ${(voice.labels && Object.values(voice.labels).join(' ')) || ''}`.toLowerCase()
  let points = 0
  if (hay.includes('mexican') || hay.includes('mexico') || hay.includes('méxico')) points += 5
  if (hay.includes('latin')) points += 2
  if (hay.includes('spanish') || hay.includes('español') || hay.includes('espanol')) points += 2
  if (voice.labels?.language?.toLowerCase() === 'es' || voice.labels?.accent?.toLowerCase().includes('mexican')) {
    points += 4
  }
  return points
}

async function listVoices(apiKey) {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  })
  if (!response.ok) {
    throw new Error(`Failed to list ElevenLabs voices (${response.status})`)
  }
  const data = await response.json()
  return data.voices ?? []
}

function buildVoicePool(voices, allowlist) {
  const filtered = allowlist.length
    ? voices.filter((voice) => allowlist.includes(voice.voice_id))
    : voices

  const preferred = filtered.filter((voice) => voiceScore(voice) > 0)
  const pool = preferred.length >= 2 ? preferred : filtered
  return pool.map((voice) => ({ id: voice.voice_id, name: voice.name }))
}

function pickRandomVoice(pool, lastVoiceId) {
  if (!pool.length) return null
  if (pool.length === 1) return pool[0]

  const candidates = lastVoiceId ? pool.filter((voice) => voice.id !== lastVoiceId) : pool
  const choices = candidates.length ? candidates : pool
  return choices[Math.floor(Math.random() * choices.length)]
}

export function createElevenLabsTtsHandler(env) {
  const apiKey = env.ELEVENLABS_API_KEY?.trim()
  const allowlist = (env.ELEVENLABS_VOICE_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const modelId = env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'

  let voicePool = null
  let voicePoolPromise = null
  let lastVoiceId = null

  async function ensureVoicePool() {
    if (voicePool?.length) return voicePool
    if (!apiKey) return []
    if (!voicePoolPromise) {
      voicePoolPromise = listVoices(apiKey)
        .then((voices) => {
          voicePool = buildVoicePool(voices, allowlist)
          return voicePool
        })
        .catch((error) => {
          voicePoolPromise = null
          throw error
        })
    }
    return voicePoolPromise
  }

  return async function elevenLabsTtsHandler(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    if (!apiKey) {
      sendJson(res, 503, {
        error: 'ElevenLabs is not configured. Add ELEVENLABS_API_KEY to your .env file.',
      })
      return
    }

    let body
    try {
      body = await readJson(req)
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }

    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) {
      sendJson(res, 400, { error: 'Missing text' })
      return
    }
    if (text.length > MAX_CHARS) {
      sendJson(res, 400, { error: `Text too long (max ${MAX_CHARS} characters)` })
      return
    }

    let voice
    try {
      if (body.voiceId) {
        voice = { id: body.voiceId, name: body.voiceId }
      } else {
        const pool = await ensureVoicePool()
        voice = pickRandomVoice(pool, lastVoiceId)
      }
    } catch (error) {
      sendJson(res, 502, { error: error.message || 'Could not resolve ElevenLabs voice' })
      return
    }

    if (!voice?.id) {
      sendJson(res, 503, {
        error: 'No ElevenLabs voices available on this account.',
      })
      return
    }

    const speed = clampSpeed(body.speed ?? 1)
    lastVoiceId = voice.id
    const key = cacheKey(voice.id, modelId, text, speed)
    const cached = memoryCache.get(key)
    if (cached) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('X-TTS-Cache', 'hit')
      res.setHeader('X-TTS-Voice', voice.id)
      res.setHeader('X-TTS-Speed', String(speed))
      if (voice.name) res.setHeader('X-TTS-Voice-Name', encodeURIComponent(voice.name))
      res.end(cached)
      return
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.15,
            use_speaker_boost: true,
            speed,
          },
        }),
      })

      if (!response.ok) {
        const detail = await response.text()
        sendJson(res, response.status, {
          error: 'ElevenLabs request failed',
          detail: detail.slice(0, 500),
        })
        return
      }

      const audio = Buffer.from(await response.arrayBuffer())
      remember(key, audio)
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('X-TTS-Cache', 'miss')
      res.setHeader('X-TTS-Voice', voice.id)
      if (voice.name) res.setHeader('X-TTS-Voice-Name', encodeURIComponent(voice.name))
      res.end(audio)
    } catch (error) {
      sendJson(res, 502, { error: error.message || 'ElevenLabs network error' })
    }
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
