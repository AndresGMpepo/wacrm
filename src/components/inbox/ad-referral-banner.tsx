"use client";

import { useState } from "react";
import { Megaphone, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MetaAdReferral } from "@/types";

interface AdReferralBannerProps {
  referral: MetaAdReferral;
}

/**
 * Mirrors what Meta's own Messenger/Instagram app shows at the top of a
 * conversation that started from a Click-to-Messenger ad: "Esto es una
 * respuesta a un anuncio" + "Ver detalles". Without this, an agent has no
 * way to tell which ad a customer is asking about (see Message.ad_referral).
 * Dismissal is local/session-only — reopening the conversation shows it
 * again, same as re-fetching the thread would.
 */
export function AdReferralBanner({ referral }: AdReferralBannerProps) {
  const t = useTranslations("Inbox.adReferralBanner");
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  return (
    <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs sm:px-4">
      <div className="flex items-center gap-2">
        {referral.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote Meta CDN thumbnail, same pattern as contact/message avatars in this folder.
          <img
            src={referral.photo_url}
            alt=""
            className="h-8 w-8 flex-shrink-0 rounded object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{t("title")}</p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-primary hover:underline"
          >
            {expanded ? t("hideDetails") : t("viewDetails")}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-background/60 p-2">
          {referral.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- remote Meta CDN thumbnail.
            <img
              src={referral.photo_url}
              alt=""
              className="h-16 w-16 flex-shrink-0 rounded object-cover"
            />
          )}
          <div className="min-w-0 space-y-0.5">
            {referral.ad_title ? (
              <p className="font-medium text-foreground">{referral.ad_title}</p>
            ) : (
              <p className="text-muted-foreground">{t("noTitle")}</p>
            )}
            {referral.ad_id && (
              <p className="text-muted-foreground">{t("adId", { id: referral.ad_id })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
