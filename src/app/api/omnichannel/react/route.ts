import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { addZernioReaction, extractZernioPlatformMessageId, removeZernioReaction, resolveZernioPlatformMessageId } from '@/lib/zernio/server';

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase server configuration')
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(`omnichannel:react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const messageId = typeof body.message_id === 'string' ? body.message_id : '';
    const emoji = typeof body.emoji === 'string' ? body.emoji : '';

    if (!messageId) {
      return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
    }

    const db = admin();
    const { data: targetMessage, error: msgError } = await db
      .from('messages')
      .select('id, message_id, platform_message_id, conversation_id, content_type, media_url')
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('id, account_id, connector_id, channel_type, external_session_id, contact:contacts(phone)')
      .eq('id', targetMessage.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;

    if (!targetMessage.message_id) {
      return NextResponse.json({ error: 'Cannot react to a message that has not been sent through the connected channel.' }, { status: 400 });
    }

    let externalRecipient: string | null = null;
    let accessToken: string | null = null;
    let phoneNumberId: string | null = null;
    const isZernio = conversation.channel_type?.startsWith('zernio_') ?? false;

    if (isZernio) {
      const { data: connector, error: connectorError } = await db
        .from('omnichannel_connectors')
        .select('zernio_account_id, status')
        .eq('id', conversation.connector_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (connectorError || !connector) {
        return NextResponse.json({ error: 'Zernio channel configuration not found' }, { status: 400 });
      }
      if (!connector.zernio_account_id || connector.status === 'paused') {
        return NextResponse.json({ error: 'Zernio channel is paused or missing an account' }, { status: 409 });
      }
      externalRecipient = conversation.external_session_id ?? null;
      accessToken = connector.zernio_account_id;
      phoneNumberId = connector.zernio_account_id;
    } else if (conversation.channel_type === 'facebook' || conversation.channel_type === 'instagram') {
      const { data: connector, error: connectorError } = await db
        .from('omnichannel_connectors')
        .select('provider, external_channel_id, meta_access_token, status')
        .eq('id', conversation.connector_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (connectorError || !connector) {
        return NextResponse.json({ error: 'Meta channel configuration not found' }, { status: 400 });
      }
      if (!connector.meta_access_token || connector.status === 'paused') {
        return NextResponse.json({ error: 'Meta channel is paused or missing a token' }, { status: 409 });
      }
      accessToken = decrypt(connector.meta_access_token);
      externalRecipient = connector.external_channel_id ?? conversation.external_session_id ?? null;
      phoneNumberId = connector.external_channel_id ?? null;
    } else {
      if (!contact?.phone) {
        return NextResponse.json({ error: 'Contact phone number not found' }, { status: 400 });
      }
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('phone_number_id, access_token')
        .eq('account_id', accountId)
        .single();

      if (configError || !config) {
        return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 });
      }
      accessToken = decrypt(config.access_token);
      phoneNumberId = config.phone_number_id;
      externalRecipient = sanitizePhoneForMeta(contact.phone);
    }

    if (!isZernio && (!accessToken || !phoneNumberId || !externalRecipient)) {
      return NextResponse.json({ error: 'The connected channel is not ready to receive reactions.' }, { status: 400 });
    }

    try {
      if (isZernio) {
        let platformMessageId = targetMessage.platform_message_id ?? extractZernioPlatformMessageId(targetMessage.message_id);
        if (!platformMessageId || !conversation.external_session_id) {
          throw new Error('This Zernio message does not have a platform message id available for reactions.');
        }
        if (!targetMessage.platform_message_id) {
          const storedMessageId = targetMessage.message_id?.replace(/^zernio:(?:out:)?[^:]+:/, '') ?? '';
          const resolvedPlatformId = await resolveZernioPlatformMessageId(
            conversation.external_session_id,
            accessToken ?? '',
            storedMessageId,
          );
          if (resolvedPlatformId) platformMessageId = resolvedPlatformId;
        }
        if (emoji === '') {
          await removeZernioReaction(conversation.external_session_id, platformMessageId, accessToken ?? '');
        } else {
          const success = await addZernioReaction(conversation.external_session_id, platformMessageId, accessToken ?? '', emoji);
          if (!success) {
            throw new Error('Zernio rejected the reaction request.');
          }
        }
      } else if (conversation.channel_type === 'facebook' || conversation.channel_type === 'instagram') {
        const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(targetMessage.message_id)}/reactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ reaction: emoji ? emoji : 'angry', action: emoji ? 'react' : 'unreact' }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const detail = payload?.error?.message || `HTTP ${response.status}`;
          throw new Error(detail);
        }
      } else {
        if (!phoneNumberId || !externalRecipient) {
          return NextResponse.json({ error: 'The WhatsApp channel is not ready to receive reactions.' }, { status: 400 });
        }
        const resolvedAccessToken = accessToken ?? '';
        if (!resolvedAccessToken || !phoneNumberId || !externalRecipient) {
          return NextResponse.json({ error: 'The WhatsApp channel is not ready to receive reactions.' }, { status: 400 });
        }
        await sendReactionMessage({
          phoneNumberId,
          accessToken: resolvedAccessToken,
          to: externalRecipient,
          targetMessageId: targetMessage.message_id,
          emoji,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown channel error';
      console.error('[omnichannel/react] send failed:', message);
      return NextResponse.json({ error: `Channel reaction error: ${message}` }, { status: 502 });
    }

    if (emoji === '') {
      const { error: delError } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', targetMessage.id)
        .eq('actor_type', 'agent')
        .eq('actor_id', userId);

      if (delError) {
        console.error('[omnichannel/react] DB delete failed:', delError.message);
        return NextResponse.json({ error: 'Reaction sent to channel but DB delete failed' }, { status: 500 });
      }
    } else {
      const { error: upsertError } = await supabase.from('message_reactions').upsert(
        {
          message_id: targetMessage.id,
          conversation_id: targetMessage.conversation_id,
          actor_type: 'agent',
          actor_id: userId,
          emoji,
        },
        { onConflict: 'message_id,actor_type,actor_id' },
      );

      if (upsertError) {
        console.error('[omnichannel/react] DB upsert failed:', upsertError.message);
        return NextResponse.json({ error: 'Reaction sent to channel but DB upsert failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in omnichannel react POST:', error);
    return toErrorResponse(error);
  }
}
