import { useState } from 'react'
import { Header } from '../components/Header'
import { LessonGrid } from '../components/LessonGrid'

export function LevelPage({ level, getLessonProgress, onBack, onSelectLesson }) {
  const [tab, setTab] = useState('units')

  const lessons = tab === 'units' ? level.units : level.readingLessons

  return (
    <div className="page level-page">
      <Header title={level.subtitle} subtitle={`Level ${level.id}`} onBack={onBack} />

      <section className="level-intro">
        <p>{level.description}</p>
        <div className="level-stats">
          <span>{level.unitCount} audio lessons</span>
          <span>{level.readingCount} reading lessons</span>
        </div>
      </section>

      <div className="tab-row">
        <button
          type="button"
          className={`tab-button ${tab === 'units' ? 'is-active' : ''}`}
          onClick={() => setTab('units')}
        >
          Lessons
        </button>
        <button
          type="button"
          className={`tab-button ${tab === 'reading' ? 'is-active' : ''}`}
          onClick={() => setTab('reading')}
        >
          Reading
        </button>
        <button
          type="button"
          className="tab-button guide-tab"
          onClick={() => onSelectLesson(level.userGuide)}
        >
          User&apos;s Guide
        </button>
      </div>

      <LessonGrid
        lessons={lessons}
        getLessonProgress={(lesson) =>
          getLessonProgress(level.id, lesson.type, lesson.lessonNum)
        }
        onSelect={onSelectLesson}
      />
    </div>
  )
}
