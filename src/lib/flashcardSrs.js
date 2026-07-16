/** Card-count spaced repetition (SM-2-inspired, not calendar time). */

export const SRS = {
  firstInterval: 4,
  againInterval: 3,
  easeStart: 2.5,
  easeMin: 1.3,
  easeMax: 3.0,
  easeKnownDelta: 0.05,
  easeAgainDelta: 0.2,
  maxInterval: 400,
  /** Limit brand-new cards in the working queue so retries aren't buried. */
  newCardCap: 12,
}

export function defaultCardSrs() {
  return {
    interval: 0,
    due: 0,
    ease: SRS.easeStart,
    reps: 0,
    lapses: 0,
  }
}

export function isCardDue(state, reviewCount) {
  if (!state) return true
  return (state.due ?? 0) <= reviewCount
}

export function scheduleKnow(state, reviewCount) {
  const prev = state ?? defaultCardSrs()
  const ease = Math.min(SRS.easeMax, (prev.ease ?? SRS.easeStart) + SRS.easeKnownDelta)
  const priorInterval = prev.interval ?? 0
  const interval =
    priorInterval <= 0
      ? SRS.firstInterval
      : Math.min(SRS.maxInterval, Math.max(priorInterval + 1, Math.round(priorInterval * ease)))

  return {
    interval,
    due: reviewCount + interval,
    ease,
    reps: (prev.reps ?? 0) + 1,
    lapses: prev.lapses ?? 0,
  }
}

export function scheduleAgain(state, reviewCount) {
  const prev = state ?? defaultCardSrs()
  const ease = Math.max(SRS.easeMin, (prev.ease ?? SRS.easeStart) - SRS.easeAgainDelta)
  const interval = SRS.againInterval

  return {
    interval,
    due: reviewCount + interval,
    ease,
    reps: 0,
    lapses: (prev.lapses ?? 0) + 1,
  }
}

function shuffle(items) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function shuffleByDue(dueCards, cards) {
  const sorted = [...dueCards].sort((a, b) => {
    const dueA = cards[a.id]?.due ?? 0
    const dueB = cards[b.id]?.due ?? 0
    if (dueA !== dueB) return dueA - dueB
    // Prefer shorter intervals (recent Again) when due ties
    return (cards[a.id]?.interval ?? 0) - (cards[b.id]?.interval ?? 0)
  })

  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    const due = cards[sorted[i].id]?.due ?? 0
    while (j < sorted.length && (cards[sorted[j].id]?.due ?? 0) === due) j += 1
    for (let k = j - 1; k > i; k -= 1) {
      const r = i + Math.floor(Math.random() * (k - i + 1))
      ;[sorted[k], sorted[r]] = [sorted[r], sorted[k]]
    }
    i = j
  }

  return sorted
}

/**
 * Build the working queue:
 * 1. Due reviews first (already seen)
 * 2. A capped set of new cards
 * 3. Force-insert "coming soon" Again cards at their remaining gap
 */
export function buildDueQueue(deck, cards = {}, reviewCount = 0) {
  const dueNow = deck.filter((card) => isCardDue(cards[card.id], reviewCount))
  const reviews = dueNow.filter((card) => cards[card.id])
  const news = shuffle(dueNow.filter((card) => !cards[card.id])).slice(0, SRS.newCardCap)

  let queue = [...shuffleByDue(reviews, cards), ...news]

  const comingSoon = deck.filter((card) => {
    const state = cards[card.id]
    if (!state || isCardDue(state, reviewCount)) return false
    const gap = state.due - reviewCount
    return gap > 0 && gap <= SRS.againInterval
  })

  for (const card of comingSoon) {
    const gap = cards[card.id].due - reviewCount
    queue = queue.filter((item) => item.id !== card.id)
    const at = Math.min(Math.max(gap, 1), queue.length)
    queue = [...queue.slice(0, at), card, ...queue.slice(at)]
  }

  return queue
}

/** Soonest-due first — used when caught up and user wants to keep practicing. */
export function buildAheadQueue(deck, cards = {}) {
  return [...deck].sort((a, b) => {
    const dueA = cards[a.id]?.due ?? 0
    const dueB = cards[b.id]?.due ?? 0
    return dueA - dueB
  })
}

export function countDue(deck, cards = {}, reviewCount = 0) {
  return deck.filter((card) => isCardDue(cards[card.id], reviewCount)).length
}

export function countScheduled(deck, cards = {}) {
  return deck.filter((card) => Boolean(cards[card.id])).length
}

export const FLASHCARD_MODES = ['en-es', 'es-en', 'listen']

/** Card content sources. Each keeps an independent SRS schedule. */
export const FLASHCARD_SOURCES = ['phrases', 'pimsleur', 'numbers']
export const DEFAULT_FLASHCARD_SOURCE = 'phrases'

/**
 * Storage key for a source+mode SRS bucket. The default `phrases` source keeps
 * bare mode keys (`en-es`) for backward compatibility with existing progress;
 * other sources are namespaced (`pimsleur:en-es`).
 */
