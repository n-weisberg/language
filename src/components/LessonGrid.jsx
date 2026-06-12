export function LessonGrid({ lessons, getLessonProgress, onSelect, activeId }) {
  return (
    <div className="lesson-grid">
      {lessons.map((lesson) => {
        const { completed, position } = getLessonProgress(lesson)
        const started = position > 0 && !completed

        return (
          <button
            key={lesson.id}
            type="button"
            className={[
              'lesson-tile',
              completed ? 'is-complete' : '',
              started ? 'is-started' : '',
              activeId === lesson.id ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(lesson)}
          >
            <span className="lesson-number">{lesson.lessonNum}</span>
            <span className="lesson-label">{lesson.title}</span>
            {completed ? <span className="lesson-status">Done</span> : null}
          </button>
        )
      })}
    </div>
  )
}
