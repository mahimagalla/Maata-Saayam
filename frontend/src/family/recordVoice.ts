export const recordingLimitSeconds = 30

const preferredFormats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export async function recordVoice(signal: AbortSignal, ready: (stop: () => void) => void): Promise<Blob> {
  if (!recordingSupported()) throw new DOMException('Audio recording unavailable', 'NotSupportedError')
  signal.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  try {
    signal.throwIfAborted()
    const mimeType = preferredFormats.find((format) => MediaRecorder.isTypeSupported?.(format))
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = []
      let timeout: ReturnType<typeof setTimeout> | undefined
      let stopping = false
      function finish(error?: unknown) {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null
        if (error) reject(error)
        else {
          const audio = new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType })
          if (audio.size) resolve(audio)
          else reject(new Error('No audio recorded'))
        }
      }

      function stop() {
        if (stopping || recorder.state === 'inactive') return
        stopping = true
        clearTimeout(timeout)
        timeout = setTimeout(() => finish(new Error('Recording did not finish')), 4_000)
        try { recorder.stop() } catch (error) { finish(error) }
      }

      function abort() {
        finish(signal.reason)
        if (recorder.state !== 'inactive') {
          try { recorder.stop() } catch { /* Releasing the stream below also ends capture. */ }
        }
      }

      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => finish()
      recorder.onerror = () => finish(new Error('Audio recording failed'))
      signal.addEventListener('abort', abort, { once: true })
      try {
        recorder.start()
        timeout = setTimeout(stop, recordingLimitSeconds * 1000)
        ready(stop)
      } catch (error) {
        finish(error)
      }
    })
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}
