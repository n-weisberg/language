/** Written Spanish numbers 0–999 (Latin American style). */

const ONES = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
]

const TENS = [
  '',
  '',
  'veinte',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
]

const TWENTIES = [
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
]

const HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
]

/** Convert 0–999 to written Spanish (LA). */
export function numberToSpanish(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    throw new RangeError(`numberToSpanish expects 0–999, got ${n}`)
  }
  if (n < 20) return ONES[n]
  if (n < 30) return TWENTIES[n - 20]
  if (n < 100) {
    const ten = Math.floor(n / 10)
    const one = n % 10
    return one === 0 ? TENS[ten] : `${TENS[ten]} y ${ONES[one]}`
  }
  if (n === 100) return 'cien'
  const hundred = Math.floor(n / 100)
  const rest = n % 100
  if (rest === 0) return HUNDREDS[hundred] === 'ciento' ? 'cien' : HUNDREDS[hundred]
  // 101–199 use "ciento …"; 200+ use doscientos/trescientos/…
  const head = hundred === 1 ? 'ciento' : HUNDREDS[hundred]
  return `${head} ${numberToSpanish(rest)}`
}

function buildNumberCards() {
  const cards = []
  for (let n = 0; n <= 999; n += 1) {
    cards.push({
      id: `num-${String(n).padStart(3, '0')}`,
      en: String(n),
      es: numberToSpanish(n),
      value: n,
      bucket: n <= 100 ? 'low' : 'high',
      source: 'numbers',
    })
  }
  return cards
}

export const numberFlashcards = buildNumberCards()

export const numberMeta = {
  title: 'Spanish numbers 0–999',
  card_count: numberFlashcards.length,
  note: 'No spaced repetition — each draw is 50/50 between 0–100 and 101–999.',
}

export function getNumberFlashcards() {
  return numberFlashcards
}

/**
 * Pick one random number card: 50% from 0–100, 50% from 101–999.
 * Optionally avoid repeating the previous card id.
 */
export function pickRandomNumberCard(excludeId = null) {
  const preferLow = Math.random() < 0.5
  const primary = preferLow
    ? numberFlashcards.filter((card) => card.value <= 100)
    : numberFlashcards.filter((card) => card.value >= 101)
  const fallback = preferLow
    ? numberFlashcards.filter((card) => card.value >= 101)
    : numberFlashcards.filter((card) => card.value <= 100)

  let pool = primary.filter((card) => card.id !== excludeId)
  if (!pool.length) pool = fallback.filter((card) => card.id !== excludeId)
  if (!pool.length) pool = numberFlashcards.filter((card) => card.id !== excludeId)
  if (!pool.length) return numberFlashcards[0] ?? null
  return pool[Math.floor(Math.random() * pool.length)]
}
