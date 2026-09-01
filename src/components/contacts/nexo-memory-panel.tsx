'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Brain, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

type Memory = {
  current_summary: string | null;
  current_stage: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  sentiment_score: number | null;
  risk_level: 'low' | 'medium' | 'high' | null;
  opportunity_score: number | null;
  next_best_action: string | null;
  updated_at: string;
} | null;

type MemoryEvent = {
  id: string;
  event_type: string;
  summary: string;
  importance: 'low' | 'normal' | 'high';
  confidence: number;
  event_date: string;
};

type Fact = {
  id: string;
  category: 'interest' | 'objection' | 'attribute' | 'other';
  fact: string;
  confidence: number;
};

type Commitment = {
  id: string;
  description: string;
  owner: 'agent' | 'customer';
  due_date: string | null;
  status: 'pending' | 'done' | 'overdue' | 'cancelled';
};

// Shape already produced by the Inbox sidebar's own conversations/calls
// fetch — kept structural (not imported) so this panel has no dependency
// on that component.
export type ContactHistoryItem =
  | { kind: 'conversation'; id: string; channel: string; status: 'open' | 'pending' | 'closed'; summary: string; occurredAt: string | null }
  | { kind: 'call'; id: string; direction: 'inbound' | 'outbound' | 'internal' | 'unknown' | null; summary: string; occurredAt: string | null; durationSeconds: number | null };

type TimelineItem =
  | { kind: 'memory_event'; id: string; occurredAt: string; label: string }
  | (ContactHistoryItem & { label?: never });

