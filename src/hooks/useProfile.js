import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { createProfile, listProfiles } from '../lib/progressSync'

const PROFILE_KEY = 'pimsleur-profile-id'

function readStoredProfileId() {
  try {
    return localStorage.getItem(PROFILE_KEY)
  } catch {
    return null
  }
}

export function useProfile() {
  const [profileId, setProfileId] = useState(readStoredProfileId)
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  const refreshProfiles = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setProfiles([])
      setLoading(false)
      return []
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await listProfiles()
      setProfiles(rows)
      if (profileId && !rows.some((row) => row.id === profileId)) {
        localStorage.removeItem(PROFILE_KEY)
        setProfileId(null)
      }
      return rows
    } catch (err) {
      setError(err.message || 'Could not load profiles')
      return []
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    refreshProfiles()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const selectProfile = useCallback((id) => {
    localStorage.setItem(PROFILE_KEY, id)
    setProfileId(id)
  }, [])

  const addProfile = useCallback(
    async (name) => {
      const profile = await createProfile(name)
      setProfiles((current) => [...current, profile])
      selectProfile(profile.id)
      return profile
    },
    [selectProfile],
  )

  const clearProfile = useCallback(() => {
    localStorage.removeItem(PROFILE_KEY)
    setProfileId(null)
  }, [])

  const activeProfile = profiles.find((row) => row.id === profileId) ?? null

  return {
    configured: isSupabaseConfigured,
    profileId,
    activeProfile,
    profiles,
    loading,
    error,
    selectProfile,
    addProfile,
    clearProfile,
    refreshProfiles,
  }
}
