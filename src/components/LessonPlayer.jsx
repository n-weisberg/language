import { useCallback, useEffect } from 'react'
import { formatTime, useAudioPlayer } from '../hooks/useAudioPlayer'

export function LessonPlayer({
  lesson,
  level,
  initialPosition,
  onPositionChange,
  onComplete,
  onPrev,
  onNext,
  onBack,
  isComplete,
}) {
  const {
    audioRef,
    playing,
    duration,
    currentTime,
    ready,
    speed,
    togglePlay,
    seek,
    skip,
    cycleSpeed,
  } = useAudioPlayer({
    src: lesson.audioPath,
    initialPosition,
    onPositionChange,
  })

  const handleEnded = useCallback(() => {
    onComplete(true)
  }, [onComplete])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [audioRef, handleEnded, lesson.audioPath])

  return (
    <div className="lesson-player">
      <div className="player-visual">
        <div className="player-ring">
          <button
            type="button"
            className="play-button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause lesson' : 'Play lesson'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
        </div>
        <p className="player-hint">Listen, pause, and repeat aloud — just like Pimsleur.</p>
      </div>

      <div className="player-meta">
        <div>
          <p className="player-eyebrow">{level.subtitle}</p>
          <h2>{lesson.title}</h2>
          <p className="player-subtitle">{lesson.subtitle}</p>
        </div>
        <button
          type="button"
          className={`complete-toggle ${isComplete ? 'is-complete' : ''}`}
          onClick={() => onComplete(!isComplete)}
        >
          {isComplete ? 'Completed ✓' : 'Mark complete'}
        </button>
      </div>

      <div className="player-controls">
        <div className="time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{ready ? formatTime(duration) : '--:--'}</span>
        </div>
        <input
          type="range"
          className="scrubber"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Lesson progress"
        />
        <div className="control-row">
          <button type="button" className="control-button" onClick={() => skip(-15)}>
            −15s
          </button>
          <button type="button" className="control-button" onClick={togglePlay}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="control-button" onClick={() => skip(15)}>
            +15s
          </button>
          <button type="button" className="control-button" onClick={cycleSpeed}>
            {speed}x
          </button>
        </div>
      </div>

      <div className="player-nav">
        <button type="button" className="secondary-button" onClick={onBack}>
          All lessons
        </button>
        <div className="player-nav-group">
          <button type="button" className="secondary-button" onClick={onPrev} disabled={!onPrev}>
            Previous
          </button>
          <button type="button" className="primary-button" onClick={onNext} disabled={!onNext}>
            Next lesson
          </button>
        </div>
      </div>

      <audio ref={audioRef} src={lesson.audioPath} preload="metadata" />
    </div>
  )
}
