import { useCallback, useEffect, useState } from 'react'
import { lessonKey } from '../data/curriculum'
import {
  defaultLessonsProgress,
  flushProgressSave,
  loadProgress,
  normalizeLessonsProgress,
  queueProgressSave,
} from '../lib/progressSync'
import { isSupabaseConfigured } from '../lib/supabase'

const LEGACY_KEY = 'pimsleur-progress'

function localKey(profileId) {
  return profileId ? `pimsleur-progress:${profileId}` : LEGACY_KEY
}

function readLocal(profileId) {
  try {
    const raw = localStorage.getItem(localKey(profileId))
    if (raw) return normalizeLessonsProgress(JSON.parse(raw))
    if (profileId) {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy) return normalizeLessonsProgress(JSON.parse(legacy))
    }
    return defaultLessonsProgress()
  } catch {
    return defaultLessonsProgress()
  }
}

function writeLocal(profileId, data) {
  localStorage.setItem(localKey(profileId), JSON.stringify(data))
}

export function useProgress(profileId) {
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

        if (remote?.lessons) {
          const remoteEmpty =
            Object.keys(remote.lessons.lessons || {}).length === 0 && !remote.lessons.lastLesson
          const localHasData = Object.keys(local.lessons || {}).length > 0 || Boolean(local.lastLesson)

          if (remoteEmpty && localHasData) {
            writeLocal(profileId, local)
            setProgress(local)
            queueProgressSave(profileId, { lessons: local })
          } else {
            writeLocal(profileId, remote.lessons)
            setProgress(remote.lessons)
          }
        } else {
          // Seed cloud from local / legacy storage on first sync
          queueProgressSave(profileId, { lessons: local })
        }
      } catch (error) {
        console.warn('Could not load lesson progress from Supabase:', error)
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
          queueProgressSave(profileId, { lessons: next })
        }
        return next
      })
    },
    [profileId],
  )

  const getLessonProgress = useCallback(
    (levelId, type, lessonNum) => {
      const key = lessonKey(levelId, type, lessonNum)
      return progress.lessons[key] ?? { completed: false, position: 0 }
    },
    [progress.lessons],
  )

  const savePosition = useCallback(
    (levelId, type, lessonNum, position) => {
      const key = lessonKey(levelId, type, lessonNum)
      updateProgress((current) => ({
        ...current,
        lastLesson: { levelId, type, lessonNum },
        lessons: {
          ...current.lessons,
          [key]: {
            ...current.lessons[key],
            completed: current.lessons[key]?.completed ?? false,
            position,
          },
        },
      }))
    },
    [updateProgress],
  )

  const markComplete = useCallback(
    (levelId, type, lessonNum, completed = true) => {
      const key = lessonKey(levelId, type, lessonNum)
      updateProgress((current) => ({
        ...current,
        lessons: {
          ...current.lessons,
          [key]: {
            ...current.lessons[key],
            position: current.lessons[key]?.position ?? 0,
            completed,
          },
        },
      }))
    },
    [updateProgress],
  )

  const setLastLesson = useCallback(
    (levelId, type, lessonNum) => {
      updateProgress((current) => ({
        ...current,
        lastLesson: { levelId, type, lessonNum },
      }))
    },
    [updateProgress],
  )

  const getLevelStats = useCallback(
    (levelId, unitCount) => {
      let completed = 0
      for (let n = 1; n <= unitCount; n += 1) {
        const key = lessonKey(levelId, 'unit', n)
        if (progress.lessons[key]?.completed) completed += 1
      }
      return { completed, total: unitCount }
    },
    [progress.lessons],
  )

  return {
    progress,
    ready,
    getLessonProgress,
    savePosition,
    markComplete,
    setLastLesson,
    getLevelStats,
  }
}
