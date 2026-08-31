import { AiError } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MAX_MEDIA_BYTES = 15 * 1024 * 1024
// Media models are independent from the account's chat model. This avoids
// breaking image/audio processing when an account chooses another text model.
const IMAGE_ANALYSIS_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-4.1-mini'
const AUDIO_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'

function isBlockedMediaHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost') ||
    normalized === '0.0.0.0' || normalized === '::1' ||
    /^127\./.test(normalized) || /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
}

function textFromChatCompletion(data: unknown): string {
  const value = data as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }
  const content = value.choices?.[0]?.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : ''
  if (!text.trim()) throw new AiError('OpenAI did not return an image description.', { code: 'empty_response' })
  return text.trim().slice(0, 2500)
}

function assertSize(bytes: Buffer) {
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new AiError('El archivo supera el máximo de 15 MB para análisis.', { code: 'media_too_large', status: 400 })
  }
}

/** Download a direct CDN attachment from a trusted connected channel. */
export async function downloadPublicMedia(urlValue: string): Promise<{ bytes: Buffer; mimeType: string | null }> {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || isBlockedMediaHostname(url.hostname)) {
    throw new AiError('La URL del medio no es segura.', { code: 'unsupported_media_url', status: 400 })
  }
  let response: Response
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo descargar el medio.', { code: 'network_error' })
  }
  if (!response.ok) throw new AiError(`No se pudo descargar el medio (${response.status}).`, { code: 'provider_error', status: response.status })
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) {
    throw new AiError('El archivo supera el máximo de 15 MB para análisis.', { code: 'media_too_large', status: 400 })
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  assertSize(bytes)
  return { bytes, mimeType: response.headers.get('content-type') }
}

export async function describeImageWithOpenAi(args: {
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  timeoutMs: number
}): Promise<string> {
  assertSize(args.bytes)
  const dataUrl = `data:${args.mimeType || 'image/jpeg'};base64,${args.bytes.toString('base64')}`
  let response: Response
  try {
    response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: args.model || IMAGE_ANALYSIS_MODEL,
        messages: [{ role: 'system', content: 'Describe la imagen de forma concisa y factual para el contexto de atención al cliente. No infieras datos sensibles ni identidad.' }, { role: 'user', content: [{ type: 'text', text: 'Describe esta imagen para incluirla en el resumen de la conversación.' }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_completion_tokens: 300,
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo analizar la imagen.', { code: 'network_error' })
  }
  if (!response.ok) throw new AiError(`OpenAI rechazó el análisis de imagen (${response.status}).`, { code: 'provider_error', status: response.status })
  return textFromChatCompletion(await response.json().catch(() => null))
}

export async function transcribeAudioWithOpenAi(args: {
  apiKey: string
  model: string
  bytes: Buffer
  mimeType: string
  timeoutMs: number
}): Promise<string> {
  assertSize(args.bytes)
  const extension = args.mimeType.includes('ogg') ? 'ogg' : args.mimeType.includes('mpeg') ? 'mp3' : args.mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.set('model', args.model || AUDIO_TRANSCRIPTION_MODEL)
  form.set('language', 'es')
  form.set('file', new Blob([new Uint8Array(args.bytes)], { type: args.mimeType || 'audio/ogg' }), `voice-note.${extension}`)
  let response: Response
  try {
    response = await fetch(OPENAI_TRANSCRIPT_URL, { method: 'POST', headers: { Authorization: `Bearer ${args.apiKey}` }, body: form, signal: AbortSignal.timeout(args.timeoutMs) })
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : 'No se pudo transcribir la nota de voz.', { code: 'network_error' })
  }
  if (!response.ok) throw new AiError(`OpenAI rechazó la transcripción (${response.status}).`, { code: 'provider_error', status: response.status })
  const data = await response.json().catch(() => null) as { text?: string } | null
  if (!data?.text?.trim()) throw new AiError('OpenAI no devolvió una transcripción.', { code: 'empty_response' })
  return data.text.trim().slice(0, 10000)
}
