import { describe, expect, it } from 'vitest'

import { executiveReportCsv, executiveReportExcelXml, executiveReportPrintHtml, reportExportFilename, type ExecutiveReport, type ExecutiveReportInsight } from './executive-report-export'

const report: ExecutiveReport = {
  meta: { operating_mode: 'hybrid', currency: 'MXN', range: { from: '2026-08-01', to: '2026-08-07', days: 7 }, response_metrics_capped: false },
  operational: { new_conversations: 12, previous_new_conversations: 9, open_backlog: 3, resolved: 8, first_response_minutes: 4, first_response_samples: 9 },
  channels: [{ channel: '=WhatsApp', conversations: 12, resolved: 8, first_response_minutes: 4 }],
  agents: [{ id: 'agent-1', name: '+Agente', open_conversations: 1, first_response_minutes: 3, measured_responses: 4 }],
  intelligence: { analyzed: 10, negative: 1, negative_rate: 10, average_sentiment_score: 72, average_qa_score: 89 },
  commercial: { open_pipeline_value: 15000, open_deals: 2, won_deals: 1, lost_deals: 0, won_value: 9000 },
  campaigns: { totals: { recipients: 10, sent: 10, delivered: 9, read: 8, replied: 2, failed: 1 }, delivery_rate: 90, read_rate: 80, reply_rate: 20, items: [] },
}

const insight: ExecutiveReportInsight = {
  headline: 'Prioridad de seguimiento', summary: 'La dirección debe priorizar la recuperación de clientes.',
  priorities: [{ area: 'experiencia', priority: 'alta', title: 'Recuperar clientes', recommendation: 'Contactar casos críticos.', rationale: 'El sentimiento negativo aumentó.' }],
  risks: ['Fuga de clientes'], opportunities: ['Mejorar el seguimiento'], indicators_to_watch: ['Sentimiento'], data_note: null,
}

describe('executive report exports', () => {
  it('creates a UTF-8 CSV with separate report sections and safe cells', () => {
    const csv = executiveReportCsv(report)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('Resumen')
    expect(csv).toContain('Canales')
    expect(csv).toContain("'=WhatsApp")
    expect(csv).toContain("'+Agente")
  })

  it('creates an Excel-compatible workbook with multiple worksheets', () => {
    const workbook = executiveReportExcelXml(report)
    expect(workbook).toContain('ss:Name="Resumen"')
    expect(workbook).toContain('ss:Name="Campañas"')
    expect(workbook).toContain("&apos;=WhatsApp")
  })

  it('uses an auditable filename for the visible range', () => {
    expect(reportExportFilename(report, 'xls')).toBe('nexoomni-reporte-ejecutivo-2026-08-01-2026-08-07.xls')
  })

  it('creates a print-ready report without executable markup', () => {
    const html = executiveReportPrintHtml(report, insight)
    expect(html).toContain('<title>NexoOmni - Reporte ejecutivo</title>')
    expect(html).toContain('&apos;=WhatsApp')
    expect(html).toContain('Dictamen IA')
    expect(html).not.toContain('<script')
  })

  it('adds the visible AI insight to spreadsheet exports when provided', () => {
    expect(executiveReportCsv(report, insight)).toContain('Dictamen IA')
    expect(executiveReportExcelXml(report, insight)).toContain('Dictamen IA')
  })
})
