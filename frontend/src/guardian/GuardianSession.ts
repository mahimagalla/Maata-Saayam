import { requestAnalysis, type AnalysisResult, type TranscriptFragment } from '../speech/analysisApi'
import { alertId, type AlertNotice, type AlertState, type Threat } from '../alerts/familyLink'
import { readFamilyVoice, type FamilyVoice } from '../family/familyVoiceStore'
import { fallbackMessage, playFamilyRescue } from '../family/rescueAudio'
import type { SpeechEvent, SpeechLanguage, SpeechProvider, SpeechSession } from '../speech/provider'
import { isHighRisk, RiskMonitor, warningCooldownMs, type RiskState } from './riskState'
import { TranscriptWindow } from './transcriptWindow'
import { playTeluguWarning } from './warningAudio'

type RecognitionState = 'IDLE' | 'STARTING' | 'LISTENING' | 'PAUSED' | 'STOPPED' | 'ENDED' | 'ERROR'
type AnalysisState = 'IDLE' | 'PENDING' | 'READY' | 'UNAVAILABLE'

export type RescueState = {
  displayName: string | null
  message: string
  loading: boolean
  playing: boolean
  failed: boolean
}

export type GuardianState = {
  recognition: RecognitionState
  microphoneActive: boolean
  recognitionError: string
  analysis: AnalysisState
  risk: RiskState
  result: AnalysisResult | null
  transcript: string
  interim: string
  warningPlaying: boolean
  warningFailed: boolean
  rescue: RescueState | null
}

export const initialGuardianState: GuardianState = {
  recognition: 'IDLE', microphoneActive: false, recognitionError: '',
  analysis: 'IDLE', risk: 'LISTENING', result: null, transcript: '', interim: '',
  warningPlaying: false, warningFailed: false, rescue: null,
}

export function isMonitoring(status: RecognitionState) {
  return status === 'STARTING' || status === 'LISTENING' || status === 'PAUSED'
}

export class GuardianSession {
  state = initialGuardianState
  private language: SpeechLanguage = 'te-IN'
  private recognition?: SpeechSession
  private window = new TranscriptWindow()
  private risk = new RiskMonitor()
  private evaluatedThrough = 0
  private expiryTimer?: ReturnType<typeof setTimeout>
  private request?: { controller: AbortController; timeout: ReturnType<typeof setTimeout> }
  private playback?: AbortController
  private resumeTimer?: ReturnType<typeof setTimeout>
  private familyVoice: FamilyVoice | null = null
  private criticalEvidence = new Set<number>()
  private lastRescueAt = -Infinity
  private notice?: { id: string; evidence: number[]; state: AlertState }

  constructor(
    private provider: SpeechProvider,
    private onChange: (state: GuardianState) => void,
    private analyze = requestAnalysis,
    private playWarning = playTeluguWarning,
    private loadVoice = readFamilyVoice,
    private playRescue = playFamilyRescue,
    private notifyFamily: (notice: AlertNotice) => void = () => {},
  ) {}

  start(language: SpeechLanguage) {
    if (isMonitoring(this.state.recognition) || this.provider.unavailableReason || this.state.rescue) return
    this.language = language
    this.openMicrophone()
  }

  stop() {
    this.finish('STOPPED')
  }

  dispose() {
    this.release()
    this.state = initialGuardianState
  }

  repeatWarning() {
    if (this.state.rescue) return
    if (Date.now() >= (this.window.nextExpiry() ?? Infinity)) {
      this.expire()
      return
    }
    if (isHighRisk(this.state.risk)) void this.announce()
  }

  requestRescue() {
    if (this.state.rescue) return
    const result = this.state.result
    if (this.state.risk === 'CRITICAL' && result?.recommended_action === 'FAMILY_RESCUE' &&
        Date.now() < (this.window.nextExpiry() ?? 0)) {
      const ids = result.evidence_fragment_ids ?? []
      for (const id of ids) this.criticalEvidence.add(id)
      if (ids.length) this.reportEpisode(ids, result, 'rescue')
    }
    this.openRescue(true)
  }

  repeatRescue() {
    if (!this.state.rescue || this.state.rescue.loading || this.state.rescue.playing) return
    void this.runRescue(false)
  }

  dismissRescue() {
    if (!this.state.rescue) return
    this.cancelPlayback()
    this.familyVoice = null
    this.update({ rescue: null })
    this.resumeAfterPlayback()
  }

