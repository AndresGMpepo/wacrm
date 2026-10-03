'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, List, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AgendaProMonthCalendar } from '@/components/agendapro/month-calendar';
import { AgendaProDaySchedule, clockFromMinutes, type ProviderWorkingHours } from '@/components/agendapro/day-schedule';
import { AgendaProWeekSchedule } from '@/components/agendapro/week-schedule';
import { AgendaProRescheduleDialog } from '@/components/agendapro/reschedule-dialog';
import { AgendaProBookingPopover } from '@/components/agendapro/booking-popover';
import { AGENDAPRO_STATUS_OPTIONS, colorForStatus, normalizeStatusKey } from '@/lib/agendapro/status-colors';
import { parseAgendaProTime } from '@/lib/agendapro/time';

type Location = { id: number; name: string };
type Service = { id: number; name: string; duration: number };
type Provider = { id: number; name: string; location_id: number };
type ContactOption = { id: string; name: string | null; phone: string | null };
type Booking = {
  id: number;
  start: string;
  end: string;
  price: number;
  service: string;
  service_id?: number;
  service_provider: string;
  service_provider_id: number;
  location: string;
  location_id?: number;
  status: string;
  notes?: string | null;
  company_comment?: string | null;
  client: { id: number; first_name: string; last_name: string | null; phone?: string | null; email?: string | null } | null;
};
type AvailableHour = { start_time: string; end_time: string; provider_id: number; provider_name: string; start_block: string };

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(parseAgendaProTime(value));
}

function todayISODate() {
  // Local calendar date, not `toISOString()` (UTC): in Mexico City
  // (UTC-6) the UTC date is already "tomorrow" from 6 PM onward, which
  // made the "Hoy" button jump to the next day every evening.
  return format(new Date(), 'yyyy-MM-dd');
}

