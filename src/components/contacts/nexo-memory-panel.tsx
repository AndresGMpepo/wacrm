'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

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

export function NexoMemoryPanel({ contactId }: { contactId: string }) {
  const [loading, setLoading] = useState(true);
  const [memory, setMemory] = useState<Memory>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/memory`, {
        cache: 'no-store',
      });
      const payload = response.ok
        ? ((await response.json()) as {
            memory?: Memory;
            events?: MemoryEvent[];
            facts?: Fact[];
            commitments?: Commitment[];
          })
        : null;
      setMemory(payload?.memory ?? null);
      setEvents(payload?.events ?? []);
      setFacts(payload?.facts ?? []);
      setCommitments(payload?.commitments ?? []);
    } catch {
      setMemory(null);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!memory && !events.length && !facts.length && !commitments.length)
    return null;

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Brain className="text-primary size-4" />
        Nexo Memory
      </div>
      {memory ? (
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

      {events.length ? (
        <div className="text-xs">
          <p className="text-muted-foreground font-medium uppercase tracking-wide">
            Historial
          </p>
          <ul className="mt-1 space-y-1">
            {events.slice(0, 8).map((event) => (
              <li key={event.id} className="text-muted-foreground">
                <span className="text-foreground">{formatDate(event.event_date)}</span>{' '}
                — {event.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
