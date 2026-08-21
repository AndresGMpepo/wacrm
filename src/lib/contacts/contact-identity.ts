/**
 * Connector identifiers are useful internally for matching a person across
 * channels, but they are not telephone numbers and must not leak into the
 * agent-facing interface.
 */
const TECHNICAL_CONTACT_IDENTIFIER = /^(?:zernio(?:[:_]|$)|meta:(?:facebook|instagram):|yeastar-chat:)/i;

export function isTechnicalContactIdentifier(value: string | null | undefined) {
  return TECHNICAL_CONTACT_IDENTIFIER.test(value?.trim() ?? '');
}

/** Returns a dialable/displayable phone number, or null for connector ids. */
export function displayContactPhone(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && !isTechnicalContactIdentifier(normalized) ? normalized : null;
}
