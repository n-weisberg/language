import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { v2 as cloudinary } from 'cloudinary'
import dotenv from 'dotenv'
import { getAllAudioAssets } from '../src/data/audio-paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const manifestPath = path.join(rootDir, 'src/data/cloudinary-manifest.json')
const publicDir = path.join(rootDir, 'public')

// Cloudinary Upload API has no hourly rate cap, but account concurrency is limited.
// Docs recommend ~10 parallel uploads; HTTP 420 means slow down and retry.
// https://cloudinary.com/documentation/upload_images#parallel_uploads_and_rate_limiting
const DEFAULT_CONCURRENCY = 10
const MAX_RETRIES = 6

dotenv.config({ path: path.join(rootDir, '.env') })

const forceUpload = process.argv.includes('--force')
const dryRun = process.argv.includes('--dry-run')
const concurrency = parseConcurrency()

function parseConcurrency() {
  const arg = process.argv.find((value) => value.startsWith('--concurrency='))
  if (arg) {
    const parsed = Number(arg.split('=')[1])
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }

  const fromEnv = Number(process.env.UPLOAD_CONCURRENCY)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)

  return DEFAULT_CONCURRENCY
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env (see .env.example).`)
  }
  return value
}

cloudinary.config({
  cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
  api_key: requireEnv('CLOUDINARY_API_KEY'),
  api_secret: requireEnv('CLOUDINARY_API_SECRET'),
  secure: true,
})

function readManifest() {
  if (!existsSync(manifestPath)) return {}
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

function localFilePath(asset) {
  return path.join(publicDir, ...asset.localRelativeParts)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimited(error) {
  return error?.http_code === 420 || error?.error?.http_code === 420
}

class ManifestStore {
  constructor(initialManifest) {
    this.manifest = initialManifest
    this.writeChain = Promise.resolve()
  }

  has(key) {
    return Boolean(this.manifest[key])
  }

  set(key, url) {
    this.manifest[key] = url
    this.writeChain = this.writeChain.then(() => {
      writeFileSync(manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`)
    })
    return this.writeChain
  }

  flush() {
    return this.writeChain
  }
}

async function uploadAsset(asset) {
  const filePath = localFilePath(asset)

  if (!existsSync(filePath)) {
    throw new Error(`Missing local file: ${filePath}`)
  }

  if (dryRun) {
    return {
      secure_url: `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${asset.publicId}.mp3`,
      public_id: asset.publicId,
      dryRun: true,
    }
  }

  return cloudinary.uploader.upload(filePath, {
    resource_type: 'video',
    public_id: asset.publicId,
    overwrite: forceUpload,
    use_filename: false,
    unique_filename: false,
    timeout: 120000,
  })
}

async function uploadWithRetry(asset, onRetry) {
  let attempt = 0

  while (true) {
    try {
      return await uploadAsset(asset)
    } catch (error) {
      if (!isRateLimited(error) || attempt >= MAX_RETRIES) throw error

      attempt += 1
      const delay = Math.min(1000 * 2 ** attempt, 30000)
      onRetry(attempt, delay, error.message)
      await sleep(delay)
    }
  }
}

async function runWorkerQueue(items, workerCount, worker) {
  const queue = [...items]
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) break
      await worker(item)
    }
  })

  await Promise.all(workers)
}

async function main() {
  const manifestStore = new ManifestStore(readManifest())
  const assets = getAllAudioAssets()

  const pending = assets.filter((asset) => {
    if (!existsSync(localFilePath(asset))) return true
    return forceUpload || !manifestStore.has(asset.key)
  })

  const missing = pending.filter((asset) => !existsSync(localFilePath(asset)))
  const toUpload = pending.filter((asset) => existsSync(localFilePath(asset)))
  const skipped = assets.length - pending.length

  let uploaded = 0
  let failed = 0
  let completed = 0
  const total = toUpload.length

  console.log(`Found ${assets.length} audio files.`)
  console.log(`Concurrency: ${concurrency} (Cloudinary recommends starting at ~10)`)
  if (dryRun) console.log('Dry run only — no uploads will be sent.')
  if (forceUpload) console.log('Force mode — existing Cloudinary assets will be overwritten.')
  console.log(`Uploading ${total}, skipping ${skipped}, missing ${missing.length}.`)

  for (const asset of missing) {
    failed += 1
    console.error(`[missing] ${asset.key} — ${localFilePath(asset)}`)
  }

  const startedAt = Date.now()

  await runWorkerQueue(toUpload, concurrency, async (asset) => {
    const label = asset.key

    if (manifestStore.has(asset.key) && !forceUpload) {
      completed += 1
      return
    }

    try {
      const result = await uploadWithRetry(asset, (attempt, delay, message) => {
        console.warn(
          `[420 retry ${attempt}/${MAX_RETRIES}] ${label} in ${delay}ms — ${message}`,
        )
      })

      if (!dryRun) {
        await manifestStore.set(asset.key, result.secure_url)
      }

      uploaded += 1
      completed += 1
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
      console.log(`[${completed}/${total}] ${label} done (${elapsed}s elapsed)`)
    } catch (error) {
      failed += 1
      completed += 1
      console.error(`[${completed}/${total}] ${label} FAILED — ${error.message}`)
    }
  })

  await manifestStore.flush()

  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1)

  console.log('\nUpload summary')
  console.log(`  uploaded: ${uploaded}`)
  console.log(`  skipped:  ${skipped}`)
  console.log(`  failed:   ${failed}`)
  console.log(`  elapsed:  ${minutes} min`)
  console.log(`  manifest: ${manifestPath}`)

  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
