import type { TranscriptFragment } from '../speech/analysisApi'

export const windowMs = 45_000
const maxTurns = 8
const maxCharacters = 1_600

type Turn = TranscriptFragment & { key: string; stream: number }

function keyFor(text: string) {
  return text.normalize('NFKC').toLowerCase().trim().replace(/[.!?।॥]+$/u, '').replace(/\s+/gu, ' ')
}

export class TranscriptWindow {
  private turns: Turn[] = []
  private stream = 0
  private finalizedLength = 0
  private finalizedTail = ''
  private segmentCount = 0
  private nextId = 1

  startStream() {
    this.stream += 1
    this.finalizedLength = 0
    this.finalizedTail = ''
    this.segmentCount = 0
  }

  append(snapshot: string, now: number, segments?: readonly string[]): TranscriptFragment[] | undefined {
    if (segments) {
      // Web Speech finalized segments are cumulative and immutable within a stream.
      const fresh = segments.slice(this.segmentCount)
      this.segmentCount = segments.length
      return this.add(fresh, now)
    }
    const cumulative = snapshot.trim()
    const previousLength = this.finalizedLength
    const previousTail = this.finalizedTail
    const samePrefix = cumulative.slice(previousLength - previousTail.length, previousLength) === previousTail
    if (!cumulative || (samePrefix && cumulative.length === previousLength)) return
    this.finalizedLength = cumulative.length
    this.finalizedTail = cumulative.slice(-80)

    const isExtension = !previousLength || (samePrefix && cumulative[previousLength] === ' ')
    if (!isExtension) this.turns = this.turns.filter((turn) => turn.stream !== this.stream)
    return this.add([isExtension ? cumulative.slice(previousLength).trim() : cumulative], now)
  }

  private add(parts: readonly string[], now: number): TranscriptFragment[] | undefined {
    let changed = this.prune(now)
    for (const part of parts) {
      const text = part.slice(-maxCharacters)
      const key = keyFor(text)
      if (!key || this.turns.some((turn) => turn.key === key)) continue
      this.turns.push({ id: this.nextId++, text, key, finalized_at_ms: now, stream: this.stream })
      changed = true
    }
    if (!changed) return
    this.turns = this.turns.slice(-maxTurns)
    while (this.turns.reduce((length, turn) => length + turn.text.length, 0) > maxCharacters) this.turns.shift()
    return this.snapshot()
  }

  prune(now: number) {
    const count = this.turns.length
    this.turns = this.turns.filter((turn) => now - turn.finalized_at_ms < windowMs)
    return this.turns.length !== count
  }

  snapshot(): TranscriptFragment[] {
    return this.turns.map(({ id, text, finalized_at_ms }) => ({ id, text, finalized_at_ms }))
  }

  nextExpiry() {
    return this.turns.length ? this.turns[0].finalized_at_ms + windowMs : undefined
  }

  latestId() {
    return this.nextId - 1
  }
}
