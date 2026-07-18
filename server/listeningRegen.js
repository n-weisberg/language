/**
 * Regenerate a single listening dialog line, restitch the full MP3,
 * update timestamps, and replace the Cloudinary asset.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const dialogsPath = path.join(rootDir, 'src/data/listening/dialogs.json')
const outDir = path.join(rootDir, 'public/listening')
const manifestPath = path.join(rootDir, 'src/data/cloudinary-manifest.json')
const cacheDir = path.join(rootDir, '.cache/listening-tts')

const GAP_MS = 280

function requireEnv(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing ${name} in environment`)
  return value
}

function estimateMp3DurationSeconds(buffer) {
  const size = buffer.length
  const bitrate = 128_000
  return size / (bitrate / 8)
}

function probeDurationWithFfprobe(filePath) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8' },
  )
  if (result.status === 0) {
    const value = Number(result.stdout.trim())
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
}

function makeSilenceMp3(durationSec, outPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      String(durationSec),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outPath,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`ffmpeg silence failed: ${result.stderr?.slice(0, 400)}`)
  }
}

function concatWithFfmpeg(inputs, outPath) {
  const listPath = path.join(cacheDir, `${path.basename(outPath)}.concat.txt`)
  writeFileSync(
    listPath,
    inputs.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'),
  )
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${result.stderr?.slice(0, 500)}`)
  }
}

async function synthesize({ apiKey, modelId, voiceId, text, cachePath, force }) {
  if (!force && existsSync(cachePath)) return readFileSync(cachePath)

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true,
        speed: 0.95,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`TTS failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  mkdirSync(path.dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, buffer)
  return buffer
}

async function uploadToCloudinary(env, localPath, publicId) {
  const { v2: cloudinary } = await import('cloudinary')
  cloudinary.config({
    cloud_name: requireEnv(env, 'CLOUDINARY_CLOUD_NAME'),
    api_key: requireEnv(env, 'CLOUDINARY_API_KEY'),
    api_secret: requireEnv(env, 'CLOUDINARY_API_SECRET'),
    secure: true,
  })
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    public_id: publicId,
    overwrite: true,
    invalidate: true,
    use_filename: false,
    unique_filename: false,
    timeout: 120000,
  })
  return result.secure_url
}

/**
 * @param {{ env: Record<string, string>, dialogId: string, lineId: string, upload?: boolean }} opts
 */
export async function regenerateListeningLine({ env, dialogId, lineId, upload = true }) {
  if (!dialogId || !lineId) {
    throw new Error('dialogId and lineId are required')
  }

  const apiKey = requireEnv(env, 'ELEVENLABS_API_KEY')
  const modelId = env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'

  const data = JSON.parse(readFileSync(dialogsPath, 'utf8'))
  const dialog = data.dialogs.find((item) => item.id === dialogId)
  if (!dialog) throw new Error(`Unknown dialog: ${dialogId}`)

  const line = dialog.lines.find((item) => item.id === lineId)
  if (!line) throw new Error(`Unknown line: ${lineId}`)

  const voices = data.meta?.voices
  if (!voices?.a?.id || !voices?.b?.id) {
    throw new Error('dialogs.json is missing meta.voices — run build:listening once first')
  }

  const useFfmpeg = hasFfmpeg()
  mkdirSync(outDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  let silencePath = null
  if (useFfmpeg) {
    silencePath = path.join(cacheDir, `silence-${GAP_MS}ms.mp3`)
    if (!existsSync(silencePath)) {
      makeSilenceMp3(GAP_MS / 1000, silencePath)
    }
  }

  const lineFiles = []
  let cursor = 0

  for (const current of dialog.lines) {
    const voiceId = voices[current.speaker]?.id
    if (!voiceId) throw new Error(`No voice for speaker ${current.speaker}`)

    const cachePath = path.join(cacheDir, `${dialog.id}-${current.id}.mp3`)
    const forceLine = current.id === lineId
    if (forceLine && existsSync(cachePath)) {
      unlinkSync(cachePath)
    }

    const buffer = await synthesize({
      apiKey,
      modelId,
      voiceId,
      text: current.es,
      cachePath,
      force: forceLine,
    })

    let duration = probeDurationWithFfprobe(cachePath)
    if (!duration) duration = estimateMp3DurationSeconds(buffer)

    current.start = Number(cursor.toFixed(3))
    current.end = Number((cursor + duration).toFixed(3))
    cursor = current.end + (useFfmpeg ? GAP_MS / 1000 : 0.05)
    lineFiles.push(cachePath)
  }

  const outPath = path.join(outDir, `${dialog.id}.mp3`)
  if (useFfmpeg) {
    const concatInputs = []
    for (let i = 0; i < lineFiles.length; i += 1) {
      concatInputs.push(lineFiles[i])
      if (i < lineFiles.length - 1 && silencePath) concatInputs.push(silencePath)
    }
    concatWithFfmpeg(concatInputs, outPath)
  } else {
    writeFileSync(outPath, Buffer.concat(lineFiles.map((file) => readFileSync(file))))
  }

  const totalDuration = probeDurationWithFfprobe(outPath) ?? cursor
  dialog.duration = Number(totalDuration.toFixed(3))

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  let audioPath = `/listening/${dialog.id}.mp3`

  if (upload) {
    const publicId = `language/listening/${dialog.id}`
    const url = await uploadToCloudinary(env, outPath, publicId)
    manifest[dialog.audioKey] = url
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    audioPath = url
  } else if (manifest[dialog.audioKey]) {
    audioPath = manifest[dialog.audioKey]
  }

  writeFileSync(dialogsPath, `${JSON.stringify(data, null, 2)}\n`)

  const updatedLine = dialog.lines.find((item) => item.id === lineId)

  return {
    dialog: {
      ...dialog,
      audioPath: `${audioPath}${audioPath.includes('?') ? '&' : '?'}t=${Date.now()}`,
      speakers: data.meta.speakers,
    },
    line: updatedLine,
    audioPath,
  }
}
