'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, MessageSquare, Phone, UserCheck, Archive, ArchiveRestore, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

type TraceEvent = {
  at: string;
  type:
    | 'conversation_started'
    | 'assignment'
    | 'agent_replied'
    | 'call'
    | 'contact_archived'
    | 'contact_restored';
  agent: string | null;
  channel: string | null;
  conversation_id: string | null;
  detail: string;
};

const ICONS = {
  conversation_started: Inbox,
  assignment: UserCheck,
  agent_replied: MessageSquare,
  call: Phone,
  contact_archived: Archive,
  contact_restored: ArchiveRestore,
} as const;

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  zernio_whatsapp: 'WhatsApp conectado',
  zernio_facebook: 'Facebook conectado',
  zernio_instagram: 'Instagram conectado',
  facebook: 'Facebook',
  instagram: 'Instagram',
  yeastar_live_chat: 'Chat web',
  tiktok: 'TikTok',
  telefonía: 'Telefonía',
};

/** Who attended this customer, in order, across chat and phone. */
export function ContactTracePanel({ contactId }: { contactId: string }) {
  const t = useTranslations('Contacts.trace');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/trace`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? t('loadFailed'));
        return;
      }
      setEvents(body.events ?? []);
    } finally {
      setLoading(false);
    }
  }, [contactId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('description')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(`/api/contacts/${contactId}/trace?format=csv`, '_blank')}
          disabled={events.length === 0}
        >
          <Download className="size-4" />
          {t('download')}
        </Button>
      </div>

      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event, index) => {
            const Icon = ICONS[event.type] ?? MessageSquare;
            return (
              <li
                key={`${event.at}-${index}`}
                className="flex gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {event.agent ?? t('noAgent')}
                    </span>
                    {event.channel ? (
                      <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">
                        {CHANNEL_LABELS[event.channel] ?? event.channel}
                      </span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(event.at).toLocaleString()}
                    </span>
                  </div>
                  <p className="break-words text-xs text-muted-foreground">{event.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
