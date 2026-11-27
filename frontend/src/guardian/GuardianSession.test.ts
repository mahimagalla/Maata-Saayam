import { afterEach, expect, test, vi } from 'vitest'
import type { AnalysisResult, requestAnalysis } from '../speech/analysisApi'
import type { SpeechEvent, SpeechProvider } from '../speech/provider'
import { GuardianSession } from './GuardianSession'
import { recoveryMs, RiskMonitor, warningCooldownMs } from './riskState'
import { TranscriptWindow, windowMs } from './transcriptWindow'

test('family alerts are silent for ordinary speech and caution, and upgrade one episode without stopping local audio', async () => {
  const { guardian, analyze, finalize, notifyFamily, play, rescue } = setup()
  analyze.mockResolvedValueOnce(result('CONTINUE_LISTENING'))
    .mockResolvedValueOnce({ ...result('SHOW_CAUTION', 30), evidence_fragment_ids: [2] })
    .mockResolvedValueOnce({ ...result('SPOKEN_WARNING', 50), evidence_fragment_ids: [2, 3] })
    .mockResolvedValue({ ...result('FAMILY_RESCUE', 75), evidence_fragment_ids: [2, 3, 4] })
  notifyFamily.mockImplementation(() => { throw new Error('offline') })
  guardian.start('en-IN')
  finalize('I will come home.')
  await vi.advanceTimersByTimeAsync(0)
  finalize('I will come home. Send your OTP.')
  await vi.advanceTimersByTimeAsync(0)
  expect(notifyFamily).not.toHaveBeenCalled()
  finalize('I will come home. Send your OTP. You will be arrested.')
  await vi.advanceTimersByTimeAsync(350)
  expect(play).toHaveBeenCalledOnce()
  expect(notifyFamily.mock.calls[0][0]).toMatchObject({ state: 'warning' })
  finalize('Transfer money to the safe account.')
  await vi.advanceTimersByTimeAsync(350)
  expect(rescue).toHaveBeenCalledOnce()
  expect(notifyFamily.mock.calls[1][0]).toEqual({ ...notifyFamily.mock.calls[0][0], state: 'rescue' })
  finalize('Stay on the line.')
  await vi.advanceTimersByTimeAsync(0)
  expect(notifyFamily).toHaveBeenCalledTimes(2)
})

function result(action: AnalysisResult['recommended_action'], score = 0): AnalysisResult {
  return {
    risk_score: score, risk_level: score >= 70 ? 'critical' : score >= 50 ? 'high_caution' : 'low',
    recommended_action: action, detected_signals: [], evidence: ['test evidence'],
    explanation: 'Rule result', transcript_quality: { status: 'usable', token_count: 8, duplicates_removed: 0 },
    normalized_transcript: '',
  }
}

