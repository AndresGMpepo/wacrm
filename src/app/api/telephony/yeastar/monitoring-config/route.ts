import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt } from '@/lib/whatsapp/encryption'
import { toErrorResponse } from '@/lib/auth/account'
import { requireEntitlement } from '@/lib/account/entitlements'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function webhookUrl(request: Request, accountId: string) {
  // Generate the PBX callback from the current deployment origin so a stale
  // public build variable cannot point Yeastar back to a retired environment.
  return `${new URL(request.url).origin}/api/telephony/yeastar/events/${accountId}`
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireEntitlement('yeastar_telephony', 'admin')
    const db = admin()
    const { data, error } = await db.from('yeastar_monitoring_configs')
      .select('api_client_id, api_client_secret, webhook_secret')
      .eq('account_id', accountId).maybeSingle()
    if (error) throw error
    const { data: receipts, error: receiptError } = await db.from('yeastar_webhook_event_receipts')
      .select('event_type, call_id, outcome, detail, received_at').eq('account_id', accountId)
      .order('received_at', { ascending: false }).limit(5)
    if (receiptError) throw receiptError
    return NextResponse.json({
      webhookUrl: webhookUrl(request, accountId),
      config: {
        webhookConfigured: Boolean(data?.webhook_secret),
        apiConfigured: Boolean(data?.api_client_id && data?.api_client_secret),
      },
      receipts: receipts ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('yeastar_telephony', 'admin')
    const body = await request.json().catch(() => null)
    const current = await admin().from('yeastar_monitoring_configs')
      .select('api_client_id, api_client_secret, webhook_secret')
      .eq('account_id', accountId).maybeSingle()
    if (current.error) throw current.error
    const clientId = typeof body?.clientId === 'string' && body.clientId.trim()
      ? encrypt(body.clientId.trim()) : current.data?.api_client_id ?? null
    const clientSecret = typeof body?.clientSecret === 'string' && body.clientSecret
      ? encrypt(body.clientSecret) : current.data?.api_client_secret ?? null
    const webhookSecret = typeof body?.webhookSecret === 'string' && body.webhookSecret
      ? encrypt(body.webhookSecret) : current.data?.webhook_secret ?? null
    if (!webhookSecret) {
      return NextResponse.json({ error: 'El secreto del webhook de Yeastar es obligatorio.' }, { status: 400 })
    }
    const { error } = await admin().from('yeastar_monitoring_configs').upsert({
      account_id: accountId,
      api_client_id: clientId,
      api_client_secret: clientSecret,
      webhook_secret: webhookSecret,
      created_by: userId,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
