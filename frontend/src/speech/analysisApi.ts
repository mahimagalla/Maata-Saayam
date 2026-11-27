import type { SpeechLanguage } from './provider'

export type AnalysisLanguage = SpeechLanguage | 'auto'

export type TranscriptFragment = { id: number; text: string; finalized_at_ms: number }

export interface AnalysisResult {
  risk_score: number
  risk_level: 'low' | 'suspicious' | 'high_caution' | 'critical'
  detected_signals: {
    category: string
    severity: 'low' | 'medium' | 'high'
    evidence: string
    start: number
    end: number
    match_quality: 'direct' | 'normalized_variant'
    explanation: string
  }[]
  evidence: string[]
  explanation: string
  recommended_action: 'CONTINUE_LISTENING' | 'SHOW_CAUTION' | 'SPOKEN_WARNING' | 'FAMILY_RESCUE'
  transcript_quality: { status: 'empty' | 'limited' | 'usable'; token_count: number; duplicates_removed: number }
  normalized_transcript: string
  evidence_fragment_ids?: number[]
}

export const transcriptLimit = 20_000

export async function requestAnalysis(
  input: string | readonly TranscriptFragment[],
  language: AnalysisLanguage,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof input === 'string'
      ? { transcript: input, language }
      : { fragments: input, language }),
    signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    if (response.status === 422) throw new Error('Check the transcript length and selected language.')
    throw new Error('Analysis is unavailable. Check that the backend is running and try again.')
  }
  return response.json() as Promise<AnalysisResult>
}
