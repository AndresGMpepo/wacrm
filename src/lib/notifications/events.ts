/** Fired whenever a notification is created/read for the current user, so
 *  any badge/count relying only on its own Realtime subscription has a
 *  reliable fallback signal to refetch from — IncomingMessageAlert already
 *  has a robust poll+Realtime dual path for detecting new notifications;
 *  reuse it instead of trusting a second, independent Realtime subscription. */
export const NOTIFICATIONS_CHANGED_EVENT = 'nexoomni:notifications-changed'

export function emitNotificationsChanged() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT))
}
