"use client";

/* eslint-disable @next/next/no-img-element -- Meta CDN / same-origin media proxy, same pattern as message-bubble.tsx. */

import { useState } from "react";
import { AtSign, CircleSlash, Clapperboard, ExternalLink, History, Image as ImageIcon, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { MessagePostContext } from "@/types";

interface PostContextCardProps {
  context: MessagePostContext;
  /** Same-origin preview (Zernio media proxy) when the share itself is the message's media. */
  previewSrc?: string;
}

const ICONS = {
  story_reply: History,
  story_mention: AtSign,
  shared_post: ImageIcon,
  shared_reel: Clapperboard,
  shared_story: History,
  link_referral: Link2,
  unavailable: CircleSlash,
} as const;

/**
 * Mirrors the context Meta's own Instagram/Messenger inbox shows above a
 * message ("Respondió a tu historia", a shared post, …) so the agent knows
 * which post or story the customer is writing about. Data comes from
 * `messages.post_context` (src/lib/zernio/post-context.ts, migration 145).
 */
export function PostContextCard({ context, previewSrc }: PostContextCardProps) {
  const t = useTranslations("Inbox.postContext");
  const [previewFailed, setPreviewFailed] = useState(false);
  const Icon = ICONS[context.kind];
  const preview = context.kind === "story_reply" ? context.url : previewSrc;

  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-border/60 bg-background/60 text-xs">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">{t(context.kind)}</span>
      </div>
      {preview && !previewFailed && (
        <img
          src={preview}
          alt=""
          loading="lazy"
          onError={() => setPreviewFailed(true)}
          className="max-h-48 w-full max-w-[16rem] object-cover"
        />
      )}
      {preview && previewFailed && (context.kind === "story_reply" || context.kind === "shared_story" || context.kind === "story_mention") && (
        <p className="px-2 pb-1.5 text-muted-foreground">{t("storyExpired")}</p>
      )}
      {context.kind === "link_referral" && context.ref && (
        <p className="px-2 pb-1.5 text-muted-foreground">{t("ref", { ref: context.ref })}</p>
      )}
      {context.permalink && (
        <a
          href={context.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("flex items-center gap-1 px-2 py-1.5 text-primary hover:underline", preview && !previewFailed && "border-t border-border/60")}
        >
          <ExternalLink className="h-3 w-3" />
          {t("openPost")}
        </a>
      )}
    </div>
  );
}
