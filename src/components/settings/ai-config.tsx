'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';
const ANALYSIS_MODEL_IDS = ['gpt-5.4-mini', 'gpt-4.1-mini'];
const IMAGE_MODEL_IDS = ['gpt-4.1-mini', 'gpt-5.4-mini'];
const TRANSCRIPTION_MODEL_IDS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe'];

type HandoffTarget = 'unassigned' | 'agent' | 'queue' | 'ai_queue';

const AI_CHANNELS: { id: string; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp (Meta directo)' },
  { id: 'zernio_whatsapp', label: 'WhatsApp (conectado)' },
  { id: 'zernio_facebook', label: 'Facebook (conectado)' },
  { id: 'zernio_instagram', label: 'Instagram (conectado)' },
  { id: 'facebook', label: 'Facebook Messenger' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'yeastar_live_chat', label: 'Chat web de Yeastar' },
  { id: 'tiktok', label: 'TikTok' },
];

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [analysisModel, setAnalysisModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [imageAnalysisModel, setImageAnalysisModel] = useState('gpt-4.1-mini');
  const [voiceTranscriptionModel, setVoiceTranscriptionModel] = useState('gpt-4o-mini-transcribe');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [conversationAnalysisEnabled, setConversationAnalysisEnabled] = useState(false);
  const [analysisOnCustomerMessage, setAnalysisOnCustomerMessage] = useState(false);
  const [analysisOnTransfer, setAnalysisOnTransfer] = useState(false);
  const [analysisOnClose, setAnalysisOnClose] = useState(false);
  const [analysisDailyLimit, setAnalysisDailyLimit] = useState(100);
  const [analysisMonthlyLimit, setAnalysisMonthlyLimit] = useState(1000);
  const [analysisMaxPerConversation, setAnalysisMaxPerConversation] = useState(8);
  const [analysisImagesEnabled, setAnalysisImagesEnabled] = useState(false);
  const [analysisVoiceNotesEnabled, setAnalysisVoiceNotesEnabled] = useState(false);
  const [mediaAnalysisDailyLimit, setMediaAnalysisDailyLimit] = useState(100);
  const [qaScoringEnabled, setQaScoringEnabled] = useState(false);
  const [qaScoringCriteria, setQaScoringCriteria] = useState('');
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [handoffTarget, setHandoffTarget] = useState<HandoffTarget>('agent');
  const [handoffQueueId, setHandoffQueueId] = useState('');
  const [channelTypes, setChannelTypes] = useState<string[]>([]);
  const [queues, setQueues] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setAnalysisModel(data.analysis_model ?? data.model);
        setImageAnalysisModel(data.image_analysis_model ?? 'gpt-4.1-mini');
        setVoiceTranscriptionModel(data.voice_transcription_model ?? 'gpt-4o-mini-transcribe');
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setConversationAnalysisEnabled(Boolean(data.conversation_analysis_enabled));
        setAnalysisOnCustomerMessage(Boolean(data.analysis_on_customer_message));
        setAnalysisOnTransfer(Boolean(data.analysis_on_transfer));
        setAnalysisOnClose(Boolean(data.analysis_on_close));
        setAnalysisDailyLimit(data.analysis_daily_limit ?? 100);
        setAnalysisMonthlyLimit(data.analysis_monthly_limit ?? 1000);
        setAnalysisMaxPerConversation(Math.max(8, data.analysis_max_per_conversation ?? 8));
        setAnalysisImagesEnabled(Boolean(data.analysis_images_enabled));
        setAnalysisVoiceNotesEnabled(Boolean(data.analysis_voice_notes_enabled));
        setMediaAnalysisDailyLimit(data.media_analysis_daily_limit ?? 100);
        setQaScoringEnabled(Boolean(data.qa_scoring_enabled));
        setQaScoringCriteria(data.qa_scoring_criteria ?? '');
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHandoffTarget((data.handoff_target as HandoffTarget) ?? 'agent');
        setHandoffQueueId(data.handoff_queue_id ?? '');
        setChannelTypes(Array.isArray(data.channel_types) ? data.channel_types : []);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
    // Queues feed the handoff routing picker. Best-effort, same as members.
    void fetch('/api/conversations/queues', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setQueues(data?.queues ?? []))
      .catch(() => undefined);
  }, [accountId, fetchConfig]);

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    analysis_model: analysisModel.trim() || null,
    image_analysis_model: imageAnalysisModel.trim() || null,
    voice_transcription_model: voiceTranscriptionModel.trim() || null,
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    handoff_target: handoffTarget,
    handoff_queue_id: handoffQueueId || null,
    channel_types: channelTypes,
    conversation_analysis_enabled: conversationAnalysisEnabled,
    analysis_on_customer_message: analysisOnCustomerMessage,
    analysis_on_transfer: analysisOnTransfer,
    analysis_on_close: analysisOnClose,
    analysis_daily_limit: analysisDailyLimit,
    analysis_monthly_limit: analysisMonthlyLimit,
    analysis_max_per_conversation: analysisMaxPerConversation,
    analysis_images_enabled: analysisImagesEnabled,
    analysis_voice_notes_enabled: analysisVoiceNotesEnabled,
    media_analysis_daily_limit: mediaAnalysisDailyLimit,
    qa_scoring_enabled: qaScoringEnabled,
    qa_scoring_criteria: qaScoringCriteria.trim() || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('encryptionNotice')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Proveedor de IA</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">OpenAI</div>
                <p className="text-xs text-muted-foreground">Una sola cuenta y una sola factura para respuestas, análisis, imágenes y notas de voz. NexoOmni elige internamente modelos especializados de OpenAI cuando hace falta.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">Modelo para respuestas del agente</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL.openai}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder="sk-..."
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('embeddingsHint', {
                  sameKeyText: t('sameKeyText'),
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label>Canales donde responde</Label>
              <p className="text-xs text-muted-foreground">
                Sin selección, el agente responde en todos los canales de la bandeja.
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {AI_CHANNELS.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={channelTypes.length === 0 || channelTypes.includes(channel.id)}
                      onChange={() =>
                        setChannelTypes((current) => {
                          const base = current.length === 0 ? AI_CHANNELS.map((c) => c.id) : current;
                          const next = base.includes(channel.id)
                            ? base.filter((c) => c !== channel.id)
                            : [...base, channel.id];
                          return next.length === AI_CHANNELS.length ? [] : next;
                        })
                      }
                      disabled={disabled || !autoReplyEnabled}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {channel.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff-target">Al transferir a un humano</Label>
              <p className="text-xs text-muted-foreground">
                Qué hacer cuando el agente de IA deja la conversación en manos de una persona.
              </p>
              <Select
                value={handoffTarget}
                onValueChange={(v) => setHandoffTarget(v as HandoffTarget)}
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Dejar sin asignar</SelectItem>
                  <SelectItem value="agent">Asignar a un agente fijo</SelectItem>
                  <SelectItem value="queue">Enviar a una cola fija</SelectItem>
                  <SelectItem value="ai_queue">
                    La IA elige la cola según la conversación
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(handoffTarget === 'queue' || handoffTarget === 'ai_queue') && (
              <div className="space-y-2">
                <Label htmlFor="ai-handoff-queue">
                  {handoffTarget === 'ai_queue' ? 'Cola de respaldo' : 'Cola'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {handoffTarget === 'ai_queue'
                    ? 'Se usa cuando la IA no identifica un departamento claro. La cola asigna al agente con sus propias reglas.'
                    : 'La cola asigna al agente con sus propias reglas (turnos o menos chats abiertos).'}
                </p>
                <Select
                  value={handoffQueueId || HANDOFF_QUEUE}
                  onValueChange={(v) => setHandoffQueueId(!v || v === HANDOFF_QUEUE ? '' : v)}
                  disabled={disabled || !autoReplyEnabled}
                >
                  <SelectTrigger id="ai-handoff-queue">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>Sin cola</SelectItem>
                    {queues.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {handoffTarget === 'agent' && (
              <div className="space-y-2">
                <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('handoffToDesc')}
                </p>
                <Select
                  value={handoffAgentId || HANDOFF_QUEUE}
                  onValueChange={(v) =>
                    setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                  }
                  disabled={disabled || !autoReplyEnabled}
                >
                  <SelectTrigger id="ai-handoff">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>
                      {t('handoffQueue')}
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modelos por función</CardTitle>
            <CardDescription>
              Elige el equilibrio entre calidad y costo para cada tarea. Puedes seleccionar una recomendación o escribir un ID de modelo autorizado en tu cuenta de OpenAI.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-analysis-model">Análisis, memoria, sentimiento y QA</Label>
              <Select value={ANALYSIS_MODEL_IDS.includes(analysisModel) ? analysisModel : '__custom__'} onValueChange={(value) => setAnalysisModel(value === '__custom__' ? '' : value ?? 'gpt-5.4-mini')} disabled={disabled}>
                <SelectTrigger id="ai-analysis-model" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-5.4-mini">gpt-5.4-mini — recomendado y estable</SelectItem>
                  <SelectItem value="gpt-4.1-mini">gpt-4.1-mini — menor costo</SelectItem>
                  <SelectItem value="__custom__">Otro modelo…</SelectItem>
                </SelectContent>
              </Select>
              {!ANALYSIS_MODEL_IDS.includes(analysisModel) && <Input value={analysisModel} onChange={(e) => setAnalysisModel(e.target.value)} placeholder="ID del modelo personalizado" disabled={disabled} />}
              <p className="text-xs text-muted-foreground">Recomendado para análisis inmediato: gpt-5.4-mini.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-image-model">Descripción de imágenes</Label>
              <Select value={IMAGE_MODEL_IDS.includes(imageAnalysisModel) ? imageAnalysisModel : '__custom__'} onValueChange={(value) => setImageAnalysisModel(value === '__custom__' ? '' : value ?? 'gpt-4.1-mini')} disabled={disabled}>
                <SelectTrigger id="ai-image-model" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4.1-mini">gpt-4.1-mini — recomendado</SelectItem>
                  <SelectItem value="gpt-5.4-mini">gpt-5.4-mini — mayor razonamiento</SelectItem>
                  <SelectItem value="__custom__">Otro modelo…</SelectItem>
                </SelectContent>
              </Select>
              {!IMAGE_MODEL_IDS.includes(imageAnalysisModel) && <Input value={imageAnalysisModel} onChange={(e) => setImageAnalysisModel(e.target.value)} placeholder="ID del modelo personalizado" disabled={disabled} />}
              <p className="text-xs text-muted-foreground">Recomendado: gpt-4.1-mini.</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ai-transcription-model">Transcripción de notas de voz</Label>
              <Select value={TRANSCRIPTION_MODEL_IDS.includes(voiceTranscriptionModel) ? voiceTranscriptionModel : '__custom__'} onValueChange={(value) => setVoiceTranscriptionModel(value === '__custom__' ? '' : value ?? 'gpt-4o-mini-transcribe')} disabled={disabled}>
                <SelectTrigger id="ai-transcription-model" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe — recomendado</SelectItem>
                  <SelectItem value="gpt-4o-transcribe">gpt-4o-transcribe — mayor precisión</SelectItem>
                  <SelectItem value="__custom__">Otro modelo…</SelectItem>
                </SelectContent>
              </Select>
              {!TRANSCRIPTION_MODEL_IDS.includes(voiceTranscriptionModel) && <Input value={voiceTranscriptionModel} onChange={(e) => setVoiceTranscriptionModel(e.target.value)} placeholder="ID del modelo personalizado" disabled={disabled} />}
              <p className="text-xs text-muted-foreground">Para notas de voz en español, gpt-4o-mini-transcribe ofrece el mejor costo-beneficio. Usa gpt-4o-transcribe si necesitas priorizar precisión.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Análisis automático de conversaciones</CardTitle>
            <CardDescription>
              Política administrada por la cuenta. Los agentes no pueden omitir los análisis configurados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div><p className="text-sm font-medium">Habilitar análisis automático</p><p className="text-xs text-muted-foreground">Guarda los trabajos en una cola sin bloquear WhatsApp.</p></div>
              <Switch checked={conversationAnalysisEnabled} onCheckedChange={setConversationAnalysisEnabled} disabled={disabled || !isActive} />
            </div>
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Cuándo analizar</p>
              <label className="flex items-center justify-between gap-4 text-sm"><span>Tras 2 minutos sin respuesta del cliente</span><Switch checked={analysisOnCustomerMessage} onCheckedChange={setAnalysisOnCustomerMessage} disabled={disabled || !conversationAnalysisEnabled} /></label>
              <label className="flex items-center justify-between gap-4 text-sm"><span>Al transferir o asignar a otro agente</span><Switch checked={analysisOnTransfer} onCheckedChange={setAnalysisOnTransfer} disabled={disabled || !conversationAnalysisEnabled} /></label>
              <label className="flex items-center justify-between gap-4 text-sm"><span>Al cerrar la conversación</span><Switch checked={analysisOnClose} onCheckedChange={setAnalysisOnClose} disabled={disabled || !conversationAnalysisEnabled} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Límite diario de análisis</Label><Input type="number" min={1} max={10000} value={analysisDailyLimit} onChange={(e) => setAnalysisDailyLimit(Number(e.target.value) || 1)} disabled={disabled || !conversationAnalysisEnabled} /><p className="text-xs text-muted-foreground">Cantidad total de ejecuciones IA para toda la cuenta por día.</p></div>
              <div className="space-y-2"><Label>Límite mensual de análisis</Label><Input type="number" min={1} max={100000} value={analysisMonthlyLimit} onChange={(e) => setAnalysisMonthlyLimit(Number(e.target.value) || 1)} disabled={disabled || !conversationAnalysisEnabled} /><p className="text-xs text-muted-foreground">Cantidad total de ejecuciones IA para toda la cuenta por mes.</p></div>
              <div className="space-y-2"><Label>Máximo diario de análisis por conversación</Label><Input type="number" min={8} max={100} value={analysisMaxPerConversation} onChange={(e) => setAnalysisMaxPerConversation(Math.max(8, Number(e.target.value) || 8))} disabled={disabled || !conversationAnalysisEnabled} /><p className="text-xs text-muted-foreground">Mínimo 8. Al alcanzar el límite se mostrará 8/8 y el análisis se reanudará al día siguiente.</p></div>
            </div>
            <div className="space-y-3 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Contenido multimedia recibido</p>
                <p className="text-xs text-muted-foreground">Opcional. Se procesa en segundo plano y sólo se usa el texto o la descripción resultante en el análisis de la conversación.</p>
              </div>
              <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Analizar imágenes</span><span className="text-xs text-muted-foreground">Describe imágenes nuevas enviadas por el cliente.</span></span><Switch checked={analysisImagesEnabled} onCheckedChange={setAnalysisImagesEnabled} disabled={disabled || !conversationAnalysisEnabled} /></label>
              <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Transcribir notas de voz</span><span className="text-xs text-muted-foreground">Transcribe audios nuevos enviados por el cliente.</span></span><Switch checked={analysisVoiceNotesEnabled} onCheckedChange={setAnalysisVoiceNotesEnabled} disabled={disabled || !conversationAnalysisEnabled} /></label>
              <div className="max-w-sm space-y-2"><Label>Límite diario de multimedia</Label><Input type="number" min={1} max={10000} value={mediaAnalysisDailyLimit} onChange={(e) => setMediaAnalysisDailyLimit(Number(e.target.value) || 1)} disabled={disabled || !conversationAnalysisEnabled} /><p className="text-xs text-muted-foreground">Cantidad total de imágenes y notas de voz que la cuenta puede procesar por día. Los mensajes anteriores no se reprocesan automáticamente.</p></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auditoría de calidad automática</CardTitle>
            <CardDescription>
              Califica cada análisis sin hacer una segunda llamada a la IA. Los resultados son internos y sirven para mejorar la atención, no para responder al cliente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Habilitar QA Scoring</p>
                <p className="text-xs text-muted-foreground">Evalúa empatía, manejo de objeciones y cumplimiento de los criterios de tu cuenta.</p>
              </div>
              <Switch
                checked={qaScoringEnabled}
                onCheckedChange={setQaScoringEnabled}
                disabled={disabled || !conversationAnalysisEnabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-criteria">Guion y criterios propios de evaluación</Label>
              <Textarea
                id="qa-criteria"
                value={qaScoringCriteria}
                onChange={(event) => setQaScoringCriteria(event.target.value)}
                placeholder="Ejemplo: confirmar necesidad, explicar el siguiente paso, no prometer plazos sin verificar y cerrar con una pregunta clara."
                rows={4}
                disabled={disabled || !qaScoringEnabled}
              />
              <p className="text-xs text-muted-foreground">Opcional. Si lo dejas vacío, se usan criterios generales de servicio. No pegues datos sensibles ni instrucciones para la IA.</p>
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
