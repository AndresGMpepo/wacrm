'use client'

import { useCallback, useEffect, useState } from 'react'

/** Lightweight operational counter for the sidebar's "Seguimientos" badge.
 * Sums call no-reply tasks with Nexo Memory's own follow-up queue (overdue
 * commitments, high-risk contacts, stale prospects) since both live under
 * the same nav item. Polling is deliberate: this avoids adding another
 * Realtime publication just for a badge. */
export function usePendingCallTasks() {
  const [count, setCount] = useState(0)
  const load = useCallback(async () => {
    try {
      const [callTasksResponse, memoryResponse] = await Promise.all([
        fetch('/api/telephony/follow-up-tasks', { cache: 'no-store' }),
        fetch('/api/contacts/memory/follow-ups', { cache: 'no-store' }),
      ])
      const callTasksData = await callTasksResponse.json()
      const memoryData = await memoryResponse.json()
      const callTasksCount = callTasksResponse.ok && Array.isArray(callTasksData.tasks) ? callTasksData.tasks.length : 0
      const memoryCount = memoryResponse.ok
        ? (memoryData.overdue_commitments?.length ?? 0) + (memoryData.high_risk_contacts?.length ?? 0) + (memoryData.stale_prospects?.length ?? 0)
        : 0
      setCount(callTasksCount + memoryCount)
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
