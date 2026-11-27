import { useEffect, useState } from 'react'
import { languages, type SpeechLanguage, type SpeechProvider } from './provider'
import { useMicrophonePermission } from './useMicrophonePermission'
import { useSpeechSession } from './useSpeechSession'
import { TranscriptAnalysis } from './TranscriptAnalysis'

const buttonStyle = 'rounded border border-teal-800 px-4 py-2 text-teal-900 disabled:opacity-50'
const primaryButton = 'rounded bg-teal-800 px-4 py-2 text-white disabled:opacity-50'

const errors: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Check the site and device microphone settings.',
  'service-not-allowed': 'The browser blocked the recognition service. Try a different browser or check its settings.',
  'audio-capture': 'The microphone could not be opened. Check that it is connected and available.',
  'no-speech': 'No speech was detected or no results arrived. Start again and speak clearly.',
  'no-match': 'The browser could not recognize the speech. Try a shorter phrase.',
  'no-final-result': 'The session ended before returning a final transcript. Start again and speak a short phrase.',
  'aborted': 'The browser interrupted recognition. Start again when ready.',
  'network': 'The browser could not reach its speech service. Check your connection and try again.',
  'language-not-supported': 'The browser speech service does not support this language.',
  'language-unavailable': 'The selected language is unavailable in this browser speech service.',
  'start-timeout': 'Recognition did not start in time. Check the permission prompt or try again.',
  'start-failed': 'Recognition could not start. Check browser support and microphone permissions.',
  'stop-timeout': 'The browser did not finish stopping in time. Any final text received is shown below.',
  'stop-failed': 'The browser could not stop normally. The recognition session was closed.',
}

const samples = {
  telugu: 'A: నమస్తే, మీరు రేపు వస్తారా?\nB: Yes, I will come after lunch.\nA: సరే, please call me when you arrive.',
  hindi: 'A: नमस्ते, आप कल कितने बजे आएँगे?\nB: I will be there at ten.\nA: ठीक है, please bring the notebook.',
  scam: 'Caller: నేను పోలీస్ అధికారిని. మీపై digital arrest ఉంది. వెంటనే డబ్బులు safe account కి పంపండి. ఎవరికీ చెప్పకండి.\nRecipient: నేను నా కుటుంబానికి ఫోన్ చేయవచ్చా?\nCaller: కాల్ పెట్టేయకండి.',
}

export function SpeechLab({ provider }: { provider: SpeechProvider }) {
  const [mode, setMode] = useState<'live' | 'sample'>('live')

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-lg text-slate-900">
      <a href="./" className="text-teal-800 underline">Back to Maata-Saayam</a>
      <h1 className="mt-5 text-4xl font-bold">Speech Lab</h1>

      <fieldset className="mt-6">
        <legend className="font-semibold">Test mode</legend>
        <div className="flex flex-wrap gap-x-6">
          <label className="flex items-center gap-2 py-2">
            <input type="radio" name="speech-mode" checked={mode === 'live'} onChange={() => setMode('live')} />
            Live microphone
          </label>
          <label className="flex items-center gap-2 py-2">
            <input type="radio" name="speech-mode" checked={mode === 'sample'} onChange={() => setMode('sample')} />
            Sample transcript
          </label>
        </div>
      </fieldset>

      {mode === 'live' ? <LiveRecognition provider={provider} /> : <SampleTranscript />}
    </main>
  )
}

