import { isSupabaseConfigured, supabase } from './supabase'

const DEFAULT_LESSONS = { lessons: {}, lastLesson: null }

function emptyModeState() {
  return { reviewCount: 0, cards: {}, known: {}, again: {} }
}

function emptyByMode() {
  return {
    'en-es': emptyModeState(),
    'es-en': emptyModeState(),
    listen: emptyModeState(),
  }
}

const DEFAULT_FLASHCARDS = {
  level: 1,
  mode: 'en-es',
  source: 'phrases',
  voiceSpeed: 1,
  byMode: emptyByMode(),
  lastCardId: null,
  scheduleVersion: 0,
}

const saveTimers = new Map()
const pendingPatches = new Map()

export function defaultLessonsProgress() {
  return structuredClone(DEFAULT_LESSONS)
}

export function defaultFlashcardsProgress() {
  return structuredClone(DEFAULT_FLASHCARDS)
}

export function normalizeFlashcardsProgress(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {}
  const mode = ['en-es', 'es-en', 'listen'].includes(parsed.mode) ? parsed.mode : 'en-es'
  const source = ['phrases', 'pimsleur', 'numbers'].includes(parsed.source)
    ? parsed.source
    : 'phrases'
  const voiceSpeed = [0.7, 0.85, 1].includes(parsed.voiceSpeed) ? parsed.voiceSpeed : 1

  let byMode = parsed.byMode
  if (!byMode || typeof byMode !== 'object') {
    byMode = emptyByMode()
    // Keep flat legacy fields so migrateLegacyCardState can seed the active mode
  } else {
    byMode = {
      ...emptyByMode(),
      ...byMode,
    }
  }

  return {
    level: parsed.level ?? 1,
    mode,
    source,
    voiceSpeed,
    byMode,
    // Legacy flat fields retained for one-time migration
    reviewCount: Number.isFinite(parsed.reviewCount) ? parsed.reviewCount : 0,
    cards:
      parsed.cards && typeof parsed.cards === 'object' && !Array.isArray(parsed.cards)
        ? parsed.cards
        : {},
    known: parsed.known ?? {},
    again: parsed.again ?? {},
    lastCardId: parsed.lastCardId ?? null,
    scheduleVersion: Number.isFinite(parsed.scheduleVersion) ? parsed.scheduleVersion : 0,
  }
}

export function normalizeLessonsProgress(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {}
  return {
    lessons: parsed.lessons ?? {},
    lastLesson: parsed.lastLesson ?? null,
  }
}

export async function listProfiles() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createProfile(name) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured')
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Name is required')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ name: trimmed })
    .select('id, name, created_at')
    .single()
  if (profileError) throw profileError

  const { error: progressError } = await supabase.from('progress').insert({
    profile_id: profile.id,
    lessons: DEFAULT_LESSONS,
    flashcards: DEFAULT_FLASHCARDS,
  })
  if (progressError) throw progressError

  return profile
}

export async function loadProgress(profileId) {
  if (!isSupabaseConfigured || !profileId) return null
  const { data, error } = await supabase
    .from('progress')
    .select('lessons, flashcards, updated_at')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    lessons: normalizeLessonsProgress(data.lessons),
    flashcards: normalizeFlashcardsProgress(data.flashcards),
    updatedAt: data.updated_at,
  }
}

async function writeProgressPatch(profileId, patch) {
  if (!isSupabaseConfigured || !profileId) return

  const { data: existing, error: readError } = await supabase
    .from('progress')
    .select('profile_id')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (readError) throw readError

  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await supabase.from('progress').update(payload).eq('profile_id', profileId)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('progress').insert({
    profile_id: profileId,
    lessons: patch.lessons ?? DEFAULT_LESSONS,
    flashcards: patch.flashcards ?? DEFAULT_FLASHCARDS,
    updated_at: payload.updated_at,
  })
  if (error) throw error
}

export function queueProgressSave(profileId, patch) {
  if (!isSupabaseConfigured || !profileId) return

  const current = pendingPatches.get(profileId) ?? {}
  pendingPatches.set(profileId, { ...current, ...patch })

  const existingTimer = saveTimers.get(profileId)
  if (existingTimer) window.clearTimeout(existingTimer)

  const timer = window.setTimeout(() => {
    saveTimers.delete(profileId)
    const nextPatch = pendingPatches.get(profileId)
    pendingPatches.delete(profileId)
    if (!nextPatch) return
    writeProgressPatch(profileId, nextPatch).catch((error) => {
      console.warn('Failed to sync progress to Supabase:', error)
    })
  }, 450)

  saveTimers.set(profileId, timer)
}

export async function flushProgressSave(profileId) {
  if (!isSupabaseConfigured || !profileId) return
  const timer = saveTimers.get(profileId)
  if (timer) {
    window.clearTimeout(timer)
    saveTimers.delete(profileId)
  }
  const nextPatch = pendingPatches.get(profileId)
  pendingPatches.delete(profileId)
  if (!nextPatch) return
  await writeProgressPatch(profileId, nextPatch)
}
