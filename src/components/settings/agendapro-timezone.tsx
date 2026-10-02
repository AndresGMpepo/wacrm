'use client';

import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * AgendaPro's API mislabels every booking's start/end as UTC ("Z") when
 * it's actually the clinic's own local wall-clock time — confirmed by
 * comparing AgendaPro's own calendar against NexoOmni's side by side
 * (every booking showed up to this zone's UTC offset too early). This
 * zone is what src/lib/agendapro/time.ts uses to correct it, both for
 * the live calendar and for the webhook-synced cache that backs the
 * 24h confirmation reminder (see supabase/migrations/136).
 */
export function AgendaProTimezone() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [timezone, setTimezone] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/agendapro/timezone', { cache: 'no-store' });
      if (response.status === 404) {
        setAvailable(false);
        return;
      }
      const payload = (await response.json()) as { timezone?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la zona horaria.');
      setTimezone(payload.timezone || 'America/Mexico_City');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la zona horaria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo guardar la zona horaria.');
      toast.success('Zona horaria guardada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la zona horaria.');
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
          <Globe className="h-4 w-4" />
          Zona horaria de AgendaPro
        </CardTitle>
        <CardDescription>
          La zona horaria real donde operan tus locales de AgendaPro — necesaria para mostrar y registrar la
          hora correcta de cada cita. Solo cámbiala si tus locales NO operan en Ciudad de México.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="agendapro-timezone">Zona horaria (IANA)</Label>
          <Input
            id="agendapro-timezone"
            placeholder="America/Mexico_City"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}
