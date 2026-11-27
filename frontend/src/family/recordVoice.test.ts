import { afterEach, expect, test, vi } from 'vitest'
import { recordVoice } from './recordVoice'

class Recorder {
  static isTypeSupported = (mime: string) => mime === 'audio/mp4'
  state = 'inactive'
  mimeType: string
  onstop?: () => void
  ondataavailable?: (event: { data: Blob }) => void
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { this.mimeType = options?.mimeType ?? '' }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['family voice'], { type: this.mimeType }) })
      this.onstop?.()
    })
  }
}

function setup() {
  const stopTrack = vi.fn()
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', Recorder)
  return { stopTrack, getUserMedia }
}

afterEach(() => vi.unstubAllGlobals())

test('selects a supported codec, captures the stop event, and releases each take', async () => {
  const { stopTrack, getUserMedia } = setup()
  for (let take = 0; take < 2; take++) {
    const audio = await recordVoice(new AbortController().signal, (stop) => stop())
    expect(audio.type).toBe('audio/mp4')
    expect(await audio.text()).toBe('family voice')
  }
  expect(getUserMedia).toHaveBeenCalledTimes(2)
  expect(stopTrack).toHaveBeenCalledTimes(2)
})

test('handles denial, unavailable recording, and an unsupported recorder format', async () => {
  const { stopTrack, getUserMedia } = setup()
  getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
  const record = () => recordVoice(new AbortController().signal, vi.fn())
  await expect(record()).rejects.toMatchObject({ name: 'NotAllowedError' })
  vi.stubGlobal('MediaRecorder', undefined)
  await expect(record()).rejects.toMatchObject({ name: 'NotSupportedError' })
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported = () => false
    constructor() { throw new DOMException('Unsupported format', 'NotSupportedError') }
  })
  await expect(record()).rejects.toMatchObject({ name: 'NotSupportedError' })
  expect(stopTrack).toHaveBeenCalledOnce()
})

test('aborting a take stops the microphone without producing a draft', async () => {
  const { stopTrack } = setup()
  const controller = new AbortController()
  await expect(recordVoice(controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' })
  expect(stopTrack).toHaveBeenCalledOnce()
})
