export type ExecutiveReport = {
  meta: { operating_mode: 'commercial' | 'support' | 'hybrid'; currency: string; range: { from: string; to: string; days: number }; response_metrics_capped: boolean }
  operational: { new_conversations: number; previous_new_conversations: number; open_backlog: number; resolved: number; first_response_minutes: number | null; first_response_samples: number }
  channels: { channel: string; conversations: number; resolved: number; first_response_minutes: number | null }[]
  agents: { id: string; name: string; open_conversations: number; first_response_minutes: number | null; measured_responses: number }[]
  intelligence: { analyzed: number; negative: number; negative_rate: number | null; average_sentiment_score: number | null; average_qa_score: number | null }
  commercial: { open_pipeline_value: number; open_deals: number; won_deals: number; lost_deals: number; won_value: number }
  campaigns: { totals: { recipients: number; sent: number; delivered: number; read: number; replied: number; failed: number }; delivery_rate: number | null; read_rate: number | null; reply_rate: number | null; items: { id: string; name: string; status: string; created_at: string; total_recipients: number | null; delivered_count: number | null; read_count: number | null; replied_count: number | null; failed_count: number | null }[] }
}

export type ExecutiveReportInsight = {
  headline: string
  summary: string
  priorities: Array<{ area: 'operacion' | 'comercial' | 'marketing' | 'experiencia'; priority: 'alta' | 'media' | 'baja'; title: string; recommendation: string; rationale: string }>
  risks: string[]
  opportunities: string[]
  indicators_to_watch: string[]
  data_note: string | null
}

type ExportCell = string | number | null | undefined
type ExportSheet = { name: string; rows: ExportCell[][] }

function display(value: ExportCell) { return value === null || value === undefined ? 'Sin datos' : String(value) }

// Prevent spreadsheet formula injection when report fields contain user-supplied values.
function safeCell(value: ExportCell) {
  const text = display(value)
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
}

