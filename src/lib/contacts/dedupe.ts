import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  /** Secondary numbers kept from a merged-away duplicate (migration 127)
   *  OR a contact that genuinely has more than one active number (e.g. a
   *  business line and a personal line) — see `addAlternatePhone`. */
  alternate_phones?: string[] | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone OR any of its
 * `alternate_phones` matches `phone`, or null. Pre-filters in SQL by the
 * last-8-digit suffix on the primary phone (so we don't pull every
 * contact), then applies the strict `phonesMatch` in JS on the small
 * candidate set — the exact approach the webhook has used. A contact
 * that genuinely owns more than one active number (a business line and
 * a personal line, not just an old merged one) is looked up the same
 * way: whichever number messages in, this still resolves to the one
 * contact instead of spawning a duplicate.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const [byPhone, byAlternate] = await Promise.all([
    db
      .from("contacts")
      .select("*")
      .eq("account_id", accountId)
      .like("phone", `%${suffix}`),
    // Contacts with any alternate number never number more than a
    // handful per account (only merges/manual additions create them),
    // so fetching all of them and matching in JS is cheap and avoids
    // needing a per-array-element SQL suffix match PostgREST can't
    // express directly.
    db
      .from("contacts")
      .select("*")
      .eq("account_id", accountId)
      .not("alternate_phones", "eq", "{}"),
  ]);

  if (byPhone.error && byAlternate.error) return null;

  const byPrimary = (byPhone.data as ExistingContact[] | null)?.find((c) => phonesMatch(c.phone, phone));
  if (byPrimary) return byPrimary;

  return (
    (byAlternate.data as ExistingContact[] | null)?.find((c) =>
      (c.alternate_phones ?? []).some((alt) => phonesMatch(alt, phone)),
    ) ?? null
  );
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
