import type { AnalysisResult } from '../speech/analysisApi'

export type RiskState = 'LISTENING' | 'CAUTION' | 'WARNING' | 'CRITICAL'

const actions: Record<AnalysisResult['recommended_action'], RiskState> = {
  CONTINUE_LISTENING: 'LISTENING',
  SHOW_CAUTION: 'CAUTION',
  SPOKEN_WARNING: 'WARNING',
  FAMILY_RESCUE: 'CRITICAL',
}

const order: RiskState[] = ['LISTENING', 'CAUTION', 'WARNING', 'CRITICAL']
export const recoveryMs = 8_000
export const warningCooldownMs = 45_000

export function isHighRisk(state: RiskState) {
  return state === 'WARNING' || state === 'CRITICAL'
}

export class RiskMonitor {
  state: RiskState = 'LISTENING'
  private recoveringSince: number | undefined
  private warningPlayedAt = -Infinity
  private episode = new Set<number>()

  assess(action: AnalysisResult['recommended_action'], now: number,
    evidence?: readonly number[], fresh = true): boolean {
    const next = actions[action]
    const previous = this.state

    if (order.indexOf(next) < order.indexOf(previous)) {
      if (this.recoveringSince === undefined) this.recoveringSince = now
      if (now - this.recoveringSince < recoveryMs) return false
    }

    this.recoveringSince = undefined
    this.state = next
    if (!isHighRisk(next)) {
      this.episode.clear()
      return false
    }
    const continuing = evidence
      ? evidence.some((id) => this.episode.has(id))
      : isHighRisk(previous)
    if (evidence) this.episode = new Set(evidence)
    return fresh && !continuing && now - this.warningPlayedAt >= warningCooldownMs
  }

  invalidate() {
    this.state = 'LISTENING'
    this.recoveringSince = undefined
    this.episode.clear()
  }

  warningStarted(now: number) {
    this.warningPlayedAt = now
  }
}
