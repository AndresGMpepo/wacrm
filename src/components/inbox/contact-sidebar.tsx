"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { displayContactPhone } from "@/lib/contacts/contact-identity";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  PhoneCall,
  ListTodo,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useTelephony } from '@/components/telephony/telephony-provider';
import { ConversationInternalNotes } from './conversation-internal-notes';
import { NexoMemoryPanel } from '@/components/contacts/nexo-memory-panel';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

type ContactConversation = {
  id: string;
  status: "open" | "pending" | "closed";
  last_message_text: string | null;
  last_message_at: string | null;
  channel_type: "whatsapp" | "yeastar_live_chat" | "facebook" | "instagram" | "tiktok" | "zernio_whatsapp" | "zernio_facebook" | "zernio_instagram" | null;
  channel_source_label: string | null;
};

type ContactCall = {
  id: string;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  direction: "inbound" | "outbound" | "internal" | "unknown" | null;
  duration_seconds: number | null;
};

type ContactTask = {
  id: string;
  description: string;
  due_date: string | null;
  due_at: string | null;
  status: string;
};

type ContactHistoryItem =
  | { kind: "conversation"; id: string; channel: string; status: ContactConversation["status"]; summary: string; occurredAt: string | null }
  | { kind: "call"; id: string; direction: ContactCall["direction"]; summary: string; occurredAt: string | null; durationSeconds: number | null };

function channelLabel(conversation: ContactConversation) {
  if (conversation.channel_type === "yeastar_live_chat") return conversation.channel_source_label ? `Chat web · ${conversation.channel_source_label}` : "Chat web Yeastar";
  if (conversation.channel_type === "facebook" || conversation.channel_type === "zernio_facebook") return "Facebook";
  if (conversation.channel_type === "instagram" || conversation.channel_type === "zernio_instagram") return "Instagram";
  if (conversation.channel_type === "zernio_whatsapp") return "WhatsApp";
  if (conversation.channel_type === "tiktok") return "TikTok";
  return "WhatsApp";
}

/** Friendly due-date label for the sidebar's Tareas list — mirrors the
 *  Seguimientos queue's own formatting so the same task reads the same
 *  way everywhere. */
function formatTaskDue(task: { due_date: string | null; due_at: string | null }) {
  if (task.due_at) {
    const date = new Date(task.due_at);
    const now = new Date();
    const diffMin = Math.round((date.getTime() - now.getTime()) / 60_000);
    const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(date);
    if (diffMin <= 0) return `Venciendo · ${time}`;
    if (diffMin < 60) return `En ${diffMin} min`;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date.toDateString() === now.toDateString()) return `Hoy ${time}`;
    if (date.toDateString() === tomorrow.toDateString()) return `Mañana ${time}`;
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  if (task.due_date) return `Para el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(`${task.due_date}T00:00:00`))}`;
  return "Sin fecha";
}

interface ContactSidebarProps {
  contact: Contact | null;
  conversationId?: string | null;
  internalNotesOpenSignal?: number;
}

