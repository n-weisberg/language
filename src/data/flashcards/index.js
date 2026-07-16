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

/** Cumulative deck: everything up to and including the selected level. */
export function getPimsleurFlashcardsForLevel(level) {
  return pimsleurFlashcards.filter((card) => card.level <= level)
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
