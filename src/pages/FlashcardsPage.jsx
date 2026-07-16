import { useEffect, useMemo, useState } from 'react'
import { Header } from '../components/Header'
import {
  getFlashcardsForLevel,
  getMaxCompletedPimsleurLessons,
  getPimsleurFlashcardsForProgress,
  getPimsleurLevels,
  pickRandomNumberCard,
} from '../data/flashcards'
import {
  buildAheadQueue,
  buildDueQueue,
  countDue,
  countScheduled,
  getModeState,
} from '../lib/flashcardSrs'
import {
  VOICE_SPEEDS,
  audioCacheKey,
  cancelSpeech,
  clearSpeechPrefetch,
  normalizeVoiceSpeed,
  prefetchSpanish,
  retainSpeechCache,
  speakSpanish,
} from '../lib/speakSpanish'

const LEVELS = [1, 2, 3, 4, 5]
const PIMSLEUR_LEVELS = getPimsleurLevels()

const SOURCES = [
  { id: 'phrases', label: 'Phrases', hint: 'Grammar-tagged phrases (Tatoeba)' },
  { id: 'pimsleur', label: 'Pimsleur', hint: 'Vocab from completed Pimsleur lessons' },
  {
    id: 'numbers',
    label: 'Numbers',
    hint: 'Written numbers 0–999 — random draws, no spaced repetition',
  },
]

const MODES = [
  { id: 'en-es', label: 'EN → ES', hint: 'English prompt, Spanish answer' },
  { id: 'es-en', label: 'ES → EN', hint: 'Spanish prompt, English answer' },
  {
    id: 'listen',
    label: 'Listen',
    hint: 'ElevenLabs Mexican Spanish voice first, then Spanish text, then English',
  },
]

const LEVEL_HINTS = {
  1: 'Present, ir a, imperatives',
  2: 'Adds past (preterite / he…)',
  3: 'Adds imperfect + future',
  4: 'Adds conditional + subjunctive',
  5: 'Adds hypotheticals',
}

function maxStep(mode) {
  return mode === 'listen' ? 2 : 1
}

function cardView(mode, step, card) {
  if (!card) return { label: '', text: '', meta: '', showSpeaker: false }
  const numberSide = card.source === 'numbers' ? 'Number' : 'English'

  if (mode === 'en-es') {
    if (step === 0) {
      return {
        label: numberSide,
        text: card.en,
        meta: 'Tap to reveal Spanish',
        showSpeaker: false,
      }
    }
    return {
      label: 'Spanish',
      text: card.es,
      meta: card.features?.join(' · ') || 'Tap to hide',
      showSpeaker: true,
    }
  }

  if (mode === 'es-en') {
    if (step === 0) {
      return {
        label: 'Spanish',
        text: card.es,
        meta: `Tap to reveal ${numberSide.toLowerCase()}`,
        showSpeaker: true,
      }
    }
    return {
      label: numberSide,
      text: card.en,
      meta: card.features?.join(' · ') || 'Tap to hide',
      showSpeaker: true,
    }
  }

  if (step === 0) {
    return {
      label: 'Listen',
      text: '',
      meta: 'Audio only — tap to reveal Spanish',
      showSpeaker: true,
      audioOnly: true,
    }
  }
  if (step === 1) {
    return {
      label: 'Spanish',
      text: card.es,
      meta: 'Tap for English',
      showSpeaker: true,
    }
  }
  return {
    label: 'English',
    text: card.en,
    meta: card.features?.join(' · ') || 'Tap to restart',
    showSpeaker: true,
  }
}

