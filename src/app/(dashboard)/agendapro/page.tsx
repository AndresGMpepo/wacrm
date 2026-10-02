'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  service_provider: string;
  location: string;
  status: string;
  client: { id: number; first_name: string; last_name: string | null } | null;
};
type AvailableHour = { start_time: string; end_time: string; provider_id: number; provider_name: string; start_block: string };

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
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
      params.set('range_from', todayISODate());
      const to = new Date();
      to.setDate(to.getDate() + 30);
      params.set('range_to', to.toISOString().slice(0, 10));
      const response = await fetch(`/api/agendapro/bookings?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as Booking[] | { error?: string } | null;
      if (!response.ok) throw new Error((payload as { error?: string })?.error || 'No se pudieron cargar las reservas.');
      setBookings(Array.isArray(payload) ? payload : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las reservas.');
    } finally {
      setLoadingBookings(false);
    }
  }, [connected, filterLocationId, filterServiceId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

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
  }

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
          <p className="mt-1 text-sm text-muted-foreground">Reservas de los próximos 30 días.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadBookings()} disabled={loadingBookings}>
            <RefreshCw className={loadingBookings ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Actualizar
          </Button>
          <Button onClick={() => setShowForm(true)}>
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
      </div>

      {showForm ? (
        <Card className="mt-4">
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

      <div className="mt-6 space-y-2">
        {loadingBookings ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay reservas en los próximos 30 días.</p>
        ) : (
          bookings.map((booking) => (
            <Card key={booking.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm">
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
                  <p className="text-xs text-muted-foreground">{booking.status}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
