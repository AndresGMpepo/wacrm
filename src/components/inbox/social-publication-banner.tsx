"use client";

/* eslint-disable @next/next/no-img-element -- provider CDN preview URLs may expire and are not stable image-loader sources. */

import { ExternalLink, MessageSquareText, Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Conversation } from "@/types";

export function SocialPublicationBanner({ conversation }: { conversation: Conversation }) {
  const t = useTranslations("Inbox.socialPublication");
  if (!conversation.social_comment_id) return null;

  return (
    <div className="border-b border-border bg-primary/5 px-3 py-2 text-xs sm:px-4">
      <div className="flex items-start gap-2">
        {conversation.social_post_preview_url ? (
          <img
            src={conversation.social_post_preview_url}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
            <MessageSquareText className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {t(conversation.channel_type === "zernio_instagram" || conversation.channel_type === "instagram" ? "instagramComment" : "facebookComment")}
          </p>
          <p className="mt-0.5 line-clamp-2 text-muted-foreground">
            {conversation.social_post_title || t("unknownPost")}
          </p>
          {conversation.social_ad_id || conversation.social_ad_title ? (
            <p className="mt-1 flex items-center gap-1 text-primary">
              <Megaphone className="h-3 w-3" />
              {conversation.social_ad_title || t("paidAd", { id: conversation.social_ad_id ?? "" })}
            </p>
          ) : null}
          {conversation.social_post_url ? (
            <a
              href={conversation.social_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t("openPost")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
