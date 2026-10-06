'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Clock3,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CallContextDialog } from './call-context-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTelephony, type CallHistoryItem } from './telephony-provider';

function historyIcon(status: CallHistoryItem['status']) {
  if (status === 'missed') return <PhoneMissed className="size-4 text-destructive" />;
  if (status === 'incoming') return <PhoneIncoming className="size-4 text-emerald-500" />;
  return <PhoneOutgoing className="size-4 text-primary" />;
}

function historyLabel(status: CallHistoryItem['status']) {
  return status === 'missed' ? 'Perdida' : status === 'incoming' ? 'Entrante' : status === 'outgoing' ? 'Saliente' : 'Llamada';
}

/** Inline "¿agendar un seguimiento?" prompt shown right after a call ends —
 *  same task the Seguimientos page's "Nueva tarea" creates, just one tap
 *  away from where the agent already is. */
function PostCallFollowUp({ number, onDone }: { number: string; onDone: () => void }) {
  const [creating, setCreating] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('09:00');

  const schedule = async (dueAt: Date, description: string) => {
    setCreating(true);
    try {
      const response = await fetch('/api/contacts/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: number, description, dueAt: dueAt.toISOString() }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || 'No se pudo crear la tarea.');
      toast.success('Seguimiento agendado. Te avisaremos 10 minutos antes.');
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la tarea.');
    } finally {
      setCreating(false);
    }
  };

  const tomorrowNineAm = () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-2.5 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium text-foreground">¿Agendar seguimiento con {number}?</p>
        <Button size="icon-sm" variant="ghost" onClick={onDone} aria-label="Cerrar"><X className="size-3.5" /></Button>
      </div>
      {customOpen ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input type="date" className="h-8 text-xs" value={customDate} onChange={(event) => setCustomDate(event.target.value)} />
            <Input type="time" className="h-8 text-xs" value={customTime} onChange={(event) => setCustomTime(event.target.value)} />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={creating || !customDate || !customTime}
            onClick={() => void schedule(new Date(`${customDate}T${customTime}`), `Seguimiento de llamada con ${number}`)}
          >
            Agendar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" disabled={creating} onClick={() => void schedule(new Date(Date.now() + 60 * 60_000), `Llamar de nuevo a ${number}`)}>En 1 hora</Button>
          <Button size="sm" variant="secondary" disabled={creating} onClick={() => void schedule(tomorrowNineAm(), `Llamar de nuevo a ${number}`)}>Mañana 9:00 am</Button>
          <Button size="sm" variant="ghost" disabled={creating} onClick={() => setCustomOpen(true)}>Elegir fecha</Button>
        </div>
      )}
    </div>
  );
}

