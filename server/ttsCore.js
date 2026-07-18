import { findCachedTts, uploadTtsClip } from './ttsCloudinary.js'

const MAX_CHARS = 500
const memoryCache = new Map()
const MAX_CACHE_ENTRIES = 200

function memoryCacheKey(voiceId, modelId, text, speed) {
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

function jsonResult(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function audioResult({ audio, voice, speed, cache, url = null }) {
  const headers = {
    'Content-Type': 'audio/mpeg',
    'X-TTS-Cache': cache,
    'X-TTS-Voice': voice.id,
    'X-TTS-Speed': String(speed),
  }
  if (voice.name) headers['X-TTS-Voice-Name'] = encodeURIComponent(voice.name)
  if (url) headers['X-TTS-Url'] = url
  return { status: 200, headers, body: audio }
}

function urlResult({ url, voiceId, speed, cache }) {
  return jsonResult(200, {
    url,
    voiceId,
    speed,
    cache,
  })
}

async function ensureVoicePool(apiKey, allowlist) {
  if (!runTtsRequest._voicePoolPromise) {
    runTtsRequest._voicePoolPromise = listVoices(apiKey)
      .then((voices) => {
        runTtsRequest._voicePool = buildVoicePool(voices, allowlist)
        return runTtsRequest._voicePool
      })
      .catch((error) => {
        runTtsRequest._voicePoolPromise = null
        throw error
      })
  }
  return runTtsRequest._voicePoolPromise
}

async function synthesizeBuffer({ apiKey, modelId, voiceId, text, speed }) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
    const error = new Error('ElevenLabs request failed')
    error.status = response.status
    error.detail = detail.slice(0, 500)
    throw error
  }

  return Buffer.from(await response.arrayBuffer())
}

/**
 * Shared TTS handler for Vite middleware and Vercel serverless.
 * With `cacheKey`, prefers Cloudinary (generate once, reuse forever) and returns JSON `{ url }`.
 * Without `cacheKey`, returns audio/mpeg as before.
 *
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer | string }>}
 */
export async function runTtsRequest({ env, method, body }) {
  const apiKey = env.ELEVENLABS_API_KEY?.trim()
  const allowlist = (env.ELEVENLABS_VOICE_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const modelId = env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'

  if (method === 'OPTIONS') {
    return { status: 204, headers: {}, body: '' }
  }

  if (method !== 'POST') {
    return jsonResult(405, { error: 'Method not allowed' })
  }

  if (!apiKey) {
    return jsonResult(503, {
      error: 'ElevenLabs is not configured. Set ELEVENLABS_API_KEY in your environment.',
    })
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return jsonResult(400, { error: 'Missing text' })
  }
  if (text.length > MAX_CHARS) {
    return jsonResult(400, { error: `Text too long (max ${MAX_CHARS} characters)` })
  }

  const persistKey = typeof body?.cacheKey === 'string' ? body.cacheKey.trim() : ''
  const force = Boolean(body?.force)
  const speed = clampSpeed(body.speed ?? 1)
  const preferUrl = Boolean(persistKey)

  if (persistKey && !force) {
    const cached = await findCachedTts(env, persistKey)
    if (cached?.url) {
      return urlResult({
        url: cached.url,
        voiceId: cached.voiceId || body.voiceId || null,
        speed,
        cache: 'cloudinary',
      })
    }
  }

  let voice
  try {
    if (body.voiceId) {
      voice = { id: body.voiceId, name: body.voiceId }
    } else {
      const pool = await ensureVoicePool(apiKey, allowlist)
      voice = pickRandomVoice(pool, runTtsRequest._lastVoiceId)
    }
  } catch (error) {
    return jsonResult(502, { error: error.message || 'Could not resolve ElevenLabs voice' })
  }

  if (!voice?.id) {
    return jsonResult(503, {
      error: 'No ElevenLabs voices available on this account.',
    })
  }

  runTtsRequest._lastVoiceId = voice.id
  const memKey = memoryCacheKey(voice.id, modelId, text, speed)
  let audio = !force ? memoryCache.get(memKey) : null
  let cacheLabel = audio ? 'hit' : 'miss'

  if (!audio) {
    try {
      audio = await synthesizeBuffer({
        apiKey,
        modelId,
        voiceId: voice.id,
        text,
        speed,
      })
      remember(memKey, audio)
      cacheLabel = 'miss'
    } catch (error) {
      if (error.status) {
        return jsonResult(error.status, {
          error: error.message || 'ElevenLabs request failed',
          detail: error.detail,
        })
      }
      return jsonResult(502, { error: error.message || 'ElevenLabs network error' })
    }
  }

  let cloudUrl = null
  if (persistKey) {
    try {
      cloudUrl = await uploadTtsClip(env, persistKey, audio, voice.id)
      cacheLabel = cacheLabel === 'hit' ? 'memory+cloudinary' : 'generated'
    } catch (error) {
      console.warn('[tts] Cloudinary upload failed, returning raw audio:', error.message || error)
    }
  }

  if (preferUrl && cloudUrl) {
    return urlResult({
      url: cloudUrl,
      voiceId: voice.id,
      speed,
      cache: cacheLabel,
    })
  }

  return audioResult({
    audio,
    voice,
    speed,
    cache: cacheLabel,
    url: cloudUrl,
  })
}

runTtsRequest._voicePool = null
runTtsRequest._voicePoolPromise = null
runTtsRequest._lastVoiceId = null
