'use client'

import { useCallback, useEffect, useState } from 'react'

/** Lightweight operational counter for the sidebar. Polling is deliberate:
 * the task queue is already API-scoped to the current agent and this avoids
 * adding another Realtime publication just for a badge. */
export function usePendingCallTasks() {
  const [count, setCount] = useState(0)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' })
      const data = await response.json()
      if (response.ok) setCount(Array.isArray(data.tasks) ? data.tasks.length : 0)
    } catch {
      // Keep the last known count if the network is briefly unavailable.
    }
  }, [])
  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])
  return count
}
