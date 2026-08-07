'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

type Session = {
  status?: {
    number?: string;
    callId?: string;
    communicationType?: 'inbound' | 'outbound';
    transferParent?: { callId?: string; number?: string };
  };
  answer: (options?: { video?: boolean }) => Promise<unknown>;
  reject: () => void;
  hangup: () => void;
  mute: () => void;
  unmute: () => void;
  blindTransfer: (number: string) => void;
  attendedTransfer: (number: string) => void;
  hold: () => void;
  unhold: () => void;
  audioToVideo: (allowNoneCamera?: boolean) => Promise<unknown>;
  dtmf: (tone: string) => void;
  on: (event: string, listener: (payload?: unknown) => void) => unknown;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
};

type Phone = {
  start: () => unknown;
  call: (number: string, options?: { video?: boolean }, transferId?: string) => Promise<unknown>;
  on: (event: string, listener: (payload: { session: Session }) => void) => unknown;
};

export type CallHistoryItem = {
  id: string;
  number: string;
  status: 'incoming' | 'missed' | 'outgoing' | 'unknown';
  timestamp: number;
  duration?: number;
};

type Pbx = {
  cdrQuery: (params: {
    page: number;
    size: number;
    sortBy?: 'time' | 'id';
    orderBy?: 'desc' | 'asc';
  }) => Promise<{ errcode: number; personal_cdr_list?: Array<Record<string, unknown>> }>;
};

type State = {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  status: string;
  incoming: Session | null;
  active: Session | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  history: CallHistoryItem[];
  refreshHistory: () => Promise<void>;
  refreshConfiguration: () => Promise<void>;
  call: (number: string, video?: boolean) => Promise<void>;
  answer: (video?: boolean) => Promise<void>;
  reject: () => void;
  hangup: () => void;
  mute: (value: boolean) => void;
  transfer: (number: string, attended?: boolean) => Promise<void>;
  attendedTransferReady: boolean;
  completeAttendedTransfer: () => void;
  cancelAttendedTransfer: () => void;
  video: () => Promise<void>;
  dtmf: (tone: string) => void;
};

const TelephonyContext = createContext<State | null>(null);

function callHistoryItem(row: Record<string, unknown>): CallHistoryItem {
  const rawStatus = Number(row.status);
  return {
    id: String(row.id ?? `${row.timestamp ?? ''}-${row.number ?? ''}`),
    number: String(row.number ?? 'Número desconocido'),
    status: rawStatus === 1 ? 'incoming' : rawStatus === 2 ? 'missed' : rawStatus === 3 ? 'outgoing' : 'unknown',
    timestamp: Number(row.timestamp ?? 0) * (Number(row.timestamp ?? 0) < 10_000_000_000 ? 1000 : 1),
    duration: typeof row.duration === 'number' ? row.duration : undefined,
  };
}

