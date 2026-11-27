import type { SpeechProvider } from './provider'

interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

interface BrowserRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onnomatch: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => BrowserRecognition
type SpeechBrowser = Pick<Window, 'isSecureContext'> & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

const responseTimeout = 30_000
const stopTimeout = 4_000

export function browserSpeechProvider(browser: SpeechBrowser | undefined): SpeechProvider {
  const Recognition = browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition
  const unavailableReason = !Recognition
    ? 'This browser does not expose speech recognition.'
    : !browser?.isSecureContext
      ? 'Microphone recognition requires HTTPS or localhost.'
      : undefined

  return {
    name: 'Browser Web Speech API',
    unavailableReason,
    createSession(language, onEvent) {
      if (!Recognition || unavailableReason) throw new Error(unavailableReason)
      const recognition = new Recognition()
      recognition.lang = language
      recognition.continuous = true
      recognition.interimResults = true

      let closed = false
      let listening = false
      let stopping = false
      let watchdog: ReturnType<typeof setTimeout> | undefined

      function close() {
        closed = true
        clearTimeout(watchdog)
        recognition.onstart = recognition.onaudiostart = recognition.onend = null
        recognition.onresult = recognition.onerror = recognition.onnomatch = null
      }

      function abort() {
        if (closed) return
        close()
        try {
          recognition.abort()
        } catch {
          // Some engines close the microphone before dispatching the terminal event.
        }
      }

      function fail(code: string) {
        abort()
        onEvent({ type: 'error', code })
      }

      function waitForResponse() {
        if (closed || stopping) return
        clearTimeout(watchdog)
        watchdog = setTimeout(() => fail(listening ? 'no-speech' : 'start-timeout'), responseTimeout)
      }

      recognition.onstart = () => {
        listening = true
        waitForResponse()
        if (!stopping) onEvent({ type: 'listening' })
      }
      recognition.onaudiostart = () => onEvent({ type: 'microphone-active' })
      recognition.onresult = ({ results }) => {
        const final: string[] = []
        const interim: string[] = []
        for (const result of Array.from(results)) {
          const parts = result.isFinal ? final : interim
          parts.push(result[0].transcript)
        }
        waitForResponse()
        onEvent({
          type: 'transcript',
          final: final.map((part) => part.trim()).join(' ').trim(),
          interim: interim.map((part) => part.trim()).join(' ').trim(),
          finalSegments: final,
        })
      }
      recognition.onerror = ({ error }) => fail(error)
      recognition.onnomatch = () => fail('no-match')
      recognition.onend = () => {
        close()
        onEvent({ type: 'ended' })
      }

      return {
        start() {
          waitForResponse()
          try {
            recognition.start()
          } catch (error) {
            const denied = error instanceof DOMException &&
              ['NotAllowedError', 'SecurityError'].includes(error.name)
            fail(denied ? 'not-allowed' : 'start-failed')
          }
        },
        stop() {
          if (closed || stopping) return
          stopping = true
          clearTimeout(watchdog)
          watchdog = setTimeout(() => fail('stop-timeout'), stopTimeout)
          try {
            recognition.stop()
          } catch {
            fail('stop-failed')
          }
        },
        abort,
      }
    },
  }
}
