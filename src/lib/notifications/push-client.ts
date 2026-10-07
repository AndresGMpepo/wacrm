import { z } from 'zod';

export type PushErrorCode = 'unsupported' | 'permissionDenied' | 'installFirst'
  | 'notConfigured' | 'requestFailed' | 'subscriptionMissing' | 'pushTestFailed'
  | 'subscriptionKeyChanged' | 'localTestFailed';

export class PushSettingsError extends Error {
  constructor(public readonly code: PushErrorCode) {
    super(code);
  }
}

const configurationSchema = z.object({
  publicKey: z.string().min(1),
  registered: z.boolean(),
});
const errorSchema = z.object({
  code: z.enum(['notConfigured', 'requestFailed', 'subscriptionMissing', 'pushTestFailed']),
});

export async function getDevicePushConfiguration(endpoint?: string) {
  const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : '';
  const response = await fetch(`/api/push/subscription${query}`, { cache: 'no-store' });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new PushSettingsError(error.success ? error.data.code : 'requestFailed');
  }
  const configuration = configurationSchema.safeParse(body);
  if (!configuration.success) throw new PushSettingsError('requestFailed');
  return configuration.data;
}

export function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const key = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) key[index] = raw.charCodeAt(index);
  return key;
}

export function subscriptionKeyMatches(subscription: Pick<PushSubscription, 'options'>, publicKey: string): boolean {
  const actual = subscription.options.applicationServerKey;
  if (!actual) return true;
  const expected = decodeApplicationServerKey(publicKey);
  const bytes = new Uint8Array(actual);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}