function mergeHistory(current: CallHistoryItem[], next: CallHistoryItem[]) {
  const unique = new Map<string, CallHistoryItem>();
  for (const item of [...next, ...current]) {
    const key = `${item.status}:${item.number}:${Math.floor(item.timestamp / 60_000)}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 24);
}

function streamFromEvent(payload: unknown): MediaStream | null {
  const candidate = payload && typeof payload === 'object'
    ? (payload as { stream?: unknown; remoteStream?: unknown; localStream?: unknown }).stream
      ?? (payload as { remoteStream?: unknown }).remoteStream
      ?? (payload as { localStream?: unknown }).localStream
      ?? payload
    : payload;
  return candidate && typeof candidate === 'object' && 'getTracks' in candidate
    ? candidate as MediaStream
    : null;
}

function isSameSession(first: Session | null | undefined, second: Session | null | undefined) {
  if (!first || !second) return false;
  const firstCallId = first.status?.callId;
  const secondCallId = second.status?.callId;
  return first === second || Boolean(firstCallId && secondCallId && firstCallId === secondCallId);
}

export function TelephonyProvider({ children }: { children: ReactNode }) {
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [incoming, setIncoming] = useState<Session | null>(null);
  const [active, setActive] = useState<Session | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [history, setHistory] = useState<CallHistoryItem[]>([]);
  const [attendedTransferReady, setAttendedTransferReady] = useState(false);

  const phone = useRef<Phone | null>(null);
  const pbx = useRef<Pbx | null>(null);
  const destroy = useRef<(() => void) | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const connectingRef = useRef(false);
  const incomingAnswered = useRef(false);
  const incomingSession = useRef<Session | null>(null);
  const activeSession = useRef<Session | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const ringtone = useRef<ReturnType<typeof setInterval> | null>(null);
  const transferParent = useRef<Session | null>(null);
  const consultation = useRef<Session | null>(null);
  const finalizedCallIds = useRef(new Set<string>());
  const liveReportingError = useRef<string | null>(null);

  const notify = useCallback((title: string, body: string) => {
    if (document.visibilityState === 'visible') return;
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, { body, icon: '/icon' });
      notification.onclick = () => {
        window.focus();
        setOpen(true);
        notification.close();
      };
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtone.current) clearInterval(ringtone.current);
    ringtone.current = null;
  }, []);

  const ring = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== 'running') return;
    const at = context.currentTime;
    for (const [frequency, offset] of [[660, 0], [880, 0.32]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(frequency, at + offset);
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.26);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at + offset);
      oscillator.stop(at + offset + 0.28);
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    ring();
    ringtone.current = setInterval(ring, 1400);
  }, [ring, stopRingtone]);

  const rememberCall = useCallback((session: Session | undefined, callStatus: CallHistoryItem['status']) => {
    const number = session?.status?.number ?? 'Número desconocido';
    const timestamp = Date.now();
    setHistory((current) => mergeHistory(current, [{
      id: `local-${session?.status?.callId ?? number}-${timestamp}`,
      number,
      status: callStatus,
      timestamp,
    }]));
  }, []);

  // The browser knows which authenticated WACRM extension owns an SDK
  // session. Send that minimal state to the server as a reliable complement to
  // PBX webhooks, whose trunk notifications may omit the answering extension.
  const reportLiveCall = useCallback((session: Session | undefined, callStatus: string, finished = false, diagnostic = false) => {
    const callId = session?.status?.callId;
    if (!callId) {
      if (diagnostic && liveReportingError.current !== 'missing-call-id') {
        liveReportingError.current = 'missing-call-id';
        toast.error('No se pudo sincronizar la supervisión', { description: 'Yeastar no entregó el identificador de esta llamada al softphone.' });
      }
      return;
    }
    const body = JSON.stringify({
      callId,
      number: session.status?.number,
      direction: session.status?.communicationType,
      status: callStatus,
      diagnostic,
    });
    void fetch('/api/telephony/yeastar/live-calls/self', {
      method: finished ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: finished,
    }).then(async (response) => {
      if (response.ok) {
        liveReportingError.current = null;
        return;
      }
      const data = await response.json().catch(() => null) as { error?: string } | null;
      const message = data?.error ?? 'El servidor rechazó el estado de llamada.';
      if (liveReportingError.current !== message) {
        liveReportingError.current = message;
        toast.error('No se pudo sincronizar la supervisión', { description: message });
      }
    }).catch(() => {
      // The PBX webhook remains the fallback when the browser is closing or
      // temporarily offline. The agent's call controls must never be blocked.
    });
  }, []);

  const restoreSessionMedia = useCallback((session: Session) => {
    activeSession.current = session;
    setActive(session);
    setLocalStream(session.localStream ?? null);
    setRemoteStream(session.remoteStream ?? null);
    // A resumed call can receive its tracks just after the HOLD/UNHOLD SIP
    // negotiation. Read the SDK streams again after that negotiation settles.
    for (const delay of [0, 250, 900]) {
      setTimeout(() => {
        if (activeSession.current !== session) return;
        if (session.localStream) setLocalStream(session.localStream);
        if (session.remoteStream) setRemoteStream(session.remoteStream);
      }, delay);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!pbx.current) return;
    try {
      const result = await pbx.current.cdrQuery({ page: 1, size: 12, sortBy: 'time', orderBy: 'desc' });
      if (result.errcode === 0) {
        const rawList = result.personal_cdr_list ?? (result as { personalCdrList?: Array<Record<string, unknown>> }).personalCdrList ?? [];
        setHistory((current) => mergeHistory(current, rawList.map(callHistoryItem)));
      }
    } catch {
      // The call controls remain available if Yeastar temporarily rejects CDR retrieval.
    }
  }, []);

  const clearSession = useCallback((session?: Session) => {
    const callId = session?.status?.callId;
    if (callId && finalizedCallIds.current.has(callId)) return;
    if (callId) {
      finalizedCallIds.current.add(callId);
      if (finalizedCallIds.current.size > 100) finalizedCallIds.current.clear();
    }
    stopRingtone();
    const missed = isSameSession(incomingSession.current, session) && !incomingAnswered.current;
    const callStatus: CallHistoryItem['status'] = missed
      ? 'missed'
      : session?.status?.communicationType === 'outbound'
        ? 'outgoing'
        : 'incoming';
    if (session) {
      reportLiveCall(session, 'BYE', true);
      rememberCall(session, callStatus);
    }

    if (isSameSession(consultation.current, session)) {
      consultation.current = null;
      setAttendedTransferReady(false);
      const parent = transferParent.current;
      transferParent.current = null;
      parent?.unhold();
      if (parent) restoreSessionMedia(parent);
    }
    if (missed) {
      setStatus('Llamada perdida');
      toast.error('Llamada perdida', { description: session?.status?.number ?? 'No se atendió la llamada entrante.' });
      notify('Llamada perdida', session?.status?.number ?? 'No se atendió la llamada entrante.');
    } else {
      setStatus('Llamada finalizada');
    }
    incomingSession.current = null;
    incomingAnswered.current = false;
    setIncoming(null);
    if (isSameSession(activeSession.current, session)) {
      activeSession.current = null;
      setActive(null);
      setLocalStream(null);
      setRemoteStream(null);
    }
    void refreshHistory();
  }, [notify, refreshHistory, rememberCall, reportLiveCall, restoreSessionMedia, stopRingtone]);

  const connect = useCallback(async () => {
    if (connectingRef.current || !live.current) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const response = await fetch('/api/telephony/yeastar/signature', { method: 'POST' });
      const credentials = await response.json();
      if (!response.ok) throw new Error(credentials.error);

      destroy.current?.();
      const sdk = await import('ys-webrtc-sdk-core');
      const operator = await sdk.init({
        username: credentials.extension,
        secret: credentials.secret,
        pbxURL: credentials.pbxUrl,
        reRegistryPhoneTimes: 999999,
      });
      phone.current = operator.phone as Phone;
      pbx.current = operator.pbx as Pbx;
      destroy.current = operator.destroy;

      operator.phone.on('registered', () => {
        setConnected(true);
        setStatus('Conectado');
        void refreshHistory();
      });
      operator.phone.on('registrationFailed', () => {
        setConnected(false);
        setStatus('No se pudo registrar la extensión');
      });
      operator.phone.on('disconnected', () => {
        setConnected(false);
        setStatus('Reconectando…');
        if (live.current) retry.current = setTimeout(() => void connect(), 5000);
      });
      operator.phone.on('incoming', ({ session }) => {
        incomingAnswered.current = false;
        incomingSession.current = session;
        setIncoming(session);
        setOpen(true);
        setStatus('Llamada entrante');
        reportLiveCall(session, 'RING', false, true);
        startRingtone();
        toast.info('Llamada entrante', { description: session.status?.number ?? 'Contesta desde el softphone.' });
        notify('Llamada entrante', session.status?.number ?? 'Contesta desde WACRM.');
        // A missed call never reaches startSession. Listen directly to the
        // incoming session so it is recorded even when Yeastar removes it
        // before emitting a phone-level deleteSession event.
        session.on('ended', () => clearSession(session));
        session.on('failed', () => clearSession(session));
      });
      operator.phone.on('startSession', ({ session }) => {
        stopRingtone();
        activeSession.current = session;
        setActive(session);
        setIncoming(null);
        setOpen(true);
        if (session.status?.transferParent) {
          consultation.current = session;
          setAttendedTransferReady(true);
          setStatus(`Consulta con ${session.status.number ?? 'destino'}`);
        } else {
          setStatus('Llamada en curso');
        }
        reportLiveCall(session, session.status?.communicationType === 'inbound' ? 'ANSWER' : 'ANSWERED', false, true);
        setLocalStream(session.localStream ?? null);
        setRemoteStream(session.remoteStream ?? null);
        const updateRemoteStream = (event?: unknown) => {
          const stream = streamFromEvent(event) ?? session.remoteStream ?? null;
          if (stream) setRemoteStream(stream);
        };
        const updateLocalStream = (event?: unknown) => {
          const stream = streamFromEvent(event) ?? session.localStream ?? null;
          if (stream) setLocalStream(stream);
        };
        session.on('streamAdded', updateRemoteStream);
        session.on('updateRemoteStream', updateRemoteStream);
        session.on('updateLocalStream', updateLocalStream);
        setTimeout(() => {
          updateLocalStream();
          updateRemoteStream();
        }, 0);
        session.on('ended', () => clearSession(session));
        session.on('failed', () => clearSession(session));
      });
      operator.phone.on('deleteSession', ({ session }) => clearSession(session));
      operator.phone.start();
    } catch (error) {
      setConnected(false);
      setStatus(error instanceof Error ? error.message : 'Error de conexión');
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [clearSession, notify, refreshHistory, reportLiveCall, startRingtone, stopRingtone]);

  const refreshConfiguration = useCallback(async () => {
    try {
      const response = await fetch('/api/telephony/config');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const ready = Boolean(data.config?.extension);
      setConfigured(ready);
      if (ready) await connect();
    } catch {
      setConfigured(false);
    }
  }, [connect]);

  useEffect(() => {
    live.current = true;
    const unlockAudio = () => {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = audioContext.current ?? new AudioContextClass();
      audioContext.current = context;
      if (context.state === 'suspended') void context.resume();
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    };
    const close = () => {
      const session = activeSession.current ?? incomingSession.current;
      if (session) reportLiveCall(session, 'BYE', true);
      destroy.current?.();
    };
    window.addEventListener('pagehide', close);
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    void refreshConfiguration();
    return () => {
      live.current = false;
      window.removeEventListener('pagehide', close);
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      if (retry.current) clearTimeout(retry.current);
      stopRingtone();
      destroy.current?.();
      void audioContext.current?.close();
      audioContext.current = null;
    };
  }, [refreshConfiguration, reportLiveCall, stopRingtone]);

  useEffect(() => {
    const session = active ?? incoming;
    if (!session) return;
    const callStatus = active ? (session.status?.communicationType === 'inbound' ? 'ANSWER' : 'ANSWERED') : 'RING';
    reportLiveCall(session, callStatus);
    const timer = window.setInterval(() => reportLiveCall(session, callStatus), 15_000);
    return () => window.clearInterval(timer);
  }, [active, incoming, reportLiveCall]);

  const value: State = {
    configured,
    connected,
    connecting,
    open,
    setOpen,
    status,
    incoming,
    active,
    localStream,
    remoteStream,
    history,
    refreshHistory,
    refreshConfiguration,
    call: async (number, video) => {
      setOpen(true);
      setStatus(`Llamando a ${number}…`);
      if (!phone.current) await connect();
      await phone.current?.call(number, { video });
    },
    answer: async (video) => {
      if (!incoming) return;
      incomingAnswered.current = true;
      stopRingtone();
      await incoming.answer({ video });
    },
    reject: () => {
      stopRingtone();
      incoming?.reject();
    },
    hangup: () => {
      stopRingtone();
      if (active) active.hangup();
      else incoming?.hangup();
    },
    mute: (muted) => {
      if (muted) active?.mute();
      else active?.unmute();
    },
    transfer: async (number, attended) => {
      if (!active || !number.trim()) return;
      setStatus(attended ? `Consultando a ${number}…` : `Transfiriendo a ${number}…`);
      if (!attended) {
        active.blindTransfer(number);
        return;
      }
      const transferId = active.status?.callId;
      if (!transferId || !phone.current) {
        toast.error('No se puede iniciar la transferencia atendida.');
        return;
      }
      transferParent.current = active;
      setAttendedTransferReady(false);
      active.hold();
      try {
        await phone.current.call(number, undefined, transferId);
      } catch {
        transferParent.current = null;
        active.unhold();
        setStatus('No se pudo iniciar la consulta');
        toast.error('No se pudo iniciar la transferencia atendida.');
      }
    },
    attendedTransferReady,
    completeAttendedTransfer: () => {
      const activeConsultation = consultation.current;
      const parentNumber = activeConsultation?.status?.transferParent?.number ?? transferParent.current?.status?.number;
      if (!activeConsultation || !parentNumber) {
        toast.error('Primero espera a que la llamada de consulta se conecte.');
        return;
      }
      setStatus('Completando transferencia atendida…');
      activeConsultation.attendedTransfer(parentNumber);
      consultation.current = null;
      transferParent.current = null;
      setAttendedTransferReady(false);
    },
    cancelAttendedTransfer: () => {
      const parent = transferParent.current;
      consultation.current?.hangup();
      consultation.current = null;
      transferParent.current = null;
      setAttendedTransferReady(false);
      parent?.unhold();
      if (parent) restoreSessionMedia(parent);
      setStatus('Consulta cancelada');
    },
    video: async () => {
      if (!active) return;
      setStatus('Solicitando vídeo…');
      await active.audioToVideo(false);
      setLocalStream(active.localStream ?? null);
      setRemoteStream(active.remoteStream ?? null);
    },
    dtmf: (tone) => active?.dtmf(tone),
  };

  return <TelephonyContext.Provider value={value}>{children}</TelephonyContext.Provider>;
}

export function useTelephony() {
  const value = useContext(TelephonyContext);
  if (!value) throw new Error('useTelephony must be used inside TelephonyProvider');
  return value;
}
