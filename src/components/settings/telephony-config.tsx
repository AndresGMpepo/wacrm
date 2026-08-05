'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Phone, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useTelephony } from '@/components/telephony/telephony-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

export function TelephonyConfig() {
  const { profile } = useAuth();
  const telephony = useTelephony();
  const canManageIntegration = profile?.account_role === 'owner' || profile?.account_role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [integrationReady, setIntegrationReady] = useState(false);
  const [pbxUrl, setPbxUrl] = useState('');
  const [extension, setExtension] = useState('');
  const [accessId, setAccessId] = useState('');
  const [accessKey, setAccessKey] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/config');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (payload.config) {
        setIntegrationReady(true);
        setPbxUrl(payload.config.pbx_url);
        setExtension(payload.config.extension ?? '');
      }
    } catch {
      toast.error('No se pudo cargar la configuración de telefonía.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/telephony/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pbxUrl, extension, accessId, accessKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setAccessId('');
      setAccessKey('');
      toast.success('Tu extensión fue guardada. El softphone se conectará automáticamente.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const led = telephony.connected ? 'bg-emerald-500' : telephony.connecting ? 'animate-pulse bg-amber-400' : 'bg-red-500';
  const firstIntegration = canManageIntegration && !integrationReady;
  const cannotSave = saving || loading || !extension.trim() || (firstIntegration && (!pbxUrl || !accessId || !accessKey));

  return (
    <div>
      <SettingsPanelHead title="Telefonía" description="La integración Yeastar es común para el equipo; tu extensión es privada y solo se usa en tu sesión de WACRM." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="size-4" /> Yeastar WebRTC</CardTitle>
          <CardDescription className="flex items-center gap-2"><span className={`size-2 rounded-full ${led}`} />{telephony.connected ? `Conectado como extensión ${extension}` : extension ? 'Tu extensión está guardada; se reconectará automáticamente.' : 'Registra tu extensión asignada para conectar el softphone.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="my-extension">Mi extensión</Label>
            <Input id="my-extension" value={extension} onChange={(event) => setExtension(event.target.value)} placeholder="1000" disabled={loading || saving || (!integrationReady && !canManageIntegration)} />
            <p className="text-xs text-muted-foreground">No se comparte con otros usuarios de WACRM.</p>
          </div>

          {canManageIntegration ? <>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="pbx-url">URL del PBX</Label><Input id="pbx-url" value={pbxUrl} onChange={(event) => setPbxUrl(event.target.value)} placeholder="https://pbx.example.com" disabled={loading || saving} /></div>
            <div className="space-y-2"><Label htmlFor="linkus-id">Access ID de Linkus SDK</Label><Input id="linkus-id" value={accessId} onChange={(event) => setAccessId(event.target.value)} placeholder={integrationReady ? 'Guardado — escribe solo para reemplazarlo' : ''} disabled={loading || saving} /></div>
            <div className="space-y-2"><Label htmlFor="linkus-key">Access Key de Linkus SDK</Label><Input id="linkus-key" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={integrationReady ? 'Guardada — escribe solo para reemplazarla' : ''} disabled={loading || saving} /></div>
          </> : <p className="text-sm text-muted-foreground md:col-span-2">La URL y las credenciales de Yeastar son administradas por el equipo. Solo puedes configurar tu propia extensión.</p>}

          <Button className="w-fit" onClick={() => void save()} disabled={cannotSave}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{extension ? 'Guardar mi extensión' : 'Guardar extensión'}</Button>
        </CardContent>
      </Card>
      {canManageIntegration ? <Card className="mt-6">
        <CardHeader>
          <CardTitle>Guía de integración: Yeastar Linkus SDK</CardTitle>
          <CardDescription>Esta configuración conecta WACRM directamente con Yeastar mediante firmas Linkus temporales. La contraseña SIP de una extensión nunca se guarda ni se envía al navegador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>En Yeastar, habilita <strong>Linkus SDK</strong> y crea o consulta el <strong>Access ID</strong> y <strong>Access Key</strong> de la integración.</li>
            <li>Usa la URL HTTPS pública de tu PBX, por ejemplo <code>https://tu-pbx.ras.yeastar.com</code>. No uses la URL WSS de transmisión de audio para este formulario.</li>
            <li>Como administrador, registra la URL, Access ID y Access Key una sola vez para tu cuenta WACRM.</li>
            <li>Cada miembro de la cuenta guarda únicamente su propia extensión, por ejemplo 1000 o 1008. Una extensión no se comparte ni reemplaza la de otro agente.</li>
            <li>Guarda la configuración y permite el micrófono cuando el navegador lo solicite. La cámara solo se solicita al iniciar o responder una videollamada.</li>
          </ol>
          <p className="rounded-md border border-primary/30 bg-primary/10 p-3 text-primary"><strong>Seguridad:</strong> Access ID y Access Key quedan cifrados en el servidor. WACRM solicita a Yeastar una firma temporal para la extensión del usuario conectado; nunca reutiliza la firma de otro usuario.</p>
        </CardContent>
      </Card> : null}
    </div>
  );
}
