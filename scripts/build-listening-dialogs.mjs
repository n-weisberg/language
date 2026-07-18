/**
 * Build Listening dialog audio:
 * 1. TTS each line with two fixed ElevenLabs voices
 * 2. Measure durations, stitch with short gaps
 * 3. Write public/listening/*.mp3 + update dialogs.json timestamps
 * 4. Optionally upload to Cloudinary (--upload)
 *
 * Already-uploaded dialogs (present in cloudinary-manifest.json) are skipped
 * unless you pass --force. The app always plays the Cloudinary URL from the
 * manifest — you do not need to rebuild audio for normal deploys.
 *
 * Usage:
 *   node scripts/build-listening-dialogs.mjs
 *   node scripts/build-listening-dialogs.mjs --upload
 *   node scripts/build-listening-dialogs.mjs --upload --force
 *   node scripts/build-listening-dialogs.mjs --dialog=meet-someone
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(rootDir, '.env') })

const dialogsPath = path.join(rootDir, 'src/data/listening/dialogs.json')
const outDir = path.join(rootDir, 'public/listening')
const manifestPath = path.join(rootDir, 'src/data/cloudinary-manifest.json')
const cacheDir = path.join(rootDir, '.cache/listening-tts')

const upload = process.argv.includes('--upload')
const force = process.argv.includes('--force')
const dialogFilter = process.argv.find((a) => a.startsWith('--dialog='))?.split('=')[1]

const GAP_MS = 280

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name} in .env`)
  return value
}

async function listVoices(apiKey) {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  })
  if (!response.ok) throw new Error(`Failed to list voices (${response.status})`)
  const data = await response.json()
  return data.voices ?? []
}

function scoreVoice(voice, want) {
  const hay =
    `${voice.name} ${voice.description ?? ''} ${(voice.labels && Object.values(voice.labels).join(' ')) || ''}`.toLowerCase()
  let points = 0
  if (hay.includes('mexican') || hay.includes('mexico') || hay.includes('méxico')) points += 5
  if (hay.includes('spanish') || hay.includes('español') || hay.includes('espanol')) points += 3
  if (hay.includes('latin')) points += 2
  if (want === 'woman' && (hay.includes('female') || hay.includes('woman') || hay.includes('mujer'))) points += 4
  if (want === 'man' && (hay.includes('male') || hay.includes('man') || hay.includes('hombre'))) points += 4
  return points
}

function pickVoice(voices, want, excludeId) {
  const ranked = voices
    .filter((v) => v.voice_id !== excludeId)
    .map((v) => ({ voice: v, score: scoreVoice(v, want) }))
    .sort((a, b) => b.score - a.score)
  if (!ranked.length) throw new Error(`No voices available for ${want}`)
  return ranked[0].voice
}

async function synthesize({ apiKey, modelId, voiceId, text, cachePath }) {
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

/** Estimate MP3 duration from bitrate header / file size (CBR fallback). */
function estimateMp3DurationSeconds(buffer) {
  // Try to find Xing/Info or use 128kbps assumption common for ElevenLabs
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

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
}

async function uploadToCloudinary(localPath, publicId) {
  const { v2: cloudinary } = await import('cloudinary')
  cloudinary.config({
    cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
    api_key: requireEnv('CLOUDINARY_API_KEY'),
    api_secret: requireEnv('CLOUDINARY_API_SECRET'),
    secure: true,
  })
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    public_id: publicId,
    overwrite: true,
    use_filename: false,
    unique_filename: false,
    timeout: 120000,
  })
  return result.secure_url
}

