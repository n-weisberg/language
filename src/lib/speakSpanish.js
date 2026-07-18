/** @type {HTMLAudioElement | null} */
let activeAudio = null

/** @type {Map<string, { url: string | null, promise: Promise<string>, remote?: boolean }>} */
const audioCache = new Map()

/** @type {Map<string, string>} cardId -> ElevenLabs voice id */
const voiceLocks = new Map()

const VOICE_LOCK_STORAGE_KEY = 'pimsleur-tts-voice-locks'

export const VOICE_SPEEDS = [
  { id: 0.7, label: 'Slow' },
  { id: 0.85, label: 'Slower' },
  { id: 1, label: 'Normal' },
]

export function normalizeVoiceSpeed(value) {
  const speed = Number(value)
  const match = VOICE_SPEEDS.find((option) => option.id === speed)
  return match ? match.id : 1
}

export function audioCacheKey(cardId, speed = 1) {
  return `${cardId}@${normalizeVoiceSpeed(speed)}`
}

function cardIdFromCacheKey(cacheKey) {
  if (!cacheKey) return null
  const at = cacheKey.lastIndexOf('@')
  return at === -1 ? cacheKey : cacheKey.slice(0, at)
}

function loadVoiceLocks() {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(VOICE_LOCK_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    for (const [cardId, voiceId] of Object.entries(parsed)) {
      if (typeof voiceId === 'string' && voiceId) voiceLocks.set(cardId, voiceId)
    }
  } catch {
    /* ignore */
  }
}

function persistVoiceLocks() {
  if (typeof window === 'undefined') return
  try {
    const payload = Object.fromEntries(voiceLocks.entries())
    localStorage.setItem(VOICE_LOCK_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

loadVoiceLocks()

function pickBrowserVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  return (
    voices.find((voice) => /^es-MX/i.test(voice.lang)) ||
    voices.find((voice) => /^es(-|_)/i.test(voice.lang) && /mexico|latin|us/i.test(voice.name)) ||
    voices.find((voice) => /^es-US/i.test(voice.lang)) ||
    voices.find((voice) => /^es/i.test(voice.lang)) ||
    null
  )
}

function speakWithBrowser(text, speed = 1) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) {
    return Promise.resolve(false)
  }

  window.speechSynthesis.cancel()

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'es-MX'
    utter.rate = Math.max(0.5, Math.min(1.2, 0.92 * normalizeVoiceSpeed(speed)))
    const voice = pickBrowserVoice()
    if (voice) {
      utter.voice = voice
      utter.lang = voice.lang || 'es-MX'
    }
    utter.onend = () => resolve(true)
    utter.onerror = () => resolve(false)

    const speak = () => {
      const late = pickBrowserVoice()
      if (late) {
        utter.voice = late
        utter.lang = late.lang || 'es-MX'
      }
      window.speechSynthesis.speak(utter)
    }

    if (window.speechSynthesis.getVoices().length) speak()
    else {
      const onVoices = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
        speak()
      }
      window.speechSynthesis.addEventListener('voiceschanged', onVoices)
      window.setTimeout(speak, 250)
    }
  })
}

async function synthesizeElevenLabs(text, speed = 1, voiceId = null, cacheKey = null, force = false) {
  const payload = { text, speed: normalizeVoiceSpeed(speed) }
  if (voiceId) payload.voiceId = voiceId
  if (cacheKey) payload.cacheKey = cacheKey
  if (force) payload.force = true

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || body.error || ''
    } catch {
      detail = await response.text()
    }
    throw new Error(detail || `TTS request failed (${response.status})`)
  }

  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('application/json')) {
    const body = await response.json()
    if (!body?.url) throw new Error('TTS returned no audio URL')
    return {
      url: body.url,
      voiceId: body.voiceId || voiceId || null,
      remote: true,
    }
  }

  const usedVoiceId = response.headers.get('X-TTS-Voice')
  const remoteUrl = response.headers.get('X-TTS-Url')
  if (remoteUrl) {
    return {
      url: remoteUrl,
      voiceId: usedVoiceId || voiceId || null,
      remote: true,
    }
  }

  const blob = await response.blob()
  if (!blob.size) throw new Error('TTS returned empty audio')
  return {
    url: URL.createObjectURL(blob),
    voiceId: usedVoiceId || voiceId || null,
    remote: false,
  }
}

