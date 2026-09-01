"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/events";
import { useAuth } from "@/hooks/use-auth";

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * Combines a Realtime subscription (fast path) with a plain refetch
 * triggered by `NOTIFICATIONS_CHANGED_EVENT` (dispatched by
 * IncomingMessageAlert, which already has a proven poll+Realtime dual path)
 * and a visibility-change refetch, so the badge doesn't get stuck if this
 * subscription alone misses an event.
 */
export function useUnreadNotifications(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    let cancelled = false;

    const refetchCount = async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: unreadCount, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (cancelled || error) return;
      setCount(unreadCount ?? 0);
    };

    void refetchCount();

    const onNotificationsChanged = () => void refetchCount();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetchCount();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = supabase
      .channel(`notifications-unread-count:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => void refetchCount(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}
