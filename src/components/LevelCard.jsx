export function LevelCard({ level, stats, onSelect }) {
  const percent = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0

  return (
    <button type="button" className="level-card" onClick={() => onSelect(level.id)}>
      <div className="level-card-top">
        <span className="level-badge">Level {level.id}</span>
        <span className="level-progress-text">
          {stats.completed}/{stats.total} lessons
        </span>
      </div>
      <h2>{level.subtitle}</h2>
      <p>{level.description}</p>
      <div className="level-card-footer">
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span>{percent}% complete</span>
      </div>
    </button>
  )
}