export function ContactSidebar({ contact, conversationId, internalNotesOpenSignal }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const telephony = useTelephony();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingTagId, setSavingTagId] = useState<string | null>(null);
  const [history, setHistory] = useState<ContactHistoryItem[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [taskTime, setTaskTime] = useState("09:00");
  const [savingTask, setSavingTask] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // The contact, not a provider-specific visitor label, is the stable
    // identity. This lets a known customer see their WhatsApp and Live Chat
    // threads together without ever merging conversations automatically.
    const [dealsRes, notesRes, tagsRes, allTagsRes, conversationsRes, callsRes, tasksRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("tags").select("*").order("name"),
      supabase
        .from("conversations")
        .select("id, status, last_message_text, last_message_at, channel_type, channel_source_label")
        .eq("contact_id", contact.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(8),
      supabase
        .from("yeastar_call_transcriptions")
        .select("id, summary, started_at, ended_at, direction, duration_seconds")
        .eq("contact_id", contact.id)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(8),
      supabase
        .from("contact_commitments")
        .select("id, description, due_date, due_at, status")
        .eq("contact_id", contact.id)
        .eq("status", "pending")
        .order("due_date", { ascending: true, nullsFirst: false }),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    if (tasksRes.data) setTasks(tasksRes.data as ContactTask[]);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    const conversations = (conversationsRes.data ?? []) as ContactConversation[];
    const calls = (callsRes.data ?? []) as ContactCall[];
    const analyses = conversations.length
      ? await supabase
        .from("ai_conversation_analyses")
        .select("conversation_id, summary")
        .in("conversation_id", conversations.map((conversation) => conversation.id))
        .eq("status", "completed")
      : { data: [] as { conversation_id: string; summary: string | null }[] };
    const summaries = new Map((analyses.data ?? []).map((analysis) => [analysis.conversation_id, analysis.summary]));
    setHistory([
      ...conversations.map((conversation): ContactHistoryItem => ({
        kind: "conversation",
        id: conversation.id,
        channel: channelLabel(conversation),
        status: conversation.status,
        summary: summaries.get(conversation.id) || conversation.last_message_text || "Sin mensajes",
        occurredAt: conversation.last_message_at,
      })),
      ...calls.map((call): ContactHistoryItem => ({
        kind: "call",
        id: call.id,
        direction: call.direction,
        summary: call.summary || "Sin resumen de llamada disponible.",
        occurredAt: call.ended_at || call.started_at,
        durationSeconds: call.duration_seconds,
      })),
    ].sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "")).slice(0, 10));
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Live refresh: an analysis run against one of this contact's other
  // conversations (e.g. Instagram) must reflect here immediately, without
  // waiting for a page reload, when viewing a different conversation (e.g.
  // WhatsApp) of the SAME contact.
  useEffect(() => {
    if (!contact) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`contact-history:${contact.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `contact_id=eq.${contact.id}` }, () => void fetchContactData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_conversation_analyses' }, () => void fetchContactData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_commitments', filter: `contact_id=eq.${contact.id}` }, () => void fetchContactData())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [contact, fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    const phone = displayContactPhone(contact?.phone);
    if (!phone) return;
    await navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleToggleTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      const existing = tags.find((t) => t.id === tag.id);
      setSavingTagId(tag.id);
      try {
        if (existing) {
          await deleteContactTag(contact.id, tag.id);
          setTags((prev) => prev.filter((t) => t.id !== tag.id));
        } else {
          const result = await addContactTag(contact.id, tag.id);
          if (result.added !== false) {
            setTags((prev) => [...prev, { ...tag, contact_tag_id: `${contact.id}:${tag.id}` }]);
          }
        }
      } catch {
        // Best-effort — the dropdown stays open so the agent can retry.
      } finally {
        setSavingTagId(null);
      }
    },
    [contact, tags],
  );

  function openNewTaskForm() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setEditingTaskId(null);
    setTaskDescription("");
    setTaskDate(tomorrow.toISOString().slice(0, 10));
    setTaskTime("09:00");
    setTaskFormOpen(true);
  }

  function openEditTaskForm(task: ContactTask) {
    const reference = task.due_at ? new Date(task.due_at) : task.due_date ? new Date(`${task.due_date}T09:00`) : new Date();
    setEditingTaskId(task.id);
    setTaskDescription(task.description);
    setTaskDate(reference.toISOString().slice(0, 10));
    setTaskTime(task.due_at ? reference.toTimeString().slice(0, 5) : "09:00");
    setTaskFormOpen(true);
  }

  function closeTaskForm() {
    setTaskFormOpen(false);
    setEditingTaskId(null);
  }

  const saveTaskDraft = useCallback(async () => {
    if (!contact || !taskDescription.trim() || !taskDate || !taskTime) return;
    setSavingTask(true);
    try {
      const dueAt = new Date(`${taskDate}T${taskTime}`).toISOString();
      const response = editingTaskId
        ? await fetch(`/api/contacts/${contact.id}/memory/commitments/${editingTaskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: taskDescription.trim(), dueAt }),
          })
        : await fetch("/api/contacts/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactId: contact.id, description: taskDescription.trim(), dueAt }),
          });
      if (!response.ok) return;
      closeTaskForm();
      void fetchContactData();
    } finally {
      setSavingTask(false);
    }
  }, [contact, taskDescription, taskDate, taskTime, editingTaskId, fetchContactData]);

  const completeTask = useCallback(
    async (task: ContactTask) => {
      if (!contact) return;
      const response = await fetch(`/api/contacts/${contact.id}/memory/commitments/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (response.ok) setTasks((prev) => prev.filter((t) => t.id !== task.id));
    },
    [contact],
  );

  const deleteTask = useCallback(
    async (task: ContactTask) => {
      if (!contact) return;
      if (!window.confirm("¿Eliminar esta tarea?")) return;
      const response = await fetch(`/api/contacts/${contact.id}/memory/commitments/${task.id}`, {
        method: "DELETE",
      });
      if (response.ok) setTasks((prev) => prev.filter((t) => t.id !== task.id));
    },
    [contact],
  );

  if (!contact) {
    return (
      <div className="flex h-full w-80 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const contactPhone = displayContactPhone(contact.phone);
  const displayName = contact.name || contactPhone || "Contacto";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contactPhone ? (
              <div className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={() => void telephony.call(contactPhone)}
                  disabled={!telephony.connected}
                  title="Llamar por NexPhone"
                  aria-label="Llamar por NexPhone"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  <PhoneCall className="h-4 w-4" />
                </button>
                <button
                  onClick={handleCopyPhone}
                  className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex-1 truncate">{contactPhone}</span>
                  {copied ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            ) : null}

            {/* Other numbers on file for this contact (e.g. a business
                line + a personal line) — each callable on its own. */}
            {(contact.alternate_phones ?? []).map((altPhone) => {
              const label = displayContactPhone(altPhone);
              return (
                <div key={altPhone} className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => void telephony.call(label ?? altPhone)}
                    disabled={!telephony.connected}
                    title="Llamar por NexPhone"
                    aria-label="Llamar por NexPhone"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/70"
                  >
                    <PhoneCall className="h-4 w-4" />
                  </button>
                  <div className="flex flex-1 items-center gap-2 px-2 py-1.5">
                    <span className="flex-1 truncate">{label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Otro número</span>
                  </div>
                </div>
              );
            })}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          <NexoMemoryPanel
            contactId={contact.id}
            history={history}
            activeConversationId={conversationId}
          />

          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      title={tSidebar("addTag")}
                    />
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-border bg-popover">
                  {allTags.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {tSidebar("noTagsAvailable")}
                    </div>
                  ) : (
                    allTags.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={tags.some((t) => t.id === tag.id)}
                        disabled={savingTagId === tag.id}
                        onCheckedChange={() => handleToggleTag(tag)}
                        className="text-popover-foreground"
                      >
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tasks — create/edit/delete a follow-up task with a reminder,
              right from the conversation without leaving the inbox. */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <ListTodo className="h-3 w-3" />
                Tareas
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                title="Nueva tarea"
                onClick={openNewTaskForm}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {tasks.length === 0 && !taskFormOpen ? (
                <p className="px-1 text-xs text-muted-foreground">Sin tareas pendientes.</p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-xs text-foreground">{task.description}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {formatTaskDue(task)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-5 w-5" title="Editar" onClick={() => openEditTaskForm(task)}>
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5" title="Marcar hecho" onClick={() => void completeTask(task)}>
                          <Check className="h-3 w-3 text-emerald-500" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5" title="Eliminar" onClick={() => void deleteTask(task)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {taskFormOpen ? (
                <div className="space-y-2 rounded-lg border border-dashed border-border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {editingTaskId ? "Editar tarea" : "Nueva tarea"}
                    </span>
                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={closeTaskForm}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <textarea
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="¿Qué hay que hacer?"
                    rows={2}
                    className="w-full resize-none rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                  />
                  <div className="flex gap-2">
                    <Input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className="h-7 flex-1 text-xs" />
                    <Input type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} className="h-7 w-24 text-xs" />
                  </div>
                  <Button
                    size="sm"
                    className="h-7 w-full text-xs"
                    disabled={!taskDescription.trim() || !taskDate || !taskTime || savingTask}
                    onClick={() => void saveTaskDraft()}
                  >
                    {savingTask ? "Guardando…" : editingTaskId ? "Guardar cambios" : "Crear tarea"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {conversationId ? <ConversationInternalNotes conversationId={conversationId} compact openSignal={internalNotesOpenSignal} /> : null}

          {conversationId ? <div className="my-4 border-t border-border" /> : null}

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
