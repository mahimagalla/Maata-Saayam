import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { playTeluguMessage } from '../guardian/warningAudio'
import type { AnalysisResult } from '../speech/analysisApi'
import { RecoveryPanel, recoveryAudioText, recoveryAudioUrl } from './RecoveryPanel'
import { rememberRecovery } from './summary'

afterEach(() => vi.unstubAllGlobals())

const cues = [
  ['authority_impersonation', 'I am calling from CBI'],
  ['legal_threat', 'You are under digital arrest'],
  ['secrecy_isolation', 'Do not tell anyone'],
  ['financial_manipulation', 'సేఫ్ అకౌంట్ కు డబ్బులు పంపండి 456789'],
]

test('projects structured results to Telugu explanations with no transcript or personal data', () => {
  const result = {
    recommended_action: 'FAMILY_RESCUE',
    detected_signals: cues.map(([category, evidence]) => ({ category, evidence })),
  } as AnalysisResult
  const summary = rememberRecovery(null, result)
  expect(summary).toEqual({ level: 'critical', reasons: ['cbi', 'digitalArrest', 'secrecy_isolation', 'safeAccount'] })
  const ordinary = { ...result, recommended_action: 'CONTINUE_LISTENING' } as const
  expect(rememberRecovery(summary, ordinary)).toBe(summary)
  expect(rememberRecovery(summary, { ...result, recommended_action: 'SHOW_CAUTION' })).toBe(summary)
  const html = renderToStaticMarkup(<RecoveryPanel summary={summary!} onDismiss={() => {}} />)
  for (const copy of ['సీబీఐ', 'డిజిటల్ అరెస్టు', 'ఇతరులకు చెప్పవద్దని', 'సురక్షిత ఖాతా', 'డబ్బు పంపారా?']) {
    expect(html).toContain(copy)
  }
  expect(html).toContain('lang="te"')
  expect(html).toContain('href="tel:1930"')
  expect(html).toContain('href="https://cybercrime.gov.in/"')
  expect(html).not.toContain('456789')
  expect(html).not.toContain('I am calling')
  expect(html).not.toContain('<audio')
})

test('does not infer CBI from evidence in a different category or from an ordinary police claim', () => {
  const result = { recommended_action: 'SHOW_CAUTION', detected_signals: [
    { category: 'authority_impersonation', evidence: 'I am calling from the police' },
    { category: 'legal_threat', evidence: 'The CBI will arrest you' },
  ] } as AnalysisResult
  expect(rememberRecovery(null, result)?.reasons).toEqual(['authority_impersonation', 'legal_threat'])
})

test('uses the bundled recovery guidance when no Telugu browser voice is available', async () => {
  const opened = vi.fn()
  vi.stubGlobal('window', { speechSynthesis: { getVoices: () => [{ lang: 'en-IN' }] } })
  vi.stubGlobal('Audio', class {
    onended: (() => void) | null = null
    constructor(url: string) { opened(url) }
    async play() { this.onended?.() }
  })
  await playTeluguMessage(recoveryAudioText, recoveryAudioUrl, new AbortController().signal)
  expect(opened).toHaveBeenCalledExactlyOnceWith('/audio/telugu-recovery-guidance.wav')
})
