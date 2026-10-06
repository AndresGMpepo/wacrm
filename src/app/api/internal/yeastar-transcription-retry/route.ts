import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { processCallTranscriptions } from '@/lib/telephony/transcription-sync'

export const maxDuration = 120

// Compatibility for existing cron installations; the main worker also runs it.
export async function POST(request: Request) {
  const secret = process.env.AI_ANALYSIS_WORKER_SECRET
  if (!secret || request.headers.get('x-ai-worker-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await processCallTranscriptions(supabaseAdmin()))
  } catch (error) {
    console.error('[yeastar] transcription worker failed:', error)
    return NextResponse.json({ error: 'Could not synchronize call transcriptions' }, { status: 500 })
  }
}
