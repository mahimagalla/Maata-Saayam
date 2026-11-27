import { useEffect, useRef, useState } from 'react'
import type { SpeechEvent, SpeechLanguage, SpeechProvider, SpeechSession } from './provider'

type Status = 'Ready' | 'Starting' | 'Listening' | 'Stopping' | 'Stopped' | 'Ended' | 'Error'

export function useSpeechSession(provider: SpeechProvider, language: SpeechLanguage) {
  const [status, setStatus] = useState<Status>('Ready')
  const [interim, setInterim] = useState('')
  const [final, setFinal] = useState('')
  const [error, setError] = useState('')
  const [microphoneActive, setMicrophoneActive] = useState(false)
  const current = useRef<SpeechSession | null>(null)
  const hasFinal = useRef(false)
  const stopRequested = useRef(false)

  function clear() {
    setInterim('')
    setFinal('')
    setError('')
    hasFinal.current = false
  }

  useEffect(() => {
    function release() {
      const session = current.current
      current.current = null
      session?.abort()
    }
    function leavePage() {
      release()
      setStatus('Ready')
      setMicrophoneActive(false)
      clear()
    }

    window.addEventListener('pagehide', leavePage)
    return () => {
      window.removeEventListener('pagehide', leavePage)
      release()
    }
  }, [])

  function start() {
    if (current.current || provider.unavailableReason) return
    clear()
    setStatus('Starting')
    stopRequested.current = false

    function receive(event: SpeechEvent) {
      if (current.current !== session) return

      switch (event.type) {
        case 'listening':
          setStatus('Listening')
          break
        case 'microphone-active':
          setMicrophoneActive(true)
          break
        case 'transcript':
          hasFinal.current = Boolean(event.final)
          setFinal(event.final)
          setInterim(event.interim)
          break
        case 'error':
        case 'ended':
          current.current = null
          setMicrophoneActive(false)
          setInterim('')
          if (event.type === 'error') {
            setStatus('Error')
            setError(event.code)
          } else {
            setStatus(stopRequested.current ? 'Stopped' : 'Ended')
            if (!hasFinal.current) setError('no-final-result')
          }
          break
      }
    }

    let session: SpeechSession | undefined
    try {
      session = provider.createSession(language, receive)
      current.current = session
      session.start()
    } catch {
      current.current = null
      session?.abort()
      setStatus('Error')
      setError('start-failed')
    }
  }

  function stop() {
    if (!current.current || stopRequested.current) return
    stopRequested.current = true
    setStatus('Stopping')
    current.current.stop()
  }

  return { status, interim, final, error, microphoneActive, start, stop, clear }
}
