export const ROMAN = ['I', 'II', 'III', 'IV', 'V']

export const READING_COUNTS = { 1: 15, 2: 16, 3: 20, 4: 20, 5: 20 }
export const UNIT_COUNTS = { 1: 30, 2: 30, 3: 30, 4: 27, 5: 30 }

function pad2(n) {
  return String(n).padStart(2, '0')
}

function unitFilename(level, lessonNum) {
  const roman = ROMAN[level - 1]
  if (level === 5) return `Unit ${lessonNum}.mp3`
  return `Spanish ${roman} - Unit ${pad2(lessonNum)}.mp3`
}

function readingFilename(level, lessonNum) {
  const roman = ROMAN[level - 1]
  if (level <= 3) {
    return {
      folder: 'Reading Lessons',
      file: `Spanish ${roman} - Reading ${pad2(lessonNum)}.mp3`,
    }
  }
  if (level === 4) {
    return {
      folder: 'Reading lessons',
      file: `${30 + lessonNum} - Reading Lesson ${lessonNum}.mp3`,
    }
  }
  return { folder: null, file: `Reading Lesson ${lessonNum}.mp3` }
}

function guideFilename(level) {
  const roman = ROMAN[level - 1]
  if (level === 5) return `User's Guide.mp3`
  return `Spanish ${roman} - User's Guide.mp3`
}

export function lessonKey(levelId, type, lessonNum) {
  return `${levelId}:${type}:${lessonNum}`
}

export function getLocalRelativeParts(levelId, type, lessonNum) {
  const parts = ['levels', String(levelId)]

  if (type === 'unit') {
    parts.push(unitFilename(levelId, lessonNum))
    return parts
  }

  if (type === 'reading') {
    const { folder, file } = readingFilename(levelId, lessonNum)
    if (folder) parts.push(folder)
    parts.push(file)
    return parts
  }

  if (type === 'guide') {
    parts.push(guideFilename(levelId))
    return parts
  }

  throw new Error(`Unknown lesson type: ${type}`)
}

export function getLocalPublicPath(levelId, type, lessonNum) {
  return `/${getLocalRelativeParts(levelId, type, lessonNum)
    .map((part) => encodeURIComponent(part))
    .join('/')}`
}

export function getCloudinaryPublicId(levelId, type, lessonNum) {
  if (type === 'guide') {
    return `language/level-${levelId}/guide/users-guide`
  }

  const folder = type === 'unit' ? 'units' : 'reading'
  const name = type === 'unit' ? `unit-${pad2(lessonNum)}` : `reading-${pad2(lessonNum)}`
  return `language/level-${levelId}/${folder}/${name}`
}

export function getAllAudioAssets() {
  const assets = []

  for (let levelId = 1; levelId <= 5; levelId += 1) {
    for (let lessonNum = 1; lessonNum <= UNIT_COUNTS[levelId]; lessonNum += 1) {
      assets.push({
        key: lessonKey(levelId, 'unit', lessonNum),
        levelId,
        type: 'unit',
        lessonNum,
        publicId: getCloudinaryPublicId(levelId, 'unit', lessonNum),
        localRelativeParts: getLocalRelativeParts(levelId, 'unit', lessonNum),
      })
    }

    for (let lessonNum = 1; lessonNum <= READING_COUNTS[levelId]; lessonNum += 1) {
      assets.push({
        key: lessonKey(levelId, 'reading', lessonNum),
        levelId,
        type: 'reading',
        lessonNum,
        publicId: getCloudinaryPublicId(levelId, 'reading', lessonNum),
        localRelativeParts: getLocalRelativeParts(levelId, 'reading', lessonNum),
      })
    }

    assets.push({
      key: lessonKey(levelId, 'guide', 0),
      levelId,
      type: 'guide',
      lessonNum: 0,
      publicId: getCloudinaryPublicId(levelId, 'guide', 0),
      localRelativeParts: getLocalRelativeParts(levelId, 'guide', 0),
    })
  }

  return assets
}