export function FlashcardsPage({
  progress,
  lessonProgress,
  setLevel,
  setMode,
  setSource,
  setVoiceSpeed,
  markKnown,
  markAgain,
  resetKnownForLevel,
  onBack,
}) {
  const source = SOURCES.some((item) => item.id === progress.source) ? progress.source : 'phrases'
  const availableLevels =
    source === 'numbers' ? [] : source === 'pimsleur' ? PIMSLEUR_LEVELS : LEVELS
  const requestedLevel = progress.level ?? 1
  const level = availableLevels.length
    ? availableLevels.includes(requestedLevel)
      ? requestedLevel
      : availableLevels[availableLevels.length - 1]
    : 1
  const isNumbers = source === 'numbers'
  const isPimsleur = source === 'pimsleur'
  const unlockedByLevel = useMemo(
    () => getMaxCompletedPimsleurLessons(lessonProgress),
    [lessonProgress],
  )
  const unlockedThrough = unlockedByLevel[level] ?? 0
  const mode = progress.mode ?? 'en-es'
  const voiceSpeed = normalizeVoiceSpeed(progress.voiceSpeed ?? 1)
  const modeState = getModeState(progress, mode, source)
  const reviewCount = modeState.reviewCount ?? 0
  const cards = modeState.cards ?? {}
  const scheduleVersion = progress.scheduleVersion ?? 0
  const deck = useMemo(() => {
    if (isNumbers) return []
    if (isPimsleur) return getPimsleurFlashcardsForProgress(level, lessonProgress)
    return getFlashcardsForLevel(level)
  }, [source, level, isNumbers, isPimsleur, lessonProgress])
  const [queue, setQueue] = useState([])
  const [numberCard, setNumberCard] = useState(() => pickRandomNumberCard())
  const [numberUpcoming, setNumberUpcoming] = useState(() => pickRandomNumberCard())
  const [step, setStep] = useState(0)
  const [sessionSeen, setSessionSeen] = useState(0)
  const [practicingAhead, setPracticingAhead] = useState(false)

  useEffect(() => {
    if (isNumbers) {
      setPracticingAhead(false)
      setSessionSeen(0)
      const next = pickRandomNumberCard()
      setNumberCard(next)
      setNumberUpcoming(pickRandomNumberCard(next?.id))
      setStep(0)
      cancelSpeech()
      return
    }
    setPracticingAhead(false)
    setSessionSeen(0)
    setQueue(buildDueQueue(deck, cards, reviewCount))
    setStep(0)
    cancelSpeech()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset session when deck/level/mode changes
  }, [deck, level, mode, scheduleVersion, source, isNumbers])

  // Rebuild after each answer so Again cards are pinned ~3 slots ahead
  useEffect(() => {
    if (isNumbers) return
    setPracticingAhead(false)
    setQueue(buildDueQueue(deck, cards, reviewCount))
    setStep(0)
    cancelSpeech()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cards update with reviewCount per mode
  }, [reviewCount, mode, isNumbers])

  useEffect(() => {
    setStep(0)
    cancelSpeech()
  }, [mode])

  const current = isNumbers ? numberCard : (queue[0] ?? null)
  const upcoming = isNumbers ? numberUpcoming : (queue[1] ?? null)
  const view = cardView(mode, step, current)
  const modeMeta = MODES.find((item) => item.id === mode) ?? MODES[0]
  const sourceMeta = SOURCES.find((item) => item.id === source) ?? SOURCES[0]
  const currentAudioKey = current ? audioCacheKey(current.id, voiceSpeed) : null
  const upcomingAudioKey = upcoming ? audioCacheKey(upcoming.id, voiceSpeed) : null

  useEffect(() => {
    if (mode !== 'listen') {
      clearSpeechPrefetch()
      return undefined
    }
    if (!current) {
      clearSpeechPrefetch()
      return undefined
    }

    retainSpeechCache([currentAudioKey, upcomingAudioKey])
    prefetchSpanish(current.es, currentAudioKey, voiceSpeed)
    if (upcoming && upcomingAudioKey) prefetchSpanish(upcoming.es, upcomingAudioKey, voiceSpeed)
    return undefined
  }, [mode, current, upcoming, voiceSpeed, currentAudioKey, upcomingAudioKey])

  useEffect(() => {
    if (!current || mode !== 'listen' || step !== 0) return undefined
    const timer = window.setTimeout(() => {
      speakSpanish(current.es, { cacheKey: audioCacheKey(current.id, voiceSpeed), speed: voiceSpeed })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      cancelSpeech()
    }
  }, [current, mode, step, voiceSpeed])

  useEffect(
    () => () => {
      cancelSpeech()
      clearSpeechPrefetch()
    },
    [],
  )

  const dueNow = isNumbers ? 0 : countDue(deck, cards, reviewCount)
  const scheduled = isNumbers ? 0 : countScheduled(deck, cards)
  const remaining = isNumbers ? 0 : queue.length
  const progressPct = !isNumbers && deck.length ? Math.round((scheduled / deck.length) * 100) : 0
  const caughtUp = !isNumbers && !current && dueNow === 0 && deck.length > 0

  function finishCard() {
    cancelSpeech()
    setStep(0)
    setSessionSeen((count) => count + 1)
  }

  function handleCardClick() {
    if (!current) return
    handleReveal()
  }

  function handleReveal() {
    if (!current) return
    setStep((currentStep) => {
      const next = currentStep + 1
      return next > maxStep(mode) ? 0 : next
    })
  }

  function handleSpeak(event) {
    event?.stopPropagation()
    if (!current) return
    speakSpanish(current.es, {
      cacheKey: audioCacheKey(current.id, voiceSpeed),
      speed: voiceSpeed,
    })
  }

  function handleVoiceSpeed(nextSpeed) {
    if (nextSpeed === voiceSpeed) return
    cancelSpeech()
    setVoiceSpeed(nextSpeed)
  }

  function handleCardKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleCardClick()
    }
  }

  function handleKnow() {
    if (!current || isNumbers) return
    markKnown(current.id)
    finishCard()
  }

  function handleAgain() {
    if (!current || isNumbers) return
    markAgain(current.id)
    finishCard()
  }

  function handleNextNumber() {
    if (!isNumbers) return
    cancelSpeech()
    const next = numberUpcoming ?? pickRandomNumberCard(numberCard?.id)
    setNumberCard(next)
    setNumberUpcoming(pickRandomNumberCard(next?.id))
    setStep(0)
    setSessionSeen((count) => count + 1)
  }

  function handleReset() {
    if (isNumbers) return
    cancelSpeech()
    resetKnownForLevel(deck.map((card) => card.id))
    setPracticingAhead(false)
    setSessionSeen(0)
    setStep(0)
  }

  function handlePracticeAhead() {
    if (isNumbers) return
    cancelSpeech()
    setPracticingAhead(true)
    setQueue(buildAheadQueue(deck, cards))
    setStep(0)
  }

  return (
    <div className="page flashcards-page">
      <Header title="Flashcards" subtitle="Phrase practice" onBack={onBack} />

      <section className="level-intro flashcard-intro">
        <p>
          {sourceMeta.hint}. {modeMeta.hint}.{' '}
          {isNumbers
            ? 'Digit on one side, Spanish spelling on the other. Each draw is 50% from 0–100 and 50% from 101–999.'
            : isPimsleur
              ? unlockedThrough
                ? `Unlocked through Level ${level} Lesson ${unlockedThrough} (based on completed audio lessons).`
                : `No Level ${level} audio lessons marked done yet — complete a lesson to unlock vocab.`
              : `Grammar matched to Pimsleur Level ${level}. ${LEVEL_HINTS[level]} Each source and mode has its own spaced-repetition schedule.`}
          {isPimsleur ? ' Each source and mode has its own spaced-repetition schedule.' : ''}
        </p>
        <div className="level-stats flashcard-stats">
          {isNumbers ? (
            <span>{sessionSeen} this session</span>
          ) : (
            <>
              <span>{dueNow} due now</span>
              <span>
                {scheduled} / {deck.length} in rotation
              </span>
              <span>{sessionSeen} this session</span>
            </>
          )}
        </div>
        {!isNumbers ? (
          <div className="flashcard-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="level-progress-text">{progressPct}%</span>
          </div>
        ) : null}
      </section>

      <div className="tab-row" role="tablist" aria-label="Card source">
        {SOURCES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={source === item.id}
            className={`tab-button ${source === item.id ? 'is-active' : ''}`}
            onClick={() => setSource(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="tab-row" role="tablist" aria-label="Practice mode">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={`tab-button ${mode === item.id ? 'is-active' : ''}`}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {availableLevels.length ? (
        <div className="tab-row" role="tablist" aria-label="Pimsleur level filter">
          {availableLevels.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={level === value}
              className={`tab-button ${level === value ? 'is-active' : ''}`}
              onClick={() => setLevel(value)}
            >
              Level {value}
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'listen' ? (
        <div className="tab-row flashcard-speed-row" role="tablist" aria-label="Voice speed">
          {VOICE_SPEEDS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={voiceSpeed === option.id}
              className={`tab-button ${voiceSpeed === option.id ? 'is-active' : ''}`}
              onClick={() => handleVoiceSpeed(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {current ? (
        <>
          <div
            className={`flashcard ${step > 0 ? 'is-flipped' : ''} ${view.audioOnly ? 'is-audio-only' : ''}`}
            role="button"
            tabIndex={0}
            onClick={handleCardClick}
            onKeyDown={handleCardKeyDown}
            aria-label={
              mode === 'listen'
                ? step === 0
                  ? 'Reveal Spanish'
                  : step === 1
                    ? 'Reveal English'
                    : 'Hide text'
                : step === 0
                  ? 'Reveal answer'
                  : 'Hide answer'
            }
          >
            {view.showSpeaker ? (
              <button
                type="button"
                className="flashcard-speak"
                onClick={handleSpeak}
                aria-label="Play Spanish audio"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M3 10v4h3.2L11 18.8V5.2L6.2 10H3zm11.5 2a3.5 3.5 0 0 0-1.5-2.87v5.74A3.5 3.5 0 0 0 14.5 12zm0-7.2v2.06a5.5 5.5 0 0 1 0 10.28v2.06a7.5 7.5 0 0 0 0-14.4z"
                  />
                </svg>
              </button>
            ) : null}
            <span className="flashcard-side-label">{view.label}</span>
            {view.audioOnly ? (
              <span className="flashcard-audio-prompt" aria-hidden="true">
                ♪
              </span>
            ) : (
              <span className="flashcard-text">{view.text}</span>
            )}
            <span className="flashcard-meta">
              {view.meta}
              {!isNumbers && practicingAhead ? ' · practicing ahead' : ''}
              {!isNumbers && remaining ? ` · ${remaining} in queue` : ''}
            </span>
            {mode === 'listen' ? (
              <span className="flashcard-steps" aria-hidden="true">
                <span className={step >= 0 ? 'is-active' : ''} />
                <span className={step >= 1 ? 'is-active' : ''} />
                <span className={step >= 2 ? 'is-active' : ''} />
              </span>
            ) : null}
          </div>

          <div className="flashcard-actions">
            {isNumbers ? (
              <button type="button" className="primary-button" onClick={handleNextNumber}>
                Next
              </button>
            ) : (
              <>
                <button type="button" className="secondary-button" onClick={handleAgain}>
                  Again
                </button>
                <button type="button" className="primary-button" onClick={handleKnow}>
                  Know
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <section className="flashcard-empty">
          <h2>
            {isPimsleur && deck.length === 0
              ? 'Nothing unlocked yet'
              : caughtUp
                ? 'Caught up'
                : 'Deck clear'}
          </h2>
          <p>
            {isPimsleur && deck.length === 0
              ? `Mark Level ${level} audio lessons as done to unlock matching vocab cards.`
              : caughtUp
                ? 'Nothing due right now. Cards you know will return after more reviews. Practice ahead to review early, or reset this level.'
                : 'Practice ahead to keep going, or switch levels.'}
          </p>
          {!(isPimsleur && deck.length === 0) ? (
            <div className="flashcard-actions">
              <button type="button" className="secondary-button" onClick={handlePracticeAhead}>
                Practice ahead
              </button>
              <button type="button" className="primary-button" onClick={handleReset}>
                Reset level
              </button>
            </div>
          ) : null}
        </section>
      )}

      {!isNumbers ? (
        <div className="flashcard-toolbar">
          <button type="button" className="secondary-button" onClick={handlePracticeAhead}>
            Practice ahead
          </button>
          <button type="button" className="secondary-button" onClick={handleReset}>
            Reset level
          </button>
        </div>
      ) : null}
    </div>
  )
}
