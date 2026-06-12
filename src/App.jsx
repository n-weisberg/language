import { useCallback, useMemo, useState } from 'react'
import { getLesson, getLevel } from './data/curriculum'
import { useProgress } from './hooks/useProgress'
import { HomePage } from './pages/HomePage'
import { LevelPage } from './pages/LevelPage'
import { LessonPage } from './pages/LessonPage'
import './App.css'

function App() {
  const {
    progress,
    getLessonProgress,
    savePosition,
    markComplete,
    setLastLesson,
    getLevelStats,
  } = useProgress()

  const [view, setView] = useState('home')
  const [selectedLevelId, setSelectedLevelId] = useState(null)
  const [activeLesson, setActiveLesson] = useState(null)

  const selectedLevel = useMemo(
    () => (selectedLevelId ? getLevel(selectedLevelId) : null),
    [selectedLevelId],
  )

  const openLevel = useCallback((levelId) => {
    setSelectedLevelId(levelId)
    setActiveLesson(null)
    setView('level')
  }, [])

  const openLesson = useCallback(
    (lesson) => {
      setActiveLesson(lesson)
      setLastLesson(selectedLevelId, lesson.type, lesson.lessonNum)
      setView('lesson')
    },
    [selectedLevelId, setLastLesson],
  )

  const continueLearning = useCallback(() => {
    const last = progress.lastLesson
    if (!last) return

    const level = getLevel(last.levelId)
    const lesson = getLesson(last.levelId, last.type, last.lessonNum)
    if (!level || !lesson) return

    setSelectedLevelId(last.levelId)
    setActiveLesson(lesson)
    setView('lesson')
  }, [progress.lastLesson])

  const handlePositionChange = useCallback(
    (position) => {
      if (!selectedLevel || !activeLesson) return
      savePosition(selectedLevel.id, activeLesson.type, activeLesson.lessonNum, position)
    },
    [activeLesson, savePosition, selectedLevel],
  )

  const handleComplete = useCallback(
    (completed) => {
      if (!selectedLevel || !activeLesson) return
      markComplete(selectedLevel.id, activeLesson.type, activeLesson.lessonNum, completed)
    },
    [activeLesson, markComplete, selectedLevel],
  )

  const handleNavigateLesson = useCallback(
    (lesson) => {
      setActiveLesson(lesson)
      setLastLesson(selectedLevel.id, lesson.type, lesson.lessonNum)
    },
    [selectedLevel, setLastLesson],
  )

  return (
    <div className="app-shell">
      {view === 'home' ? (
        <HomePage
          progress={progress}
          getLevelStats={getLevelStats}
          onSelectLevel={openLevel}
          onContinue={continueLearning}
        />
      ) : null}

      {view === 'level' && selectedLevel ? (
        <LevelPage
          level={selectedLevel}
          getLessonProgress={getLessonProgress}
          onBack={() => setView('home')}
          onSelectLesson={openLesson}
        />
      ) : null}

      {view === 'lesson' && selectedLevel && activeLesson ? (
        <LessonPage
          level={selectedLevel}
          lesson={activeLesson}
          lessonProgress={getLessonProgress(
            selectedLevel.id,
            activeLesson.type,
            activeLesson.lessonNum,
          )}
          onBack={() => setView('level')}
          onNavigate={handleNavigateLesson}
          onPositionChange={handlePositionChange}
          onComplete={handleComplete}
        />
      ) : null}
    </div>
  )
}

export default App
