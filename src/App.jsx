import { useCallback, useMemo, useState } from 'react'
import { getLesson, getLevel } from './data/curriculum'
import { useFlashcardProgress } from './hooks/useFlashcardProgress'
import { useProfile } from './hooks/useProfile'
import { useProgress } from './hooks/useProgress'
import { FlashcardsPage } from './pages/FlashcardsPage'
import { HomePage } from './pages/HomePage'
import { LevelPage } from './pages/LevelPage'
import { LessonPage } from './pages/LessonPage'
import { ListeningPage } from './pages/ListeningPage'
import { ProfileGate } from './pages/ProfileGate'
import './App.css'

function App() {
  const {
    configured,
    profileId,
    activeProfile,
    profiles,
    loading: profilesLoading,
    error: profilesError,
    selectProfile,
    addProfile,
    clearProfile,
  } = useProfile()

  const {
    progress,
    ready: lessonsReady,
    getLessonProgress,
    savePosition,
    markComplete,
    setLastLesson,
    getLevelStats,
  } = useProgress(profileId)

  const {
    progress: flashcardProgress,
    ready: flashcardsReady,
    setLevel: setFlashcardLevel,
    setMode: setFlashcardMode,
    setSource: setFlashcardSource,
    setVoiceSpeed: setFlashcardVoiceSpeed,
    markKnown,
    markAgain,
    resetKnownForLevel,
  } = useFlashcardProgress(profileId)

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

  const openFlashcards = useCallback(() => {
    setView('flashcards')
  }, [])

  const openListening = useCallback(() => {
    setView('listening')
  }, [])

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

  const handleSwitchProfile = useCallback(() => {
    setView('home')
    setSelectedLevelId(null)
    setActiveLesson(null)
    clearProfile()
  }, [clearProfile])

  if (configured && !profileId) {
    return (
      <div className="app-shell">
        <ProfileGate
          profiles={profiles}
          loading={profilesLoading}
          error={profilesError}
          onSelect={selectProfile}
          onCreate={addProfile}
        />
      </div>
    )
  }

  if (configured && profileId && (!lessonsReady || !flashcardsReady)) {
    return (
      <div className="app-shell">
        <div className="page profile-gate">
          <section className="hero-panel profile-panel">
            <p className="eyebrow">Syncing</p>
            <h1>Loading progress…</h1>
            <p className="hero-copy">Pulling lesson and flashcard progress for {activeProfile?.name || 'you'}.</p>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {configured && activeProfile ? (
        <div className="profile-bar">
          <span>
            Learning as <strong>{activeProfile.name}</strong>
          </span>
          <button type="button" className="text-button" onClick={handleSwitchProfile}>
            Switch
          </button>
        </div>
      ) : null}

      {view === 'home' ? (
        <HomePage
          progress={progress}
          getLevelStats={getLevelStats}
          onSelectLevel={openLevel}
          onContinue={continueLearning}
          onOpenFlashcards={openFlashcards}
          onOpenListening={openListening}
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

      {view === 'flashcards' ? (
        <FlashcardsPage
          progress={flashcardProgress}
          lessonProgress={progress}
          setLevel={setFlashcardLevel}
          setMode={setFlashcardMode}
          setSource={setFlashcardSource}
          setVoiceSpeed={setFlashcardVoiceSpeed}
          markKnown={markKnown}
          markAgain={markAgain}
          resetKnownForLevel={resetKnownForLevel}
          onBack={() => setView('home')}
        />
      ) : null}

      {view === 'listening' ? <ListeningPage onBack={() => setView('home')} /> : null}
    </div>
  )
}

export default App
