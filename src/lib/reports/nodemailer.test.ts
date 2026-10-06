import { describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'

describe('Nodemailer report attachment compatibility', () => {
  it('generates an email with both report attachments without contacting an SMTP server', async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    })
    const result = await transport.sendMail({
      from: 'Reports <reports@example.test>',
      to: ['reception@example.test'],
      subject: '[NexoOmni Reportes] Seguimiento',
      html: '<p>Reporte de seguimiento</p>',
      attachments: [
        { filename: 'nexoomni-reporte-ejecutivo.csv', content: Buffer.from('cliente,pendiente\nAna,Seguimiento'), contentType: 'text/csv; charset=utf-8' },
        { filename: 'nexoomni-reporte-ejecutivo.xls', content: Buffer.from('<table><tr><td>Ana</td></tr></table>'), contentType: 'application/vnd.ms-excel' },
      ],
    })
    expect(result.messageId).toBeTruthy()
    expect(result.envelope.to).toEqual(['reception@example.test'])
    const message = result.message.toString()
    expect(message).toContain('Subject: [NexoOmni Reportes] Seguimiento')
    expect(message).toContain('filename=nexoomni-reporte-ejecutivo.csv')
    expect(message).toContain('filename=nexoomni-reporte-ejecutivo.xls')
    expect(message).toContain('Content-Type: text/html')
  })
})
