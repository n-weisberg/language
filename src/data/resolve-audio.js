import manifest from './cloudinary-manifest.json'
import { lessonKey } from './audio-paths.js'

export function resolveAudioPath(levelId, type, lessonNum) {
  const key = lessonKey(levelId, type, lessonNum)
  return manifest[key] ?? null
}