function asPercent(value: number | null) { return value === null ? 'Sin datos' : `${value}%` }
function minutes(value: number | null) { return value === null ? 'Sin datos' : value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min` }
function operatingMode(mode: ExecutiveReport['meta']['operating_mode']) { return mode === 'commercial' ? 'Comercial' : mode === 'support' ? 'Soporte' : 'Híbrido' }

function reportSheets(report: ExecutiveReport, insight?: ExecutiveReportInsight | null): ExportSheet[] {
  const sheets: ExportSheet[] = [
    { name: 'Resumen', rows: [
      ['Reporte ejecutivo NexoOmni'],
      ['Periodo', `${report.meta.range.from} al ${report.meta.range.to}`],
      ['Perfil operativo', operatingMode(report.meta.operating_mode)],
      ['Moneda', report.meta.currency], [],
      ['Métrica', 'Valor'],
      ['Conversaciones nuevas', report.operational.new_conversations],
      ['Conversaciones nuevas (periodo anterior)', report.operational.previous_new_conversations],
      ['Cola abierta', report.operational.open_backlog], ['Conversaciones cerradas', report.operational.resolved],
      ['Primera respuesta', minutes(report.operational.first_response_minutes)], ['Muestras de primera respuesta', report.operational.first_response_samples],
      ['Análisis IA', report.intelligence.analyzed], ['Análisis negativos', report.intelligence.negative], ['Tasa de análisis negativos', asPercent(report.intelligence.negative_rate)],
      ['Sentimiento promedio', report.intelligence.average_sentiment_score ?? 'Sin datos'], ['QA promedio', report.intelligence.average_qa_score ?? 'Sin datos'],
      ['Valor de pipeline abierto', report.commercial.open_pipeline_value], ['Tratos abiertos', report.commercial.open_deals], ['Tratos ganados', report.commercial.won_deals], ['Valor ganado', report.commercial.won_value],
    ] },
    { name: 'Canales', rows: [['Canal', 'Conversaciones nuevas', 'Cierres', 'Primera respuesta'], ...report.channels.map((channel) => [channel.channel, channel.conversations, channel.resolved, minutes(channel.first_response_minutes)])] },
    { name: 'Agentes', rows: [['Agente', 'Chats abiertos', 'Primera respuesta', 'Respuestas medidas'], ...report.agents.map((agent) => [agent.name, agent.open_conversations, minutes(agent.first_response_minutes), agent.measured_responses])] },
    { name: 'Campañas', rows: [
      ['Campaña', 'Estado', 'Creada', 'Destinatarios', 'Entregados', 'Leídos', 'Respondidos', 'Fallidos'],
      ...report.campaigns.items.map((campaign) => [campaign.name, campaign.status, campaign.created_at, campaign.total_recipients, campaign.delivered_count, campaign.read_count, campaign.replied_count, campaign.failed_count]),
      [], ['Totales', '', '', report.campaigns.totals.recipients, report.campaigns.totals.delivered, report.campaigns.totals.read, report.campaigns.totals.replied, report.campaigns.totals.failed],
      ['Tasas', '', '', asPercent(report.campaigns.delivery_rate), asPercent(report.campaigns.read_rate), asPercent(report.campaigns.reply_rate)],
    ] },
  ]
  if (insight) {
    sheets.push({ name: 'Dictamen IA', rows: [
      ['Dictamen IA para dirección'],
      ['Titular', insight.headline],
      ['Resumen', insight.summary], [],
      ['Prioridad', 'Área', 'Recomendación', 'Base'],
      ...insight.priorities.map((item) => [item.title, `${item.priority} · ${item.area}`, item.recommendation, item.rationale]), [],
      ['Riesgos', ...insight.risks],
      ['Oportunidades', ...insight.opportunities],
      ['Indicadores a vigilar', ...insight.indicators_to_watch],
      ...(insight.data_note ? [['Nota de datos', insight.data_note]] : []),
    ] })
  }
  return sheets
}

function escapeCsv(value: ExportCell) {
  const text = safeCell(value).replaceAll('"', '""')
  return /[;"\n\r]/.test(text) ? `"${text}"` : text
}

function escapeXml(value: ExportCell) {
  return safeCell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function executiveReportCsv(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  return `\uFEFF${reportSheets(report, insight).flatMap((sheet, index) => [...(index === 0 ? [] : [['']]), [sheet.name], ...sheet.rows]).map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`
}

export function executiveReportExcelXml(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  const sheets = reportSheets(report, insight).map((sheet) => `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${sheet.rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets}</Workbook>`
}

export function reportExportFilename(report: ExecutiveReport, extension: 'csv' | 'xls') {
  return `nexoomni-reporte-ejecutivo-${report.meta.range.from}-${report.meta.range.to}.${extension}`
}

export function executiveReportPrintHtml(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  const sheetTable = (sheet: ExportSheet) => `<section><h2>${escapeXml(sheet.name)}</h2><table><tbody>${sheet.rows.map((row, index) => `<tr>${row.map((cell) => `<${index === 0 ? 'th' : 'td'}>${escapeXml(cell)}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></section>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>NexoOmni - Reporte ejecutivo</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:36px}h1{font-size:24px;margin:0 0 6px}p{color:#536075;margin:0 0 22px}h2{font-size:16px;margin:26px 0 8px}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:14px}th,td{border:1px solid #d8dee9;padding:7px;text-align:left;vertical-align:top}th{background:#f1f4f8;font-weight:700}@media print{body{margin:18px}section{break-inside:avoid}}</style></head><body><h1>Reporte ejecutivo NexoOmni</h1><p>Periodo: ${escapeXml(report.meta.range.from)} al ${escapeXml(report.meta.range.to)} · Perfil: ${escapeXml(operatingMode(report.meta.operating_mode))}</p>${reportSheets(report, insight).map(sheetTable).join('')}</body></html>`
}
