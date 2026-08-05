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
  const { profile } = useAuth(); const telephony = useTelephony();
  const canManage = profile?.account_role === 'owner' || profile?.account_role === 'admin';
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  const [pbxUrl, setPbxUrl] = useState(''); const [extension, setExtension] = useState(''); const [accessId, setAccessId] = useState(''); const [accessKey, setAccessKey] = useState('');
  const load = useCallback(async () => { try { const r = await fetch('/api/telephony/config'); const p = await r.json(); if (!r.ok) throw new Error(p.error); if (p.config) { setPbxUrl(p.config.pbx_url); setExtension(p.config.extension ?? ''); setSaved(true); } } catch { toast.error('No se pudo cargar la configuración de telefonía.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function save() { setSaving(true); try { const r = await fetch('/api/telephony/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pbxUrl, extension, accessId, accessKey }) }); const p = await r.json(); if (!r.ok) throw new Error(p.error); setAccessId(''); setAccessKey(''); setSaved(true); toast.success('Configuración guardada. El softphone se conectará automáticamente.'); } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'); } finally { setSaving(false); } }
  const led = telephony.connected ? 'bg-emerald-500' : telephony.connecting ? 'bg-amber-400 animate-pulse' : 'bg-red-500';
  return <div><SettingsPanelHead title="Telefonía" description="Configura Yeastar una sola vez. El softphone se inicia automáticamente al entrar a WACRM." /><Card><CardHeader><CardTitle className="flex items-center gap-2"><Phone className="size-4" /> Yeastar WebRTC</CardTitle><CardDescription className="flex items-center gap-2"><span className={`size-2 rounded-full ${led}`} />{telephony.connected ? 'Extensión conectada' : telephony.connecting ? 'Conectando…' : saved ? 'Extensión desconectada; se reintentará automáticamente.' : 'Aún sin configurar'}</CardDescription></CardHeader><CardContent>{canManage ? <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2 md:col-span-2"><Label>URL del PBX</Label><Input value={pbxUrl} onChange={e => setPbxUrl(e.target.value)} placeholder="https://pbx.example.com" /></div><div className="space-y-2"><Label>Extensión</Label><Input value={extension} onChange={e => setExtension(e.target.value)} placeholder="1000" /></div><div className="space-y-2"><Label>Access ID de Linkus SDK</Label><Input value={accessId} onChange={e => setAccessId(e.target.value)} placeholder={saved ? 'Guardado — escribe solo para reemplazarlo' : ''} /></div><div className="space-y-2 md:col-span-2"><Label>Access Key de Linkus SDK</Label><Input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder={saved ? 'Guardada — escribe solo para reemplazarla' : ''} /></div><Button onClick={() => void save()} disabled={saving || loading || !pbxUrl || !extension || (!saved && (!accessId || !accessKey))}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saved ? 'Actualizar configuración' : 'Guardar conexión'}</Button></div> : <p className="text-sm text-muted-foreground">La configuración está protegida y solo puede editarla un administrador.</p>}</CardContent></Card></div>;
}
