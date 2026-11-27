import { afterEach, expect, test, vi } from 'vitest'
import { playFamilyRescue } from './rescueAudio'

class AudioElement {
  static created: AudioElement[] = []
  onended?: () => void
  onerror?: () => void
  canPlayType = vi.fn((type: string) => type === 'audio/webm' ? 'probably' : '')
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  constructor(readonly url: string) { AudioElement.created.push(this) }
}

function setup() {
  AudioElement.created = []
  vi.stubGlobal('Audio', AudioElement)
}

const voice = { displayName: 'అబ్బాయి', message: 'అమ్మా, భయపడకు.', audio: new Blob(['voice'], { type: 'audio/webm' }) }

afterEach(() => vi.unstubAllGlobals())

test('rings first, then plays a saved voice without overlapping', async () => {
  setup()
  const fallback = vi.fn()
  const done = playFamilyRescue(voice, new AbortController().signal, fallback, true)
  expect(AudioElement.created.map(({ url }) => url)).toEqual(['/audio/family-rescue-ring.wav'])
  AudioElement.created[0].onended?.()
  await vi.waitFor(() => expect(AudioElement.created).toHaveLength(2))
  expect(AudioElement.created[1].url).toMatch(/^blob:/)
  AudioElement.created[1].onended?.()
  await done
  expect(fallback).not.toHaveBeenCalled()
})

test('plays a safe fallback for missing, unplayable, or damaged recordings', async () => {
  setup()
  const fallback = vi.fn()
  const signal = new AbortController().signal
  const missing = playFamilyRescue(null, signal, fallback, false)
  expect(AudioElement.created.at(-1)?.url).toContain('family-rescue-fallback.wav')
  AudioElement.created.at(-1)?.onended?.()
  await missing

  const unsupported = playFamilyRescue({ ...voice, audio: new Blob(['voice'], { type: 'audio/unsupported' }) }, signal, fallback, false)
  await vi.waitFor(() => expect(AudioElement.created).toHaveLength(3))
  expect(AudioElement.created.at(-1)?.url).toContain('family-rescue-fallback.wav')
  AudioElement.created.at(-1)?.onended?.()
  await unsupported

  const damaged = playFamilyRescue(voice, signal, fallback, false)
  AudioElement.created.at(-1)?.onerror?.()
  await vi.waitFor(() => expect(AudioElement.created).toHaveLength(5))
  expect(AudioElement.created.at(-1)?.url).toContain('family-rescue-fallback.wav')
  AudioElement.created.at(-1)?.onended?.()
  await damaged
  expect(fallback).toHaveBeenCalledTimes(2)
})

test('dismissing during the ringtone suppresses the voice', async () => {
  setup()
  const controller = new AbortController()
  const done = playFamilyRescue(voice, controller.signal, vi.fn(), true)
  controller.abort()
  await done
  expect(AudioElement.created).toHaveLength(1)
  expect(AudioElement.created[0].pause).toHaveBeenCalledOnce()
})
