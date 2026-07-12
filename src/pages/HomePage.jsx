import { LevelCard } from '../components/LevelCard'
import { levels } from '../data/curriculum'

export function HomePage({
  progress,
  getLevelStats,
  onSelectLevel,
  onContinue,
  onOpenFlashcards,
}) {
  const lastLesson = progress.lastLesson

  return (
    <div className="page home-page">
      <section className="hero-panel">
        <p className="eyebrow">Audio-first language learning</p>
        <h1>Spanish Course</h1>
        <p className="hero-copy">
          Five levels, thirty lessons each. Press play, listen carefully, and speak along.
        </p>
        <div className="hero-actions">
          {lastLesson ? (
            <button type="button" className="primary-button continue-button" onClick={onContinue}>
              Continue where you left off
            </button>
          ) : null}
          <button
            type="button"
            className={lastLesson ? 'secondary-button' : 'primary-button continue-button'}
            onClick={onOpenFlashcards}
          >
            Practice flashcards
          </button>
        </div>
      </section>

      <section className="levels-section">
        <div className="section-heading">
          <h2>Choose a level</h2>
          <p>Work through lessons in order for the best results.</p>
        </div>
        <div className="level-grid">
          {levels.map((level) => (
            <LevelCard
              key={level.id}
              level={level}
              stats={getLevelStats(level.id, level.unitCount)}
              onSelect={onSelectLevel}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
