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
  webhook_url?: string;
};

/**
 * AgendaPro ("Agendapro Public V1" — agendapro.com/api/public/v1) connection.
 * Authenticates with the USER + PASSWORD pair shown once in AgendaPro's own
 * "Configuraciones → API Pública" panel (HTTP Basic Auth), NOT an API key —
 * this account's plan does not use the newer Bearer-key "Connect v3" API.
 * Independent from the internal Appointments module. Plain Spanish,
 * self-contained fetches (same convention as Nexo Memory/Appointments),
 * not next-intl.
 */
export function AgendaProConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [apiUser, setApiUser] = useState('');
  const [apiPassword, setApiPassword] = useState('');

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
    if (!apiUser.trim() || !apiPassword.trim()) {
      toast.error('Ingresa el usuario y la contraseña de la API de AgendaPro.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/agendapro/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_user: apiUser, api_password: apiPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo conectar AgendaPro.');
      setApiUser('');
      setApiPassword('');
      toast.success('AgendaPro conectado correctamente.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo conectar AgendaPro.');
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
          Conecta tu cuenta de AgendaPro (reservas, clientes y pagos) con el usuario y contraseña de
          &quot;Configuraciones → API Pública&quot; dentro de tu panel de AgendaPro. Este módulo es independiente
          del módulo de Citas interno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {config?.connected ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Conectado{config.last_error ? ` — último error: ${config.last_error}` : '.'}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="agendapro-api-user">Usuario (API Pública)</Label>
              <Input
                id="agendapro-api-user"
                placeholder="Ej. arqrcq16"
                value={apiUser}
                onChange={(event) => setApiUser(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agendapro-api-password">Contraseña</Label>
              <Input
                id="agendapro-api-password"
                type="password"
                placeholder="Pega aquí la contraseña"
                value={apiPassword}
                onChange={(event) => setApiPassword(event.target.value)}
              />
            </div>
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
                Pega esta URL en AgendaPro → Configuraciones → API Pública → Webhooks (botón &quot;Crear Webhook&quot;).
                AgendaPro no firma estas notificaciones, así que mantén esta URL en secreto — es lo único que
                protege este canal.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={config.webhook_url ?? ''} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyWebhookUrl} aria-label="Copiar URL del webhook">
                  <Copy className="h-4 w-4" />
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

