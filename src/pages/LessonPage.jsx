import { Header } from '../components/Header'
import { LessonPlayer } from '../components/LessonPlayer'
import { getNextLesson, getPrevLesson } from '../data/curriculum'

export function LessonPage({
  level,
  lesson,
  lessonProgress,
  onBack,
  onNavigate,
  onPositionChange,
  onComplete,
}) {
  const prevLesson = getPrevLesson(level.id, lesson.type, lesson.lessonNum)
  const nextLesson = getNextLesson(level.id, lesson.type, lesson.lessonNum)

  return (
    <div className="page lesson-page">
      <Header
        title={lesson.title}
        subtitle={`${level.subtitle} · ${lesson.type === 'reading' ? 'Reading' : lesson.type === 'guide' ? 'Guide' : 'Lesson'}`}
        onBack={onBack}
      />
      <LessonPlayer
        lesson={lesson}
        level={level}
        initialPosition={lessonProgress.position}
        onPositionChange={onPositionChange}
        onComplete={onComplete}
        isComplete={lessonProgress.completed}
        onBack={onBack}
        onPrev={prevLesson ? () => onNavigate(prevLesson) : null}
        onNext={nextLesson ? () => onNavigate(nextLesson) : null}
      />
    </div>
  )
}
