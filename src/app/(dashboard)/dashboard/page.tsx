"use client"

import { useCallback, useEffect, useState } from 'react'
import { DollarSign, MessageSquare, Send, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { MetricCard } from '@/components/dashboard/metric-card'
import { OperationalShortcuts } from '@/components/dashboard/operational-shortcuts'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import { loadActivity, loadMetrics } from '@/lib/dashboard/queries'
import type { ActivityItem, MetricsBundle } from '@/lib/dashboard/types'
import { createClient } from '@/lib/supabase/client'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const { defaultCurrency, canManageMembers } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadToday = useCallback(() => {
    const db = createClient()
    void loadMetrics(db)
      .then(setMetrics)
      .catch((error) => console.error('[dashboard] metrics failed:', error))
      .finally(() => setMetricsLoading(false))
    void loadActivity(db, 50)
      .then(setActivity)
      .catch((error) => console.error('[dashboard] activity failed:', error))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => { loadToday() }, [loadToday])

  return <div className="space-y-5">
    <div>
      <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Operación del día: atiende prioridades, crea acciones y consulta la actividad reciente.</p>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metricsLoading || !metrics ? Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />) : <>
        <MetricCard title={t('activeConversations')} value={metrics.activeConversations.current.toLocaleString()} icon={MessageSquare} delta={{ sign: metrics.activeConversations.previous, label: deltaLabel(metrics.activeConversations.previous, t('newTodayVsYesterday'), t('noChange', { suffix: t('newTodayVsYesterday') })) }} />
        <MetricCard title={t('newContactsToday')} value={metrics.newContactsToday.current.toLocaleString()} icon={UserPlus} delta={{ sign: metrics.newContactsToday.current - metrics.newContactsToday.previous, label: deltaLabel(metrics.newContactsToday.current - metrics.newContactsToday.previous, t('vsYesterday'), t('noChange', { suffix: t('vsYesterday') })) }} />
        <MetricCard title={t('openDealsValue')} value={formatCurrency(metrics.openDealsValue, defaultCurrency)} icon={DollarSign} subtitle={t('openDeals', { count: metrics.openDealsCount })} />
        <MetricCard title={t('messagesSentToday')} value={metrics.messagesSentToday.current.toLocaleString()} icon={Send} delta={{ sign: metrics.messagesSentToday.current - metrics.messagesSentToday.previous, label: deltaLabel(metrics.messagesSentToday.current - metrics.messagesSentToday.previous, t('vsYesterday'), t('noChange', { suffix: t('vsYesterday') })) }} />
      </>}
    </div>

    <OperationalShortcuts canViewReports={canManageMembers} />
    <QuickActions />
    <ActivityFeed items={activity} loading={activityLoading} />
  </div>
}

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  return `${delta > 0 ? '+' : ''}${delta.toLocaleString()} ${suffix}`
}
