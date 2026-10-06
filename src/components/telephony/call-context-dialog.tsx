'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, Loader2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CallContext } from '@/lib/telephony/call-context'

function channelTranslationKey(channel: string): string {
  switch (channel) {
    case 'whatsapp':
    case 'zernio_whatsapp': return 'channelWhatsapp'
    case 'facebook':
    case 'zernio_facebook': return 'channelFacebook'
    case 'instagram':
    case 'zernio_instagram': return 'channelInstagram'
    case 'tiktok': return 'channelTikTok'
    case 'yeastar_live_chat': return 'channelWebChat'
    case 'call_inbound': return 'channelIncomingCall'
    case 'call_outbound': return 'channelOutgoingCall'
    case 'call_internal': return 'channelInternalCall'
    default: return 'channelOther'
  }
}

export function CallContextDialog({ callId }: { callId: string }) {
  const t = useTranslations('NexPhoneContext')
  const [open, setOpen] = useState(true)
  const [context, setContext] = useState<CallContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    const load = async () => {
      try {
        const response = await fetch(`/api/telephony/yeastar/call-context?${new URLSearchParams({ call_id: callId })}`, {
          cache: 'no-store', signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (response.status === 409 && attempts++ < 15) {
          timer = setTimeout(load, 2000)
          return
        }
        if (!response.ok) throw new Error(`Call context HTTP ${response.status}`)
        const payload = await response.json() as CallContext
        if (controller.signal.aborted) return
        setContext(payload)
        setLoading(false)
        setError(false)
      } catch (reason) {
        if (controller.signal.aborted) return
        console.error('[nexphone] call context could not be loaded:', reason)
        setLoading(false)
        setError(true)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [callId, refresh])

  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}><BookOpen className="size-4" />{t('open')}</Button>
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('loading')}</p> : null}
        {error ? <div className="space-y-2"><p role="alert" className="text-destructive">{t('error')}</p><Button variant="outline" onClick={() => { setLoading(true); setError(false); setRefresh((value) => value + 1) }}>{t('retry')}</Button></div> : null}
        {context ? <div className="space-y-3 text-sm">
          <section className="rounded-lg bg-primary/5 p-3">
            <h3 className="mb-1 flex items-center gap-2 font-semibold"><UserRound className="size-4" />{t('customerContext')}</h3>
            {context.contact
              ? <>
                <p className="font-medium">{context.contact.name || t('unnamedContact')}</p>
                <p className="text-xs text-muted-foreground">{context.contact.phone || context.callerNumber}</p>
                {context.latestInteraction
                  ? <div className="mt-2 rounded-md bg-background/70 p-2">
                    <p className="text-xs font-medium">{t('lastInteraction')}: {t(channelTranslationKey(context.latestInteraction.channel))}{context.latestInteraction.sourceLabel ? ` · ${context.latestInteraction.sourceLabel}` : ''}{context.latestInteraction.occurredAt ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(context.latestInteraction.occurredAt))}` : ''}</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{context.latestInteraction.summary}</p>
                  </div>
                  : <p className="mt-2 text-muted-foreground">{t('noPreviousInteraction')}</p>}
              </>
              : <div>
                <p className="font-medium">{t('unregisteredCustomer')}</p>
                <p className="mt-1 text-muted-foreground">{context.callerNumber}</p>
                <p className="mt-2 text-muted-foreground">{t('registerCustomer')}</p>
              </div>}
          </section>
          {context.current ? <section className="rounded-lg border p-3">
            <h3 className="mb-1 font-semibold">{t('current')}</h3>
            <p className="whitespace-pre-wrap">{context.current.summary}</p>
            {context.current.customer_need ? <p className="mt-2"><b>{t('need')} </b>{context.current.customer_need}</p> : null}
            {context.current.next_action ? <p className="mt-2"><b>{t('next')} </b>{context.current.next_action}</p> : null}
          </section> : null}
          <section><h3 className="mb-1 font-semibold">{t('history')}</h3><p className="whitespace-pre-wrap text-muted-foreground">{context.history || t('noHistory')}</p></section>
          {context.nextAction ? <p><b>{t('followUp')} </b>{context.nextAction}</p> : null}
          {context.commitments.length ? <section><h3 className="font-semibold">{t('pending')}</h3><ul className="list-inside list-disc">{context.commitments.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
        </div> : null}
      </DialogContent>
    </Dialog>
  </>
}
