/** @type {HTMLAudioElement | null} */
let activeAudio = null

/** @type {Map<string, { url: string | null, promise: Promise<string> }>} */
const audioCache = new Map()

/** @type {Map<string, string>} cardId -> ElevenLabs voice id */
const voiceLocks = new Map()

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

async function synthesizeElevenLabs(text, speed = 1, voiceId = null) {
  const payload = { text, speed: normalizeVoiceSpeed(speed) }
  if (voiceId) payload.voiceId = voiceId

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

  const usedVoiceId = response.headers.get('X-TTS-Voice')
  const blob = await response.blob()
  if (!blob.size) throw new Error('TTS returned empty audio')
  return {
    url: URL.createObjectURL(blob),
    voiceId: usedVoiceId || voiceId || null,
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

async function getOrFetchAudio(text, cacheKey, speed, cardId) {
  const existing = audioCache.get(cacheKey)
  if (existing) {
    return existing.url ?? existing.promise
  }

  const lockedVoiceId = cardId ? voiceLocks.get(cardId) : null
  const promise = synthesizeElevenLabs(text, speed, lockedVoiceId)
    .then(({ url, voiceId }) => {
      if (cardId && voiceId) voiceLocks.set(cardId, voiceId)
      const current = audioCache.get(cacheKey)
      if (current?.promise === promise) {
        audioCache.set(cacheKey, { url, promise })
      } else {
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

  audioCache.set(cacheKey, { url: null, promise })
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
  const keepCardIds = new Set([...keep].map(cardIdFromCacheKey).filter(Boolean))

  for (const [key, entry] of audioCache.entries()) {
    if (keep.has(key)) continue
    if (entry.url) URL.revokeObjectURL(entry.url)
    audioCache.delete(key)
  }

  for (const cardId of [...voiceLocks.keys()]) {
    if (!keepCardIds.has(cardId)) voiceLocks.delete(cardId)
  }
}

export function clearSpeechPrefetch() {
  retainSpeechCache([])
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
 * Speak Spanish via ElevenLabs. Reuses cached audio for the same cacheKey,
 * and reuses the card's locked voice across speeds.
 * @param {string} text
 * @param {{ cacheKey?: string, speed?: number }} [options]
 */
export async function speakSpanish(text, options = {}) {
  const normalized = text?.trim()
  if (!normalized) return false
  const speed = normalizeVoiceSpeed(options.speed ?? 1)
  const cacheKey = options.cacheKey ?? `${normalized}@${speed}`
  const cardId = cardIdFromCacheKey(cacheKey)

  try {
    const url = await getOrFetchAudio(normalized, cacheKey, speed, cardId)
    return playUrl(url)
  } catch (error) {
    console.warn('ElevenLabs TTS unavailable, falling back to browser voice:', error)
    return speakWithBrowser(normalized, speed)
  }
}
