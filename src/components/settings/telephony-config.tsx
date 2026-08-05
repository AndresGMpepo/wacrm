'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Phone, PhoneOff, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

type YeastarPhone = {
  start: () => unknown;
  call: (number: string) => Promise<unknown>;
  hangup: (callId: string) => boolean;
  currentSessionID: string | null;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export function TelephonyConfig() {
  const { profile } = useAuth();
  const canManage = profile?.account_role === 'owner' || profile?.account_role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [number, setNumber] = useState('');
  const [pbxUrl, setPbxUrl] = useState('https://voice-aurionova.ras.yeastar.com');
  const [extension, setExtension] = useState('');
  const [accessId, setAccessId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const phoneRef = useRef<YeastarPhone | null>(null);
  const destroyRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/config');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load telephony settings.');
      if (payload.config) {
        setPbxUrl(payload.config.pbx_url);
        setExtension(payload.config.extension || '');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load telephony settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => destroyRef.current?.();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/telephony/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pbxUrl, extension, accessId, accessKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to save Yeastar settings.');
      setAccessId('');
      setAccessKey('');
      toast.success('Yeastar configured. Credentials are encrypted on the server.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save Yeastar settings.');
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch('/api/telephony/yeastar/signature', { method: 'POST' });
      const credentials = await response.json();
      if (!response.ok) throw new Error(credentials.error || 'Unable to connect to Yeastar.');
      destroyRef.current?.();
      const sdk = await import('ys-webrtc-sdk-core');
      const operator = await sdk.init({ username: credentials.extension, secret: credentials.secret, pbxURL: credentials.pbxUrl });
      phoneRef.current = operator.phone as YeastarPhone;
      destroyRef.current = operator.destroy;
      operator.phone.on('registered', () => setRegistered(true));
      operator.phone.on('registrationFailed', () => setRegistered(false));
      operator.phone.on('disconnected', () => setRegistered(false));
      operator.phone.on('incoming', () => toast.info('Incoming Yeastar call. Open the dialer to answer it.'));
      operator.phone.start();
      setRegistered(true);
      toast.success(`Extension ${credentials.extension} connected.`);
    } catch (error) {
      setRegistered(false);
      toast.error(error instanceof Error ? error.message : 'Unable to connect to Yeastar.');
    } finally {
      setConnecting(false);
    }
  }

  async function call() {
    if (!phoneRef.current || !number.trim()) return;
    try {
      await phoneRef.current.call(number.trim());
    } catch {
      toast.error('Yeastar could not start the call.');
    }
  }

  function hangup() {
    const phone = phoneRef.current;
    if (phone?.currentSessionID) phone.hangup(phone.currentSessionID);
  }

  return (
    <div>
      <SettingsPanelHead title="Telefonía" description="Conecta una extensión de Yeastar a WACRM. La integración usa firmas Linkus temporales, nunca la contraseña SIP en el navegador." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Phone className="size-4" /> Yeastar WebRTC</CardTitle>
          <CardDescription>Primer conector de la capa de telefonía SIP. Las próximas integraciones podrán usar el mismo dialer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {canManage ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2"><Label htmlFor="pbx-url">URL del PBX</Label><Input id="pbx-url" value={pbxUrl} onChange={(event) => setPbxUrl(event.target.value)} placeholder="https://pbx.example.com" /></div>
              <div className="space-y-2"><Label htmlFor="extension">Extensión de prueba</Label><Input id="extension" value={extension} onChange={(event) => setExtension(event.target.value)} placeholder="1000" /></div>
              <div className="space-y-2"><Label htmlFor="access-id">Linkus SDK Access ID</Label><Input id="access-id" value={accessId} onChange={(event) => setAccessId(event.target.value)} placeholder="Solo al guardar" /></div>
              <div className="space-y-2 md:col-span-2"><Label htmlFor="access-key">Linkus SDK Access Key</Label><Input id="access-key" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Solo al guardar" /></div>
              <Button onClick={save} disabled={saving || !accessId || !accessKey}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar conexión</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">Un administrador debe guardar las credenciales Linkus SDK de la cuenta.</p>}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-600" /> {registered ? 'Extensión conectada' : 'Extensión desconectada'}</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={connect} disabled={connecting || !extension || loading}>{connecting ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}{registered ? 'Reconectar' : 'Conectar softphone'}</Button>
              <Input value={number} onChange={(event) => setNumber(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void call()} className="max-w-xs" placeholder="Número a llamar" disabled={!registered} />
              <Button onClick={() => void call()} disabled={!registered || !number.trim()}><Phone className="size-4" /> Llamar</Button>
              <Button variant="destructive" onClick={hangup} disabled={!phoneRef.current?.currentSessionID}><PhoneOff className="size-4" /> Colgar</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
