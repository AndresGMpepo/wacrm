import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { sendOmnichannelText } from '@/lib/omnichannel/outbound-text'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { AiConfig } from './types'
import type { ChannelType } from '@/types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Inbox channel the inbound arrived on. Checked against the agent's
   *  configured channel scope. */
  channelType?: ChannelType
  /** True when an automation already answered this same inbound, so the
   *  customer isn't texted twice. */
  automationReplied?: boolean
}

export interface AutoReplyGateInput {
  accountId: string
  conversationId: string
  channelType?: ChannelType
  automationReplied?: boolean
}

export type AutoReplyGateResult =
  | {
      ok: true
      config: AiConfig
      conv: { assigned_agent_id: string | null; ai_reply_count: number }
    }
  | { ok: false; reason: string }

/**
 * Every reason the agent may stay silent, in one place, so the inbox can
 * explain it and the dispatch can log it. "The AI never answers" used to be
 * undiagnosable — each gate simply returned.
 */
export async function evaluateAutoReplyGates(
  db: ReturnType<typeof supabaseAdmin>,
  input: AutoReplyGateInput,
): Promise<AutoReplyGateResult> {
  const { accountId, conversationId } = input

  const config = await loadAiConfig(db, accountId)
  if (!config) return { ok: false, reason: 'ai_inactive' }
  if (!config.autoReplyEnabled) return { ok: false, reason: 'auto_reply_disabled' }

  // Channel scope: an account can let the agent answer everywhere (null)
  // or only on the channels it was trained for.
  if (
    config.channelTypes &&
    config.channelTypes.length > 0 &&
    (!input.channelType || !config.channelTypes.includes(input.channelType))
  ) {
    return { ok: false, reason: `channel_out_of_scope:${input.channelType ?? 'unknown'}` }
  }

  // Deterministic, user-configured responders win over the LLM — the
  // caller already excludes messages a Flow consumed. When the caller
  // knows whether a message-level automation actually ran for THIS
  // inbound (every inbound webhook does), we trust that; otherwise we
  // fall back to the conservative "account has some active
  // auto-responder" check.
  if (input.automationReplied) return { ok: false, reason: 'automation_replied' }
  if (input.automationReplied === undefined) {
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) {
      return { ok: false, reason: 'account_has_active_auto_responder' }
    }
  }

  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
    .eq('id', conversationId)
    .maybeSingle()
  if (convErr || !conv) return { ok: false, reason: 'conversation_not_found' }
  if (conv.ai_autoreply_disabled) return { ok: false, reason: 'paused_on_this_conversation' }

  // "A human owns this thread" must mean a person actually wrote in it, not
  // merely that routing put a name on it: queue auto-assignment stamps an
  // assignee on every inbound, which silenced the agent account-wide.
  const { count: humanMessages } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .not('sender_id', 'is', null)
  if ((humanMessages ?? 0) > 0) return { ok: false, reason: 'human_agent_already_replied' }

  // Cheap early-out; the authoritative cap check is the atomic claim in the
  // dispatch (this read can race a concurrent inbound).
  if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
    return {
      ok: false,
      reason: `reply_cap_reached:${conv.ai_reply_count}/${config.autoReplyMaxPerConversation}`,
    }
  }

  return {
    ok: true,
    config,
    conv: { assigned_agent_id: conv.assigned_agent_id, ai_reply_count: conv.ai_reply_count },
  }
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const gate = await evaluateAutoReplyGates(db, {
      accountId,
      conversationId,
      channelType: args.channelType,
      automationReplied: args.automationReplied,
    })
    if (!gate.ok) {
      console.info(
        `[ai auto-reply] skipped conversation ${conversationId}: ${gate.reason}`,
      )
      return
    }
    const { config, conv } = gate

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const routableQueues =
      config.handoffTarget === 'ai_queue' ? await loadQueues(db, accountId) : []

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      handoffQueues: routableQueues.map((q) => q.name),
    })

    const { text, handoff, handoffQueue, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }

      // Never stomp an existing human assignment.
      const queueId =
        config.handoffTarget === 'ai_queue'
          ? matchQueueId(routableQueues, handoffQueue) ?? config.handoffQueueId ?? null
          : config.handoffTarget === 'queue'
            ? config.handoffQueueId ?? null
            : null

      // The gates above already established no human has written here, so a
      // routing-time assignee may be replaced by the configured target.
      if (queueId) {
        update.queue_id = queueId
        update.assigned_agent_id = null
      } else if ((config.handoffTarget ?? 'agent') === 'agent' && config.handoffAgentId) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // Let the queue's own rules (round-robin / fewest open chats,
      // restricted to its members) pick the human.
      if (queueId) {
        const { error: assignErr } = await db.rpc('auto_assign_inbound_conversation', {
          p_account_id: accountId,
          p_conversation_id: conversationId,
        })
        if (assignErr) {
          console.error('[ai auto-reply] queue assignment failed:', assignErr.message)
        }
      }
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    if (args.channelType && args.channelType !== 'whatsapp') {
      await sendOmnichannelText(db, {
        accountId,
        conversationId,
        text,
        senderType: 'bot',
      })
      return
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

async function loadQueues(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('conversation_queues')
    .select('id, name')
    .eq('account_id', accountId)
    .order('name')
  if (error) {
    console.error('[ai auto-reply] could not load queues:', error.message)
    return []
  }
  return (data ?? []) as { id: string; name: string }[]
}

/** Match the department the model named against the account's queues,
 *  case- and accent-insensitively. */
function matchQueueId(
  queues: { id: string; name: string }[],
  named: string | null,
): string | null {
  if (!named) return null
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase()
  const target = normalize(named)
  return queues.find((q) => normalize(q.name) === target)?.id ?? null
}
