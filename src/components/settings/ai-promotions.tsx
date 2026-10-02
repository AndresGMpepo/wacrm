'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarRange, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Promotion = {
  id: string;
  name: string;
  description: string;
  starts_on: string;
  ends_on: string;
};

type Draft = { name: string; description: string; starts_on: string; ends_on: string };

const EMPTY_DRAFT: Draft = { name: '', description: '', starts_on: '', ends_on: '' };

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function statusFor(promotion: Promotion, t: ReturnType<typeof useTranslations>) {
  const today = todayISODate();
  if (today < promotion.starts_on) return { label: t('statusUpcoming'), className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' };
  if (today > promotion.ends_on) return { label: t('statusExpired'), className: 'bg-muted text-muted-foreground' };
  return { label: t('statusActive'), className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' };
}

/**
 * Promotions the AI assistant may mention via {{active_promotions}} (see
 * src/lib/ai/prompt-variables.ts) — only ones whose starts_on/ends_on
 * window covers today are ever surfaced to the model; the rest just sit
 * here as upcoming or expired history.
 */
export function AiPromotions() {
  const t = useTranslations('Settings.aiPromotions');
  const [loading, setLoading] = useState(true);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/promotions', { cache: 'no-store' });
      const payload = (await response.json()) as { promotions?: Promotion[]; error?: string };
      if (!response.ok) throw new Error(payload.error || t('loadFailed'));
      setPromotions(payload.promotions ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setShowForm(true);
  }

  function startEdit(promotion: Promotion) {
    setEditingId(promotion.id);
    setDraft({
      name: promotion.name,
      description: promotion.description,
      starts_on: promotion.starts_on,
      ends_on: promotion.ends_on,
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.starts_on || !draft.ends_on) {
      toast.error(t('missingFields'));
      return;
    }
    if (draft.ends_on < draft.starts_on) {
      toast.error(t('invalidRange'));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/ai/promotions/${editingId}` : '/api/ai/promotions', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || t('saveFailed'));
      toast.success(t('saveSuccess'));
      cancelForm();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(promotion: Promotion) {
    if (!window.confirm(t('confirmDelete', { name: promotion.name }))) return;
    try {
      const response = await fetch(`/api/ai/promotions/${promotion.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(t('deleteFailed'));
      setPromotions((prev) => prev.filter((p) => p.id !== promotion.id));
      toast.success(t('deleteSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('deleteFailed'));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {!showForm ? (
          <Button variant="outline" size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{editingId ? t('editTitle') : t('addTitle')}</p>
              <Button variant="outline" size="icon" onClick={cancelForm} aria-label={t('cancel')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-name">{t('name')}</Label>
              <Input id="promo-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-description">{t('promoDescription')}</Label>
              <Textarea
                id="promo-description"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder={t('promoDescriptionPlaceholder')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promo-starts">{t('startsOn')}</Label>
                <Input id="promo-starts" type="date" value={draft.starts_on} onChange={(e) => setDraft((d) => ({ ...d, starts_on: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promo-ends">{t('endsOn')}</Label>
                <Input id="promo-ends" type="date" value={draft.ends_on} onChange={(e) => setDraft((d) => ({ ...d, ends_on: e.target.value }))} />
              </div>
            </div>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : promotions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="space-y-2">
            {promotions.map((promotion) => {
              const status = statusFor(promotion, t);
              return (
                <div key={promotion.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{promotion.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{promotion.description}</p>
                    <p className="text-xs text-muted-foreground">{promotion.starts_on} → {promotion.ends_on}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon" onClick={() => startEdit(promotion)} aria-label={t('edit')}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="text-destructive" onClick={() => void remove(promotion)} aria-label={t('delete')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
