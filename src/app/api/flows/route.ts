import { NextResponse } from 'next/server'
import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { getFlowTemplate } from '@/lib/flows/templates'

/**
 * GET /api/flows: list the caller's account flows.
 * POST /api/flows: create a new draft flow.
 *
 * Every active plan includes Flows by default. The entitlement remains
 * server-enforced so a commercial override can disable it safely.
 */
export async function GET() {
  let ctx
  try {
    ctx = await requireEntitlement('automation_flows')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data, error } = await ctx.supabase
    .from('flows')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flows: data ?? [] })
}

export async function POST(request: Request) {
  // The service-role client below bypasses RLS. Keep the same admin
  // boundary in this route and in the database policy migration.
  let ctx
  try {
    ctx = await requireEntitlement('automation_flows', 'admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { userId, accountId } = ctx

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string
        description?: string | null
        trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config?: Record<string, unknown>
        /** Clone a static template into a fresh account-owned draft. */
        template_slug?: string
      }
    | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug)
    if (!template) {
      return NextResponse.json({ error: `Unknown template_slug "${body.template_slug}"` }, { status: 400 })
    }
    const { data: flow, error: flowErr } = await admin
      .from('flows')
      .insert({
        user_id: userId,
        account_id: accountId,
        name: body.name?.trim() || template.name,
        description: template.description,
        status: 'draft',
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        entry_node_id: template.entry_node_id,
      })
      .select()
      .single()
    if (flowErr || !flow) {
      return NextResponse.json({ error: flowErr?.message ?? 'flow insert failed' }, { status: 500 })
    }
    if (template.nodes.length > 0) {
      const { error: nodesErr } = await admin.from('flow_nodes').insert(
        template.nodes.map((node) => ({
          flow_id: flow.id,
          node_key: node.node_key,
          node_type: node.node_type,
          config: node.config,
        })),
      )
      if (nodesErr) {
        // Avoid a half-cloned draft when its graph cannot be persisted.
        await admin.from('flows').delete().eq('id', flow.id)
        return NextResponse.json({ error: nodesErr.message }, { status: 500 })
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const { data, error } = await admin
    .from('flows')
    .insert({
      user_id: userId,
      account_id: accountId,
      name: body.name.trim(),
      description: body.description ?? null,
      status: 'draft',
      trigger_type: body.trigger_type ?? 'keyword',
      trigger_config: body.trigger_config ?? {},
    })
    .select()
    .single()
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  }
  return NextResponse.json({ flow: data }, { status: 201 })
}