const SENTIMENT_LABEL: Record<string, string> = {
  positive: 'Positivo',
  neutral: 'Neutral',
  negative: 'Negativo',
  mixed: 'Mixto',
};
const RISK_LABEL: Record<string, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};
const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald-600',
  medium: 'text-amber-600',
  high: 'text-destructive',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
    new Date(value)
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function callDuration(seconds: number | null) {
  return seconds == null ? '' : ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function NexoMemoryPanel({
  contactId,
  history = [],
  activeConversationId,
}: {
  contactId: string;
  history?: ContactHistoryItem[];
  activeConversationId?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/contacts/${contactId}/memory`, {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as {
        memory?: Memory;
        events?: MemoryEvent[];
        facts?: Fact[];
        commitments?: Commitment[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || 'No se pudo cargar Nexo Memory.');
      setMemory(payload?.memory ?? null);
      setEvents(payload?.events ?? []);
      setFacts(payload?.facts ?? []);
      setCommitments(payload?.commitments ?? []);
    } catch (error) {
      setMemory(null);
      setEvents([]);
      setFacts([]);
      setCommitments([]);
      setLoadError(
        error instanceof Error ? error.message : 'No se pudo cargar Nexo Memory.'
      );
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live refresh: an analysis run against ANY of this contact's
  // conversations (across channels) updates the same contact_memory row, so
  // this must resubscribe whenever the viewer switches to a different
  // contact — without this, switching from an Instagram to a WhatsApp
  // conversation of the same contact showed stale memory until reload.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`nexo-memory:${contactId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_memory', filter: `contact_id=eq.${contactId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_memory_events', filter: `contact_id=eq.${contactId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_facts', filter: `contact_id=eq.${contactId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_commitments', filter: `contact_id=eq.${contactId}` }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId, load]);

  async function markCommitmentDone(commitmentId: string) {
    try {
      const response = await fetch(
        `/api/contacts/${contactId}/memory/commitments/${commitmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'done' }),
        }
      );
      if (!response.ok) throw new Error();
      await load();
    } catch {
      toast.error('No se pudo actualizar el compromiso.');
    }
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-1 py-3 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Cargando Nexo Memory…
      </div>
    );

  const interests = facts.filter((fact) => fact.category === 'interest');
  const objections = facts.filter((fact) => fact.category === 'objection');
  const pendingCommitments = commitments.filter(
    (commitment) => commitment.status === 'pending'
  );
  const timeline: TimelineItem[] = [
    ...events.map(
      (event): TimelineItem => ({
        kind: 'memory_event',
        id: event.id,
        occurredAt: event.event_date,
        label: event.summary,
      })
    ),
    ...history,
  ].sort((left, right) =>
    (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
  );

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Brain className="text-primary size-4" />
        Nexo Memory
      </div>
      {loadError ? (
        <p className="text-destructive text-xs">{loadError}</p>
      ) : memory ? (
        <div className="space-y-1.5 text-xs">
          {memory.current_summary ? (
            <p className="text-foreground">{memory.current_summary}</p>
          ) : null}
          <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {memory.current_stage ? (
              <span>
                <strong className="text-foreground">Etapa:</strong>{' '}
                {memory.current_stage}
              </span>
            ) : null}
            {memory.sentiment ? (
              <span>
                <strong className="text-foreground">Sentimiento:</strong>{' '}
                {SENTIMENT_LABEL[memory.sentiment] || memory.sentiment}
              </span>
            ) : null}
            {memory.risk_level ? (
              <span className={RISK_COLOR[memory.risk_level]}>
                <strong>Riesgo:</strong>{' '}
                {RISK_LABEL[memory.risk_level] || memory.risk_level}
              </span>
            ) : null}
            {memory.opportunity_score !== null ? (
              <span>
                <strong className="text-foreground">Oportunidad:</strong>{' '}
                {memory.opportunity_score}/100
              </span>
            ) : null}
          </div>
          {memory.next_best_action ? (
            <p>
              <strong>Siguiente acción:</strong> {memory.next_best_action}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Aún no hay memoria consolidada para este contacto.
        </p>
      )}

      {objections.length ? (
        <div className="text-xs">
          <p className="text-muted-foreground font-medium uppercase tracking-wide">
            Objeciones
          </p>
          <ul className="mt-1 list-inside list-disc">
            {objections.map((fact) => (
              <li key={fact.id}>{fact.fact}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {interests.length ? (
        <div className="text-xs">
          <p className="text-muted-foreground font-medium uppercase tracking-wide">
            Intereses
          </p>
          <ul className="mt-1 list-inside list-disc">
            {interests.map((fact) => (
              <li key={fact.id}>{fact.fact}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingCommitments.length ? (
        <div className="text-xs">
          <p className="text-muted-foreground font-medium uppercase tracking-wide">
            Pendientes
          </p>
          <ul className="mt-1 space-y-1">
            {pendingCommitments.map((commitment) => (
              <li key={commitment.id} className="flex items-center justify-between gap-2">
                <span>
                  {commitment.description}
                  {commitment.due_date ? ` · ${formatDate(commitment.due_date)}` : ''}
                  {commitment.owner === 'customer' ? ' (cliente)' : ''}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2"
                  onClick={() => void markCommitmentDone(commitment.id)}
                >
                  <CheckCircle2 className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="text-xs">
        <p className="text-muted-foreground font-medium uppercase tracking-wide">
          Historial omnicanal
        </p>
        {timeline.length === 0 ? (
          <p className="text-muted-foreground mt-1">Sin interacciones registradas.</p>
        ) : (
          <div className="mt-1 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {timeline.map((item) =>
              item.kind === 'memory_event' ? (
                <div key={`memory-${item.id}`} className="rounded-lg border px-2.5 py-1.5">
                  <p className="text-foreground">{item.label}</p>
                  <p className="text-muted-foreground mt-0.5 text-[10px]">{formatDateTime(item.occurredAt)}</p>
                </div>
              ) : (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={item.kind === 'conversation' ? `/inbox?c=${encodeURIComponent(item.id)}` : `/call-transcriptions?call=${encodeURIComponent(item.id)}`}
                  className={cn(
                    'block rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-muted',
                    item.kind === 'conversation' && item.id === activeConversationId && 'border-primary/50 bg-primary/5'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground truncate font-medium">
                      {item.kind === 'call' ? `Llamada ${item.direction === 'outbound' ? 'saliente' : item.direction === 'inbound' ? 'entrante' : ''}` : item.channel}
                    </span>
                    <ArrowUpRight className="text-muted-foreground size-3 shrink-0" />
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.summary}</p>
                  <p className="text-muted-foreground mt-0.5 text-[10px]">
                    {item.kind === 'conversation' ? (item.status === 'open' ? 'Abierta' : item.status === 'pending' ? 'Pendiente' : 'Cerrada') : 'Llamada'}
                    {item.kind === 'call' ? callDuration(item.durationSeconds) : ''}
                    {item.occurredAt ? ` · ${formatDateTime(item.occurredAt)}` : ''}
                  </p>
                </Link>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
