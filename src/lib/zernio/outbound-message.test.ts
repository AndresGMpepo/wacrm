import { describe, expect, it, vi } from 'vitest'
import { createClient, PostgrestError } from '@supabase/supabase-js'
import { persistZernioOutbound, zernioOutboundIsHuman } from './outbound-message'

describe('connected outbound attribution', () => {
  it.each(['api', 'broadcast', 'sequence', 'workflow', 'comment_automation', 'bulk-api', null, undefined])(
    'does not attribute %s to a human', (sentVia) => {
      expect(zernioOutboundIsHuman({ sentVia })).toBe(false)
    },
  )
  it('recognizes an operator or an explicit phone-app send', () => {
    expect(zernioOutboundIsHuman({ sentVia: 'human' })).toBe(true)
    expect(zernioOutboundIsHuman({ sentVia: null, source: 'whatsapp_business_app' })).toBe(true)
    expect(zernioOutboundIsHuman({ sentVia: null, source: 'cloud_api' })).toBe(false)
    expect(zernioOutboundIsHuman({ source: 'meta_business_agent' })).toBe(false)
  })
})

const args = {
  accountId: 'account-1', conversationId: 'conversation-1', connectorId: 'connector-1',
  internalId: 'internal-1', platformId: 'wamid-1', local: false,
  message: {
    sender_type: 'bot' as const, sender_id: null,
    content_type: 'text' as const, content_text: 'Hola',
    created_at: '2026-10-04T12:00:00Z',
  },
}

describe('persistZernioOutbound', () => {
  it('keeps internal and platform identity separate and sends tenant scope to the atomic writer', async () => {
    const db = createClient('https://example.supabase.co', 'test-key')
    const rpc = vi.spyOn(db, 'rpc').mockResolvedValue({
      data: { id: 'row-1', ...args.message }, error: null, count: null, status: 200, statusText: 'OK', success: true,
    })
    await expect(persistZernioOutbound(db, args)).resolves.toMatchObject({ id: 'row-1', sender_type: 'bot' })
    expect(rpc).toHaveBeenCalledWith('persist_zernio_outbound_message', {
      p_account_id: args.accountId, p_connector_id: args.connectorId,
      p_conversation_id: args.conversationId, p_internal_id: 'internal-1',
      p_platform_id: 'wamid-1', p_local: false, p_message: args.message,
      p_fallback_id: 'internal-1',
    })
  })

  it.each([true, false])('rejects an unidentified send (local=%s) rather than creating an unmatchable duplicate', async (local) => {
    const db = createClient('https://example.supabase.co', 'test-key')
    const rpc = vi.spyOn(db, 'rpc')
    await expect(persistZernioOutbound(db, { ...args, internalId: null, platformId: null, local })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces persistence failures', async () => {
    const db = createClient('https://example.supabase.co', 'test-key')
    vi.spyOn(db, 'rpc').mockResolvedValue({
      data: null, error: new PostgrestError({ message: 'migration missing', details: '', hint: '', code: '42883' }),
      count: null, status: 400, statusText: 'Bad Request', success: false,
    })
    await expect(persistZernioOutbound(db, args)).rejects.toMatchObject({ code: '42883' })
  })
})
