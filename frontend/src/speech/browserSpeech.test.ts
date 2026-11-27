import { afterEach, expect, test, vi } from 'vitest'
import { browserSpeechProvider } from './browserSpeech'
import type { SpeechEvent } from './provider'

class Recognition {
  static instance: Recognition
  lang = ''
  continuous = false
  interimResults = false
  onstart: (() => void) | null = null
  onaudiostart: (() => void) | null = null
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onnomatch: (() => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  constructor() {
    Recognition.instance = this
  }
}

function setup() {
  const receive = vi.fn<(event: SpeechEvent) => void>()
  const provider = browserSpeechProvider({ isSecureContext: true, webkitSpeechRecognition: Recognition })
  const session = provider.createSession('te-IN', receive)
  return { receive, session, recognition: Recognition.instance }
}

afterEach(() => vi.useRealTimers())

test('guards unsupported and insecure browsers and accepts the unprefixed API', () => {
  expect(browserSpeechProvider({ isSecureContext: true }).unavailableReason).toMatch(/does not expose/)
  expect(browserSpeechProvider({ isSecureContext: false, SpeechRecognition: Recognition }).unavailableReason)
    .toMatch(/HTTPS or localhost/)
  const provider = browserSpeechProvider({ isSecureContext: true, SpeechRecognition: Recognition })
  provider.createSession('en-IN', vi.fn())
  expect(Recognition.instance.lang).toBe('en-IN')
  provider.createSession('hi-IN', vi.fn())
  expect(Recognition.instance.lang).toBe('hi-IN')
})

test('reports interim and cumulative final results without duplicating earlier phrases', () => {
  const { receive, session, recognition } = setup()
  expect(recognition.lang).toBe('te-IN')
  expect(recognition.interimResults).toBe(true)
  expect(recognition.continuous).toBe(true)
  expect(recognition.start).not.toHaveBeenCalled()
  session.start()
  recognition.onstart?.()
  recognition.onaudiostart?.()
  expect(receive.mock.calls.map(([event]) => event.type)).toEqual(['listening', 'microphone-active'])
  const first = { isFinal: true, 0: { transcript: ' నమస్తే ' } }
  recognition.onresult?.({ results: [first, { isFinal: false, 0: { transcript: ' please' } }] })
  expect(receive).toHaveBeenLastCalledWith({
    type: 'transcript', interim: 'please', final: 'నమస్తే', finalSegments: [first[0].transcript],
  })
  session.stop()
  expect(recognition.stop).toHaveBeenCalledOnce()
  recognition.onresult?.({ results: [first, { isFinal: true, 0: { transcript: 'please wait' } }] })
  expect(receive).toHaveBeenLastCalledWith({
    type: 'transcript', interim: '', final: 'నమస్తే please wait', finalSegments: [first[0].transcript, 'please wait'],
  })
  recognition.onend?.()
  expect(receive).toHaveBeenLastCalledWith({ type: 'ended' })
})

test.each(['not-allowed', 'service-not-allowed', 'network', 'aborted', 'language-not-supported'])(
  'preserves the browser error %s and detaches old callbacks',
  (error) => {
    const { receive, session, recognition } = setup()
    session.start()
    recognition.onerror?.({ error })
    expect(receive).toHaveBeenCalledExactlyOnceWith({ type: 'error', code: error })
    expect(recognition.onend).toBeNull()
    expect(recognition.onresult).toBeNull()
    expect(recognition.abort).toHaveBeenCalledOnce()
  },
)

test('bounds stalled startup, silence, and stalled shutdown', () => {
  vi.useFakeTimers()
  const starting = setup()
  starting.session.start()
  vi.advanceTimersByTime(30_000)
  expect(starting.receive).toHaveBeenLastCalledWith({ type: 'error', code: 'start-timeout' })

  const silent = setup()
  silent.session.start()
  silent.recognition.onstart?.()
  vi.advanceTimersByTime(30_000)
  expect(silent.receive).toHaveBeenLastCalledWith({ type: 'error', code: 'no-speech' })

  const stopping = setup()
  stopping.session.start()
  stopping.session.stop()
  vi.advanceTimersByTime(4_000)
  expect(stopping.receive).toHaveBeenLastCalledWith({ type: 'error', code: 'stop-timeout' })
  expect(stopping.recognition.abort).toHaveBeenCalledOnce()
})

test('aborts without delivering recognition results after cleanup', () => {
  vi.useFakeTimers()
  const { receive, session, recognition } = setup()
  session.start()
  session.abort()
  session.abort()
  vi.runAllTimers()
  expect(recognition.abort).toHaveBeenCalledOnce()
  expect(recognition.onresult).toBeNull()
  expect(receive).not.toHaveBeenCalled()
})
