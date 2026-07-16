import phrases from './phrases.json'
import grammarLevels from './grammar-levels.json'
import pimsleurLessons from './pimsleur-lessons/levels-1-2.json'
import {
  getNumberFlashcards,
  numberFlashcards,
  numberMeta,
  pickRandomNumberCard,
} from './numbers.js'

export { getNumberFlashcards, numberFlashcards, numberMeta, pickRandomNumberCard }

/** Active deck — grammar-tagged phrases balanced across Pimsleur-oriented levels. */
export const flashcards = phrases.cards

export const flashcardMeta = phrases.meta

export const grammarUnlocks = grammarLevels.unlocks
export const featureLevels = grammarLevels.feature_levels

/**
 * Pimsleur lesson deck — unofficial vocab scraped per lesson (Brainscape),
 * mapped to Pimsleur levels/lessons. Kept as a separate source from the
 * grammar-tagged phrase deck above.
 */
export const pimsleurFlashcards = pimsleurLessons.cards

export const pimsleurMeta = pimsleurLessons.meta

/** Levels present in the Pimsleur deck (e.g. [1, 2]). */
export function getPimsleurLevels() {
  return [...new Set(pimsleurFlashcards.map((card) => card.level))].sort((a, b) => a - b)
}

/**
 * Highest completed audio unit per Pimsleur level from lesson progress.
 * Keys look like `1:unit:23`. Reading/guide lessons are ignored.
 */
export function getMaxCompletedPimsleurLessons(lessonsProgress) {
  const maxByLevel = {}
  for (const [key, value] of Object.entries(lessonsProgress?.lessons ?? {})) {
    if (!value?.completed) continue
    const [levelId, type, lessonNum] = key.split(':')
    if (type !== 'unit') continue
    const level = Number(levelId)
    const lesson = Number(lessonNum)
    if (!Number.isFinite(level) || !Number.isFinite(lesson)) continue
    maxByLevel[level] = Math.max(maxByLevel[level] ?? 0, lesson)
  }
  return maxByLevel
}

/** Cumulative deck: everything up to and including the selected level. */
export function getPimsleurFlashcardsForLevel(level) {
  return pimsleurFlashcards.filter((card) => card.level <= level)
}

/**
 * Cards unlocked by completed audio lessons, capped at the selected level tab.
 * A card from level L / lesson N is included only if the user has completed
 * unit N (or later) on that level.
 */
export function getPimsleurFlashcardsForProgress(selectedLevel, lessonsProgress) {
  const maxByLevel = getMaxCompletedPimsleurLessons(lessonsProgress)
  return pimsleurFlashcards.filter((card) => {
    if (card.level > selectedLevel) return false
    const unlockedThrough = maxByLevel[card.level] ?? 0
    return card.lesson <= unlockedThrough
  })
}

/** Cards for a single lesson, keyed by level + lesson number. */
export function getPimsleurFlashcardsForLesson(level, lesson) {
  return pimsleurFlashcards.filter((card) => card.level === level && card.lesson === lesson)
}

export function getFlashcardsByBucket(bucket) {
  return flashcards.filter((card) => card.bucket === bucket)
}

export function getFlashcardsForLevel(level) {
  return flashcards.filter((card) => card.min_level <= level)
}

export function getFlashcardsExactLevel(level) {
  return flashcards.filter((card) => card.min_level === level)
}

export function getFlashcard(id) {
  return flashcards.find((card) => card.id === id) ?? null
}

/**
 * Larger ranked pool (phrases-pool.json). Import only when expanding the deck —
 * do not pull this into the default UI bundle.
 */
export async function loadFlashcardPool() {
  const { default: phrasePool } = await import('./phrases-pool.json')
  return phrasePool.cards
}

export async function loadFlashcardPoolForLevel(level) {
  const pool = await loadFlashcardPool()
  return pool.filter((card) => card.min_level <= level)
}
