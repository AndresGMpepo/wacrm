import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformOperator } from '@/lib/platform/operator'
import { logSupportAudit, requireSupportSession, supportAdminClient } from '@/lib/platform/support-session'

const RECENT_DAYS = 7

/**
 * GET /api/platform/accounts/[accountId]/support/overview
 *
 * Operational snapshot of a tenant for support: volumes, channel health,
 * queues, AI and automation setup, and the errors its connectors reported.
 *
 * Deliberately excludes message bodies, contact identities and any secret —
 * enough to diagnose "why isn't this working" without reading the customer's
 * conversations. Requires a live support session and is itself audited.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const operator = await requirePlatformOperator()
    const { accountId } = await params
    const db = supportAdminClient()

    const session = await requireSupportSession(db, accountId, operator.user.email)

    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
    const [
      account,
      contacts,
      openConversations,
      recentConversations,
      connectors,
      queues,
      aiConfig,
      automations,
      flows,
      failedReceipts,
      whatsappConfig,
    ] = await Promise.all([
      db.from('accounts').select('id, name, created_at').eq('id', accountId).maybeSingle(),
      db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('deleted_at', null),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'open'),
      db.from('conversations').select('channel_type').eq('account_id', accountId).gte('updated_at', since),
      db
        .from('omnichannel_connectors')
        .select('id, provider, display_name, status, last_event_at, last_error')
        .eq('account_id', accountId)
        .order('provider'),
      db
        .from('conversation_queues')
        .select('id, name, is_default, mode')
        .eq('account_id', accountId)
        .order('name'),
      db
        .from('ai_configs')
        .select('provider, model, is_active, auto_reply_enabled, conversation_analysis_enabled, handoff_target, channel_types, analysis_auto_route_enabled')
        .eq('account_id', accountId)
        .maybeSingle(),
      db.from('automations').select('id, name, trigger_type, is_active, channel_types, execution_count, last_executed_at').eq('account_id', accountId).order('created_at', { ascending: false }).limit(20),
      db.from('flows').select('id, name, is_active').eq('account_id', accountId).limit(20),
      db
        .from('omnichannel_webhook_receipts')
        .select('event_type, detail, received_at')
        .eq('account_id', accountId)
        .eq('outcome', 'failed')
        .order('received_at', { ascending: false })
        .limit(10),
      db.from('whatsapp_config').select('phone_number_id, status, connected_at').eq('account_id', accountId).maybeSingle(),
    ])

    if (!account.data) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 })

    const byChannel: Record<string, number> = {}
    for (const row of recentConversations.data ?? []) {
      const channel = (row.channel_type as string) ?? 'whatsapp'
      byChannel[channel] = (byChannel[channel] ?? 0) + 1
    }

    await logSupportAudit(db, {
      accountId,
      accountName: account.data.name as string,
      actorUserId: operator.user.id,
      action: 'support_overview_viewed',
      details: { session_id: session.id, operator_email: operator.user.email },
    })

    return NextResponse.json({
      session,
      account: account.data,
      totals: {
        contacts: contacts.count ?? 0,
        open_conversations: openConversations.count ?? 0,
        conversations_last_7d: recentConversations.data?.length ?? 0,
      },
      conversations_by_channel: byChannel,
      connectors: connectors.data ?? [],
      queues: queues.data ?? [],
      whatsapp: whatsappConfig.data
        ? {
            phone_number_id: whatsappConfig.data.phone_number_id,
            status: whatsappConfig.data.status,
            connected_at: whatsappConfig.data.connected_at,
          }
        : null,
      ai: aiConfig.data ?? null,
      automations: automations.data ?? [],
      flows: flows.data ?? [],
      recent_errors: failedReceipts.data ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
