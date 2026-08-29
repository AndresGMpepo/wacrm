'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  CircleX,
  ClipboardCheck,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRoundX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';

type Appointment = {
  id: string;
  contact_id: string | null;
  assigned_agent_id: string | null;
  specialist_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  google_calendar_connection_id: string | null;
  google_sync_status: 'not_connected' | 'pending' | 'synced' | 'failed';
  google_sync_error: string | null;
  contact: { name: string | null; phone: string | null } | null;
  agent: { full_name: string | null } | null;
  specialist: { full_name: string; specialty: string | null } | null;
  latest_audit: {
    source: 'nexoomni' | 'google_calendar';
    action: string;
    created_at: string;
    actor_name: string | null;
  } | null;
};
type ContactOption = { id: string; name: string | null; phone: string | null };
type MemberOption = { user_id: string; full_name: string; is_active: boolean };
type Specialist = { id: string; full_name: string; specialty: string | null; notes: string | null; is_active: boolean };
type GoogleConnection = {
  id: string;
  assigned_agent_id: string | null;
  specialist_id: string | null;
  specialist: { full_name: string; specialty: string | null } | null;
  calendar_id: string;
  display_name: string;
  is_default: boolean;
  last_synced_at: string | null;
  last_error: string | null;
};
type GoogleCalendarOption = { id: string; summary: string; primary?: boolean };
const STATUS: Record<string, string> = {
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};
const DURATIONS = [15, 30, 45, 60];

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function appointmentTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function auditLabel(audit: Appointment['latest_audit']) {
  if (!audit) return null;
  const origin =
    audit.source === 'google_calendar'
      ? 'Google Calendar'
      : audit.actor_name || 'NexoOmni';
  const action = audit.action.startsWith('status_')
    ? STATUS[audit.action.slice(7)] || audit.action.slice(7)
    : audit.action === 'created'
      ? 'Cita creada'
      : audit.action === 'updated'
        ? 'Cita actualizada'
        : 'Cambio sincronizado';
  return `Último cambio: ${action} · ${origin} · ${appointmentTime(audit.created_at)}`;
}

