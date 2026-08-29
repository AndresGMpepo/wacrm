/**
 * Meta customer-service window.
 *
 * Meta direct messaging channels share a 24-hour service window. This is
 * deliberately kept independent from the connector implementation so the
 * same policy is applied to the native Meta routes and to Zernio routes.
 * Public comments are not direct messages and are therefore excluded.
 */
export const META_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const META_DIRECT_MESSAGE_CHANNELS = new Set([
  'whatsapp',
  'facebook',
  'instagram',
  'zernio_whatsapp',
  'zernio_facebook',
  'zernio_instagram',
]);

export const META_MESSAGING_WINDOW_CLOSED_MESSAGE =
  'La ventana de atención de 24 horas de Meta terminó. Pide al cliente que escriba nuevamente. En WhatsApp usa una plantilla aprobada desde el canal compatible.';

export function isMetaDirectMessageChannel(
  channelType: string | null | undefined,
  isPublicComment = false,
): boolean {
  return channelType !== null && channelType !== undefined &&
    !isPublicComment &&
    META_DIRECT_MESSAGE_CHANNELS.has(channelType);
}

export function getMetaCustomerServiceWindow(
  lastCustomerMessageAt: string | Date | null | undefined,
  now = new Date(),
) {
  if (!lastCustomerMessageAt) {
    return { isOpen: false, remainingMs: 0, expiresAt: null };
  }

  const lastCustomerMessage = new Date(lastCustomerMessageAt);
  if (Number.isNaN(lastCustomerMessage.getTime())) {
    return { isOpen: false, remainingMs: 0, expiresAt: null };
  }

  const expiresAt = new Date(lastCustomerMessage.getTime() + META_CUSTOMER_SERVICE_WINDOW_MS);
  const remainingMs = expiresAt.getTime() - now.getTime();

  return {
    isOpen: remainingMs > 0,
    remainingMs: Math.max(0, remainingMs),
    expiresAt,
  };
}