async function main() {
  const data = JSON.parse(readFileSync(dialogsPath, 'utf8'))
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const selected = dialogFilter ? data.dialogs.filter((d) => d.id === dialogFilter) : data.dialogs
  if (!selected.length) throw new Error(`No dialogs matched filter: ${dialogFilter}`)

  const dialogs = selected.filter((dialog) => {
    const alreadyUploaded = Boolean(manifest[dialog.audioKey])
    if (alreadyUploaded && !force) {
      console.log(`Skipping ${dialog.id} (already in Cloudinary manifest). Use --force to rebuild.`)
      return false
    }
    return true
  })

  if (!dialogs.length) {
    console.log('\nNothing to build — all selected dialogs already have Cloudinary URLs.')
    console.log('App playback uses those URLs from cloudinary-manifest.json.')
    return
  }

  const apiKey = requireEnv('ELEVENLABS_API_KEY')
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2'
  const useFfmpeg = hasFfmpeg()
  if (!useFfmpeg) {
    console.warn('ffmpeg not found — concatenating MP3 buffers without silence gaps (install ffmpeg for better pacing).')
  }

  mkdirSync(outDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })

  console.log('Resolving voices…')
  let voiceA
  let voiceB
  if (data.meta.voices?.a?.id && data.meta.voices?.b?.id) {
    voiceA = { voice_id: data.meta.voices.a.id, name: data.meta.voices.a.name }
    voiceB = { voice_id: data.meta.voices.b.id, name: data.meta.voices.b.name }
    console.log('  Using saved voices from dialogs.json')
  } else {
    const voices = await listVoices(apiKey)
    voiceA = pickVoice(voices, 'woman')
    voiceB = pickVoice(voices, 'man', voiceA.voice_id)
    data.meta.voices = {
      a: { id: voiceA.voice_id, name: voiceA.name },
      b: { id: voiceB.voice_id, name: voiceB.name },
    }
  }
  console.log(`  A (${data.meta.speakers.a.name}): ${voiceA.name} (${voiceA.voice_id})`)
  console.log(`  B (${data.meta.speakers.b.name}): ${voiceB.name} (${voiceB.voice_id})`)

  let silencePath = null
  if (useFfmpeg) {
    silencePath = path.join(cacheDir, `silence-${GAP_MS}ms.mp3`)
    if (force || !existsSync(silencePath)) {
      makeSilenceMp3(GAP_MS / 1000, silencePath)
    }
  }

  for (const dialog of dialogs) {
    console.log(`\nBuilding ${dialog.id}…`)
    const lineFiles = []
    let cursor = 0

    for (const line of dialog.lines) {
      const voice = line.speaker === 'a' ? voiceA : voiceB
      const cachePath = path.join(cacheDir, `${dialog.id}-${line.id}.mp3`)
      const buffer = await synthesize({
        apiKey,
        modelId,
        voiceId: voice.voice_id,
        text: line.es,
        cachePath,
      })

      let duration = probeDurationWithFfprobe(cachePath)
      if (!duration) duration = estimateMp3DurationSeconds(buffer)

      line.start = Number(cursor.toFixed(3))
      line.end = Number((cursor + duration).toFixed(3))
      cursor = line.end + (useFfmpeg ? GAP_MS / 1000 : 0.05)
      lineFiles.push(cachePath)
      console.log(`  ${line.id} [${line.speaker}] ${duration.toFixed(2)}s — ${line.es}`)
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
      const chunks = lineFiles.map((file) => readFileSync(file))
      writeFileSync(outPath, Buffer.concat(chunks))
    }

    const totalDuration = probeDurationWithFfprobe(outPath) ?? cursor
    dialog.duration = Number(totalDuration.toFixed(3))
    console.log(`  → ${outPath} (${dialog.duration}s)`)

    if (upload) {
      const publicId = `language/listening/${dialog.id}`
      const url = await uploadToCloudinary(outPath, publicId)
      manifest[dialog.audioKey] = url
      console.log(`  uploaded ${dialog.audioKey} → ${url}`)
    }
  }

  // Write timestamps back into full dialogs file
  writeFileSync(dialogsPath, `${JSON.stringify(data, null, 2)}\n`)
  if (upload) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  console.log('\nDone.')
  console.log(`Local audio: ${outDir}`)
  if (!upload) console.log('Re-run with --upload to push MP3s to Cloudinary and update the manifest.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
