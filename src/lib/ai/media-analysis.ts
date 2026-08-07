import { AiError } from './types'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MAX_MEDIA_BYTES = 15 * 1024 * 1024
// Kept independent from the chat model selected in Settings. An account may
// choose a text-only chat model, while GPT-4.1 mini reliably accepts image
// input through Chat Completions using the very same OpenAI API key.
const IMAGE_ANALYSIS_MODEL = 'gpt-4.1-mini'

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

export async function describeImageWithOpenAi(args: {
  apiKey: string
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
        model: IMAGE_ANALYSIS_MODEL,
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
  bytes: Buffer
  mimeType: string
  timeoutMs: number
}): Promise<string> {
  assertSize(args.bytes)
  const extension = args.mimeType.includes('ogg') ? 'ogg' : args.mimeType.includes('mpeg') ? 'mp3' : args.mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.set('model', 'gpt-4o-mini-transcribe')
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
