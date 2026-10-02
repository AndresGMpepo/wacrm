'use client';

import { useCallback, useEffect, useState } from 'react';
import { Palette, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { STATUS_COLOR_PALETTE, colorForStatus, normalizeStatusKey } from '@/lib/agendapro/status-colors';

type ApiResponse = { colors: Record<string, string>; suggested_statuses: string[]; error?: string };

/**
 * Lets an account override the calendar's deterministic default color
 * for any AgendaPro status (see status-colors.ts for why there's no
 * hardcoded status→color mapping — AgendaPro's status_name values
 * aren't a documented fixed set). Pre-fills suggestions from statuses
 * actually seen in synced bookings, but also accepts a free-text status
 * for anything the local cache hasn't seen yet.
 */
export function AgendaProStatusColors() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [newStatus, setNewStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/agendapro/status-colors', { cache: 'no-store' });
      if (response.status === 404) {
        setAvailable(false);
        return;
      }
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los colores.');
      setColors(payload.colors);
      // Union of already-configured keys and suggestions seen in bookings,
      // so a status that was overridden but later disappears from the
      // cache doesn't vanish from the list.
      const keys = new Set([...payload.suggested_statuses, ...Object.keys(payload.colors)]);
      setStatuses(Array.from(keys).sort());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los colores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setColorFor(status: string, color: string) {
    setColors((prev) => ({ ...prev, [normalizeStatusKey(status)]: color }));
  }

  function addStatus() {
    const trimmed = newStatus.trim();
    if (!trimmed) return;
    if (!statuses.includes(trimmed)) setStatuses((prev) => [...prev, trimmed].sort());
    setNewStatus('');
  }

  function removeStatus(status: string) {
    setStatuses((prev) => prev.filter((s) => s !== status));
    setColors((prev) => {
      const next = { ...prev };
      delete next[normalizeStatusKey(status)];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/status-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colors }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudieron guardar los colores.');
      toast.success('Colores guardados.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los colores.');
    } finally {
      setSaving(false);
    }
  }

  if (!available) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" />
          Colores del calendario por estado
        </CardTitle>
        <CardDescription>
          AgendaPro no comparte un código de colores fijo por API, así que cada estado arranca con un color
          automático (siempre el mismo para el mismo estado). Ajusta aquí el de cualquier estado para que
          coincida con el que usas en AgendaPro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no se han sincronizado reservas con un estado. Agrega uno manualmente o espera a que llegue
              la primera reserva por el webhook.
            </p>
          ) : (
            statuses.map((status) => {
              const current = colorForStatus(status, colors);
              return (
                <div key={status} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <span className="min-w-[10rem] flex-1 text-sm font-medium text-foreground">{status}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_COLOR_PALETTE.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        aria-label={`Usar color ${swatch} para ${status}`}
                        onClick={() => setColorFor(status, swatch)}
                        className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{ backgroundColor: swatch, borderColor: current === swatch ? 'var(--foreground)' : 'transparent' }}
                      />
                    ))}
                  </div>
                  <Button variant="outline" size="icon" onClick={() => removeStatus(status)} aria-label={`Quitar ${status}`}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder='Agregar un estado, ej. "No show"'
            value={newStatus}
            onChange={(event) => setNewStatus(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addStatus(); } }}
          />
          <Button variant="outline" onClick={addStatus}>
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar colores
        </Button>
      </CardContent>
    </Card>
  );
}