  private update(patch: Partial<GuardianState>) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  private openMicrophone() {
    this.window.startStream()
    this.update({ recognition: 'STARTING', recognitionError: '', microphoneActive: false, interim: '' })
    try {
      const session = this.provider.createSession(this.language, (event) => {
        if (this.recognition === session) this.receive(event)
      })
      this.recognition = session
      session.start()
    } catch {
      this.finish('ERROR', 'start-failed')
    }
  }

  private receive(event: SpeechEvent) {
    switch (event.type) {
      case 'listening':
        this.update({ recognition: 'LISTENING' })
        break
      case 'microphone-active':
        this.update({ microphoneActive: true })
        break
      case 'transcript': {
        const latest = this.window.latestId()
        const next = this.window.append(event.final, Date.now(), event.finalSegments)
        this.update({ interim: event.interim })
        if (next) this.refresh(next, next.some((fragment) => fragment.id > latest))
        break
      }
      case 'error':
        this.finish('ERROR', event.code)
        break
      case 'ended':
        this.finish('ENDED')
        break
    }
  }

  private refresh(fragments: TranscriptFragment[], allowWarning: boolean) {
    clearTimeout(this.expiryTimer)
    const expiry = this.window.nextExpiry()
    if (expiry !== undefined) {
      this.expiryTimer = setTimeout(() => this.expire(), Math.max(0, expiry - Date.now()))
    }
    const liveIds = new Set(fragments.map((fragment) => fragment.id))
    const previousEvidence = this.state.result?.evidence_fragment_ids ?? []
    if (previousEvidence.some((id) => !liveIds.has(id)) || !fragments.length) {
      this.risk.invalidate()
      this.update({ risk: this.risk.state, result: null })
    }
    this.update({ transcript: fragments.map((fragment) => fragment.text).join('\n') })
    if (fragments.length) this.submit(fragments, allowWarning)
    else {
      this.cancelRequest()
      if (this.state.analysis !== 'UNAVAILABLE') this.update({ analysis: 'IDLE' })
    }
  }

  private expire() {
    this.window.prune(Date.now())
    this.refresh(this.window.snapshot(), false)
  }

