import { READING_COUNTS, ROMAN, UNIT_COUNTS, lessonKey } from './audio-paths.js'
import { resolveAudioPath } from './resolve-audio.js'

function buildUnits(level) {
  const count = UNIT_COUNTS[level]
  return Array.from({ length: count }, (_, index) => {
    const lessonNum = index + 1
    return {
      id: `unit-${lessonNum}`,
      type: 'unit',
      lessonNum,
      title: `Lesson ${lessonNum}`,
      subtitle: `Unit ${lessonNum}`,
      audioPath: resolveAudioPath(level, 'unit', lessonNum),
      key: lessonKey(level, 'unit', lessonNum),
    }
  })
}

function buildReadingLessons(level) {
  const count = READING_COUNTS[level]
  return Array.from({ length: count }, (_, index) => {
    const lessonNum = index + 1
    return {
      id: `reading-${lessonNum}`,
      type: 'reading',
      lessonNum,
      title: `Reading ${lessonNum}`,
      subtitle: 'Reading practice',
      audioPath: resolveAudioPath(level, 'reading', lessonNum),
      key: lessonKey(level, 'reading', lessonNum),
    }
  })
}

export const levels = [1, 2, 3, 4, 5].map((level) => ({
  id: level,
  title: `Level ${level}`,
  subtitle: `Spanish ${ROMAN[level - 1]}`,
  description:
    level === 1
      ? 'Begin your conversational Spanish journey.'
      : level === 5
        ? 'Advanced fluency and natural expression.'
        : `Build on Level ${level - 1} with new vocabulary and structures.`,
  unitCount: UNIT_COUNTS[level],
  readingCount: READING_COUNTS[level],
  units: buildUnits(level),
  readingLessons: buildReadingLessons(level),
  userGuide: {
    id: 'guide',
    type: 'guide',
    lessonNum: 0,
    title: "User's Guide",
    subtitle: 'How to use these lessons',
    audioPath: resolveAudioPath(level, 'guide', 0),
    key: lessonKey(level, 'guide', 0),
  },
}))

export function getLevel(levelId) {
  return levels.find((level) => level.id === levelId)
}

export function getLesson(levelId, type, lessonNum) {
  const level = getLevel(levelId)
  if (!level) return null

  if (type === 'guide') return level.userGuide

  const list = type === 'reading' ? level.readingLessons : level.units
  return list.find((lesson) => lesson.lessonNum === lessonNum) ?? null
}

export function getNextLesson(levelId, type, lessonNum) {
  const level = getLevel(levelId)
  if (!level) return null

  const list = type === 'reading' ? level.readingLessons : level.units
  const index = list.findIndex((lesson) => lesson.lessonNum === lessonNum)
  if (index === -1 || index === list.length - 1) return null
  return list[index + 1]
}

export function getPrevLesson(levelId, type, lessonNum) {
  const level = getLevel(levelId)
  if (!level) return null

  const list = type === 'reading' ? level.readingLessons : level.units
  const index = list.findIndex((lesson) => lesson.lessonNum === lessonNum)
  if (index <= 0) return null
  return list[index - 1]
}

export { lessonKey } from './audio-paths.js'
