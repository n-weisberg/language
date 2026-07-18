import dialogsData from './dialogs.json'
import manifest from '../cloudinary-manifest.json'

export const listeningMeta = dialogsData.meta

export function getListeningDialogs() {
  return dialogsData.dialogs.map((dialog) => enrichDialog(dialog))
}

export function getListeningDialog(id) {
  const dialog = dialogsData.dialogs.find((item) => item.id === id)
  return dialog ? enrichDialog(dialog) : null
}

function enrichDialog(dialog) {
  const audioPath = resolveListeningAudio(dialog.audioKey, dialog.id)
  return {
    ...dialog,
    audioPath,
    speakers: listeningMeta.speakers,
  }
}

export function resolveListeningAudio(audioKey, dialogId) {
  if (audioKey && manifest[audioKey]) return manifest[audioKey]
  // Local fallback for pre-upload / offline builds
  return `/listening/${dialogId}.mp3`
}

/** Active lyric line for a playback time (seconds). */
export function getActiveListeningLine(dialog, currentTime) {
  if (!dialog?.lines?.length) return null
  const t = Number(currentTime) || 0
  let active = null
  for (const line of dialog.lines) {
    if (typeof line.start !== 'number') continue
    // Keep highlighting through short inter-line gaps until the next line starts.
    if (t >= line.start) active = line
    else break
  }
  return active
}
