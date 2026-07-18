import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Header } from './Header'
import { getActiveListeningLine } from '../data/listening'
import { formatTime, useAudioPlayer } from '../hooks/useAudioPlayer'

const TEXT_MODES = [
  { id: 'es', label: 'Spanish' },
  { id: 'en', label: 'English' },
  { id: 'hidden', label: 'Hidden' },
]

const LONG_PRESS_MS = 480

export function ListeningPlayer({
  dialog,
  initialPosition = 0,
  textMode,
  onTextModeChange,
  onPositionChange,
  onDialogUpdated,
  onBack,
  onPrev,
  onNext,
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
    src: dialog.audioPath,
    initialPosition,
    onPositionChange,
  })

  const activeLine = useMemo(
    () => getActiveListeningLine(dialog, currentTime),
    [dialog, currentTime],
  )
  const activeId = activeLine?.id ?? null
  const lineRefs = useRef({})
  const longPressTimer = useRef(null)
  const longPressTriggered = useRef(false)
  const menuRef = useRef(null)

  const [menu, setMenu] = useState(null)
  const [regeneratingLineId, setRegeneratingLineId] = useState(null)
  const [regenError, setRegenError] = useState(null)

  useEffect(() => {
    if (!activeId) return
    const node = lineRefs.current[activeId]
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeId])

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])

  useEffect(() => {
    if (!menu) return undefined

    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return
      closeMenu()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu, closeMenu])

  const openMenuAt = useCallback((lineId, rect) => {
    setMenu({
      lineId,
      x: Math.min(rect.left + 12, window.innerWidth - 200),
      y: Math.min(rect.bottom + 6, window.innerHeight - 80),
    })
    setRegenError(null)
  }, [])

  const handleLineClick = useCallback(
    (line) => {
      if (longPressTriggered.current) {
        longPressTriggered.current = false
        return
      }
      if (typeof line.start === 'number') seek(line.start)
    },
    [seek],
  )

  const handlePointerDown = useCallback(
    (line, event) => {
      if (event.button !== 0) return
      longPressTriggered.current = false
      clearLongPress()
      const rect = event.currentTarget.getBoundingClientRect()
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true
        openMenuAt(line.id, rect)
      }, LONG_PRESS_MS)
    },
    [clearLongPress, openMenuAt],
  )

  const handleContextMenu = useCallback(
    (line, event) => {
      event.preventDefault()
      clearLongPress()
      longPressTriggered.current = true
      openMenuAt(line.id, event.currentTarget.getBoundingClientRect())
    },
    [clearLongPress, openMenuAt],
  )

  const regenerateLine = useCallback(
    async (lineId) => {
      closeMenu()
      setRegenError(null)
      setRegeneratingLineId(lineId)
      try {
        const response = await fetch('/api/listening/regenerate-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dialogId: dialog.id, lineId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error || `Regeneration failed (${response.status})`)
        }
        onDialogUpdated?.(payload.dialog, payload.line)
      } catch (error) {
        setRegenError(error.message || 'Could not regenerate audio')
      } finally {
        setRegeneratingLineId(null)
      }
    },
    [closeMenu, dialog.id, onDialogUpdated],
  )

  const speakers = dialog.speakers ?? {}
  const busy = Boolean(regeneratingLineId)

  return (
    <div className="page listening-player-page">
      <Header title={dialog.title} subtitle={dialog.situation} onBack={onBack} />

      <div className="lesson-player listening-player">
        <div className="player-meta">
          <div>
            <p className="player-eyebrow">Listening</p>
            <h2>{dialog.title}</h2>
            <p className="player-subtitle">{dialog.situation}</p>
          </div>
        </div>

        <div className="tab-row" role="tablist" aria-label="Transcript language">
          {TEXT_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={textMode === mode.id}
              className={`tab-button ${textMode === mode.id ? 'is-active' : ''}`}
              onClick={() => onTextModeChange(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {textMode !== 'hidden' ? (
          <div className="listening-lyrics" aria-live="polite">
            {dialog.lines.map((line) => {
              const speaker = speakers[line.speaker]?.name ?? line.speaker
              const text = textMode === 'en' ? line.en : line.es
              const isActive = line.id === activeId
              const isRegenerating = regeneratingLineId === line.id
              return (
                <button
                  key={line.id}
                  type="button"
                  ref={(node) => {
                    lineRefs.current[line.id] = node
                  }}
                  className={`listening-line ${isActive ? 'is-active' : ''} ${isRegenerating ? 'is-regenerating' : ''}`}
                  onClick={() => handleLineClick(line)}
                  onPointerDown={(event) => handlePointerDown(line, event)}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onContextMenu={(event) => handleContextMenu(line, event)}
                  disabled={busy && !isRegenerating}
                >
                  <span className="listening-speaker">{speaker}</span>
                  <span className="listening-text">
                    {isRegenerating ? 'Regenerating audio…' : text}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="listening-lyrics listening-lyrics-hidden">
            <p>Transcript hidden — listen carefully.</p>
          </div>
        )}

        {regenError ? <p className="listening-regen-error">{regenError}</p> : null}

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
            aria-label="Dialog progress"
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
            All dialogs
          </button>
          <div className="player-nav-group">
            <button type="button" className="secondary-button" onClick={onPrev} disabled={!onPrev}>
              Previous
            </button>
            <button type="button" className="primary-button" onClick={onNext} disabled={!onNext}>
              Next dialog
            </button>
          </div>
        </div>

        <audio ref={audioRef} src={dialog.audioPath} preload="metadata" />
      </div>

      {menu ? (
        <div
          ref={menuRef}
          className="listening-line-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className="listening-line-menu-item"
            disabled={busy}
            onClick={() => regenerateLine(menu.lineId)}
          >
            Regenerate audio
          </button>
        </div>
      ) : null}
    </div>
  )
}