function setup() {
  vi.useFakeTimers()
  const streams: { emit: (event: SpeechEvent) => void; start: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }[] = []
  const provider: SpeechProvider = {
    name: 'Test provider',
    createSession: vi.fn((_language, emit) => {
      const stream = { emit, start: vi.fn(), stop: vi.fn(), abort: vi.fn() }
      streams.push(stream)
      return stream
    }),
  }
  const analyze = vi.fn<typeof requestAnalysis>().mockResolvedValue(result('CONTINUE_LISTENING'))
  const play = vi.fn<(signal: AbortSignal) => Promise<void>>().mockResolvedValue(undefined)
  const loadVoice = vi.fn().mockResolvedValue(null)
  const rescue = vi.fn<NonNullable<ConstructorParameters<typeof GuardianSession>[5]>>()
    .mockImplementation((_voice, signal) => play(signal))
  const notifyFamily = vi.fn()
  const guardian = new GuardianSession(provider, vi.fn(), analyze, play, loadVoice, rescue, notifyFamily)
  const finalize = (final: string, interim = '') => streams.at(-1)?.emit({ type: 'transcript', final, interim })
  return { guardian, streams, provider, analyze, play, finalize, loadVoice, rescue, notifyFamily }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('starts the selected microphone once, shows interim text, and clears state on stop', async () => {
  const { guardian, streams, provider, analyze, finalize } = setup()
  guardian.start('hi-IN')
  guardian.start('hi-IN')
  expect(provider.createSession).toHaveBeenCalledExactlyOnceWith('hi-IN', expect.any(Function))
  expect(streams[0].start).toHaveBeenCalledOnce()
  streams[0].emit({ type: 'listening' })
  streams[0].emit({ type: 'microphone-active' })
  finalize('', 'नमस्ते')
  expect(guardian.state).toMatchObject({ recognition: 'LISTENING', microphoneActive: true, interim: 'नमस्ते' })
  expect(analyze).not.toHaveBeenCalled()
  finalize('नमस्ते, हम कल मिलेंगे।')
  expect(analyze).toHaveBeenCalledTimes(1)
  guardian.stop()
  expect(streams[0].abort).toHaveBeenCalledOnce()
  expect(analyze.mock.calls[0][2].aborted).toBe(true)
  streams[0].emit({ type: 'listening' })
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ recognition: 'STOPPED', result: null, transcript: '', interim: '' })
})

test('suppresses repeated finalized content and ignores late results for older text', async () => {
  const { guardian, analyze, finalize, play } = setup()
  let completeOld!: (value: AnalysisResult) => void
  analyze.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve }))
  guardian.start('en-IN')
  finalize('Please send the OTP.')
  finalize('Please send the OTP.', 'please')
  finalize('Please send the OTP. Please send the OTP.')
  finalize('Please send the OTP. Please send the OTP. We will meet tomorrow.')
  expect(analyze).toHaveBeenCalledTimes(2)
  expect(analyze.mock.calls[1][0]).toEqual([
    expect.objectContaining({ id: 1, text: 'Please send the OTP.' }),
    expect.objectContaining({ id: 2, text: 'We will meet tomorrow.' }),
  ])
  expect(analyze.mock.calls[0][2].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  completeOld(result('FAMILY_RESCUE', 100))
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ risk: 'LISTENING', result: { risk_score: 0 } })
  expect(play).not.toHaveBeenCalled()
})

test('expires old text and keeps the transcript bounded across microphone restarts', () => {
  const window = new TranscriptWindow()
  expect(window.append('I am calling from the police.', 0)).toEqual([
    { id: 1, text: 'I am calling from the police.', finalized_at_ms: 0 },
  ])
  expect(window.append('I am calling from the police. We will meet tomorrow.', 46_000)).toEqual([
    { id: 2, text: 'We will meet tomorrow.', finalized_at_ms: 46_000 },
  ])
  window.startStream()
  expect(window.append('WE WILL MEET TOMORROW!', 47_000)).toBeUndefined()
  expect(window.append('WE WILL MEET TOMORROW! ' + 'x'.repeat(1_700), 48_000)?.[0].text.length).toBe(1_600)
})

