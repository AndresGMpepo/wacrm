'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseAgendaProTime } from '@/lib/agendapro/time';

export type ReschedulableBooking = {
  id: number;
  start: string;
  service: string;
  service_id?: number;
  service_provider_id: number;
  location_id?: number;
  client: { first_name: string; last_name: string | null } | null;
};

type AvailableHour = { start_time: string; end_time: string; provider_id: number; provider_name: string; start_block: string };

/**
 * Reschedule an AgendaPro booking: pick a date (and optionally another
 * provider) and one of the free slots AgendaPro itself returns for that
 * booking's service. The chosen slot's start/end are sent back exactly as
 * AgendaPro produced them, so no date format or timezone is guessed here.
 */
export function AgendaProRescheduleDialog({
  booking,
  providers,
  onClose,
  onRescheduled,
}: {
  booking: ReschedulableBooking;
  providers: { id: number; name: string; location_id: number }[];
  onClose: () => void;
  onRescheduled: () => void;
}) {
  const [date, setDate] = useState(booking.start.slice(0, 10));
  const [providerId, setProviderId] = useState(String(booking.service_provider_id));
  const [hours, setHours] = useState<AvailableHour[]>([]);
  const [loadingHours, setLoadingHours] = useState(false);
  const [selected, setSelected] = useState<AvailableHour | null>(null);
  const [saving, setSaving] = useState(false);

  const locationProviders = providers.filter(
    (provider) => !booking.location_id || provider.location_id === booking.location_id || provider.id === booking.service_provider_id,
  );
  const clientName = booking.client ? `${booking.client.first_name} ${booking.client.last_name ?? ''}`.trim() : 'Sin cliente';

  useEffect(() => {
    if (!booking.service_id || !date || !providerId) {
      setHours([]);
      return;
    }
    let cancelled = false;
    setLoadingHours(true);
    setSelected(null);
    const params = new URLSearchParams({ service_id: String(booking.service_id), date, provider_id: providerId });
    void fetch(`/api/agendapro/available-slots?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { available_hours?: AvailableHour[] } | null) => {
        if (!cancelled) setHours(payload?.available_hours ?? []);
      })
      .catch(() => { if (!cancelled) setHours([]); })
      .finally(() => { if (!cancelled) setLoadingHours(false); });
    return () => { cancelled = true; };
  }, [booking.service_id, date, providerId]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/agendapro/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: selected.start_time,
          end: selected.end_time,
          provider_id: selected.provider_id || Number(providerId),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo reagendar la cita.');
      toast.success(`Cita reagendada al ${format(new Date(`${date}T00:00:00`), 'dd/MM/yyyy')} a las ${selected.start_block}.`);
      onRescheduled();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reagendar la cita.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reagendar cita</DialogTitle>
          <DialogDescription>
            {clientName} · {booking.service} · actualmente el {format(parseAgendaProTime(booking.start), "dd/MM/yyyy 'a las' HH:mm")}
          </DialogDescription>
        </DialogHeader>

        {!booking.service_id ? (
          <p className="text-sm text-destructive">
            AgendaPro no devolvió el servicio de esta reserva, así que no se pueden consultar horarios. Reagéndala desde AgendaPro.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nueva fecha</Label>
                <Input type="date" value={date} min={format(new Date(), 'yyyy-MM-dd')} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Prestador</Label>
                <select
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                  className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
                >
                  {locationProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Horarios disponibles</Label>
              {loadingHours ? (
                <p className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Buscando horarios…</p>
              ) : hours.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay horarios disponibles para ese prestador en esa fecha.</p>
              ) : (
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                  {hours.map((hour) => (
                    <button
                      key={`${hour.provider_id}-${hour.start_time}`}
                      type="button"
                      onClick={() => setSelected(hour)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selected?.start_time === hour.start_time ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      {hour.start_block}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cerrar</Button>
          <Button onClick={() => void save()} disabled={!selected || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Reagendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
