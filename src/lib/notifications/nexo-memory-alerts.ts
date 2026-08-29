import { supabaseAdmin } from '@/lib/ai/admin-client'

type Db = ReturnType<typeof supabaseAdmin>

/** Every proactive Nexo Memory alert goes to the account's owners/admins —
 *  same recipient rule already used for negative-sentiment alerts (migration
 *  041), since these are account-health signals, not a single agent's task. */
async function notifyAccountAdmins(db: Db, accountId: string, notification: { contactId: string | null; title: string; body: string }) {
  const { data: admins, error } = await db.from('profiles').select('user_id').eq('account_id', accountId).in('account_role', ['owner', 'admin'])
  if (error || !admins?.length) return
  await db.from('notifications').insert(admins.map((admin) => ({
    account_id: accountId,
    user_id: admin.user_id,
    type: 'nexo_memory_alert' as const,
    contact_id: notification.contactId,
    title: notification.title,
    body: notification.body,
  })))
}

function contactLabel(contact: { name: string | null; phone: string | null } | null) {
  return contact?.name || contact?.phone || 'Un contacto'
}

/** Fires once, right when a contact's consolidated risk actually escalates to
 *  'high' — not on every re-analysis that keeps it there. */
export async function alertRiskEscalatedToHigh(db: Db, accountId: string, contactId: string) {
  const { data: contact } = await db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const name = contactLabel(contact)
  await notifyAccountAdmins(db, accountId, {
    contactId,
    title: 'Cliente en riesgo alto',
    body: `Nexo Memory marcó a ${name} con riesgo alto. Revisa su historial y da seguimiento.`,
  })
}

/** Fires once per commitment, right when it flips from 'pending' to 'overdue'. */
export async function alertCommitmentOverdue(db: Db, accountId: string, contactId: string, description: string) {
  const { data: contact } = await db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const name = contactLabel(contact)
  await notifyAccountAdmins(db, accountId, {
    contactId,
    title: 'Compromiso vencido',
    body: `El compromiso "${description}" con ${name} venció sin cumplirse.`,
  })
}

/** Fires when a still-active prospect (medium/high risk) hasn't had any new
 *  memory generated in 48h — re-alerts every 48h while it stays stale. */
export async function alertStaleProspect(db: Db, accountId: string, contactId: string) {
  const { data: contact } = await db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const name = contactLabel(contact)
  await notifyAccountAdmins(db, accountId, {
    contactId,
    title: 'Prospecto sin seguimiento',
    body: `${name} lleva más de 48 horas sin actividad ni seguimiento registrado.`,
  })
}

/** One aggregate alert per account per day — the "tienes 14 clientes
 *  esperando..." style summary, deduped by checking today's own alerts
 *  instead of a separate schedule table. */
export async function sendDailyNexoMemoryDigest(db: Db, accountId: string, counts: { overdueCommitments: number; highRisk: number; staleProspects: number }) {
  if (!counts.overdueCommitments && !counts.highRisk && !counts.staleProspects) return
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  const { count } = await db.from('notifications').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('type', 'nexo_memory_alert').eq('title', 'Resumen diario de Nexo Memory').gte('created_at', startOfDay.toISOString())
  if (count) return
  const parts = [
    counts.overdueCommitments ? `${counts.overdueCommitments} compromiso(s) vencido(s)` : null,
    counts.highRisk ? `${counts.highRisk} cliente(s) en riesgo alto` : null,
    counts.staleProspects ? `${counts.staleProspects} prospecto(s) sin seguimiento en 48h` : null,
  ].filter(Boolean)
  await notifyAccountAdmins(db, accountId, {
    contactId: null,
    title: 'Resumen diario de Nexo Memory',
    body: `Tienes ${parts.join(', ')}. Revisa el panel de Reportes para ver el detalle.`,
  })
}
