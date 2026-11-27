import { afterEach, expect, test, vi } from 'vitest'
import { playTeluguWarning, warningAudioUrl, warningText } from './warningAudio'

class PrerecordedAudio {
  static instance: PrerecordedAudio
  onended?: () => void
  onerror?: () => void
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  constructor(readonly url: string) { PrerecordedAudio.instance = this }
}

class Utterance {
  static instance: Utterance
  onend?: () => void
  onerror?: () => void
  constructor(readonly text: string) { Utterance.instance = this }
}

function setup(voices: { lang: string }[]) {
  const synthesis = { getVoices: () => voices, speak: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('window', { speechSynthesis: synthesis })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('Audio', PrerecordedAudio)
  return synthesis
}

afterEach(() => vi.unstubAllGlobals())

test('prefers browser Telugu speech synthesis', async () => {
  const synthesis = setup([{ lang: 'en-IN' }, { lang: 'te-IN' }])
  const done = playTeluguWarning(new AbortController().signal)
  expect(Utterance.instance.text).toBe(warningText)
  expect(synthesis.speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lang: 'te-IN' }))
  Utterance.instance.onend?.()
  await done
})

test('uses the bundled file for browsers with no Telugu voice and cancels on stop', async () => {
  const synthesis = setup([{ lang: 'en-IN' }])
  const controller = new AbortController()
  const done = playTeluguWarning(controller.signal)
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect(PrerecordedAudio.instance.url).toBe(warningAudioUrl)
  expect(PrerecordedAudio.instance.play).toHaveBeenCalledOnce()
  controller.abort()
  await done
  expect(PrerecordedAudio.instance.pause).toHaveBeenCalledOnce()
})

test('a Telugu synthesis error falls back to bundled playback', async () => {
  setup([{ lang: 'te' }])
  const done = playTeluguWarning(new AbortController().signal)
  Utterance.instance.onerror?.()
  await Promise.resolve()
  expect(PrerecordedAudio.instance.play).toHaveBeenCalledOnce()
  PrerecordedAudio.instance.onended?.()
  await done
})
