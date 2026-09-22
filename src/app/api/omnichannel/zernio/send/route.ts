import crypto from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireEntitlement } from '@/lib/account/entitlements'
import { toErrorResponse } from '@/lib/auth/account'
import {
  getMetaCustomerServiceWindow,
  isMetaDirectMessageChannel,
  META_MESSAGING_WINDOW_CLOSED_MESSAGE,
} from '@/lib/omnichannel/messaging-window'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { sendZernioMedia, sendZernioTemplateToConversation, sendZernioText, zernioAttachmentTypeFrom } from '@/lib/zernio/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta la configuración del servidor.')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireEntitlement('social_messaging', 'agent')
    const limit = checkRateLimit(`omnichannel:zernio:send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    const mediaUrl = typeof body?.media_url === 'string' ? body.media_url.trim() : ''
    const messageType = typeof body?.message_type === 'string' ? body.message_type.trim().toLowerCase() : ''
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : undefined
    const isTemplateSend = messageType === 'template'
    const templateName = typeof body?.template_name === 'string' ? body.template_name.trim() : ''
    const templateLanguage = typeof body?.template_language === 'string' ? body.template_language.trim() : 'es_MX'
    const templateMessageParams = body?.template_message_params && typeof body.template_message_params === 'object'
      ? body.template_message_params as { body?: unknown; headerText?: unknown; buttonParams?: unknown }
      : {}
    const templateBodyParams = Array.isArray(templateMessageParams.body)
      ? templateMessageParams.body.filter((v): v is string => typeof v === 'string')
      : []
    const templateHeaderText = typeof templateMessageParams.headerText === 'string' ? templateMessageParams.headerText : undefined

    if (!conversationId) return NextResponse.json({ error: 'Indica una conversación.' }, { status: 400 })
    if (isTemplateSend && !templateName) return NextResponse.json({ error: 'Indica el nombre de la plantilla.' }, { status: 400 })
    if (templateMessageParams.buttonParams && Object.keys(templateMessageParams.buttonParams as object).length > 0) {
      return NextResponse.json(
        { error: 'Las plantillas con variables en los botones aún no están soportadas en este canal — usa solo variables en el encabezado o el cuerpo.' },
        { status: 400 },
      )
    }
    const isMediaSend = Boolean(mediaUrl) && Boolean(messageType) && !isTemplateSend
    if (!isTemplateSend && !isMediaSend && !text) return NextResponse.json({ error: 'Indica un mensaje o un archivo.' }, { status: 400 })
    if (text && text.length > 2_000) return NextResponse.json({ error: 'El mensaje supera el límite de 2,000 caracteres.' }, { status: 400 })

    const db = admin()
    const { data: conversation, error: conversationError } = await db.from('conversations')
      .select('id, connector_id, external_session_id, channel_type, social_comment_id')
      .eq('id', conversationId).eq('account_id', accountId)
      .in('channel_type', ['zernio_whatsapp', 'zernio_facebook', 'zernio_instagram']).maybeSingle()
    if (conversationError) throw conversationError
    if (!conversation?.connector_id || !conversation.external_session_id) {
      return NextResponse.json({ error: 'Esta conversación no tiene un destinatario conectado disponible.' }, { status: 409 })
    }
    if (isMetaDirectMessageChannel(conversation.channel_type, Boolean(conversation.social_comment_id)) && !isTemplateSend) {
      const { data: lastCustomerMessage, error: lastCustomerMessageError } = await db.from('messages')
        .select('created_at').eq('conversation_id', conversation.id).eq('sender_type', 'customer')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (lastCustomerMessageError) throw lastCustomerMessageError
      if (!getMetaCustomerServiceWindow(lastCustomerMessage?.created_at).isOpen) {
        return NextResponse.json(
          { error: META_MESSAGING_WINDOW_CLOSED_MESSAGE, code: 'meta_messaging_window_closed' },
          { status: 409 },
        )
      }
    }
    const { data: connector, error: connectorError } = await db.from('omnichannel_connectors')
      .select('zernio_account_id, status').eq('id', conversation.connector_id).eq('account_id', accountId).maybeSingle()
    if (connectorError) throw connectorError
    if (!connector?.zernio_account_id || connector.status === 'paused') {
      return NextResponse.json({ error: 'Este canal está pausado o requiere reconexión.' }, { status: 409 })
    }

    if (isTemplateSend) {
      // Same status guard as the dashboard's picker (which only ever lists
      // APPROVED rows) — this endpoint is also reachable from automations/
      // MCP with an arbitrary template name, so re-check here too.
      const { data: templateRow, error: templateError } = await db.from('message_templates')
        .select('status').eq('account_id', accountId).eq('connector_id', conversation.connector_id)
        .eq('name', templateName).eq('language', templateLanguage).maybeSingle()
      if (templateError) throw templateError
      if (templateRow && templateRow.status !== 'APPROVED') {
        return NextResponse.json({ error: `La plantilla "${templateName}" no está aprobada (estado: ${templateRow.status}).` }, { status: 400 })
      }
    }

    const externalId = isTemplateSend
      ? await sendZernioTemplateToConversation({
          conversationId: conversation.external_session_id,
          zernioAccountId: connector.zernio_account_id,
          templateName,
          templateLanguage,
          bodyParams: templateBodyParams,
          headerText: templateHeaderText,
        })
      : isMediaSend
        ? await sendZernioMedia(
            conversation.external_session_id,
            connector.zernio_account_id,
            text || undefined,
            mediaUrl,
            zernioAttachmentTypeFrom(messageType),
            filename,
          )
        : await sendZernioText(conversation.external_session_id, connector.zernio_account_id, text)
    const now = new Date().toISOString()
    const contentType = isTemplateSend ? 'template' : isMediaSend ? messageType === 'image' ? 'image' : messageType === 'video' ? 'video' : messageType === 'audio' ? 'audio' : 'document' : 'text'
    const { data: message, error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent', sender_id: userId, content_type: contentType, content_text: text || (filename || 'Archivo'), media_url: isMediaSend ? mediaUrl : null,
      ...(isTemplateSend ? { template_name: templateName } : {}),
      message_id: `zernio:out:${conversation.connector_id}:${externalId ?? crypto.randomUUID()}`,
      platform_message_id: externalId,
      status: 'sent', created_at: now,
    }).select().single()
    if (messageError) throw messageError
    const { error: updateError } = await db.from('conversations').update({
      last_message_text: text, last_message_at: now, updated_at: now,
    }).eq('id', conversation.id).eq('account_id', accountId)
    if (updateError) throw updateError
    return NextResponse.json({ message })
  } catch (error) {
    return toErrorResponse(error)
  }
}
