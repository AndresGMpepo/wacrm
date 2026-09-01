"use client";

// Message media can be authenticated blob URLs or third-party provider URLs;
// Next Image cannot optimize either without weakening the existing media flow.
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Download,
  Maximize2,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** Conversation's channel_type — drives the Zernio media proxy below. */
  channelType?: string | null;
}

/**
 * A Zernio-connected WhatsApp conversation stores the raw Zernio CDN
 * URL in `media_url`. Unlike the native WhatsApp proxy path
 * (`/api/whatsapp/media/...`), that CDN requires a server-side bearer
 * token to download — a plain `<img>`/`<audio>` src can't attach it,
 * so the browser gets an unauthenticated 401/403 and the bubble shows
 * a broken image / "unavailable" audio. Route those through our own
 * authenticated same-origin proxy instead; Facebook/Instagram Zernio
 * media stays public and is left untouched.
 */
function resolveMediaSrc(message: Message, channelType?: string | null): string | undefined {
  if (channelType === "zernio_whatsapp" && message.media_url?.startsWith("http")) {
    return `/api/omnichannel/zernio/media/${message.id}`;
  }
  return message.media_url;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

/** Wraps a media element so a failed fetch (expired/invalid WhatsApp
 *  access token, revoked media, etc.) shows a clear message instead of
 *  the browser's blank/broken player — audio and video had no failure
 *  state at all before this, unlike images. */
function MediaWithFallback({ label, t, children }: { label: string; t: ReturnType<typeof useTranslations>; children: (onError: () => void) => ReactNode }) {
  const [error, setError] = useState(false);
  if (error) return <MediaUnavailable label={label} t={t} />;
  return <>{children(() => setError(true))}</>;
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/") || url.startsWith("/api/omnichannel/zernio/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const imageSrc = src ?? "";
  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className="group relative block overflow-hidden rounded-lg text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Ver imagen ampliada"
      >
        <img
          src={imageSrc}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          onError={() => setError(true)}
        />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/55 to-transparent px-2 pb-2 pt-8 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl gap-3 p-3 sm:max-w-5xl" aria-describedby={undefined}>
          <DialogHeader className="sr-only">
            <DialogTitle>{alt}</DialogTitle>
            <DialogDescription>Vista ampliada de la imagen adjunta.</DialogDescription>
          </DialogHeader>
          <img src={imageSrc} alt={alt} className="max-h-[78vh] w-full rounded-lg object-contain" />
          <div className="flex justify-end pr-10">
            <a
              href={imageSrc}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              <Download className="h-4 w-4" /> Descargar
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageContent({ message, t, channelType }: { message: Message, t: ReturnType<typeof useTranslations>, channelType?: string | null }) {
  const mediaSrc = resolveMediaSrc(message, channelType);
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {mediaSrc ? (
            <MediaImage url={mediaSrc} alt="Shared image" />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
          <MediaInsight label="Descripción de imagen" value={message.media_description} status={message.media_analysis_status} />
        </div>
      );

    case "video":
      return (
        <div>
          {mediaSrc ? (
            <MediaWithFallback label={t("video")} t={t}>
              {(onError) => (
                <video
                  src={mediaSrc}
                  controls
                  className="max-h-64 max-w-60 rounded-lg"
                  onError={onError}
                />
              )}
            </MediaWithFallback>
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {mediaSrc ? (
            <MediaWithFallback label={t("audio")} t={t}>
              {(onError) => (
                <audio src={mediaSrc} controls className="max-w-60" onError={onError} />
              )}
            </MediaWithFallback>
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
          <MediaInsight label="Transcripción de nota de voz" value={message.media_transcript} status={message.media_analysis_status} />
        </div>
      );

    case "document":
      if (!mediaSrc) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={mediaSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

function MediaInsight({ label, value, status }: { label: string; value?: string; status?: Message['media_analysis_status'] }) {
  if (value) {
    return <details className="mt-2 rounded-md bg-background/40 px-2 py-1.5 text-xs text-muted-foreground"><summary className="cursor-pointer select-none font-medium text-foreground">{label}</summary><p className="mt-1 whitespace-pre-wrap">{value}</p></details>
  }
  if (status === 'queued' || status === 'processing') {
    return <p className="mt-2 text-[11px] text-muted-foreground">Procesando con IA…</p>
  }
  return null
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  channelType,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} t={t} channelType={channelType} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