function playUrl(url) {
  return new Promise((resolve) => {
    cancelSpeech()
    const audio = new Audio(url)
    activeAudio = audio
    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null
      resolve(true)
    }
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null
      resolve(false)
    }
    audio.play().catch(() => {
      if (activeAudio === audio) activeAudio = null
      resolve(false)
    })
  })
}

function dropCacheEntry(cacheKey) {
  const existing = audioCache.get(cacheKey)
  if (!existing) return
  if (existing.url && !existing.remote) URL.revokeObjectURL(existing.url)
  audioCache.delete(cacheKey)
}

async function getOrFetchAudio(text, cacheKey, speed, cardId, force = false) {
  if (force) dropCacheEntry(cacheKey)

  const existing = audioCache.get(cacheKey)
  if (existing && !force) {
    return existing.url ?? existing.promise
  }

  const lockedVoiceId = cardId ? voiceLocks.get(cardId) : null
  const promise = synthesizeElevenLabs(text, speed, lockedVoiceId, cacheKey, force)
    .then(({ url, voiceId, remote }) => {
      if (cardId && voiceId) {
        voiceLocks.set(cardId, voiceId)
        persistVoiceLocks()
      }
      const current = audioCache.get(cacheKey)
      if (current?.promise === promise) {
        audioCache.set(cacheKey, { url, promise, remote: Boolean(remote) })
      } else if (!remote) {
        URL.revokeObjectURL(url)
      }
      return url
    })
    .catch((error) => {
      if (audioCache.get(cacheKey)?.promise === promise) {
        audioCache.delete(cacheKey)
      }
      throw error
    })

  audioCache.set(cacheKey, { url: null, promise, remote: false })
  return promise
}

/**
 * Start fetching TTS audio for later playback (keyed by card id + speed).
 * Locks the voice to the card so speed changes reuse the same speaker.
 */
export function prefetchSpanish(text, cacheKey, speed = 1) {
  const normalized = typeof text === 'string' ? text.trim() : ''
  if (!normalized || !cacheKey) return Promise.resolve(null)
  const cardId = cardIdFromCacheKey(cacheKey)
  return getOrFetchAudio(normalized, cacheKey, speed, cardId).catch(() => null)
}

/** Drop cached clips that are not in keepKeys (frees blob URLs). */
export function retainSpeechCache(keepKeys = []) {
  const keep = new Set(keepKeys.filter(Boolean))

  for (const [key, entry] of audioCache.entries()) {
    if (keep.has(key)) continue
    if (entry.url && !entry.remote) URL.revokeObjectURL(entry.url)
    audioCache.delete(key)
  }
}

export function clearSpeechPrefetch() {
  retainSpeechCache([])
}

/** Drop in-memory audio for one cache key (Cloudinary file stays until force regen). */
export function invalidateSpeechCache(cacheKey) {
  if (cacheKey) dropCacheEntry(cacheKey)
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }
}

/**
 * Speak Spanish via ElevenLabs / Cloudinary cache. Reuses cached audio for the same
 * cacheKey, and reuses the card's locked voice across speeds.
 * @param {string} text
 * @param {{ cacheKey?: string, speed?: number, force?: boolean }} [options]
 */
export async function speakSpanish(text, options = {}) {
  const normalized = text?.trim()
  if (!normalized) return false
  const speed = normalizeVoiceSpeed(options.speed ?? 1)
  const cacheKey = options.cacheKey ?? `${normalized}@${speed}`
  const cardId = cardIdFromCacheKey(cacheKey)
  const force = Boolean(options.force)

  try {
    const url = await getOrFetchAudio(normalized, cacheKey, speed, cardId, force)
    return playUrl(url)
  } catch (error) {
    console.warn('ElevenLabs TTS unavailable, falling back to browser voice:', error)
    return speakWithBrowser(normalized, speed)
  }
}
