'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Copy, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ConfigResponse = {
  connected: boolean;
  status?: 'configured' | 'active' | 'error';
  last_error?: string | null;
  has_webhook_secret?: boolean;
  webhook_url?: string;
};

/**
 * AgendaPro (developers.agendapro.com) connection — one API key per tenant,
 * independent from the internal Appointments module. Plain Spanish,
 * self-contained fetches (same convention as Nexo Memory/Appointments),
 * not next-intl.
 */
export function AgendaProConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/agendapro/config', { cache: 'no-store' });
      const payload = (await response.json()) as ConfigResponse;
      if (!response.ok) throw new Error('No se pudo cargar la configuración de AgendaPro.');
      setConfig(payload);
    } catch {
      toast.error('No se pudo cargar la configuración de AgendaPro.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    if (!apiKey.trim()) {
      toast.error('Ingresa tu API key de AgendaPro.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo conectar AgendaPro.');
      setApiKey('');
      toast.success('AgendaPro conectado correctamente.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo conectar AgendaPro.');
    } finally {
      setSaving(false);
    }
  }

  async function saveWebhookSecret() {
    if (!webhookSecret.trim()) {
      toast.error('Pega el secreto del webhook que te mostró AgendaPro.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_secret: webhookSecret }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el secreto.');
      setWebhookSecret('');
      toast.success('Secreto del webhook guardado.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el secreto.');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('¿Desconectar AgendaPro de esta cuenta?')) return;
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/config', { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo desconectar AgendaPro.');
      toast.success('AgendaPro desconectado.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo desconectar AgendaPro.');
    } finally {
      setSaving(false);
    }
  }

  function copyWebhookUrl() {
    if (!config?.webhook_url) return;
    void navigator.clipboard.writeText(config.webhook_url);
    toast.success('URL del webhook copiada.');
  }

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
          <CalendarClock className="h-4 w-4" />
          AgendaPro
        </CardTitle>
        <CardDescription>
          Conecta tu cuenta de AgendaPro (reservas, clientes y pagos) con una API key propia de tu empresa.
          Este módulo es independiente del módulo de Citas interno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {config?.connected ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Conectado{config.last_error ? ` — último error: ${config.last_error}` : '.'}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="agendapro-api-key">API key de AgendaPro</Label>
            <Input
              id="agendapro-api-key"
              type="password"
              placeholder="Pega aquí tu API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button onClick={() => void connect()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Conectar
            </Button>
          </div>
        )}

        {config?.connected ? (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label>URL del webhook</Label>
              <p className="text-xs text-muted-foreground">
                Pega esta URL en AgendaPro → Configuraciones → Integraciones, suscríbete a los eventos de reservas,
                clientes y pagos, y copia el secreto que te entregan en el campo de abajo.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={config.webhook_url ?? ''} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyWebhookUrl} aria-label="Copiar URL del webhook">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agendapro-webhook-secret">
                Secreto del webhook {config.has_webhook_secret ? '(ya configurado — pega uno nuevo para reemplazarlo)' : ''}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="agendapro-webhook-secret"
                  type="password"
                  placeholder="whsec_..."
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                />
                <Button variant="outline" onClick={() => void saveWebhookSecret()} disabled={saving}>
                  Guardar
                </Button>
              </div>
            </div>

            <Button variant="outline" className="text-destructive" onClick={() => void disconnect()} disabled={saving}>
              <Trash2 className="h-4 w-4" />
              Desconectar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