export function modeStorageKey(source, mode) {
  const m = FLASHCARD_MODES.includes(mode) ? mode : 'en-es'
  const s = FLASHCARD_SOURCES.includes(source) ? source : DEFAULT_FLASHCARD_SOURCE
  return s === DEFAULT_FLASHCARD_SOURCE ? m : `${s}:${m}`
}

export function emptyModeState() {
  return {
    reviewCount: 0,
    cards: {},
    known: {},
    again: {},
  }
}

export function emptyByMode() {
  return {
    'en-es': emptyModeState(),
    'es-en': emptyModeState(),
    'listen': emptyModeState(),
  }
}

export function getModeState(progress, mode = 'en-es', source = DEFAULT_FLASHCARD_SOURCE) {
  const key = modeStorageKey(source, mode)
  return progress?.byMode?.[key] ?? emptyModeState()
}

function migrateKnownAgainIntoCards(bucket) {
  const cards = { ...(bucket.cards ?? {}) }
  const reviewCount = bucket.reviewCount ?? 0
  let changed = false

  for (const [cardId, ts] of Object.entries(bucket.known ?? {})) {
    if (cards[cardId]) continue
    cards[cardId] = {
      interval: 20,
      due: reviewCount,
      ease: SRS.easeStart,
      reps: 1,
      lapses: 0,
      migratedFrom: 'known',
      legacyAt: ts,
    }
    changed = true
  }

  for (const [cardId, ts] of Object.entries(bucket.again ?? {})) {
    if (cards[cardId] && !cards[cardId].migratedFrom) continue
    cards[cardId] = {
      interval: SRS.againInterval,
      due: reviewCount,
      ease: Math.max(SRS.easeMin, SRS.easeStart - SRS.easeAgainDelta),
      reps: 0,
      lapses: 1,
      migratedFrom: 'again',
      legacyAt: ts,
    }
    changed = true
  }

  return changed ? { ...bucket, cards, reviewCount } : bucket
}

function looksLikeCardSrsMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const sample = Object.values(value)[0]
  return Boolean(sample && typeof sample === 'object' && ('due' in sample || 'interval' in sample || 'reps' in sample))
}

/**
 * Ensure per-mode SRS buckets exist. Legacy flat cards/known/again seed the
 * current mode only so other modes can diverge from a clean slate.
 */
export function migrateLegacyCardState(progress) {
  let next = { ...progress }
  let changed = false

  const hasFlatLegacy =
    looksLikeCardSrsMap(next.cards) ||
    Object.keys(next.known ?? {}).length > 0 ||
    Object.keys(next.again ?? {}).length > 0

  const byModeEmpty =
    !next.byMode ||
    FLASHCARD_MODES.every((mode) => modeProgressIsEmpty(next.byMode?.[mode]))

  if (!next.byMode || typeof next.byMode !== 'object' || (hasFlatLegacy && byModeEmpty)) {
    const byMode = emptyByMode()
    const legacyBucket = {
      reviewCount: next.reviewCount ?? 0,
      cards: looksLikeCardSrsMap(next.cards) ? { ...next.cards } : {},
      known: next.known ?? {},
      again: next.again ?? {},
    }
    const seedMode = FLASHCARD_MODES.includes(next.mode) ? next.mode : 'en-es'
    byMode[seedMode] = legacyBucket
    next = { ...next, byMode }
    changed = true
  } else {
    // Normalize every bucket (base modes + namespaced sources like `pimsleur:en-es`)
    const byMode = { ...emptyByMode(), ...next.byMode }
    for (const key of Object.keys(byMode)) {
      byMode[key] = {
        ...emptyModeState(),
        ...(byMode[key] ?? {}),
        cards: byMode[key]?.cards ?? {},
        known: byMode[key]?.known ?? {},
        again: byMode[key]?.again ?? {},
        reviewCount: byMode[key]?.reviewCount ?? 0,
      }
    }
    next = { ...next, byMode }
  }

  const byMode = { ...next.byMode }
  for (const key of Object.keys(byMode)) {
    const migrated = migrateKnownAgainIntoCards(byMode[key] ?? emptyModeState())
    if (migrated !== byMode[key]) {
      byMode[key] = migrated
      changed = true
    }
  }

  return changed || next.byMode !== progress.byMode ? { ...next, byMode } : next
}

export function modeProgressIsEmpty(bucket) {
  if (!bucket) return true
  return (
    Object.keys(bucket.cards ?? {}).length === 0 &&
    Object.keys(bucket.known ?? {}).length === 0 &&
    Object.keys(bucket.again ?? {}).length === 0
  )
}

export function flashcardsProgressIsEmpty(progress) {
  if (!progress) return true
  if (progress.byMode) {
    const keys = Object.keys(progress.byMode)
    if (keys.length === 0) return true
    return keys.every((key) => modeProgressIsEmpty(progress.byMode[key]))
  }
  return (
    Object.keys(progress.cards ?? {}).length === 0 &&
    Object.keys(progress.known ?? {}).length === 0
  )
}
