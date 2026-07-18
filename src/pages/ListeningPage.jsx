import { useCallback, useMemo, useState } from 'react'
import { Header } from '../components/Header'
import { ListeningPlayer } from '../components/ListeningPlayer'
import { formatTime } from '../hooks/useAudioPlayer'
import { getListeningDialog, getListeningDialogs } from '../data/listening'

const TEXT_MODE_KEY = 'pimsleur-listening-text-mode'
const POSITION_KEY = 'pimsleur-listening-positions'

function readTextMode() {
  try {
    const value = localStorage.getItem(TEXT_MODE_KEY)
    if (value === 'es' || value === 'en' || value === 'hidden') return value
  } catch {
    /* ignore */
  }
  return 'es'
}

function readPositions() {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePositions(positions) {
  localStorage.setItem(POSITION_KEY, JSON.stringify(positions))
}

export function ListeningPage({ onBack }) {
  const baseDialogs = useMemo(() => getListeningDialogs(), [])
  const [dialogOverrides, setDialogOverrides] = useState({})
  const [activeId, setActiveId] = useState(null)
  const [textMode, setTextMode] = useState(readTextMode)
  const [positions, setPositions] = useState(readPositions)

  const dialogs = useMemo(
    () => baseDialogs.map((dialog) => dialogOverrides[dialog.id] ?? dialog),
    [baseDialogs, dialogOverrides],
  )

  const activeDialog = activeId
    ? dialogOverrides[activeId] ?? getListeningDialog(activeId)
    : null
  const activeIndex = dialogs.findIndex((dialog) => dialog.id === activeId)

  const handleTextModeChange = useCallback((mode) => {
    setTextMode(mode)
    localStorage.setItem(TEXT_MODE_KEY, mode)
  }, [])

  const handlePositionChange = useCallback((position) => {
    if (!activeId) return
    setPositions((current) => {
      const next = { ...current, [activeId]: position }
      writePositions(next)
      return next
    })
  }, [activeId])

  const openDialog = useCallback((id) => {
    setActiveId(id)
  }, [])

  const closeDialog = useCallback(() => {
    setActiveId(null)
  }, [])

  const goPrev = useCallback(() => {
    if (activeIndex <= 0) return
    setActiveId(dialogs[activeIndex - 1].id)
  }, [activeIndex, dialogs])

  const goNext = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= dialogs.length - 1) return
    setActiveId(dialogs[activeIndex + 1].id)
  }, [activeIndex, dialogs])

  const handleDialogUpdated = useCallback((dialog, line) => {
    if (!dialog?.id) return
    setDialogOverrides((current) => ({ ...current, [dialog.id]: dialog }))
    setPositions((current) => {
      const nextStart =
        typeof line?.start === 'number' ? line.start : current[dialog.id] ?? 0
      const next = { ...current, [dialog.id]: nextStart }
      writePositions(next)
      return next
    })
  }, [])

  if (activeDialog) {
    return (
      <ListeningPlayer
        dialog={activeDialog}
        initialPosition={positions[activeDialog.id] ?? 0}
        textMode={textMode}
        onTextModeChange={handleTextModeChange}
        onPositionChange={handlePositionChange}
        onDialogUpdated={handleDialogUpdated}
        onBack={closeDialog}
        onPrev={activeIndex > 0 ? goPrev : null}
        onNext={activeIndex >= 0 && activeIndex < dialogs.length - 1 ? goNext : null}
      />
    )
  }

  return (
    <div className="page listening-page">
      <Header title="Listening" subtitle="Level 1 dialogs" onBack={onBack} />

      <section className="level-intro">
        <p>
          Short two-person conversations using vocabulary from Pimsleur Level 1. Follow along like
          lyrics, switch to English, or hide the text and just listen.
        </p>
      </section>

      <div className="listening-grid">
        {dialogs.map((dialog, index) => {
          const hasAudio = Boolean(dialog.audioPath)
          const durationLabel =
            dialog.duration > 0 ? formatTime(dialog.duration) : hasAudio ? 'Audio ready' : 'Audio pending'
          return (
            <button
              key={dialog.id}
              type="button"
              className="listening-card"
              onClick={() => openDialog(dialog.id)}
            >
              <span className="listening-card-index">{index + 1}</span>
              <span className="listening-card-body">
                <strong>{dialog.title}</strong>
                <span>{dialog.situation}</span>
              </span>
              <span className="listening-card-meta">{durationLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
