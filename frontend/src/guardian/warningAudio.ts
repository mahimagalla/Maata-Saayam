export const warningText = 'భయపడకండి. ఇది మోసపూరిత కాల్ కావచ్చు. నిజమైన పోలీసులు ఫోన్‌లో డబ్బు అడగరు. దయచేసి ఫోన్ పెట్టేయండి.'
export const warningAudioUrl = '/audio/telugu-safety-warning.wav'

export async function playTeluguWarning(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const synthesis = window.speechSynthesis
  const voice = synthesis?.getVoices().find((candidate) => /^te(?:[-_]|$)/i.test(candidate.lang))
  if (voice && typeof SpeechSynthesisUtterance !== 'undefined') {
    // Keep the utterance referenced until a terminal event. A broken voice can fall back to the asset.
    const utterance = new SpeechSynthesisUtterance(warningText)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = 0.9
    try {
      const spoken = await waitForPlayback(signal, (done) => {
        utterance.onend = () => done()
        utterance.onerror = () => done(new Error('Telugu voice unavailable'))
        synthesis.speak(utterance)
      }, () => {
        utterance.onend = utterance.onerror = null
        synthesis.cancel()
      })
      if (spoken || signal.aborted) return
    } catch {
      if (signal.aborted) return
    }
  }

  await playAudio(warningAudioUrl, signal)
}

export async function playAudio(url: string, signal: AbortSignal, mimeType = ''): Promise<void> {
  if (signal.aborted) return
  const audio = new Audio(url)
  if (mimeType && !audio.canPlayType(mimeType)) {
    throw new DOMException('Audio format unavailable', 'NotSupportedError')
  }
  try {
    await waitForPlayback(signal, (done) => {
      audio.onended = () => done()
      audio.onerror = () => done(new Error('Audio could not be loaded'))
      void audio.play().catch(done)
    }, () => {
      audio.pause()
    }, 40_000)
  } finally {
    audio.onended = audio.onerror = null
  }
}

function waitForPlayback(
  signal: AbortSignal,
  start: (done: (error?: unknown) => void) => void,
  cancel: () => void,
  timeoutMs = 20_000,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve(false)
    const timeout = setTimeout(() => {
      cleanup()
      cancel()
      reject(new Error('Warning playback timed out'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }

    function abort() {
      cleanup()
      cancel()
      resolve(false)
    }

    signal.addEventListener('abort', abort, { once: true })
    try {
      start((error) => {
        cleanup()
        if (error) {
          cancel()
          reject(error)
        } else resolve(true)
      })
    } catch (error) {
      cleanup()
      cancel()
      reject(error)
    }
  })
}