function LiveRecognition({ provider }: { provider: SpeechProvider }) {
  const [language, setLanguage] = useState<SpeechLanguage>('te-IN')
  const permission = useMicrophonePermission()
  const speech = useSpeechSession(provider, language)
  const busy = ['Starting', 'Listening', 'Stopping'].includes(speech.status)
  const permissionStatus = speech.microphoneActive
    ? 'Microphone active'
    : speech.error === 'not-allowed'
      ? 'Access blocked for the last attempt'
      : permission

  return (
    <section aria-labelledby="live-title" className="mt-5 space-y-4 rounded-lg border border-slate-300 p-5">
      <h2 id="live-title" className="text-2xl font-semibold">Live speech recognition</h2>
      <p id="microphone-notice">
        Starting activates your microphone. Your browser may send audio to its speech service.
        Maata-Saayam keeps the transcript in this tab’s memory for review and does not save it.
      </p>
      <p><strong>Browser compatibility</strong> · {provider.unavailableReason ??
        `${provider.name} detected. Language availability depends on the browser and its speech service.`}</p>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="speech-language" className="font-semibold">Recognition language</label>
        <select id="speech-language" value={language} disabled={busy}
          className="rounded border border-slate-400 bg-white p-2"
          onChange={(event) => {
            setLanguage(event.target.value as SpeechLanguage)
            speech.clear()
          }}>
          {Object.entries(languages).map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}
        </select>
      </div>

      <div role="status" className="space-y-1">
        <p><strong>Microphone permission</strong> · {permissionStatus}</p>
        <p><strong>Recognition status</strong> · {provider.unavailableReason ? 'Unavailable' : speech.status}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className={primaryButton} aria-describedby="microphone-notice"
          disabled={busy || Boolean(provider.unavailableReason)} onClick={speech.start}>Start microphone</button>
        <button type="button" className={buttonStyle} disabled={!busy || speech.status === 'Stopping'}
          onClick={speech.stop}>Stop</button>
        <button type="button" className={buttonStyle} disabled={busy || (!speech.final && !speech.error)}
          onClick={speech.clear}>Clear results</button>
      </div>

      {speech.error && <p role="alert" className="text-red-800">
        {errors[speech.error] ?? 'The speech service reported an error. Try starting again.'} ({speech.error})
      </p>}

      <Transcript title="Live interim transcript" value={speech.interim} language={language} />
      <Transcript title="Final transcript" value={speech.final} language={language} announce />
      <TranscriptAnalysis transcript={speech.final} language={language} source="Microphone transcript" disabled={busy} />
    </section>
  )
}

function Transcript({ title, value, language, announce }: {
  title: string
  value: string
  language: SpeechLanguage
  announce?: boolean
}) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <div aria-live={announce ? 'polite' : undefined}
        className="mt-1 min-h-14 whitespace-pre-wrap wrap-anywhere rounded bg-slate-100 p-3">
        {value ? <span lang={language}>{value}</span> : 'No text yet.'}
      </div>
    </div>
  )
}

function SampleTranscript() {
  const [text, setText] = useState('')

  useEffect(() => {
    const clear = () => setText('')
    window.addEventListener('pagehide', clear)
    return () => window.removeEventListener('pagehide', clear)
  }, [])

  return (
    <section aria-labelledby="sample-title" className="mt-5 space-y-4 rounded-lg border border-slate-300 p-5">
      <h2 id="sample-title" className="text-2xl font-semibold">Sample transcript testing</h2>
      <p id="sample-notice">Use a scripted sample or paste test text. This mode uses text only and keeps it in this tab’s memory.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonStyle} onClick={() => setText(samples.telugu)}>Load Telugu–English</button>
        <button type="button" className={buttonStyle} onClick={() => setText(samples.hindi)}>Load Hindi–English</button>
        <button type="button" className={buttonStyle} onClick={() => setText(samples.scam)}>Load scripted scam example</button>
        <button type="button" className={buttonStyle} disabled={!text} onClick={() => setText('')}>Clear sample</button>
      </div>
      <label htmlFor="sample-transcript" className="block font-semibold">Sample transcript</label>
      <textarea id="sample-transcript" rows={7} value={text} aria-describedby="sample-notice"
        autoComplete="off" spellCheck={false} onChange={(event) => setText(event.target.value)}
        className="w-full rounded border border-slate-400 p-3" />
      <TranscriptAnalysis transcript={text} language="auto" source="Sample or pasted text" />
    </section>
  )
}