export function NexPhone() {
  const t = useTelephony();
  const [number, setNumber] = useState('');
  const [transfer, setTransfer] = useState<'blind' | 'attended' | null>(null);
  const [muted, setMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = t.localStream;
    if (remoteVideo.current) remoteVideo.current.srcObject = t.remoteStream;
    if (remoteAudio.current) remoteAudio.current.srcObject = t.remoteStream;
  }, [t.localStream, t.remoteStream]);

  useEffect(() => {
    if (t.open) void t.refreshHistory();
  }, [t.open, t.refreshHistory]);

  if (!t.configured) return null;
  const inCall = Boolean(t.active || t.incoming);
  const submitTransfer = () => {
    if (!transfer || !number.trim()) return;
    void t.transfer(number, transfer === 'attended');
    setNumber('');
    if (transfer === 'blind') setTransfer(null);
  };

  return (
    <div className="relative">
      <audio ref={remoteAudio} autoPlay playsInline className="hidden" />
      <Button
        variant={t.connected ? 'default' : 'secondary'}
        size="icon"
        onClick={() => t.setOpen(!t.open)}
        aria-label="Abrir NexPhone"
        className="relative"
      >
        <Phone className="size-4" />
        <span className={`absolute right-0.5 top-0.5 size-2 rounded-full ring-2 ring-background ${t.connected ? 'bg-emerald-400' : t.connecting ? 'animate-pulse bg-amber-400' : 'bg-red-500'}`} />
      </Button>

      {t.incoming?.status?.communicationType === 'inbound' && t.incoming.status.callId
        ? <CallContextDialog key={t.incoming.status.callId} callId={t.incoming.status.callId} />
        : t.active?.status?.communicationType === 'inbound' && t.active.status.callId
          ? <CallContextDialog key={t.active.status.callId} callId={t.active.status.callId} />
        : null}

      {t.incoming ? (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border bg-card p-4 shadow-2xl">
          <div className="flex items-center gap-2"><PhoneIncoming className="size-5 animate-pulse text-primary" /><p className="font-semibold">Llamada entrante</p></div>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">{t.incoming.status?.number ?? 'Número desconocido'}</p>
          <div className="flex gap-2"><Button onClick={() => void t.answer(false)}><PhoneCall />Contestar</Button><Button variant="destructive" onClick={t.reject}><PhoneOff />Rechazar</Button></div>
        </div>
      ) : null}

      {t.open ? (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border bg-card p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div><b>NexPhone</b><p className="text-xs text-muted-foreground">{t.status || (t.connected ? 'Conectado' : t.connecting ? 'Conectando…' : 'Desconectado')}</p></div>
            <div className="flex items-center gap-1"><Button size="icon" variant="ghost" title="Historial" onClick={() => setShowHistory((value) => !value)}><Clock3 /></Button><Button size="icon" variant="ghost" onClick={() => t.setOpen(false)} aria-label="Cerrar"><X /></Button></div>
          </div>

          {showHistory ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">Historial de llamadas</p><Button size="icon" variant="ghost" onClick={() => void t.refreshHistory()} title="Actualizar"><RefreshCw className="size-4" /></Button></div>
              {t.history.length ? <div className="max-h-72 space-y-1 overflow-y-auto">{t.history.map((item) => <button key={item.id} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => { setNumber(item.number); setShowHistory(false); }}><span>{historyIcon(item.status)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.number}</span><span className="block text-xs text-muted-foreground">{historyLabel(item.status)}{item.timestamp ? ` · ${new Date(item.timestamp).toLocaleString()}` : ''}</span></span></button>)}</div> : <p className="rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">No hay llamadas todavía.</p>}
            </div>
          ) : <>
            {t.localStream || t.remoteStream ? <div className="mb-3 grid grid-cols-2 gap-2"><video ref={remoteVideo} autoPlay muted playsInline className="aspect-video w-full rounded bg-black" /><video ref={localVideo} autoPlay muted playsInline className="aspect-video w-full rounded bg-black" /></div> : null}
            {transfer ? <><Input autoFocus placeholder="Extensión destino" value={number} onChange={(event) => setNumber(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submitTransfer()} /><div className="mt-2 flex flex-wrap gap-2"><Button onClick={submitTransfer}>{transfer === 'attended' ? 'Iniciar consulta' : 'Transferir'}</Button><Button variant="ghost" onClick={() => setTransfer(null)}>Cancelar</Button>{t.attendedTransferReady ? <><Button onClick={t.completeAttendedTransfer}>Completar transferencia</Button><Button variant="outline" onClick={t.cancelAttendedTransfer}>Volver a la llamada</Button></> : null}</div></> : <><Input placeholder="Número o extensión" value={number} onChange={(event) => setNumber(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void t.call(number)} /><div className="mt-3 grid grid-cols-3 gap-1.5">{'123456789*0#'.split('').map((digit) => <Button key={digit} variant="secondary" onClick={() => { setNumber((value) => value + digit); t.dtmf(digit); }}>{digit}</Button>)}</div></>}
            {inCall ? <div className="mt-3 flex flex-wrap gap-2"><Button size="icon" variant="secondary" onClick={() => { t.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}</Button><Button size="sm" variant="secondary" onClick={() => setTransfer('blind')}><PhoneForwarded /> Ciega</Button><Button size="sm" variant="secondary" onClick={() => setTransfer('attended')}>Atendida</Button><Button size="icon" variant="secondary" onClick={() => void t.video()} title="Activar vídeo"><Video /></Button><Button size="icon" variant="destructive" onClick={t.hangup}><PhoneOff /></Button></div> : <div className="mt-3 grid grid-cols-2 gap-2"><Button disabled={!t.connected || !number.trim()} onClick={() => void t.call(number)}><PhoneCall />Llamar</Button><Button variant="secondary" disabled={!t.connected || !number.trim()} onClick={() => void t.call(number, true)}><Video />Video</Button></div>}
            {!inCall && t.lastEndedCall ? <PostCallFollowUp number={t.lastEndedCall.number} onDone={t.dismissLastEndedCall} /> : null}
          </>}
        </div>
      ) : null}
    </div>
  );
}
