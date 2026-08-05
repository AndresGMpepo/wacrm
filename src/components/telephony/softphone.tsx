'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneCall, PhoneForwarded, PhoneOff, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTelephony } from './telephony-provider';

export function Softphone() {
  const t = useTelephony();
  const [number, setNumber] = useState('');
  const [transfer, setTransfer] = useState<'blind' | 'attended' | null>(null);
  const [muted, setMuted] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = t.localStream; if (remoteVideo.current) remoteVideo.current.srcObject = t.remoteStream; }, [t.localStream, t.remoteStream]);
  if (!t.configured) return null;
  const inCall = Boolean(t.active || t.incoming);
  const submitTransfer = () => { if (transfer && number.trim()) { t.transfer(number, transfer === 'attended'); setNumber(''); setTransfer(null); } };
  return <div className="relative">
    <Button variant={t.connected ? 'default' : 'secondary'} size="icon" onClick={() => t.setOpen(!t.open)} aria-label="Teléfono" className="relative"><Phone className="size-4" /><span className={`absolute right-0.5 top-0.5 size-2 rounded-full ring-2 ring-background ${t.connected ? 'bg-emerald-400' : t.connecting ? 'animate-pulse bg-amber-400' : 'bg-red-500'}`} /></Button>
    {t.incoming ? <div className="fixed right-4 bottom-4 z-50 w-80 rounded-xl border bg-card p-4 shadow-2xl"><p className="font-semibold">Llamada entrante</p><p className="mb-3 text-sm text-muted-foreground">{t.status}</p><div className="flex gap-2"><Button onClick={() => void t.answer(false)}><PhoneCall />Contestar</Button><Button variant="destructive" onClick={t.reject}><PhoneOff />Rechazar</Button></div></div> : null}
    {t.open ? <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border bg-card p-4 shadow-2xl"><div className="mb-3 flex items-center justify-between"><div><b>Softphone</b><p className="text-xs text-muted-foreground">{t.status || (t.connected ? 'Conectado' : t.connecting ? 'Conectando…' : 'Desconectado')}</p></div><Button size="icon" variant="ghost" onClick={() => t.setOpen(false)}><X /></Button></div>
      {t.localStream || t.remoteStream ? <div className="mb-3 grid grid-cols-2 gap-2"><video ref={remoteVideo} autoPlay playsInline className="aspect-video w-full rounded bg-black" /><video ref={localVideo} autoPlay muted playsInline className="aspect-video w-full rounded bg-black" /></div> : null}
      {transfer ? <><Input autoFocus placeholder="Extensión destino" value={number} onChange={e => setNumber(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitTransfer()} /><div className="mt-2 flex gap-2"><Button onClick={submitTransfer}>{transfer === 'attended' ? 'Iniciar consulta' : 'Transferir'}</Button><Button variant="ghost" onClick={() => setTransfer(null)}>Cancelar</Button></div></> : <><Input placeholder="Número o extensión" value={number} onChange={e => setNumber(e.target.value)} onKeyDown={e => e.key === 'Enter' && void t.call(number)} /><div className="mt-3 grid grid-cols-3 gap-1.5">{'123456789*0#'.split('').map(x => <Button key={x} variant="secondary" onClick={() => { setNumber(n => n + x); t.dtmf(x); }}>{x}</Button>)}</div></>}
      {inCall ? <div className="mt-3 flex flex-wrap gap-2"><Button size="icon" variant="secondary" onClick={() => { t.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}</Button><Button size="sm" variant="secondary" onClick={() => setTransfer('blind')}><PhoneForwarded /> Ciega</Button><Button size="sm" variant="secondary" onClick={() => setTransfer('attended')}>Atendida</Button><Button size="icon" variant="secondary" onClick={() => void t.video()} title="Activar vídeo"><Video /></Button><Button size="icon" variant="destructive" onClick={t.hangup}><PhoneOff /></Button></div> : <Button className="mt-3 w-full" disabled={!t.connected || !number.trim()} onClick={() => void t.call(number)}><PhoneCall />Llamar</Button>}
    </div> : null}
  </div>;
}
