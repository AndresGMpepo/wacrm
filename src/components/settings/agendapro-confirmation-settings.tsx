'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Settings = {
  enabled: boolean;
  receptionPhone: string | null;
  confirmationTemplateName: string;
  confirmationTemplateLanguage: string;
  receptionTemplateName: string;
  receptionTemplateLanguage: string;
};

const DEFAULTS: Settings = {
  enabled: false,
  receptionPhone: '',
  confirmationTemplateName: 'confirmacion_cita_24h',
  confirmationTemplateLanguage: 'es_MX',
  receptionTemplateName: 'aviso_recepcion_cita_sin_confirmar',
  receptionTemplateLanguage: 'es_MX',
};

/**
 * 24h-before WhatsApp confirmation for AgendaPro bookings. Only rendered
 * once AgendaPro is connected (see agendapro-config.tsx) — the backing
 * row (agendapro_configs) only exists after that. See
 * docs/manuals/integraciones/agendapro.md for the full flow this turns
 * on and exactly what to submit in Settings → Plantillas before enabling it.
 */
export function AgendaProConfirmationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/agendapro/confirmation-settings', { cache: 'no-store' });
      if (response.status === 404) {
        setAvailable(false);
        return;
      }
      const payload = (await response.json()) as Settings & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la configuración.');
      setSettings({ ...payload, receptionPhone: payload.receptionPhone ?? '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la configuración.');
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
      const response = await fetch('/api/agendapro/confirmation-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          reception_phone: settings.receptionPhone || null,
          confirmation_template_name: settings.confirmationTemplateName,
          confirmation_template_language: settings.confirmationTemplateLanguage,
          reception_template_name: settings.receptionTemplateName,
          reception_template_language: settings.receptionTemplateLanguage,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'No se pudo guardar la configuración.');
      toast.success('Configuración de confirmaciones guardada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la configuración.');
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
          <BellRing className="h-4 w-4" />
          Confirmación de citas por WhatsApp
        </CardTitle>
        <CardDescription>
          24 horas antes de cada cita de AgendaPro se envía un mensaje de WhatsApp (plantilla aprobada por
          Meta) pidiendo al cliente responder <strong>SI</strong> o <strong>NO</strong>. Si responde NO, o si
          no responde nada en 6 horas, recepción recibe un aviso para reagendar o cancelar. Revisa cómo crear
          las dos plantillas requeridas en el manual de AgendaPro antes de activarlo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Activar confirmación automática</p>
            <p className="text-xs text-muted-foreground">
              No actives esto hasta que ambas plantillas de abajo estén aprobadas por Meta.
            </p>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings((s) => ({ ...s, enabled: checked }))} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="agendapro-reception-phone">Teléfono de recepción (aviso por WhatsApp)</Label>
          <Input
            id="agendapro-reception-phone"
            placeholder="+52 55 1234 5678"
            value={settings.receptionPhone ?? ''}
            onChange={(event) => setSettings((s) => ({ ...s, receptionPhone: event.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            Además de un aviso dentro de NexoOmni, se envía un WhatsApp a este número cuando una cita queda
            sin confirmar. Déjalo vacío para recibir solo el aviso interno.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agendapro-confirmation-template">Plantilla de confirmación (cliente)</Label>
            <Input
              id="agendapro-confirmation-template"
              value={settings.confirmationTemplateName}
              onChange={(event) => setSettings((s) => ({ ...s, confirmationTemplateName: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agendapro-confirmation-template-lang">Idioma de la plantilla</Label>
            <Input
              id="agendapro-confirmation-template-lang"
              value={settings.confirmationTemplateLanguage}
              onChange={(event) => setSettings((s) => ({ ...s, confirmationTemplateLanguage: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agendapro-reception-template">Plantilla de aviso (recepción)</Label>
            <Input
              id="agendapro-reception-template"
              value={settings.receptionTemplateName}
              onChange={(event) => setSettings((s) => ({ ...s, receptionTemplateName: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agendapro-reception-template-lang">Idioma de la plantilla</Label>
            <Input
              id="agendapro-reception-template-lang"
              value={settings.receptionTemplateLanguage}
              onChange={(event) => setSettings((s) => ({ ...s, receptionTemplateLanguage: event.target.value }))}
            />
          </div>
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}