test('leaves recognition active through API errors and analyzes the next update', async () => {
  const { guardian, streams, analyze, finalize } = setup()
  analyze.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise(() => {}))
  guardian.start('te-IN')
  streams[0].emit({ type: 'listening' })
  finalize('మనం రేపు కలుద్దాం.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ recognition: 'LISTENING', analysis: 'UNAVAILABLE' })
  finalize('మనం రేపు కలుద్దాం. నేను వస్తాను.')
  await vi.advanceTimersByTimeAsync(8_000)
  expect(analyze.mock.calls[1][2].aborted).toBe(true)
  expect(guardian.state).toMatchObject({ recognition: 'LISTENING', analysis: 'UNAVAILABLE' })
  finalize('మనం రేపు కలుద్దాం. నేను వస్తాను. కుటుంబంతో వస్తాను.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ recognition: 'LISTENING', analysis: 'READY' })
})

test.each(['not-allowed', 'no-speech', 'aborted'])('allows restarting after recognition error %s', (code) => {
  const { guardian, streams } = setup()
  guardian.start('te-IN')
  streams[0].emit({ type: 'error', code })
  expect(guardian.state).toMatchObject({ recognition: 'ERROR', recognitionError: code, transcript: '' })
  guardian.start('te-IN')
  expect(streams).toHaveLength(2)
  streams[1].emit({ type: 'ended' })
  expect(guardian.state.recognition).toBe('ENDED')
})

test('uses backend actions, holds de-escalation and respects the cooldown', () => {
  const risk = new RiskMonitor()
  expect(risk.assess('SHOW_CAUTION', 0)).toBe(false)
  expect(risk.state).toBe('CAUTION')
  expect(risk.assess('SPOKEN_WARNING', 1)).toBe(true)
  risk.warningStarted(1)
  expect(risk.assess('FAMILY_RESCUE', 2)).toBe(false)
  expect(risk.state).toBe('CRITICAL')
  expect(risk.assess('CONTINUE_LISTENING', 3)).toBe(false)
  expect(risk.state).toBe('CRITICAL')
  risk.assess('CONTINUE_LISTENING', 3 + recoveryMs)
  expect(risk.state).toBe('LISTENING')
  expect(risk.assess('SPOKEN_WARNING', 4 + recoveryMs)).toBe(false)
  expect(risk.state).toBe('WARNING')
  expect(risk.assess('SPOKEN_WARNING', 1 + warningCooldownMs)).toBe(false)
  risk.assess('CONTINUE_LISTENING', 2 + warningCooldownMs)
  risk.assess('CONTINUE_LISTENING', 2 + warningCooldownMs + recoveryMs)
  expect(risk.assess('FAMILY_RESCUE', 3 + warningCooldownMs + recoveryMs)).toBe(true)
})

test('genuine results stay silent and identical high-risk results play once unless manually repeated', async () => {
  const { guardian, streams, analyze, finalize, play } = setup()
  analyze.mockResolvedValueOnce(result('CONTINUE_LISTENING'))
    .mockResolvedValue({ ...result('FAMILY_RESCUE', 86), evidence_fragment_ids: [2] })
  guardian.start('en-IN')
  finalize('My son works in the police department.')
  await vi.advanceTimersByTimeAsync(0)
  guardian.repeatWarning()
  expect(play).not.toHaveBeenCalled()
  finalize('My son works in the police department. Transfer money to a safe account.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ risk: 'CRITICAL', result: { risk_score: 86, evidence: ['test evidence'] } })
  expect(streams[0].abort).toHaveBeenCalledOnce()
  expect(play).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(350)
  expect(streams[1].start).toHaveBeenCalledOnce()
  finalize('Transfer money to a safe account.')
  expect(analyze).toHaveBeenCalledTimes(2)
  finalize('Transfer money to a safe account. Do not hang up.')
  await vi.advanceTimersByTimeAsync(0)
  expect(analyze).toHaveBeenCalledTimes(3)
  expect(play).toHaveBeenCalledTimes(1)
  guardian.repeatRescue()
  expect(play).toHaveBeenCalledTimes(2)
  guardian.discard()
  expect(play.mock.calls[1][0].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(350)
  expect(streams).toHaveLength(2)
})

test.each([
  ['CONTINUE_LISTENING', null],
  ['SHOW_CAUTION', 'caution'],
  ['SPOKEN_WARNING', 'warning'],
] as const)('deliberate stop after %s retains only the recovery tier and recognized category', async (action, level) => {
  const { guardian, analyze, finalize, notifyFamily, streams } = setup()
  const transcript = level ? 'Send me your OTP for verification.' : 'Good morning, how are you?'
  analyze.mockResolvedValue({
    ...result(action, level === 'caution' ? 30 : level === 'warning' ? 50 : 0),
    evidence_fragment_ids: level ? [1] : [], evidence: level ? ['Send me your OTP'] : [],
    normalized_transcript: transcript,
    detected_signals: level ? [{ category: 'credential_theft', evidence: transcript, severity: 'medium',
      start: 0, end: transcript.length, match_quality: 'direct', explanation: 'secret 456789' }] : [],
  })
  const write = vi.fn()
  const network = vi.fn()
  vi.stubGlobal('localStorage', { setItem: write })
  vi.stubGlobal('indexedDB', { open: write })
  vi.stubGlobal('fetch', network)
  guardian.start('en-IN')
  finalize(transcript)
  await vi.advanceTimersByTimeAsync(0)
  const alerts = notifyFamily.mock.calls.length
  guardian.stop()
  expect(guardian.state).toMatchObject({ recognition: 'STOPPED', transcript: '', interim: '', result: null,
    recovery: level ? { level, reasons: ['credential_theft'] } : null })
  const stopped = guardian.state
  streams[0].emit({ type: 'ended' })
  guardian.stop()
  expect(guardian.state).toBe(stopped)
  expect(JSON.stringify(guardian.state)).not.toContain('456789')
  expect(notifyFamily).toHaveBeenCalledTimes(alerts)
  expect(write).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
  guardian.dismissRecovery()
  guardian.stop()
  expect(guardian.state.recovery).toBeNull()
})

test.each(['error', 'ended'] as const)('recognition %s clears a previous suspicious outcome without a post-stop summary', async (type) => {
  const { guardian, analyze, finalize, streams } = setup()
  analyze.mockResolvedValue({ ...result('SHOW_CAUTION'), evidence_fragment_ids: [1] })
  guardian.start('te-IN')
  finalize('మీ ఓటీపీ చెప్పండి.')
  await vi.advanceTimersByTimeAsync(0)
  streams[0].emit(type === 'error' ? { type, code: 'network' } : { type })
  guardian.stop()
  expect(guardian.state).toMatchObject({
    recognition: type === 'error' ? 'ERROR' : 'ENDED', recovery: null, result: null, transcript: '',
  })
})

test('deliberate stop during automatic critical rescue keeps playback and never restarts recognition', async () => {
  const { guardian, analyze, finalize, rescue, streams, notifyFamily } = setup()
  analyze.mockResolvedValue({ ...result('FAMILY_RESCUE', 75), evidence_fragment_ids: [1] })
  let endPlayback!: () => void
  rescue.mockImplementation(() => new Promise<void>((resolve) => { endPlayback = resolve }))
  guardian.start('en-IN')
  finalize('Do not tell anyone do not disconnect the call transfer the money to a safe account immediately')
  await vi.advanceTimersByTimeAsync(0)
  const signal = rescue.mock.calls[0][1]
  guardian.stop()
  expect(signal.aborted).toBe(false)
  expect(guardian.state).toMatchObject({ recognition: 'STOPPED', rescue: { playing: true },
    recovery: { level: 'critical' }, result: null, transcript: '' })
  endPlayback()
  await vi.advanceTimersByTimeAsync(350)
  expect(guardian.state.rescue?.playing).toBe(false)
  expect(streams).toHaveLength(1)
  expect(notifyFamily).toHaveBeenCalledOnce()
  guardian.dismissRescue()
  expect(guardian.state.rescue).toBeNull()
  expect(guardian.state.recovery?.level).toBe('critical')
  guardian.discard()
  expect(guardian.state.recovery).toBeNull()
})

test('blocked playback keeps the visual warning and restarts recognition', async () => {
  const { guardian, streams, analyze, finalize, play } = setup()
  analyze.mockResolvedValue({ ...result('SPOKEN_WARNING', 58), evidence_fragment_ids: [1] })
  play.mockRejectedValue(new Error('Playback blocked'))
  guardian.start('te-IN')
  finalize('OTP చెప్పండి. Transfer money now.')
  await vi.advanceTimersByTimeAsync(350)
  expect(guardian.state).toMatchObject({ risk: 'WARNING', warningFailed: true })
  expect(streams).toHaveLength(2)
})

test('sends original finalized fragments with their own timestamps and holds only live evidence', async () => {
  const { guardian, streams, analyze, play } = setup()
  const at = Date.now()
  const caution = { ...result('SHOW_CAUTION', 30), evidence_fragment_ids: [1] }
  analyze.mockResolvedValueOnce(caution).mockResolvedValueOnce(caution)
  guardian.start('en-IN')
  const emit = (...segments: string[]) => streams[0].emit({
    type: 'transcript', final: segments.join(' '), interim: '', finalSegments: segments,
  })
  emit(' Send me your OTP. ')
  await vi.advanceTimersByTimeAsync(4_000)
  expect(guardian.state.risk).toBe('CAUTION')
  emit(' Send me your OTP. ', 'Good morning.')
  emit(' Send me your OTP. ', 'Good morning.')
  await vi.advanceTimersByTimeAsync(0)
  expect(analyze).toHaveBeenCalledTimes(2)
  expect(analyze.mock.calls[1][0]).toEqual([
    { id: 1, text: ' Send me your OTP. ', finalized_at_ms: at },
    { id: 2, text: 'Good morning.', finalized_at_ms: at + 4_000 },
  ])
  await vi.advanceTimersByTimeAsync(windowMs - 4_000)
  expect(analyze.mock.calls[2][0]).toEqual([
    { id: 2, text: 'Good morning.', finalized_at_ms: at + 4_000 },
  ])
  expect(guardian.state).toMatchObject({ recognition: 'STARTING', risk: 'LISTENING', transcript: 'Good morning.' })
  expect(play).not.toHaveBeenCalled()
})

test('expiry-only reanalysis cannot play a new warning and stop cancels expiry work', async () => {
  const { guardian, analyze, finalize, play } = setup()
  analyze.mockResolvedValueOnce(result('CONTINUE_LISTENING'))
    .mockResolvedValueOnce(result('CONTINUE_LISTENING'))
    .mockResolvedValueOnce({ ...result('SPOKEN_WARNING', 50), evidence_fragment_ids: [2] })
  guardian.start('en-IN')
  finalize('First phrase.')
  await vi.advanceTimersByTimeAsync(5_000)
  finalize('First phrase. Another phrase.')
  await vi.advanceTimersByTimeAsync(windowMs - 5_000)
  expect(analyze).toHaveBeenCalledTimes(3)
  expect(play).not.toHaveBeenCalled()
  guardian.stop()
  await vi.advanceTimersByTimeAsync(windowMs)
  expect(analyze).toHaveBeenCalledTimes(3)
})

test('related evidence can raise the visual state and an independent episode can speak after cooldown', () => {
  const risk = new RiskMonitor()
  expect(risk.assess('SPOKEN_WARNING', 0, [1])).toBe(true)
  risk.warningStarted(0)
  expect(risk.assess('FAMILY_RESCUE', 3_000, [1, 2])).toBe(false)
  expect(risk.state).toBe('CRITICAL')
  expect(risk.assess('FAMILY_RESCUE', warningCooldownMs, [3], false)).toBe(false)
  expect(risk.assess('FAMILY_RESCUE', warningCooldownMs + 1, [4])).toBe(true)
})

test('a fresh independent threat warns after the first episode expires', async () => {
  const { guardian, analyze, finalize, play } = setup()
  analyze.mockResolvedValueOnce({ ...result('SPOKEN_WARNING', 50), evidence_fragment_ids: [1] })
    .mockResolvedValueOnce({ ...result('FAMILY_RESCUE', 75), evidence_fragment_ids: [1, 2] })
    .mockResolvedValueOnce(result('CONTINUE_LISTENING'))
    .mockResolvedValueOnce({ ...result('SPOKEN_WARNING', 50), evidence_fragment_ids: [3] })
  guardian.start('en-IN')
  finalize('You are under arrest.')
  await vi.advanceTimersByTimeAsync(350)
  expect(guardian.state.risk).toBe('WARNING')
  finalize('Transfer your money to the safe account.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state.risk).toBe('CRITICAL')
  expect(play).toHaveBeenCalledTimes(2)
  guardian.dismissRescue()
  await vi.advanceTimersByTimeAsync(windowMs)
  expect(guardian.state.risk).toBe('LISTENING')
  finalize('Transfer your money to the safe account. If you disconnect, you will be arrested.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state.risk).toBe('WARNING')
  expect(play).toHaveBeenCalledTimes(3)
})

test('manual help works without monitoring and exposes a saved name and caption', async () => {
  const { guardian, loadVoice, rescue, streams } = setup()
  const voice = { displayName: 'అబ్బాయి', message: 'అమ్మా, భయపడకు.', audio: new Blob(['voice']) }
  loadVoice.mockResolvedValue(voice)
  guardian.requestRescue()
  guardian.requestRescue()
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ recognition: 'IDLE', rescue: { displayName: voice.displayName, message: voice.message } })
  expect(rescue).toHaveBeenCalledExactlyOnceWith(voice, expect.any(AbortSignal), expect.any(Function), true)
  guardian.repeatRescue()
  await vi.advanceTimersByTimeAsync(0)
  expect(rescue.mock.calls[1][3]).toBe(false)
  guardian.dismissRescue()
  expect(guardian.state.rescue).toBeNull()
  expect(streams).toHaveLength(0)
})

test('critical rescue opens once per episode and a benign result never opens rescue', async () => {
  const { guardian, analyze, finalize, rescue } = setup()
  const critical = { ...result('FAMILY_RESCUE', 86), evidence_fragment_ids: [2] }
  analyze.mockResolvedValueOnce(result('CONTINUE_LISTENING')).mockResolvedValue(critical)
  guardian.start('en-IN')
  finalize('My daughter is calling me.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state.rescue).toBeNull()
  expect(rescue).not.toHaveBeenCalled()
  finalize('My daughter is calling me. Transfer money to the safe account or you will be arrested.')
  await vi.advanceTimersByTimeAsync(350)
  expect(rescue).toHaveBeenCalledOnce()
  expect(rescue.mock.calls[0][0]).toBeNull()
  expect(guardian.state.rescue).toMatchObject({ displayName: null, loading: false })
  guardian.dismissRescue()
  finalize('Do not hang up.')
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state.rescue).toBeNull()
  expect(rescue).toHaveBeenCalledOnce()
})

test('manual rescue takes over a warning and dismissal resumes without audio overlap', async () => {
  const { guardian, analyze, finalize, rescue, play, streams } = setup()
  analyze.mockResolvedValue({ ...result('SPOKEN_WARNING', 50), evidence_fragment_ids: [1] })
  play.mockImplementation(() => new Promise(() => {}))
  guardian.start('en-IN')
  finalize('You are under arrest.')
  await vi.advanceTimersByTimeAsync(0)
  const warningSignal = play.mock.calls[0][0]
  expect(guardian.state.warningPlaying).toBe(true)
  guardian.requestRescue()
  expect(warningSignal.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(guardian.state).toMatchObject({ recognition: 'PAUSED', warningPlaying: false, rescue: { playing: true } })
  guardian.repeatRescue()
  expect(rescue).toHaveBeenCalledOnce()
  guardian.dismissRescue()
  expect(rescue.mock.calls[0][1].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(350)
  expect(guardian.state).toMatchObject({ recognition: 'STARTING', rescue: null })
  expect(streams).toHaveLength(2)
})
