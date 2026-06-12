import { useCallback, useEffect, useRef, useState } from 'react'

const SPEEDS = [0.75, 1, 1.25]

export function useAudioPlayer({ src, initialPosition = 0, onPositionChange }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(initialPosition)
  const [speedIndex, setSpeedIndex] = useState(1)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    setPlaying(false)
    setReady(false)
    setDuration(0)
    setCurrentTime(0)
    audio.pause()
    audio.load()
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !ready) return

    if (initialPosition > 0 && Math.abs(audio.currentTime - initialPosition) > 1) {
      audio.currentTime = initialPosition
      setCurrentTime(initialPosition)
    }
  }, [src, ready, initialPosition])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.playbackRate = SPEEDS[speedIndex]
  }, [speedIndex, src])

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      try {
        await audio.play()
        setPlaying(true)
      } catch {
        setPlaying(false)
      }
    } else {
      audio.pause()
      setPlaying(false)
    }
  }, [])

  const seek = useCallback(
    (time) => {
      const audio = audioRef.current
      if (!audio || !duration) return

      const next = Math.max(0, Math.min(time, duration))
      audio.currentTime = next
      setCurrentTime(next)
      onPositionChange?.(next)
    },
    [duration, onPositionChange],
  )

  const skip = useCallback(
    (delta) => {
      seek(currentTime + delta)
    },
    [currentTime, seek],
  )

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((index) => (index + 1) % SPEEDS.length)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => {
      setDuration(audio.duration || 0)
      setReady(true)
    }
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      onPositionChange?.(audio.currentTime)
    }
    const onEnded = () => setPlaying(false)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [src, onPositionChange])

  return {
    audioRef,
    playing,
    duration,
    currentTime,
    ready,
    speed: SPEEDS[speedIndex],
    togglePlay,
    seek,
    skip,
    cycleSpeed,
  }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}
