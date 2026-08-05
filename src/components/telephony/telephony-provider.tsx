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
  status?: { number?: string; communicationType?: 'inbound' | 'outbound' };
  answer: (options?: { video?: boolean }) => Promise<unknown>;
  reject: () => void;
  hangup: () => void;
  mute: () => void;
  unmute: () => void;
  blindTransfer: (number: string) => void;
  attendedTransfer: (number: string) => void;
  audioToVideo: (allowNoneCamera?: boolean) => Promise<unknown>;
  dtmf: (tone: string) => void;
  on: (event: string, listener: (payload?: { stream?: MediaStream }) => void) => unknown;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
};

type Phone = {
  start: () => unknown;
  call: (number: string, options?: { video?: boolean }) => Promise<unknown>;
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
  call: (number: string, video?: boolean) => Promise<void>;
  answer: (video?: boolean) => Promise<void>;
  reject: () => void;
  hangup: () => void;
  mute: (value: boolean) => void;
  transfer: (number: string, attended?: boolean) => void;
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

  const phone = useRef<Phone | null>(null);
  const pbx = useRef<Pbx | null>(null);
  const destroy = useRef<(() => void) | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const connectingRef = useRef(false);
  const incomingAnswered = useRef(false);
  const incomingSession = useRef<Session | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const ringtone = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const refreshHistory = useCallback(async () => {
    if (!pbx.current) return;
    try {
      const result = await pbx.current.cdrQuery({ page: 1, size: 12, sortBy: 'time', orderBy: 'desc' });
      if (result.errcode === 0) setHistory((result.personal_cdr_list ?? []).map(callHistoryItem));
    } catch {
      // The call controls remain available if Yeastar temporarily rejects CDR retrieval.
    }
  }, []);

  const clearSession = useCallback((session?: Session) => {
    stopRingtone();
    const missed = incomingSession.current === session && !incomingAnswered.current;
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
    setActive(null);
    setLocalStream(null);
    setRemoteStream(null);
    void refreshHistory();
  }, [notify, refreshHistory, stopRingtone]);

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
        startRingtone();
        toast.info('Llamada entrante', { description: session.status?.number ?? 'Contesta desde el softphone.' });
        notify('Llamada entrante', session.status?.number ?? 'Contesta desde WACRM.');
      });
      operator.phone.on('startSession', ({ session }) => {
        stopRingtone();
        setActive(session);
        setIncoming(null);
        setOpen(true);
        setStatus('Llamada en curso');
        setLocalStream(session.localStream ?? null);
        setRemoteStream(session.remoteStream ?? null);
        session.on('streamAdded', (event: { stream?: MediaStream } | undefined) => {
          if (event?.stream) setRemoteStream(event.stream);
        });
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
  }, [clearSession, notify, refreshHistory, startRingtone, stopRingtone]);

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
    const close = () => destroy.current?.();
    window.addEventListener('pagehide', close);
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
    fetch('/api/telephony/config')
      .then((response) => response.json())
      .then((data) => {
        // The PBX integration can exist before this particular user has an
        // extension. Do not show/connect a softphone until their personal
        // extension assignment is present.
        setConfigured(Boolean(data.config?.extension));
        if (data.config?.extension) void connect();
      })
      .catch(() => undefined);
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
  }, [connect, stopRingtone]);

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
    transfer: (number, attended) => {
      if (!active || !number.trim()) return;
      setStatus(attended ? `Consultando a ${number}…` : `Transfiriendo a ${number}…`);
      if (attended) active.attendedTransfer(number);
      else active.blindTransfer(number);
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
