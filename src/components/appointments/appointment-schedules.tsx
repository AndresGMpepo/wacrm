'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Schedule = {
  id: string;
  specialist_id: string | null;
  agent_user_id: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  slot_minutes: number;
  buffer_minutes: number;
};

type Specialist = { id: string; full_name: string; is_active: boolean };

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Working hours behind slot availability. A schedule with no specialist is
 * the account default, used by anyone without hours of their own.
 */
export function AppointmentSchedules({
  specialists,
  canEdit,
}: {
  specialists: Specialist[];
  canEdit: boolean;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    specialist_id: '',
    weekday: '1',
    start_time: '09:00',
    end_time: '18:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    slot_minutes: '30',
    buffer_minutes: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/appointments/schedules', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? 'No se pudieron cargar los horarios.');
        return;
      }
      setSchedules(body.schedules ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setSaving(true);
    try {
      const res = await fetch('/api/appointments/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialist_id: form.specialist_id || null,
          weekday: Number(form.weekday),
          start_time: form.start_time,
          end_time: form.end_time,
          timezone: form.timezone,
          slot_minutes: Number(form.slot_minutes),
          buffer_minutes: Number(form.buffer_minutes),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? 'No se pudo guardar el horario.');
        return;
      }
      toast.success('Horario agregado');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/appointments/schedules?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('No se pudo eliminar el horario.');
      return;
    }
    setSchedules((rows) => rows.filter((row) => row.id !== id));
  }

  const specialistName = (id: string | null) =>
    id ? specialists.find((s) => s.id === id)?.full_name ?? 'Especialista' : 'Toda la empresa';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="text-primary size-4" />
          Horarios de atención
        </CardTitle>
        <CardDescription>
          Definen los huecos que se ofrecen al agendar. Sin horarios no hay disponibilidad que calcular.
          Un horario sin especialista aplica a toda la empresa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : schedules.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aún no hay horarios configurados.</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">{WEEKDAYS[schedule.weekday]}</span>
                <span>
                  {schedule.start_time.slice(0, 5)} – {schedule.end_time.slice(0, 5)}
                </span>
                <span className="text-muted-foreground text-xs">{schedule.timezone}</span>
                <span className="text-muted-foreground text-xs">
                  citas de {schedule.slot_minutes} min
                  {schedule.buffer_minutes ? ` · ${schedule.buffer_minutes} min de margen` : ''}
                </span>
                <span className="text-primary text-xs">{specialistName(schedule.specialist_id)}</span>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => void remove(schedule.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="space-y-1">
              <Label className="text-xs">Especialista</Label>
              <select
                value={form.specialist_id}
                onChange={(e) => setForm((f) => ({ ...f, specialist_id: e.target.value }))}
                className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
              >
                <option value="">Toda la empresa</option>
                {specialists.filter((s) => s.is_active).map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Día</Label>
              <select
                value={form.weekday}
                onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value }))}
                className="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duración (min)</Label>
              <Input type="number" min={5} max={480} value={form.slot_minutes} onChange={(e) => setForm((f) => ({ ...f, slot_minutes: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Margen (min)</Label>
              <Input type="number" min={0} max={240} value={form.buffer_minutes} onChange={(e) => setForm((f) => ({ ...f, buffer_minutes: e.target.value }))} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void add()} disabled={saving} className="w-full">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Agregar
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
