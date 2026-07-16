import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_FLASHCARD_SOURCE,
  emptyModeState,
  flashcardsProgressIsEmpty,
  getModeState,
  migrateLegacyCardState,
  modeStorageKey,
  scheduleAgain,
  scheduleKnow,
} from '../lib/flashcardSrs'
import {
  defaultFlashcardsProgress,
  flushProgressSave,
  loadProgress,
  normalizeFlashcardsProgress,
  queueProgressSave,
} from '../lib/progressSync'
import { isSupabaseConfigured } from '../lib/supabase'

const LEGACY_KEY = 'pimsleur-flashcards'

function localKey(profileId) {
  return profileId ? `pimsleur-flashcards:${profileId}` : LEGACY_KEY
}

function readLocal(profileId) {
  try {
    const raw = localStorage.getItem(localKey(profileId))
    if (raw) return migrateLegacyCardState(normalizeFlashcardsProgress(JSON.parse(raw)))
    if (profileId) {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) return migrateLegacyCardState(normalizeFlashcardsProgress(JSON.parse(legacy)))
    }
    return defaultFlashcardsProgress()
  } catch {
    return defaultFlashcardsProgress()
  }
}

function writeLocal(profileId, data) {
  localStorage.setItem(localKey(profileId), JSON.stringify(data))
}

function updateModeBucket(current, updater) {
  const mode = current.mode ?? 'en-es'
  const source = current.source ?? DEFAULT_FLASHCARD_SOURCE
  const key = modeStorageKey(source, mode)
  const byMode = { ...(current.byMode ?? {}) }
  const bucket = { ...emptyModeState(), ...(byMode[key] ?? {}) }
  byMode[key] = updater(bucket)
  return { ...current, byMode }
}

export function useFlashcardProgress(profileId) {
  const [progress, setProgress] = useState(() => readLocal(profileId))
  const [ready, setReady] = useState(!isSupabaseConfigured || !profileId)

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const local = readLocal(profileId)
      setProgress(local)

      if (!isSupabaseConfigured || !profileId) {
        setReady(true)
        return
      }

      setReady(false)
      try {
        const remote = await loadProgress(profileId)
        if (cancelled) return

        if (remote?.flashcards) {
          const remoteMigrated = migrateLegacyCardState(remote.flashcards)
          const remoteEmpty = flashcardsProgressIsEmpty(remoteMigrated)
          const localHasData = !flashcardsProgressIsEmpty(local)

          if (remoteEmpty && localHasData) {
            writeLocal(profileId, local)
            setProgress(local)
            queueProgressSave(profileId, { flashcards: local })
          } else {
            writeLocal(profileId, remoteMigrated)
            setProgress(remoteMigrated)
            if (remoteMigrated !== remote.flashcards) {
              queueProgressSave(profileId, { flashcards: remoteMigrated })
            }
          }
        } else {
          queueProgressSave(profileId, { flashcards: local })
        }
      } catch (error) {
        console.warn('Could not load flashcard progress from Supabase:', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    }

    hydrate()
    return () => {
      cancelled = true
      if (profileId) flushProgressSave(profileId).catch(() => {})
    }
  }, [profileId])

  useEffect(() => {
    const key = localKey(profileId)
    const onStorage = (event) => {
      if (event.key === key) setProgress(readLocal(profileId))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [profileId])

  const updateProgress = useCallback(
    (updater) => {
      setProgress((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater
        writeLocal(profileId, next)
        if (profileId && isSupabaseConfigured) {
          queueProgressSave(profileId, { flashcards: next })
        }
        return next
      })
    },
    [profileId],
  )

  const setLevel = useCallback(
    (level) => {
      updateProgress((current) => ({ ...current, level }))
    },
    [updateProgress],
  )

  const setMode = useCallback(
    (mode) => {
      updateProgress((current) => ({ ...current, mode }))
    },
    [updateProgress],
  )

  const setSource = useCallback(
    (source) => {
      updateProgress((current) => ({ ...current, source }))
    },
    [updateProgress],
  )

  const setVoiceSpeed = useCallback(
    (voiceSpeed) => {
      updateProgress((current) => ({
        ...current,
        voiceSpeed: [0.7, 0.85, 1].includes(voiceSpeed) ? voiceSpeed : 1,
      }))
    },
    [updateProgress],
  )

  const markKnown = useCallback(
    (cardId) => {
      updateProgress((current) => {
        const next = updateModeBucket(current, (bucket) => {
          const reviewCount = (bucket.reviewCount ?? 0) + 1
          const cards = { ...(bucket.cards ?? {}) }
          cards[cardId] = scheduleKnow(cards[cardId], reviewCount)
          const known = { ...(bucket.known ?? {}) }
          known[cardId] = Date.now()
          const again = { ...(bucket.again ?? {}) }
          delete again[cardId]
          return { ...bucket, reviewCount, cards, known, again }
        })
        return { ...next, lastCardId: cardId }
      })
    },
    [updateProgress],
  )

  const markAgain = useCallback(
    (cardId) => {
      updateProgress((current) => {
        const next = updateModeBucket(current, (bucket) => {
          const reviewCount = (bucket.reviewCount ?? 0) + 1
          const cards = { ...(bucket.cards ?? {}) }
          cards[cardId] = scheduleAgain(cards[cardId], reviewCount)
          const known = { ...(bucket.known ?? {}) }
          delete known[cardId]
          const again = { ...(bucket.again ?? {}) }
          again[cardId] = Date.now()
          return { ...bucket, reviewCount, cards, known, again }
        })
        return { ...next, lastCardId: cardId }
      })
    },
    [updateProgress],
  )

  const resetKnownForLevel = useCallback(
    (cardIds) => {
      updateProgress((current) => {
        const next = updateModeBucket(current, (bucket) => {
          const known = { ...(bucket.known ?? {}) }
          const again = { ...(bucket.again ?? {}) }
          const cards = { ...(bucket.cards ?? {}) }
          for (const id of cardIds) {
            delete known[id]
            delete again[id]
            delete cards[id]
          }
          return { ...bucket, known, again, cards }
        })
        return {
          ...next,
          lastCardId: null,
          scheduleVersion: (current.scheduleVersion ?? 0) + 1,
        }
      })
    },
    [updateProgress],
  )

  const mode = progress.mode ?? 'en-es'
  const source = progress.source ?? DEFAULT_FLASHCARD_SOURCE
  const modeState = getModeState(progress, mode, source)

  const isKnown = useCallback(
    (cardId) => Boolean(modeState.cards?.[cardId]?.reps > 0),
    [modeState.cards],
  )

  return {
    progress,
    ready,
    setLevel,
    setMode,
    setSource,
    setVoiceSpeed,
    markKnown,
    markAgain,
    resetKnownForLevel,
    isKnown,
  }
}
