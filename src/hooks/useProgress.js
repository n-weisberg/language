import { useCallback, useEffect, useState } from 'react'
import { lessonKey } from '../data/curriculum'

const STORAGE_KEY = 'pimsleur-progress'

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { lessons: {}, lastLesson: null }
  } catch {
    return { lessons: {}, lastLesson: null }
  }
}

function writeStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function useProgress() {
  const [progress, setProgress] = useState(readStorage)

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setProgress(readStorage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const updateProgress = useCallback((updater) => {
    setProgress((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      writeStorage(next)
      return next
    })
  }, [])

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
    getLessonProgress,
    savePosition,
    markComplete,
    setLastLesson,
    getLevelStats,
  }
}
