import phrases from './phrases.json'
import grammarLevels from './grammar-levels.json'

/** Active deck — grammar-tagged phrases balanced across Pimsleur-oriented levels. */
export const flashcards = phrases.cards

export const flashcardMeta = phrases.meta

export const grammarUnlocks = grammarLevels.unlocks
export const featureLevels = grammarLevels.feature_levels

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