export default function AppointmentsPage() {
  const { accountId, user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [duration, setDuration] = useState(30);
  const [contactId, setContactId] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [specialistId, setSpecialistId] = useState('');
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [googleConnectionCount, setGoogleConnectionCount] = useState(0);
  const [googleConnections, setGoogleConnections] = useState<
    GoogleConnection[]
  >([]);
  const [googleCalendarConnectionId, setGoogleCalendarConnectionId] =
    useState('');
  const [availableGoogleCalendars, setAvailableGoogleCalendars] = useState<
    GoogleCalendarOption[]
  >([]);
  const [calendarSourceId, setCalendarSourceId] = useState('');
  const [calendarToAdd, setCalendarToAdd] = useState('');
  const [managingCalendars, setManagingCalendars] = useState(false);
  const [googleTargetSpecialistId, setGoogleTargetSpecialistId] = useState('');
  const [newSpecialistName, setNewSpecialistName] = useState('');
  const [newSpecialistSpecialty, setNewSpecialistSpecialty] = useState('');
  const [editingSpecialistId, setEditingSpecialistId] = useState<string | null>(null);
  const [editSpecialistName, setEditSpecialistName] = useState('');
  const [editSpecialistSpecialty, setEditSpecialistSpecialty] = useState('');
  const [savingSpecialist, setSavingSpecialist] = useState(false);
  const [addCalendarTargetSpecialistId, setAddCalendarTargetSpecialistId] = useState('');
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const selectedCalendarSource = googleConnections.find(
    (connection) => connection.id === calendarSourceId
  );
  const calendarsAvailableToAdd = availableGoogleCalendars.filter(
    (calendar) =>
      !googleConnections.some(
        (connection) =>
          connection.calendar_id === calendar.id &&
          connection.specialist_id ===
            (selectedCalendarSource?.specialist_id ?? null)
      )
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/appointments', { cache: 'no-store' });
      if (response.status === 403) {
        setEnabled(false);
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        appointments?: Appointment[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudieron cargar las citas.');
      setEnabled(true);
      setAppointments(payload?.appointments ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar las citas.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGoogleConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments/google', {
        cache: 'no-store',
      });
      const payload = response.ok
        ? ((await response.json()) as {
            configured?: boolean;
            connections?: GoogleConnection[];
          })
        : null;
      const connections = payload?.connections ?? [];
      setGoogleAvailable(payload?.configured === true);
      setGoogleConnectionCount(connections.length);
      setGoogleConnections(connections);
      setGoogleCalendarConnectionId(
        (current) =>
          current ||
          connections.find((connection) => connection.is_default)?.id ||
          connections[0]?.id ||
          ''
      );
    } catch {
      setGoogleAvailable(false);
      setGoogleConnectionCount(0);
      setGoogleConnections([]);
    }
  }, []);

  const loadAvailableGoogleCalendars = useCallback(
    async (connectionId: string) => {
      if (!connectionId) return;
      setManagingCalendars(true);
      try {
        const response = await fetch(
          `/api/appointments/google?calendar_for=${encodeURIComponent(connectionId)}`,
          { cache: 'no-store' }
        );
        const payload = (await response.json().catch(() => null)) as {
          calendars?: GoogleCalendarOption[];
          error?: string;
        } | null;
        if (!response.ok)
          throw new Error(
            payload?.error ||
              'No se pudieron consultar los calendarios de Google.'
          );
        const calendars = payload?.calendars ?? [];
        setAvailableGoogleCalendars(calendars);
        setCalendarSourceId(connectionId);
        setCalendarToAdd(
          (current) =>
            current ||
            calendars.find(
              (calendar) =>
                !googleConnections.some(
                  (connection) =>
                    connection.calendar_id === calendar.id &&
                    connection.specialist_id ===
                      (googleConnections.find(
                        (connection) => connection.id === connectionId
                      )?.specialist_id ?? null)
                )
            )?.id ||
            ''
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los calendarios de Google.'
        );
      } finally {
        setManagingCalendars(false);
      }
    },
    [googleConnections]
  );

  const loadSpecialists = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments/specialists', { cache: 'no-store' });
      const payload = response.ok ? (await response.json()) as { specialists?: Specialist[] } : null;
      setSpecialists(payload?.specialists ?? []);
    } catch { setSpecialists([]); }
  }, []);

  useEffect(() => {
    void load();
    void loadGoogleConnection();
    void loadSpecialists();
  }, [load, loadGoogleConnection, loadSpecialists]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    void Promise.all([
      supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', accountId)
        .order('name')
        .limit(100),
      fetch('/api/account/members', { cache: 'no-store' }).then(
        async (response) =>
          response.ok
            ? (response.json() as Promise<{ members?: MemberOption[] }>)
            : null
      ),
    ])
      .then(([contactResult, memberPayload]) => {
        if (cancelled) return;
        setContacts((contactResult.data ?? []) as ContactOption[]);
        setMembers(
          (memberPayload?.members ?? []).filter((member) => member.is_active)
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setStartsAt('');
    setEndsAt('');
    setDuration(30);
    setContactId('');
    setAssignedAgentId('');
    setSpecialistId('');
    setNotes('');
    setGoogleCalendarConnectionId(
      googleConnections.find((connection) => !connection.specialist_id && connection.is_default)?.id ||
        googleConnections[0]?.id ||
        ''
    );
    setShowForm(false);
  }

  function startNew() {
    resetForm();
    setShowForm(true);
  }

  function editAppointment(appointment: Appointment) {
    const starts = new Date(appointment.starts_at);
    const ends = new Date(appointment.ends_at);
    setEditingId(appointment.id);
    setTitle(appointment.title);
    setStartsAt(localDateTime(starts));
    setEndsAt(localDateTime(ends));
    setDuration(
      Math.max(1, Math.round((ends.getTime() - starts.getTime()) / 60_000))
    );
    setContactId(appointment.contact_id ?? '');
    setAssignedAgentId(appointment.assigned_agent_id ?? '');
    setSpecialistId(appointment.specialist_id ?? '');
    setNotes(appointment.notes ?? '');
    setGoogleCalendarConnectionId(
      appointment.google_calendar_connection_id ?? ''
    );
    setShowForm(true);
    window.setTimeout(
      () =>
        document
          .getElementById('appointment-form')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0
    );
  }

  function updateStart(value: string) {
    setStartsAt(value);
    const start = new Date(value);
    if (!Number.isNaN(start.getTime()))
      setEndsAt(localDateTime(new Date(start.getTime() + duration * 60_000)));
  }

  function updateDuration(value: number) {
    setDuration(value);
    const start = new Date(startsAt);
    if (!Number.isNaN(start.getTime()))
      setEndsAt(localDateTime(new Date(start.getTime() + value * 60_000)));
  }

  function updateSpecialist(value: string) {
    setSpecialistId(value);
    const specialistCalendar = googleConnections.find(
      (connection) =>
        connection.specialist_id === (value || null) &&
        connection.is_default
    );
    const anySpecialistCalendar = googleConnections.find(
      (connection) => connection.specialist_id === (value || null)
    );
    const generalCalendar = googleConnections.find(
      (connection) => !connection.specialist_id && connection.is_default
    );
    setGoogleCalendarConnectionId(
      specialistCalendar?.id || anySpecialistCalendar?.id || generalCalendar?.id || ''
    );
  }

  async function saveAppointment(event: FormEvent) {
    event.preventDefault();
    if (!startsAt || !endsAt)
      return toast.error('Indica fecha y hora de inicio y término.');
    setSaving(true);
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        title,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        contact_id: contactId || null,
        assigned_agent_id: assignedAgentId || user?.id || null,
        specialist_id: specialistId || null,
        notes,
        google_calendar_connection_id: googleCalendarConnectionId || null,
      };
      const response = await fetch('/api/appointments', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo guardar la cita.');
      toast.success(
        editingId
          ? 'Cita actualizada y sincronizada con Google Calendar.'
          : 'Cita creada.'
      );
      resetForm();
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo guardar la cita.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!response.ok) {
      toast.error('No se pudo actualizar el estado.');
      return;
    }
    await load();
  }

  async function retryGoogleSync(id: string) {
    setSyncingId(id);
    try {
      const response = await fetch(`/api/appointments/${id}/google-sync`, {
        method: 'POST',
      });
      if (!response.ok)
        toast.error('No se pudo sincronizar con Google Calendar.');
      await load();
    } finally {
      setSyncingId(null);
    }
  }

  async function connectGoogle() {
    setConnectingGoogle(true);
    try {
      const response = await fetch('/api/appointments/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialist_id: googleTargetSpecialistId || null }),
      });
      const payload = (await response.json().catch(() => null)) as {
        authorize_url?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.authorize_url)
        throw new Error(
          payload?.error || 'No se pudo iniciar la conexión con Google.'
        );
      window.location.assign(payload.authorize_url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo conectar Google Calendar.'
      );
    } finally {
      setConnectingGoogle(false);
    }
  }

  async function addGoogleCalendar() {
    if (!calendarSourceId || !calendarToAdd) return;
    setManagingCalendars(true);
    try {
      const response = await fetch('/api/appointments/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_calendar',
          connection_id: calendarSourceId,
          calendar_id: calendarToAdd,
          specialist_id: addCalendarTargetSpecialistId || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo agregar el calendario.');
      toast.success(
        'Calendario agregado. Ya puedes seleccionarlo en cada cita.'
      );
      setCalendarToAdd('');
      setAddCalendarTargetSpecialistId('');
      await loadGoogleConnection();
      await loadAvailableGoogleCalendars(calendarSourceId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo agregar el calendario.'
      );
    } finally {
      setManagingCalendars(false);
    }
  }

  async function setDefaultGoogleCalendar(connectionId: string) {
    try {
      const response = await fetch('/api/appointments/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_default',
          connection_id: connectionId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          payload?.error ||
            'No se pudo actualizar el calendario predeterminado.'
        );
      toast.success('Calendario predeterminado actualizado.');
      await loadGoogleConnection();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo actualizar el calendario predeterminado.'
      );
    }
  }

  async function createSpecialist(event: FormEvent) {
    event.preventDefault();
    if (!newSpecialistName.trim())
      return toast.error('Indica el nombre del especialista.');
    try {
      const response = await fetch('/api/appointments/specialists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: newSpecialistName.trim(),
          specialty: newSpecialistSpecialty.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        specialist?: Specialist;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo crear el especialista.');
      toast.success('Especialista agregado.');
      setNewSpecialistName('');
      setNewSpecialistSpecialty('');
      await loadSpecialists();
      if (payload?.specialist) setGoogleTargetSpecialistId(payload.specialist.id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo crear el especialista.'
      );
    }
  }

  function startEditSpecialist(specialist: Specialist) {
    setEditingSpecialistId(specialist.id);
    setEditSpecialistName(specialist.full_name);
    setEditSpecialistSpecialty(specialist.specialty ?? '');
  }

  function cancelEditSpecialist() {
    setEditingSpecialistId(null);
    setEditSpecialistName('');
    setEditSpecialistSpecialty('');
  }

  async function saveSpecialist(event: FormEvent) {
    event.preventDefault();
    if (!editingSpecialistId) return;
    if (!editSpecialistName.trim())
      return toast.error('Indica el nombre del especialista.');
    setSavingSpecialist(true);
    try {
      const response = await fetch(
        `/api/appointments/specialists/${editingSpecialistId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: editSpecialistName.trim(),
            specialty: editSpecialistSpecialty.trim() || '',
          }),
        }
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          payload?.error || 'No se pudo actualizar el especialista.'
        );
      toast.success('Especialista actualizado.');
      cancelEditSpecialist();
      await loadSpecialists();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo actualizar el especialista.'
      );
    } finally {
      setSavingSpecialist(false);
    }
  }

  async function toggleSpecialistActive(specialist: Specialist) {
    try {
      const response = await fetch(
        `/api/appointments/specialists/${specialist.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !specialist.is_active }),
        }
      );
      if (!response.ok)
        throw new Error('No se pudo actualizar el especialista.');
      toast.success(
        specialist.is_active
          ? 'Especialista desactivado.'
          : 'Especialista reactivado.'
      );
      await loadSpecialists();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo actualizar el especialista.'
      );
    }
  }

  async function deleteSpecialist(specialist: Specialist) {
    if (
      !window.confirm(
        `¿Eliminar a ${specialist.full_name}? También se desconectarán sus calendarios de Google.`
      )
    )
      return;
    try {
      const response = await fetch(
        `/api/appointments/specialists/${specialist.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok)
        throw new Error('No se pudo eliminar el especialista.');
      toast.success('Especialista eliminado.');
      if (editingSpecialistId === specialist.id) cancelEditSpecialist();
      await Promise.all([loadSpecialists(), loadGoogleConnection()]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo eliminar el especialista.'
      );
    }
  }

  async function disconnectGoogleCalendar(connection: GoogleConnection) {
    if (
      !window.confirm(
        `¿Desconectar el calendario "${connection.display_name || connection.calendar_id}"? Las citas que lo usan dejarán de sincronizarse.`
      )
    )
      return;
    try {
      const response = await fetch(
        `/api/appointments/google?connection_id=${encodeURIComponent(connection.id)}`,
        { method: 'DELETE' }
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo desconectar el calendario.');
      toast.success('Calendario desconectado.');
      await loadGoogleConnection();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo desconectar el calendario.'
      );
    }
  }

  async function deleteAppointment(appointment: Appointment) {
    if (
      !window.confirm(
        `¿Eliminar la cita "${appointment.title}"? Esta acción no se puede deshacer.`
      )
    )
      return;
    try {
      const response = await fetch(
        `/api/appointments?id=${encodeURIComponent(appointment.id)}`,
        { method: 'DELETE' }
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo eliminar la cita.');
      toast.success('Cita eliminada.');
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo eliminar la cita.'
      );
    }
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex justify-center py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  if (enabled === false)
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <CalendarDays className="text-muted-foreground mx-auto size-8" />
        <h1 className="mt-3 text-lg font-semibold">Agenda deshabilitada</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Un administrador puede habilitar Agenda de citas desde Configuración →
          Objetivo operativo.
        </p>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="text-primary size-6" />
            Agenda de citas
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Crea, reagenda y conserva el historial de las citas del equipo.
          </p>
          {googleAvailable ? (
            <p
              className={
                googleConnectionCount
                  ? 'mt-1 text-xs text-emerald-600'
                  : 'mt-1 text-xs text-amber-600'
              }
            >
              {googleConnectionCount
                ? `${googleConnectionCount} calendario(s) Google conectado(s).`
                : 'Aún no hay un calendario Google conectado.'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {googleAvailable ? (
            <>
              <select
                value={googleTargetSpecialistId}
                onChange={(event) => setGoogleTargetSpecialistId(event.target.value)}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
                aria-label="Conectar calendario para"
              >
                <option value="">Calendario general de la empresa</option>
                {specialists.filter((specialist) => specialist.is_active).map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>
                    {specialist.full_name}{specialist.specialty ? ` · ${specialist.specialty}` : ''}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                onClick={() => void connectGoogle()}
                disabled={connectingGoogle}
              >
                {connectingGoogle ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Link2 />
                )}
                {googleTargetSpecialistId
                  ? 'Conectar calendario del especialista'
                  : 'Conectar cuenta de Google'}
              </Button>
            </>
          ) : null}
          <Button onClick={startNew}>
            <Plus />
            Nueva cita
          </Button>
        </div>
      </div>

      {googleAvailable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Especialistas</CardTitle>
            <CardDescription>
              Registra a cada médico o especialista con su nombre y
              especialidad. No necesitan una cuenta de agente: solo se usan
              para elegir con quién es la cita y qué calendario le corresponde.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={createSpecialist}
            >
              <label className="grid gap-1 text-sm">
                <span>Nombre</span>
                <Input
                  value={newSpecialistName}
                  onChange={(event) => setNewSpecialistName(event.target.value)}
                  placeholder="Dra. Ana López"
                  className="min-w-48"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>Especialidad</span>
                <Input
                  value={newSpecialistSpecialty}
                  onChange={(event) => setNewSpecialistSpecialty(event.target.value)}
                  placeholder="Odontología"
                  className="min-w-40"
                />
              </label>
              <Button type="submit" variant="outline">
                <Plus />
                Agregar especialista
              </Button>
            </form>
            {specialists.length > 0 ? (
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                {specialists.map((specialist) =>
                  editingSpecialistId === specialist.id ? (
                    <li key={specialist.id} className="rounded-lg border p-2">
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={saveSpecialist}
                      >
                        <Input
                          value={editSpecialistName}
                          onChange={(event) =>
                            setEditSpecialistName(event.target.value)
                          }
                          placeholder="Nombre"
                          className="min-w-32"
                        />
                        <Input
                          value={editSpecialistSpecialty}
                          onChange={(event) =>
                            setEditSpecialistSpecialty(event.target.value)
                          }
                          placeholder="Especialidad"
                          className="min-w-32"
                        />
                        <Button type="submit" size="sm" disabled={savingSpecialist}>
                          {savingSpecialist ? (
                            <Loader2 className="animate-spin" />
                          ) : null}
                          Guardar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelEditSpecialist}
                        >
                          <X />
                        </Button>
                      </form>
                    </li>
                  ) : (
                    <li
                      key={specialist.id}
                      className="text-muted-foreground flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span>
                        <span className="text-foreground font-medium">
                          {specialist.full_name}
                        </span>
                        {specialist.specialty ? ` · ${specialist.specialty}` : ''}
                        {!specialist.is_active ? ' · Inactivo' : ''}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEditSpecialist(specialist)}
                          aria-label="Editar especialista"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void toggleSpecialistActive(specialist)}
                        >
                          {specialist.is_active ? 'Desactivar' : 'Reactivar'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void deleteSpecialist(specialist)}
                          aria-label="Eliminar especialista"
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">
                Aún no hay especialistas registrados.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {googleAvailable && googleConnections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Calendarios Google conectados
            </CardTitle>
            <CardDescription>
              Elige el calendario de cada cita. Los cambios hechos directamente
              en Google se revisan automáticamente y quedan registrados con su
              origen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Calendario general de la empresa
              </p>
              {googleConnections.filter((connection) => !connection.specialist_id).length === 0 ? (
                <p className="text-muted-foreground text-xs">Sin conectar todavía.</p>
              ) : null}
              {googleConnections.filter((connection) => !connection.specialist_id).map((connection) => {
                const scopeCount = googleConnections.filter((item) => !item.specialist_id).length;
                return (
                  <div key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{connection.display_name || connection.calendar_id}{scopeCount > 1 && connection.is_default ? ' · Predeterminado' : ''}</p>
                      <p className="text-muted-foreground text-xs">
                        {connection.last_error
                          ? `Error de sincronización: ${connection.last_error}`
                          : connection.last_synced_at
                            ? `Sincronizado ${appointmentTime(connection.last_synced_at)}`
                            : 'Aún sin sincronizar'}
                      </p>
                    </div>
                    {scopeCount > 1 && !connection.is_default ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void setDefaultGoogleCalendar(connection.id)}>
                        Usar por defecto
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => void disconnectGoogleCalendar(connection)}>
                      Desconectar
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Especialistas
              </p>
              {googleConnections.filter((connection) => connection.specialist_id).length === 0 ? (
                <p className="text-muted-foreground text-xs">Ningún especialista tiene calendario conectado.</p>
              ) : null}
              {googleConnections.filter((connection) => connection.specialist_id).map((connection) => {
                const scopeCount = googleConnections.filter((item) => item.specialist_id === connection.specialist_id).length;
                return (
                  <div key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">
                        {connection.specialist?.full_name || 'Especialista'}
                        {connection.specialist?.specialty ? ` · ${connection.specialist.specialty}` : ''}
                        {scopeCount > 1 && connection.is_default ? ' · Predeterminado' : ''}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {connection.display_name || connection.calendar_id}
                        {connection.last_error
                          ? ` · Error de sincronización: ${connection.last_error}`
                          : connection.last_synced_at
                            ? ` · Sincronizado ${appointmentTime(connection.last_synced_at)}`
                            : ''}
                      </p>
                    </div>
                    {scopeCount > 1 && !connection.is_default ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void setDefaultGoogleCalendar(connection.id)}>
                        Usar por defecto
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => void disconnectGoogleCalendar(connection)}>
                      Desconectar
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="grid gap-1 text-sm">
                <span>Añadir otro calendario</span>
                <select
                  value={calendarSourceId}
                  onChange={(event) => {
                    setCalendarSourceId(event.target.value);
                    setAvailableGoogleCalendars([]);
                    setCalendarToAdd('');
                  }}
                  className="border-input h-9 min-w-56 rounded-lg border bg-transparent px-2 text-sm"
                >
                  <option value="">Selecciona una conexión</option>
                  {googleConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.display_name || connection.calendar_id}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!calendarSourceId || managingCalendars}
                onClick={() =>
                  void loadAvailableGoogleCalendars(calendarSourceId)
                }
              >
                {managingCalendars ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Ver calendarios de Google
              </Button>
              {availableGoogleCalendars.length > 0 ? (
                <>
                  <select
                    value={calendarToAdd}
                    onChange={(event) => setCalendarToAdd(event.target.value)}
                    className="border-input h-9 min-w-56 rounded-lg border bg-transparent px-2 text-sm"
                  >
                    <option value="">Selecciona el calendario a agregar</option>
                    {availableGoogleCalendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary}
                        {calendar.primary ? ' (principal)' : ''}
                      </option>
                    ))}
                  </select>
                  <select
                    value={addCalendarTargetSpecialistId}
                    onChange={(event) => setAddCalendarTargetSpecialistId(event.target.value)}
                    className="border-input h-9 min-w-48 rounded-lg border bg-transparent px-2 text-sm"
                  >
                    <option value="">Asignar a: Calendario general</option>
                    {specialists.filter((specialist) => specialist.is_active).map((specialist) => (
                      <option key={specialist.id} value={specialist.id}>
                        {specialist.full_name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    disabled={!calendarToAdd || managingCalendars}
                    onClick={() => void addGoogleCalendar()}
                  >
                    <Plus />
                    Agregar calendario
                  </Button>
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showForm ? (
        <Card id="appointment-form">
          <CardHeader>
            <CardTitle>
              {editingId ? 'Editar / reagendar cita' : 'Nueva cita'}
            </CardTitle>
            <CardDescription>
              {editingId
                ? 'Al guardar se actualiza esta misma cita y su evento existente en Google Calendar.'
                : 'La cita se sincroniza con el calendario elegido.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={saveAppointment}
            >
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Motivo de la cita"
                required
              />
              <select
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
              >
                <option value="">Sin contacto asociado</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name || contact.phone || 'Contacto sin nombre'}
                  </option>
                ))}
              </select>
              <select
                value={assignedAgentId}
                onChange={(event) => setAssignedAgentId(event.target.value)}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
                aria-label="Atiende (equipo interno)"
              >
                <option value="">Atiende: yo</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.full_name || 'Miembro sin nombre'}
                  </option>
                ))}
              </select>
              <select
                value={specialistId}
                onChange={(event) => updateSpecialist(event.target.value)}
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
                aria-label="Especialista"
              >
                <option value="">Sin especialista asignado</option>
                {specialists.filter((specialist) => specialist.is_active).map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>
                    {specialist.full_name}{specialist.specialty ? ` · ${specialist.specialty}` : ''}
                  </option>
                ))}
              </select>
              <select
                value={googleCalendarConnectionId}
                onChange={(event) =>
                  setGoogleCalendarConnectionId(event.target.value)
                }
                className="border-input h-9 rounded-lg border bg-transparent px-2 text-sm"
              >
                <option value="">Sin sincronización Google</option>
                {googleConnections
                  .filter((connection) => (connection.specialist_id ?? null) === (specialistId || null) || !connection.specialist_id)
                  .map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.specialist_id ? connection.specialist?.full_name || 'Especialista' : 'General'} · {connection.display_name || connection.calendar_id}
                  </option>
                ))}
              </select>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => updateStart(event.target.value)}
                required
              />
              <div className="flex flex-wrap gap-1 sm:col-span-2">
                {DURATIONS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={duration === value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateDuration(value)}
                  >
                    {value} min
                  </Button>
                ))}
              </div>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
              />
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Notas internas"
                rows={3}
                className="border-input resize-none rounded-lg border bg-transparent px-3 py-2 text-sm"
              />
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : null}
                  {editingId ? 'Guardar y reagendar' : 'Crear cita'}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  <X />
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loadError ? (
        <Card>
          <CardContent className="text-destructive pt-6 text-sm">
            No se pudieron cargar las citas: {loadError}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {appointments.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground pt-6 text-sm">
                No hay citas en los próximos 30 días.
              </CardContent>
            </Card>
          ) : (
            appointments.map((appointment) => (
              <Card key={appointment.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {appointment.title}
                      </CardTitle>
                      <CardDescription>
                        {appointment.contact?.name || 'Sin contacto'}
                        {appointment.specialist?.full_name
                          ? ` · ${appointment.specialist.full_name}${appointment.specialist.specialty ? ` (${appointment.specialist.specialty})` : ''}`
                          : ''}
                        {appointment.agent?.full_name
                          ? ` · Atiende: ${appointment.agent.full_name}`
                          : ''}
                      </CardDescription>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {STATUS[appointment.status] || appointment.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <span>{appointmentTime(appointment.starts_at)}</span>
                    {appointment.notes ? (
                      <p className="mt-1 text-xs">{appointment.notes}</p>
                    ) : null}
                    <p
                      className={
                        appointment.google_sync_status === 'failed'
                          ? 'text-destructive mt-1 text-xs'
                          : 'text-muted-foreground mt-1 text-xs'
                      }
                    >
                      {appointment.google_sync_status === 'synced'
                        ? 'Google Calendar sincronizado'
                        : appointment.google_sync_status === 'pending'
                          ? 'Google Calendar pendiente'
                          : appointment.google_sync_status === 'failed'
                            ? `Google Calendar: ${appointment.google_sync_error || 'Falló la sincronización.'}`
                            : 'Sin calendario Google conectado para este especialista'}
                    </p>
                    {auditLabel(appointment.latest_audit) ? (
                      <p className="text-muted-foreground mt-1 text-xs">{auditLabel(appointment.latest_audit)}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {appointment.google_sync_status !== 'synced' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void retryGoogleSync(appointment.id)}
                        disabled={syncingId === appointment.id}
                      >
                        {syncingId === appointment.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RefreshCw />
                        )}
                        Reintentar Google
                      </Button>
                    ) : null}
                    {['scheduled', 'confirmed'].includes(appointment.status) ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => editAppointment(appointment)}
                        >
                          <Pencil />
                          Editar / reagendar
                        </Button>
                        {appointment.status === 'scheduled' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void updateStatus(appointment.id, 'confirmed')
                            }
                          >
                            <CheckCircle2 />
                            Confirmar
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void updateStatus(appointment.id, 'completed')
                          }
                        >
                          <ClipboardCheck />
                          Completar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void updateStatus(appointment.id, 'no_show')
                          }
                        >
                          <UserRoundX />
                          No asistió
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() =>
                            void updateStatus(appointment.id, 'cancelled')
                          }
                        >
                          <CircleX />
                          Cancelar
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void deleteAppointment(appointment)}
                    >
                      <Trash2 />
                      Eliminar
                    </Button>
                  </div>
                </CardContent>
                {appointment.status === 'completed' ? (
                  <p className="text-muted-foreground px-6 pb-5 text-xs">
                    Cita realizada: se conserva como historial y no se elimina
                    del calendario.
                  </p>
                ) : null}
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
