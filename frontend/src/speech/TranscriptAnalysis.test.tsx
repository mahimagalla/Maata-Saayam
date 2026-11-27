import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { requestAnalysis, type AnalysisResult } from './analysisApi'
import { AnalysisResults, TranscriptAnalysis } from './TranscriptAnalysis'

const result: AnalysisResult = {
  risk_score: 58,
  risk_level: 'high_caution',
  detected_signals: [{
    category: 'credential_theft', severity: 'high',
    evidence: 'ఓటీపీ చెప్పండి', start: 0, end: 13, match_quality: 'normalized_variant',
    explanation: 'The speaker asks for a one-time code or other banking credential.',
  }],
  evidence: ['ఓటీపీ చెప్పండి'],
  explanation: 'A credential request accompanies financial pressure.',
  recommended_action: 'SPOKEN_WARNING',
  transcript_quality: { status: 'usable', token_count: 12, duplicates_removed: 1 },
  normalized_transcript: 'OTP tell',
}

afterEach(() => vi.unstubAllGlobals())

test('renders the assessment, exact evidence, match quality, and recommended action', () => {
  const html = renderToStaticMarkup(<AnalysisResults result={result} />)
  for (const value of [
    'High caution · 58/100', 'Spoken warning', 'credential theft', 'ఓటీపీ చెప్పండి',
    'Matched after normalization', 'A credential request accompanies financial pressure.',
  ]) expect(html).toContain(value)
})

test('labels input sources and disables analysis before a transcript is present', () => {
  const empty = renderToStaticMarkup(<TranscriptAnalysis transcript="" language="auto" source="Sample or pasted text" />)
  expect(empty).toContain('Sample or pasted text')
  expect(empty).toMatch(/disabled=""[^>]*>Analyze/)
  const spoken = renderToStaticMarkup(
    <TranscriptAnalysis transcript="ఓటీపీ చెప్పండి" language="te-IN" source="Microphone transcript" />,
  )
  expect(spoken).toContain('Microphone transcript')
  expect(spoken).not.toMatch(/disabled=""[^>]*>Analyze/)
})

test('uses a same-origin POST for explicitly submitted text and handles validation errors', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(result))
    .mockResolvedValueOnce(Response.json({}, { status: 422 }))
  vi.stubGlobal('fetch', fetch)
  const { signal } = new AbortController()
  await expect(requestAnalysis('ఓటీపీ చెప్పండి', 'te-IN', signal)).resolves.toEqual(result)
  expect(fetch).toHaveBeenCalledWith('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: 'ఓటీపీ చెప్పండి', language: 'te-IN' }),
    signal, cache: 'no-store',
  })
  await expect(requestAnalysis('text', 'auto', signal)).rejects.toThrow('Check the transcript length')
})
