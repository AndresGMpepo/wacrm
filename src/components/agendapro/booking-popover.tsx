'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Ban, CalendarClock, Loader2, Mail, MessageCircle, PhoneCall, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
 * these six status ids are offered — cancelling is its own DELETE call,
 * behind a confirmation step, and "Reagendar" opens the caller's
 * reschedule dialog).
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
  onReschedule,
  onCancelled,
}: {
  booking: PopoverBooking;
  anchor: HTMLElement;
  statusColors: Record<string, string>;
  onClose: () => void;
  onStatusChanged: (bookingId: number, newStatusId: number, newStatusLabel: string) => void;
  onReschedule?: () => void;
  onCancelled?: () => void;
}) {
  const router = useRouter();
  const telephony = useTelephony();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const isCancelled = normalizeStatusKey(booking.status).startsWith('cancelad');

  const clientName = booking.client ? `${booking.client.first_name} ${booking.client.last_name ?? ''}`.trim() : 'Sin cliente';
  const clientPhone = booking.client?.phone ?? null;

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const cardWidth = 304;
    const spaceOnRight = window.innerWidth - rect.right;
    const left = spaceOnRight > cardWidth + 16 ? rect.right + 8 : Math.max(8, rect.left - cardWidth - 8);
    const top = Math.min(window.scrollY + rect.top, window.scrollY + window.innerHeight - 480);
    setPosition({ top: Math.max(window.scrollY + 8, top), left: left + window.scrollX });
  }, [anchor]);

  async function cancelBooking() {
    setCancelling(true);
    try {
      const response = await fetch(`/api/agendapro/bookings/${booking.id}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo cancelar la cita.');
      toast.success('Cita cancelada en AgendaPro.');
      onCancelled?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la cita.');
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

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
      const payload = (await response.json().catch(() => null)) as
        | { conversation_id?: string; needs_template?: boolean; contact_id?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo abrir la conversación.');
      if (payload?.conversation_id) {
        router.push(`/inbox?c=${payload.conversation_id}`);
        return;
      }
      if (payload?.needs_template && payload.contact_id) {
        // This account's WhatsApp is Zernio-connected and this cliente
        // has no thread yet — Zernio (like Meta) requires the opening
        // message to be an approved template, so we send the agent to
        // the Contact page's existing "Enviar plantilla" flow instead
        // of a broken, empty Inbox conversation.
        toast.info('Este cliente no tiene una conversación de WhatsApp todavía. Envíale una plantilla aprobada para iniciarla.');
        router.push(`/contacts?contact=${payload.contact_id}`);
        return;
      }
      throw new Error('No se pudo abrir la conversación.');
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

        {isCancelled ? (
          <p className="mt-3 border-t pt-3 text-xs font-medium text-destructive">Esta cita está cancelada.</p>
        ) : (
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

          {onReschedule || onCancelled ? (
            confirmingCancel ? (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <p className="font-medium text-foreground">¿Cancelar esta cita en AgendaPro?</p>
                <p className="mt-0.5 text-muted-foreground">El horario queda libre y ya no se enviará el recordatorio de confirmación.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="destructive" disabled={cancelling} onClick={() => void cancelBooking()}>
                    {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Sí, cancelar
                  </Button>
                  <Button size="sm" variant="outline" disabled={cancelling} onClick={() => setConfirmingCancel(false)}>
                    No
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                {onReschedule ? (
                  <Button size="sm" variant="outline" className="flex-1" onClick={onReschedule}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    Reagendar
                  </Button>
                ) : null}
                {onCancelled ? (
                  <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setConfirmingCancel(true)}>
                    <Ban className="h-3.5 w-3.5" />
                    Cancelar cita
                  </Button>
                ) : null}
              </div>
            )
          ) : null}
        </div>
        )}
      </div>
    </>
  );
}
