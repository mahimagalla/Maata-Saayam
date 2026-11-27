export const languages = {
  'te-IN': 'Telugu',
  'hi-IN': 'Hindi',
  'en-IN': 'English (India)',
} as const

export type SpeechLanguage = keyof typeof languages

export type SpeechEvent =
  | { type: 'listening' | 'microphone-active' | 'ended' }
  | { type: 'transcript'; interim: string; final: string; finalSegments?: readonly string[] }
  | { type: 'error'; code: string }

export interface SpeechSession {
  start(): void
  stop(): void
  abort(): void
}

export interface SpeechProvider {
  name: string
  unavailableReason?: string
  createSession(language: SpeechLanguage, onEvent: (event: SpeechEvent) => void): SpeechSession
}