  private submit(fragments: TranscriptFragment[], allowWarning: boolean) {
    this.cancelRequest()
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      if (this.request?.controller !== controller) return
      this.cancelRequest()
      this.update({ analysis: 'UNAVAILABLE' })
    }, 8_000)
    this.request = { controller, timeout }
    if (this.state.analysis !== 'UNAVAILABLE') this.update({ analysis: 'PENDING' })
    void this.analyze(fragments, this.language, controller.signal).then((result) => {
      if (this.request?.controller !== controller) return
      const now = Date.now()
      if (now >= (this.window.nextExpiry() ?? Infinity)) {
        this.expire()
        return
      }
      const ids = result.evidence_fragment_ids ?? []
      const fresh = allowWarning && ids.some((id) => id > this.evaluatedThrough)
      this.evaluatedThrough = Math.max(this.evaluatedThrough, fragments.at(-1)?.id ?? 0)
      const shouldWarn = this.risk.assess(result.recommended_action, now, ids, fresh)
      this.update({ result, risk: this.risk.state, analysis: 'READY' })
      if (result.recommended_action === 'FAMILY_RESCUE' && this.risk.state === 'CRITICAL') {
        const continuing = ids.some((id) => this.criticalEvidence.has(id))
        if (continuing || fresh) this.criticalEvidence = new Set(ids)
        const opensRescue = fresh && !continuing && !this.state.rescue
        if (opensRescue) {
          const play = now - this.lastRescueAt >= warningCooldownMs
          if (play) this.lastRescueAt = now
          this.openRescue(play)
        }
        if (fresh) this.reportEpisode(ids, result, opensRescue || (continuing && this.state.rescue) ? 'rescue' : 'critical')
      } else if (shouldWarn && !this.state.rescue) {
        this.reportEpisode(ids, result, 'warning')
        void this.announce()
      }
    }).catch(() => {
      if (this.request?.controller === controller) this.update({ analysis: 'UNAVAILABLE' })
    }).finally(() => {
      clearTimeout(timeout)
      if (this.request?.controller === controller) this.request = undefined
    })
  }

  private reportEpisode(ids: number[], result: AnalysisResult, state: AlertState) {
    try {
      const prior = this.notice
      const continuing = prior && ids.some((id) => prior.evidence.includes(id))
      const evidence = continuing ? [...new Set([...prior.evidence, ...ids])] : ids
      if (continuing && (prior.state === state || prior.state === 'rescue' ||
          (prior.state === 'critical' && state === 'warning'))) {
        prior.evidence = evidence
        return
      }
      const id = continuing ? prior.id : alertId()
      this.notice = { id, state, evidence }
      const categories = result.detected_signals.map((signal) => signal.category)
      const preferred: Threat[] = ['legal_threat', 'financial_manipulation', 'credential_theft', 'coercion',
        'parcel_scam', 'authority_impersonation', 'secrecy_isolation', 'urgency']
      this.notifyFamily({ id, state, category: preferred.find((category) => categories.includes(category)) ?? 'other' })
    } catch { /* Remote notification must not interrupt local protection. */ }
  }

  private async announce() {
    if (this.playback || !isMonitoring(this.state.recognition)) return
    const controller = this.beginPlayback()
    this.update({ warningPlaying: true, warningFailed: false })
    try {
      await this.playWarning(controller.signal)
    } catch {
      if (this.playback === controller) this.update({ warningFailed: true })
    } finally {
      if (this.playback === controller) {
        this.update({ warningPlaying: false })
        this.completePlayback()
      }
    }
  }

  private openRescue(play: boolean) {
    const opened = { displayName: null, message: fallbackMessage, loading: true, playing: false, failed: false }
    this.update({ rescue: opened })
    if (play) void this.runRescue(true)
    else {
      void this.getVoice().then((voice) => {
        if (this.state.rescue !== opened) return
        this.familyVoice = voice
        this.updateRescue({ loading: false, displayName: voice?.displayName ?? null, message: voice?.message ?? fallbackMessage })
      })
    }
  }

  private async getVoice() {
    try { return await this.loadVoice() } catch { return null }
  }

  private async runRescue(first: boolean) {
    const controller = this.beginPlayback()
    this.update({ warningPlaying: false })
    try {
      if (first) {
        const voice = await this.getVoice()
        if (controller.signal.aborted) return
        this.familyVoice = voice
      }
      this.updateRescue({
        loading: false, playing: true, failed: false,
        displayName: this.familyVoice?.displayName ?? null,
        message: this.familyVoice?.message ?? fallbackMessage,
      })
      await this.playRescue(this.familyVoice, controller.signal, () => {
        if (this.playback !== controller) return
        this.familyVoice = null
        this.updateRescue({ displayName: null, message: fallbackMessage })
      }, first)
    } catch {
      if (this.playback === controller) this.updateRescue({ failed: true })
    } finally {
      if (this.playback === controller) {
        this.updateRescue({ loading: false, playing: false })
        this.completePlayback()
      }
    }
  }

  private updateRescue(patch: Partial<RescueState>) {
    if (this.state.rescue) this.update({ rescue: { ...this.state.rescue, ...patch } })
  }

  private beginPlayback() {
    this.cancelPlayback()
    const controller = new AbortController()
    this.playback = controller
    this.risk.warningStarted(Date.now())
    if (isMonitoring(this.state.recognition)) {
      // Resume with a fresh stream so neither the ringtone nor voice is transcribed.
      this.closeMicrophone()
      this.update({ recognition: 'PAUSED', microphoneActive: false, interim: '' })
    }
    return controller
  }

  private cancelPlayback() {
    clearTimeout(this.resumeTimer)
    const playback = this.playback
    this.playback = undefined
    playback?.abort()
  }

  private completePlayback() {
    this.playback = undefined
    this.resumeAfterPlayback()
  }

  private resumeAfterPlayback() {
    if (this.state.recognition === 'PAUSED') {
      this.resumeTimer = setTimeout(() => this.openMicrophone(), 350)
    }
  }

  private cancelRequest() {
    const request = this.request
    this.request = undefined
    if (!request) return
    clearTimeout(request.timeout)
    request.controller.abort()
  }

  private closeMicrophone() {
    const session = this.recognition
    this.recognition = undefined
    session?.abort()
  }

  private release() {
    this.closeMicrophone()
    this.cancelRequest()
    clearTimeout(this.expiryTimer)
    this.cancelPlayback()
    this.familyVoice = null
    this.criticalEvidence.clear()
    this.lastRescueAt = -Infinity
    this.notice = undefined
    this.window = new TranscriptWindow()
    this.risk = new RiskMonitor()
    this.evaluatedThrough = 0
  }

  private finish(recognition: RecognitionState, recognitionError = '') {
    const rescue = recognition === 'STOPPED' ? null : this.state.rescue
    const voice = rescue ? this.familyVoice : null
    this.release()
    this.familyVoice = voice
    this.update({ ...initialGuardianState, recognition, recognitionError, rescue })
  }
}