export default function AgendaProPage() {
  const { accountId } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [filterLocationId, setFilterLocationId] = useState('');
  const [filterServiceId, setFilterServiceId] = useState('');
  const [filterProviderId, setFilterProviderId] = useState('');

  const [viewMode, setViewMode] = useState<'day' | 'week' | 'calendar' | 'list'>('day');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayISODate());
  const [statusColors, setStatusColors] = useState<Record<string, string>>({});
  // Normalized status keys hidden from every view. Cancelled bookings are
  // hidden by default so a just-cancelled appointment leaves the grid
  // (its slot is free again); the "Cancelado" chip brings them back.
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => new Set(['cancelado']));
  const [rescheduleBooking, setRescheduleBooking] = useState<Booking | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [providerSchedules, setProviderSchedules] = useState<Record<number, ProviderWorkingHours[] | null>>({});
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formContactId, setFormContactId] = useState('');
  const [formServiceId, setFormServiceId] = useState('');
  const [formProviderId, setFormProviderId] = useState('');
  const [formLocationId, setFormLocationId] = useState('');
  const [formDate, setFormDate] = useState(todayISODate());
  const [availableHours, setAvailableHours] = useState<AvailableHour[]>([]);
  const [loadingHours, setLoadingHours] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableHour | null>(null);
  // "HH:mm" picked by clicking an empty spot on the day/week grid — matched
  // against AgendaPro's own `start_block` once free slots load.
  const [preferredBlock, setPreferredBlock] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const [locationsRes, servicesRes, providersRes] = await Promise.all([
        fetch('/api/agendapro/catalog?resource=locations', { cache: 'no-store' }),
        fetch('/api/agendapro/catalog?resource=services', { cache: 'no-store' }),
        fetch('/api/agendapro/catalog?resource=providers', { cache: 'no-store' }),
      ]);
      if ([locationsRes.status, servicesRes.status, providersRes.status].includes(403)) {
        setConnected(false);
        return;
      }
      const locationsPayload = (await locationsRes.json().catch(() => null)) as { locations?: Location[] } | null;
      const servicesPayload = (await servicesRes.json().catch(() => null)) as Service[] | null;
      const providersPayload = (await providersRes.json().catch(() => null)) as Provider[] | null;
      setLocations(locationsPayload?.locations ?? []);
      setServices(Array.isArray(servicesPayload) ? servicesPayload : []);
      setProviders(Array.isArray(providersPayload) ? providersPayload : []);
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBookings = useCallback(async () => {
    if (!connected) return;
    setLoadingBookings(true);
    try {
      const params = new URLSearchParams();
      if (filterLocationId) params.set('location_id', filterLocationId);
      if (filterServiceId) params.set('service_id', filterServiceId);
      if (filterProviderId) params.set('provider_id', filterProviderId);
      // One extra day on each side of the visible range, trimmed back
      // client-side by the booking's own wall-clock date
      // (`booking.start.slice(0, 10)`, the same date we display).
      // AgendaPro documents `range_from`/`range_to` as filtering on the
      // booking's start date but not in which timezone, nor whether
      // `range_to` is inclusive — and it already labels local times with
      // a misleading "Z". Padding makes the result correct whichever way
      // AgendaPro evaluates the edges, instead of silently dropping part
      // of the day.
      if (viewMode === 'day') {
        const day = new Date(`${selectedDate}T00:00:00`);
        params.set('range_from', format(subDays(day, 1), 'yyyy-MM-dd'));
        params.set('range_to', format(addDays(day, 1), 'yyyy-MM-dd'));
      } else if (viewMode === 'week') {
        const weekStart = startOfWeek(new Date(`${selectedDate}T00:00:00`), { weekStartsOn: 1 });
        params.set('range_from', format(subDays(weekStart, 1), 'yyyy-MM-dd'));
        params.set('range_to', format(addDays(weekStart, 7), 'yyyy-MM-dd'));
      } else {
        // The grid shows a few days of the adjacent months too, so the
        // fetched range covers the whole visible 6-week grid, not just the
        // calendar month itself — otherwise those edge days would look empty.
        const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
        const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
        params.set('range_from', format(subDays(gridStart, 1), 'yyyy-MM-dd'));
        params.set('range_to', format(addDays(gridEnd, 1), 'yyyy-MM-dd'));
      }
      const response = await fetch(`/api/agendapro/bookings?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as Booking[] | { error?: string } | null;
      if (!response.ok) throw new Error((payload as { error?: string })?.error || 'No se pudieron cargar las reservas.');
      setBookings(Array.isArray(payload) ? payload : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
    } finally {
      setLoadingBookings(false);
    }
  }, [connected, filterLocationId, filterServiceId, filterProviderId, viewMode, month, selectedDate]);

  const loadStatusColors = useCallback(async () => {
    try {
      const response = await fetch('/api/agendapro/status-colors', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { colors?: Record<string, string> };
      setStatusColors(payload.colors ?? {});
    } catch {
      // Non-critical — the calendar still renders with deterministic default colors.
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    void loadStatusColors();
  }, [loadStatusColors]);

  // Keeps the fetched month-grid range following the day view's date
  // picker/prev-next-day controls, so crossing a month boundary there
  // still has data to show instead of silently going empty.
  useEffect(() => {
    const picked = startOfMonth(new Date(`${selectedDate}T00:00:00`));
    setMonth((current) => (current.getTime() === picked.getTime() ? current : picked));
  }, [selectedDate]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .order('name')
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) setContacts((data ?? []) as ContactOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Needs a service + date + (provider OR location) before asking AgendaPro for free slots.
  useEffect(() => {
    if (!showForm || !formServiceId || !formDate || (!formProviderId && !formLocationId)) {
      setAvailableHours([]);
      return;
    }
    let cancelled = false;
    setLoadingHours(true);
    const params = new URLSearchParams({ service_id: formServiceId, date: formDate });
    if (formProviderId) params.set('provider_id', formProviderId);
    else if (formLocationId) params.set('location_id', formLocationId);
    void fetch(`/api/agendapro/available-slots?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: { available_hours?: AvailableHour[] } | null) => {
        if (!cancelled) setAvailableHours(payload?.available_hours ?? []);
      })
      .catch(() => { if (!cancelled) setAvailableHours([]); })
      .finally(() => { if (!cancelled) setLoadingHours(false); });
    return () => { cancelled = true; };
  }, [showForm, formServiceId, formProviderId, formLocationId, formDate]);

  function resetForm() {
    setShowForm(false);
    setFormContactId('');
    setFormServiceId('');
    setFormProviderId('');
    setFormLocationId('');
    setFormDate(todayISODate());
    setAvailableHours([]);
    setSelectedSlot(null);
    setPreferredBlock(null);
  }

  /** Opens "Nueva reserva" prefilled from a click on an empty spot of the
   *  day/week grid. The service still has to be chosen (a free spot says
   *  nothing about which service), after which the matching slot is
   *  selected automatically if AgendaPro offers it. */
  function openFormAt(dateISO: string, minutes: number, providerId?: number) {
    const provider = providerId ? providers.find((p) => p.id === providerId) : undefined;
    setFormDate(dateISO);
    setFormProviderId(providerId ? String(providerId) : '');
    setFormLocationId(provider ? String(provider.location_id) : filterLocationId);
    setSelectedSlot(null);
    setPreferredBlock(clockFromMinutes(minutes));
    setShowForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  useEffect(() => {
    if (!preferredBlock || selectedSlot || availableHours.length === 0) return;
    const match = availableHours.find(
      (hour) => hour.start_block === preferredBlock && (!formProviderId || String(hour.provider_id) === formProviderId),
    );
    if (match) {
      setSelectedSlot(match);
      if (!formProviderId) setFormProviderId(String(match.provider_id));
    }
  }, [availableHours, preferredBlock, selectedSlot, formProviderId]);

  async function createBooking() {
    if (!formContactId || !formServiceId || !formProviderId || !selectedSlot) {
      toast.error('Elige contacto, servicio, prestador y un horario disponible.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: formContactId,
          service_id: Number(formServiceId),
          provider_id: Number(formProviderId),
          start: selectedSlot.start_time,
          end: selectedSlot.end_time,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo crear la reserva.');
      toast.success('Reserva creada en AgendaPro.');
      resetForm();
      await loadBookings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la reserva.');
    } finally {
      setSaving(false);
    }
  }

  // Status filter applied to every view (day/week/month/list).
  const filteredBookings = useMemo(
    () => bookings.filter((booking) => !hiddenStatuses.has(normalizeStatusKey(booking.status || ''))),
    [bookings, hiddenStatuses],
  );

  // Chips: AgendaPro's six documented statuses + "Cancelado", plus any
  // other (custom) status that actually shows up in the loaded bookings.
  const statusChips = useMemo(() => {
    const chips = new Map<string, string>();
    for (const option of AGENDAPRO_STATUS_OPTIONS) chips.set(normalizeStatusKey(option.label), option.label);
    chips.set('cancelado', 'Cancelado');
    for (const booking of bookings) {
      const key = normalizeStatusKey(booking.status || '');
      if (key && !chips.has(key)) chips.set(key, booking.status);
    }
    return [...chips.entries()].map(([key, label]) => ({ key, label }));
  }, [bookings]);

  function toggleStatus(key: string) {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const weekStart = useMemo(
    () => startOfWeek(new Date(`${selectedDate}T00:00:00`), { weekStartsOn: 1 }),
    [selectedDate],
  );
  const weekBookings = useMemo(() => {
    const first = format(weekStart, 'yyyy-MM-dd');
    const last = format(addDays(weekStart, 6), 'yyyy-MM-dd');
    return filteredBookings.filter((booking) => {
      const day = booking.start.slice(0, 10);
      return day >= first && day <= last;
    });
  }, [filteredBookings, weekStart]);

  const bookingsForSelectedDay = useMemo(
    () =>
      filteredBookings
        .filter((booking) => booking.start.slice(0, 10) === selectedDate)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [filteredBookings, selectedDate],
  );

  const visibleProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          (!filterLocationId || String(provider.location_id) === filterLocationId) &&
          (!filterProviderId || String(provider.id) === filterProviderId),
      ),
    [providers, filterLocationId, filterProviderId],
  );

  // Columns for the day view: the catalog's providers, plus any provider
  // that has a booking this day but isn't in the catalog list (e.g. a
  // deactivated provider) — otherwise those bookings had no column to be
  // drawn in and silently disappeared. Bookings are already filtered by
  // location/provider server-side, so this never re-adds a filtered-out one.
  const scheduleProviders = useMemo(() => {
    const known = new Set(visibleProviders.map((p) => p.id));
    const extra: { id: number; name: string }[] = [];
    for (const booking of bookingsForSelectedDay) {
      if (known.has(booking.service_provider_id)) continue;
      known.add(booking.service_provider_id);
      extra.push({ id: booking.service_provider_id, name: booking.service_provider || `Prestador ${booking.service_provider_id}` });
    }
    return [...visibleProviders, ...extra];
  }, [visibleProviders, bookingsForSelectedDay]);

  // Working-hours schedules (used to render "profesional no disponible" /
  // lunch-break blocks in the day view) only need to be fetched for the
  // providers currently visible, and only once per provider — cache by id
  // so switching days/filters doesn't keep re-fetching the same schedule.
  useEffect(() => {
    if (viewMode !== 'day' || scheduleProviders.length === 0) return;
    const missingIds = scheduleProviders.map((p) => p.id).filter((id) => !(id in providerSchedules));
    if (missingIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/agendapro/provider-schedules?provider_ids=${missingIds.join(',')}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data.schedules) {
          setProviderSchedules((prev) => ({ ...prev, ...data.schedules }));
        }
      } catch {
        // Non-fatal — the day view just won't show unavailable-hours blocks.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, scheduleProviders, providerSchedules]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">AgendaPro</h1>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Aún no está conectado
            </CardTitle>
            <CardDescription>
              Conecta tu cuenta de AgendaPro para ver y crear reservas desde aquí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Plain anchor styled with buttonVariants — the Base UI Button has no asChild slot (see invite-member-dialog.tsx). */}
            <Link href="/settings?tab=agendapro" className={buttonVariants({ variant: 'default' })}>
              Ir a Configuración → AgendaPro
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">AgendaPro</h1>
          <p className="mt-1 text-sm text-muted-foreground">Calendario de reservas.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button variant={viewMode === 'day' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('day')}>
              <CalendarClock className="h-4 w-4" />
              Día
            </Button>
            <Button variant={viewMode === 'week' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('week')}>
              <CalendarRange className="h-4 w-4" />
              Semana
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="h-4 w-4" />
              Mes
            </Button>
            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('list')}>
              <List className="h-4 w-4" />
              Lista
            </Button>
          </div>
          <Button variant="outline" onClick={() => void loadBookings()} disabled={loadingBookings}>
            <RefreshCw className={loadingBookings ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Actualizar
          </Button>
          <Button onClick={() => { setFormDate(selectedDate || todayISODate()); setPreferredBlock(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" />
            Nueva reserva
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select value={filterLocationId} onChange={(event) => setFilterLocationId(event.target.value)} className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm">
          <option value="">Todos los locales</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </select>
        <select value={filterServiceId} onChange={(event) => setFilterServiceId(event.target.value)} className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm">
          <option value="">Todos los servicios</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>{service.name}</option>
          ))}
        </select>
        <select value={filterProviderId} onChange={(event) => setFilterProviderId(event.target.value)} className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm">
          <option value="">Todos los prestadores</option>
          {providers
            .filter((provider) => !filterLocationId || String(provider.location_id) === filterLocationId)
            .map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">Estados:</span>
        {statusChips.map((chip) => {
          const visible = !hiddenStatuses.has(chip.key);
          const color = colorForStatus(chip.label, statusColors);
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => toggleStatus(chip.key)}
              aria-pressed={visible}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity ${
                visible ? 'border-border text-foreground' : 'border-dashed border-border text-muted-foreground opacity-60'
              }`}
              title={visible ? `Ocultar "${chip.label}"` : `Mostrar "${chip.label}"`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, opacity: visible ? 1 : 0.4 }} />
              {chip.label}
            </button>
          );
        })}
      </div>

      {viewMode === 'day' || viewMode === 'week' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={viewMode === 'week' ? 'Semana anterior' : 'Día anterior'}
            onClick={() => setSelectedDate(format(subDays(new Date(`${selectedDate}T00:00:00`), viewMode === 'week' ? 7 : 1), 'yyyy-MM-dd'))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(todayISODate())}>
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={viewMode === 'week' ? 'Semana siguiente' : 'Día siguiente'}
            onClick={() => setSelectedDate(format(addDays(new Date(`${selectedDate}T00:00:00`), viewMode === 'week' ? 7 : 1), 'yyyy-MM-dd'))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="w-auto"
          />
          <span className="text-sm font-medium capitalize text-foreground">
            {viewMode === 'week'
              ? `${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(weekStart)} – ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(addDays(weekStart, 6))}`
              : new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(new Date(`${selectedDate}T00:00:00`))}
          </span>
        </div>
      ) : null}

      {showForm ? (
        <Card className="mt-4" ref={formRef}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Nueva reserva</CardTitle>
            <Button variant="outline" size="icon" onClick={resetForm} aria-label="Cerrar">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Contacto</Label>
                <select value={formContactId} onChange={(event) => setFormContactId(event.target.value)} className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm">
                  <option value="">Selecciona un contacto</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>{contact.name || contact.phone || contact.id}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Servicio</Label>
                <select value={formServiceId} onChange={(event) => { setFormServiceId(event.target.value); setSelectedSlot(null); }} className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm">
                  <option value="">Selecciona un servicio</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name} ({service.duration} min)</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Local</Label>
                <select value={formLocationId} onChange={(event) => { setFormLocationId(event.target.value); setSelectedSlot(null); }} className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm">
                  <option value="">Cualquier local</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Prestador</Label>
                <select value={formProviderId} onChange={(event) => { setFormProviderId(event.target.value); setSelectedSlot(null); }} className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm">
                  <option value="">Selecciona un prestador</option>
                  {providers
                    .filter((provider) => !formLocationId || String(provider.location_id) === formLocationId)
                    .map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={formDate} min={todayISODate()} onChange={(event) => { setFormDate(event.target.value); setSelectedSlot(null); }} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Horarios disponibles</Label>
              {preferredBlock ? (
                <p className="text-xs text-muted-foreground">
                  {selectedSlot?.start_block === preferredBlock
                    ? `Horario de las ${preferredBlock} seleccionado.`
                    : !formServiceId
                      ? `Elegiste las ${preferredBlock}. Selecciona el servicio para confirmar que ese horario está libre.`
                      : !loadingHours && availableHours.length > 0
                        ? `El horario de las ${preferredBlock} no está disponible para este servicio; elige otro.`
                        : null}
                </p>
              ) : null}
              {loadingHours ? (
                <p className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Buscando horarios…</p>
              ) : !formServiceId || (!formProviderId && !formLocationId) ? (
                <p className="text-xs text-muted-foreground">Elige un servicio y un prestador o local para ver horarios.</p>
              ) : availableHours.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay horarios disponibles para esa fecha.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableHours.map((hour) => (
                    <button
                      key={`${hour.provider_id}-${hour.start_time}`}
                      type="button"
                      onClick={() => { setSelectedSlot(hour); if (!formProviderId) setFormProviderId(String(hour.provider_id)); }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${selectedSlot?.start_time === hour.start_time && selectedSlot?.provider_id === hour.provider_id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/60'}`}
                    >
                      {hour.start_block} · {hour.provider_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={() => void createBooking()} disabled={saving || !selectedSlot}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Crear reserva
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6">
        {loadingBookings ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : viewMode === 'day' ? (
          <AgendaProDaySchedule
            date={new Date(`${selectedDate}T00:00:00`)}
            providers={scheduleProviders}
            providerSchedules={providerSchedules}
            bookings={bookingsForSelectedDay}
            statusColors={statusColors}
            selectedBookingId={selectedBooking?.id ?? null}
            onSelectBooking={(booking, element) => {
              setSelectedBooking(bookingsForSelectedDay.find((b) => b.id === booking.id) ?? null);
              setPopoverAnchor(element);
            }}
            onEmptySlotClick={(providerId, minutes) => openFormAt(selectedDate, minutes, providerId)}
          />
        ) : viewMode === 'week' ? (
          <AgendaProWeekSchedule
            weekStart={weekStart}
            bookings={weekBookings}
            statusColors={statusColors}
            selectedBookingId={selectedBooking?.id ?? null}
            onSelectBooking={(booking, element) => {
              setSelectedBooking(weekBookings.find((b) => b.id === booking.id) ?? null);
              setPopoverAnchor(element);
            }}
            onEmptySlotClick={(dateISO, minutes) =>
              openFormAt(dateISO, minutes, filterProviderId ? Number(filterProviderId) : undefined)
            }
            onSelectDay={(dateISO) => {
              setSelectedDate(dateISO);
              setViewMode('day');
            }}
          />
        ) : viewMode === 'calendar' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <AgendaProMonthCalendar
              month={month}
              onMonthChange={setMonth}
              bookings={filteredBookings}
              statusColors={statusColors}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            <div>
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                {new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(new Date(`${selectedDate}T00:00:00`))}
              </h2>
              <div className="space-y-2">
                {bookingsForSelectedDay.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay reservas este día.</p>
                ) : (
                  bookingsForSelectedDay.map((booking) => <BookingCard key={booking.id} booking={booking} statusColors={statusColors} />)
                )}
              </div>
            </div>
          </div>
        ) : filteredBookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay reservas en el mes mostrado.</p>
        ) : (
          <div className="space-y-2">
            {[...filteredBookings]
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((booking) => (
                <BookingCard key={booking.id} booking={booking} statusColors={statusColors} />
              ))}
          </div>
        )}
      </div>

      {selectedBooking && popoverAnchor && (viewMode === 'day' || viewMode === 'week') ? (
        <AgendaProBookingPopover
          booking={selectedBooking}
          anchor={popoverAnchor}
          statusColors={statusColors}
          onClose={() => { setSelectedBooking(null); setPopoverAnchor(null); }}
          onStatusChanged={(bookingId, _statusId, newStatusLabel) => {
            setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status: newStatusLabel } : b)));
            setSelectedBooking((prev) => (prev && prev.id === bookingId ? { ...prev, status: newStatusLabel } : prev));
          }}
          onReschedule={() => {
            setRescheduleBooking(selectedBooking);
            setSelectedBooking(null);
            setPopoverAnchor(null);
          }}
          onCancelled={() => {
            setSelectedBooking(null);
            setPopoverAnchor(null);
            void loadBookings();
          }}
        />
      ) : null}

      {rescheduleBooking ? (
        <AgendaProRescheduleDialog
          booking={rescheduleBooking}
          providers={providers}
          onClose={() => setRescheduleBooking(null)}
          onRescheduled={() => {
            setRescheduleBooking(null);
            void loadBookings();
          }}
        />
      ) : null}
    </div>
  );
}

function BookingCard({ booking, statusColors }: { booking: Booking; statusColors: Record<string, string> }) {
  const color = colorForStatus(booking.status, statusColors);
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-wrap items-center justify-between gap-2 border-l-4 py-4 text-sm" style={{ borderLeftColor: color }}>
        <div>
          <p className="font-medium text-foreground">
            {booking.client ? `${booking.client.first_name} ${booking.client.last_name ?? ''}`.trim() : 'Sin cliente'}
          </p>
          <p className="text-xs text-muted-foreground">
            {booking.service} · {booking.service_provider} · {booking.location}
          </p>
        </div>
        <div className="text-right">
          <p className="text-foreground">{formatDateTime(booking.start)}</p>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {booking.status}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

