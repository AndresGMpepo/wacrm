'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Mail, MessageCircle, PhoneCall, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';

import { AGENDAPRO_STATUS_OPTIONS, colorForStatus, normalizeStatusKey } from '@/lib/agendapro/status-colors';
import { useTelephony } from '@/components/telephony/telephony-provider';
import { parseAgendaProTime } from '@/lib/agendapro/time';

export type PopoverBooking = {
  id: number;
  start: string;
  end: string;
  service: string;
  service_provider: string;
  location: string;
  status: string;
  notes?: string | null;
  company_comment?: string | null;
  client: { first_name: string; last_name: string | null; phone?: string | null; email?: string | null } | null;
};

/**
 * Floating booking-detail card, positioned next to the block that was
 * clicked — mirrors AgendaPro's own popover (client, service, time,
 * provider, phone/email, internal comment, quick status change).
 * Status is changed via PATCH /api/agendapro/bookings/{id}, confirmed
 * against developers.agendapro.com/v1.0 (see that route for why only
 * these six status ids are offered — "cancelado" isn't one of them).
 *
 * The phone number calls out through NexPhone (the account's own
 * telephony, not the device's dialer), and "Hablar por WhatsApp" opens
 * the Inbox conversation inside NexoOmni (find-or-create) instead of a
 * `wa.me` link — a `wa.me` link would hand the chat off to the agent's
 * personal WhatsApp app, completely outside NexoOmni (no shared
 * inbox record, no template, no handoff to another agent).
 */
export function AgendaProBookingPopover({
  booking,
  anchor,
  statusColors,
  onClose,
  onStatusChanged,
}: {
  booking: PopoverBooking;
  anchor: HTMLElement;
  statusColors: Record<string, string>;
  onClose: () => void;
  onStatusChanged: (bookingId: number, newStatusId: number, newStatusLabel: string) => void;
}) {
  const router = useRouter();
  const telephony = useTelephony();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);
  const [openingConversation, setOpeningConversation] = useState(false);

  const clientName = booking.client ? `${booking.client.first_name} ${booking.client.last_name ?? ''}`.trim() : 'Sin cliente';
  const clientPhone = booking.client?.phone ?? null;

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const cardWidth = 304;
    const spaceOnRight = window.innerWidth - rect.right;
    const left = spaceOnRight > cardWidth + 16 ? rect.right + 8 : Math.max(8, rect.left - cardWidth - 8);
    const top = Math.min(window.scrollY + rect.top, window.scrollY + window.innerHeight - 420);
    setPosition({ top: Math.max(window.scrollY + 8, top), left: left + window.scrollX });
  }, [anchor]);

  async function changeStatus(statusId: number, label: string) {
    setUpdatingStatus(statusId);
    try {
      const response = await fetch(`/api/agendapro/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_id: statusId }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo cambiar el estado.');
      toast.success(`Estado actualizado a "${label}".`);
      onStatusChanged(booking.id, statusId, label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function openWhatsAppInInbox() {
    if (!clientPhone) return;
    setOpeningConversation(true);
    try {
      const response = await fetch('/api/agendapro/open-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clientPhone, name: clientName }),
      });
      const payload = (await response.json().catch(() => null)) as { conversation_id?: string; error?: string } | null;
      if (!response.ok || !payload?.conversation_id) throw new Error(payload?.error || 'No se pudo abrir la conversación.');
      router.push(`/inbox?c=${payload.conversation_id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir la conversación.');
    } finally {
      setOpeningConversation(false);
    }
  }

  return (
    <>
      {/* Invisible backdrop — closes the popover on any outside click without a full modal dimming effect. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed z-50 w-[19rem] rounded-xl border bg-popover p-4 text-sm shadow-lg"
        style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-foreground">{clientName}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-muted-foreground">{booking.service}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {format(parseAgendaProTime(booking.start), "EEEE dd 'de' MMMM", { locale: es })} · {format(parseAgendaProTime(booking.start), 'HH:mm')} a{' '}
          {format(parseAgendaProTime(booking.end), 'HH:mm')} hrs
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Se atenderá con: {booking.service_provider}</p>

        {clientPhone ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              onClick={() => void telephony.call(clientPhone)}
              disabled={!telephony.connected}
              title={telephony.connected ? 'Llamar por NexPhone' : 'NexPhone no está conectado'}
              className="inline-flex items-center gap-1 text-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              {clientPhone}
            </button>
            <button
              type="button"
              onClick={() => void openWhatsAppInInbox()}
              disabled={openingConversation}
              className="inline-flex items-center gap-1 text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400"
            >
              {openingConversation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
              Hablar por WhatsApp
            </button>
          </div>
        ) : null}
        {booking.client?.email ? (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            {booking.client.email}
          </div>
        ) : null}
        {(booking.notes || booking.company_comment) ? (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{[booking.notes, booking.company_comment].filter(Boolean).join(' · ')}</span>
          </div>
        ) : null}

        <div className="mt-3 border-t pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Cambiar estado</p>
          <div className="flex flex-wrap gap-2">
            {AGENDAPRO_STATUS_OPTIONS.map((option) => {
              const isCurrent = normalizeStatusKey(booking.status) === normalizeStatusKey(option.label);
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.label}
                  disabled={updatingStatus !== null}
                  onClick={() => void changeStatus(option.id, option.label)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-50 ${isCurrent ? 'border-foreground' : 'border-transparent'}`}
                  style={{ backgroundColor: colorForStatus(option.label, statusColors) }}
                >
                  {updatingStatus === option.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
