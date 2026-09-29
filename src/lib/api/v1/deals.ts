// ============================================================
// Shared deal/pipeline logic for the public API (v1).
//
// Kept out of the route files so list/get/create/update share one
// serializer and one embed shape — same pattern as
// src/lib/api/v1/contacts.ts.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Row select that embeds the contact + stage for serialization. */
export const DEAL_SELECT =
  '*, contact:contacts(id,phone,name), stage:pipeline_stages(id,name,color,position)';

export interface ApiDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  title: string;
  value: number;
  currency: string;
  status: 'open' | 'won' | 'lost';
  notes: string | null;
  expected_close_date: string | null;
  assigned_to: string | null;
  source_channel: string | null;
  created_at: string;
  updated_at: string;
  contact: { id: string; phone: string; name: string | null } | null;
  stage: { id: string; name: string; color: string; position: number } | null;
}

/** Project a raw `deals` row (with embeds) into the public shape. */
export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  return {
    id: row.id as string,
    pipeline_id: row.pipeline_id as string,
    stage_id: row.stage_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    title: row.title as string,
    value: Number(row.value ?? 0),
    currency: (row.currency as string | null) ?? 'USD',
    status: (row.status as ApiDeal['status']) ?? 'open',
    notes: (row.notes as string | null) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    assigned_to: (row.assigned_to as string | null) ?? null,
    source_channel: (row.source_channel as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string | null) ?? (row.created_at as string),
    contact: (row.contact as ApiDeal['contact']) ?? null,
    stage: (row.stage as ApiDeal['stage']) ?? null,
  };
}

/** Fetch + serialize a single deal scoped to the account, or null. */
export async function getDealById(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<ApiDeal | null> {
  const { data, error } = await db
    .from('deals')
    .select(DEAL_SELECT)
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeDeal(data as Record<string, unknown>);
}
