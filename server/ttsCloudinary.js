import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const manifestPath = path.join(rootDir, 'src/data/cloudinary-manifest.json')

export function sanitizeTtsCacheKey(cacheKey) {
  return String(cacheKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 180)
}

export function ttsPublicId(cacheKey) {
  const safe = sanitizeTtsCacheKey(cacheKey)
  if (!safe) throw new Error('Invalid TTS cache key')
  return `language/tts/${safe}`
}

export function ttsManifestKey(cacheKey) {
  return `tts:${cacheKey}`
}

function hasCloudinaryConfig(env) {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME?.trim() &&
      env.CLOUDINARY_API_KEY?.trim() &&
      env.CLOUDINARY_API_SECRET?.trim(),
  )
}

async function getCloudinary(env) {
  const { v2: cloudinary } = await import('cloudinary')
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: env.CLOUDINARY_API_KEY.trim(),
    api_secret: env.CLOUDINARY_API_SECRET.trim(),
    secure: true,
  })
  return cloudinary
}

function readManifest() {
  if (!existsSync(manifestPath)) return {}
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return {}
  }
}

function writeManifestEntry(key, url) {
  try {
    const manifest = readManifest()
    if (manifest[key] === url) return
    manifest[key] = url
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (error) {
    // Serverless / read-only FS — Cloudinary remains source of truth.
    console.warn('[tts-cloudinary] Could not update local manifest:', error.message)
  }
}

/**
 * Look up a previously uploaded flashcard TTS clip.
 * @returns {Promise<{ url: string, voiceId: string | null } | null>}
 */
export async function findCachedTts(env, cacheKey) {
  if (!cacheKey || !hasCloudinaryConfig(env)) return null

  const key = ttsManifestKey(cacheKey)
  const manifest = readManifest()
  if (manifest[key]) {
    return { url: manifest[key], voiceId: null }
  }

  try {
    const cloudinary = await getCloudinary(env)
    const publicId = ttsPublicId(cacheKey)
    const resource = await cloudinary.api.resource(publicId, { resource_type: 'video' })
    const url = resource.secure_url
    const voiceId = resource.context?.custom?.voice_id || resource.context?.voice_id || null
    writeManifestEntry(key, url)
    return { url, voiceId }
  } catch (error) {
    // 404 / not found
    if (error?.http_code === 404 || error?.error?.http_code === 404) return null
    console.warn('[tts-cloudinary] lookup failed:', error.message || error)
    return null
  }
}

/**
 * Upload an MP3 buffer to Cloudinary and record it in the local manifest when possible.
 * @returns {Promise<string>} secure URL
 */
export async function uploadTtsClip(env, cacheKey, buffer, voiceId = null) {
  if (!hasCloudinaryConfig(env)) {
    throw new Error('Cloudinary is not configured')
  }

  const cloudinary = await getCloudinary(env)
  const publicId = ttsPublicId(cacheKey)
  const context = voiceId ? `voice_id=${voiceId}` : undefined

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        use_filename: false,
        unique_filename: false,
        format: 'mp3',
        context,
        timeout: 120000,
      },
      (error, uploadResult) => {
        if (error) reject(error)
        else resolve(uploadResult)
      },
    )
    stream.end(buffer)
  })

  const url = result.secure_url
  writeManifestEntry(ttsManifestKey(cacheKey), url)
  return url
}
