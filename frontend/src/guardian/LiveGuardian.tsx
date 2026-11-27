import { useEffect, useMemo, useRef, useState } from 'react'
import { FamilyRescuePanel } from '../family/FamilyRescuePanel'
import { type SpeechLanguage, type SpeechProvider } from '../speech/provider'
import { useMicrophonePermission } from '../speech/useMicrophonePermission'
import { GuardianSession, initialGuardianState, isMonitoring } from './GuardianSession'
import { isHighRisk, type RiskState } from './riskState'
import { warningText } from './warningAudio'

const recognitionLabels = {
  IDLE: 'మైక్రోఫోన్ ఆఫ్‌లో ఉంది',
  STARTING: 'మైక్రోఫోన్ ప్రారంభమవుతోంది…',
  LISTENING: 'మైక్రోఫోన్ ద్వారా వింటున్నాం',
  PAUSED: 'హెచ్చరిక కోసం వినడం తాత్కాలికంగా ఆగింది',
  STOPPED: 'పర్యవేక్షణ ఆగింది',
  ENDED: 'బ్రౌజర్ వినడం ఆపింది. కొనసాగించడానికి మళ్లీ ప్రారంభించండి.',
  ERROR: 'పర్యవేక్షణ మధ్యలో ఆగింది',
}

const riskLabels: Record<RiskState, { label: string; color: string }> = {
  LISTENING: { label: 'వింటున్నాం', color: 'border-teal-700 bg-teal-50 text-teal-950' },
  CAUTION: { label: 'జాగ్రత్త', color: 'border-amber-700 bg-amber-50 text-amber-950' },
  WARNING: { label: 'హెచ్చరిక', color: 'border-orange-700 bg-orange-50 text-orange-950' },
  CRITICAL: { label: 'తీవ్ర హెచ్చరిక', color: 'border-red-800 bg-red-50 text-red-950' },
}

const errorLabels: Record<string, string> = {
  'not-allowed': 'మైక్రోఫోన్ అనుమతి లేదు. బ్రౌజర్ సెట్టింగ్స్‌లో అనుమతి ఇవ్వండి.',
  'service-not-allowed': 'బ్రౌజర్ వాయిస్ సేవ అందుబాటులో లేదు. వేరొక బ్రౌజర్‌లో ప్రయత్నించండి.',
  'audio-capture': 'మైక్రోఫోన్ తెరవలేకపోయాం. పరికర కనెక్షన్‌ను తనిఖీ చేయండి.',
  'no-speech': 'మాటలు వినిపించలేదు. మళ్లీ ప్రారంభించి స్పష్టంగా మాట్లాడండి.',
  'no-match': 'మాటలను గుర్తించలేకపోయాం. మళ్లీ ప్రారంభించి చిన్న వాక్యం చెప్పండి.',
  'aborted': 'బ్రౌజర్ వినడం మధ్యలో నిలిపివేసింది. సిద్ధంగా ఉన్నప్పుడు మళ్లీ ప్రారంభించండి.',
  'network': 'బ్రౌజర్ వాయిస్ సేవకు కనెక్షన్ లేదు. ఇంటర్నెట్‌ను తనిఖీ చేయండి.',
  'language-not-supported': 'ఈ భాషకు బ్రౌజర్‌లో మద్దతు లేదు.',
  'language-unavailable': 'ఈ భాష ప్రస్తుతం అందుబాటులో లేదు.',
  'start-timeout': 'మైక్రోఫోన్ ప్రారంభం కాలేదు. అనుమతిని తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.',
}

const permissionLabels: Record<string, string> = {
  Granted: 'అనుమతి ఉంది',
  Blocked: 'అనుమతి లేదు',
  'Permission may be requested': 'బ్రౌజర్ అనుమతి అడగవచ్చు',
  'Not reported by this browser': 'అనుమతి స్థితిని బ్రౌజర్ తెలియజేయలేదు',
}

export function LiveGuardian({ provider }: { provider: SpeechProvider }) {
  const [language, setLanguage] = useState<SpeechLanguage>('te-IN')
  const [state, setState] = useState(initialGuardianState)
  const permission = useMicrophonePermission()
  const session = useMemo(() => new GuardianSession(provider, setState), [provider])
  const rescueButton = useRef<HTMLButtonElement>(null)
  const monitoring = isMonitoring(state.recognition)
  const risk = riskLabels[state.risk]
  const showWarning = isHighRisk(state.risk)
  const analyzerUnavailable = state.analysis === 'UNAVAILABLE'
  const credentialRequest = state.result?.detected_signals.some((signal) => signal.category === 'credential_theft')
  const caution = credentialRequest
    ? 'మీ ఓటీపీ లేదా పిన్‌ను ఎవరికీ చెప్పకండి. అవసరమైతే బ్యాంకు అధికారిక నంబరుకు మీరే ఫోన్ చేయండి.'
    : 'తొందరపడకండి. వివరాలు చెప్పే ముందు, మీకు తెలిసిన అధికారిక నంబరుకు మీరే ఫోన్ చేసి తెలుసుకోండి.'

  useEffect(() => {
    const leave = () => session.stop()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      session.dispose()
    }
  }, [session])

  return (
    <main lang="te" className="mx-auto max-w-3xl space-y-6 px-6 py-10 text-lg text-slate-900">
      <a href="./" className="text-teal-800 underline">మాట సాయంకి తిరిగి వెళ్ళండి</a>
      <h1 className="text-4xl font-bold">ప్రత్యక్ష రక్షణ <span lang="en" className="text-xl">Live Guardian</span></h1>
      <p id="guardian-consent">
        ఫోన్‌ను స్పీకర్‌లో పెట్టండి. మీ అనుమతితో ఈ పరికరంలోని మైక్రోఫోన్ ద్వారా వింటాం.
        మొబైల్ కాల్‌కు నేరుగా కనెక్ట్ అవ్వదు. బ్రౌజర్ తన వాయిస్ సేవకు ఆడియో పంపవచ్చు.
        విశ్లేషణ కోసం గుర్తించిన మాటలు మాత్రమే మాట సాయం సర్వర్‌కు వెళ్తాయి.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="guardian-language" className="font-semibold">గుర్తింపు భాష</label>
        <select id="guardian-language" value={language} disabled={monitoring}
          className="rounded border border-slate-400 bg-white p-2"
          onChange={(event) => setLanguage(event.target.value as SpeechLanguage)}>
          <option value="te-IN">తెలుగు (te-IN)</option>
          <option value="hi-IN" lang="hi">हिन्दी (hi-IN)</option>
          <option value="en-IN" lang="en">English (India) (en-IN)</option>
        </select>
      </div>

      {provider.unavailableReason && <p role="alert">
        ఈ బ్రౌజర్ లేదా కనెక్షన్‌లో వాయిస్ గుర్తింపు అందుబాటులో లేదు. మద్దతు ఉన్న బ్రౌజర్‌ను HTTPS లేదా localhost ద్వారా తెరవండి.
        {' '}<a className="text-teal-800 underline" href="?view=speech-lab" lang="en">Speech Lab</a>
      </p>}

      <div role="status" className="space-y-2">
        <p className="text-2xl font-bold">{state.rescue && state.recognition === 'PAUSED'
          ? 'కుటుంబ సందేశం కోసం వినడం తాత్కాలికంగా ఆగింది' : recognitionLabels[state.recognition]}</p>
        <p><strong>మైక్రోఫోన్ అనుమతి</strong> · {state.recognitionError === 'not-allowed' ? 'అనుమతి నిరాకరించారు' :
          state.microphoneActive ? 'మైక్రోఫోన్ పనిచేస్తోంది' : permissionLabels[permission]}</p>
      </div>

      {state.recognitionError && <p role="alert" className="text-red-800">
        {errorLabels[state.recognitionError] ?? 'వాయిస్ గుర్తింపు విఫలమైంది. మళ్లీ ప్రారంభించండి.'}
      </p>}

      <div className="flex flex-wrap gap-3">
        <button type="button" aria-describedby="guardian-consent"
          className="min-h-14 rounded-lg bg-teal-800 px-6 py-3 text-xl font-bold text-white disabled:opacity-50"
          disabled={monitoring || Boolean(state.rescue) || Boolean(provider.unavailableReason)} onClick={() => session.start(language)}>
          పర్యవేక్షణ ప్రారంభించండి
        </button>
        <button type="button"
          className="min-h-14 rounded-lg bg-red-800 px-6 py-3 text-xl font-bold text-white disabled:opacity-50"
          disabled={!monitoring} onClick={() => session.stop()}>
          పర్యవేక్షణ ఆపండి
        </button>
        <button ref={rescueButton} type="button" disabled={Boolean(state.rescue)}
          className="min-h-14 rounded-lg bg-indigo-900 px-6 py-3 text-xl font-bold text-white disabled:opacity-50"
          onClick={() => session.requestRescue()}>కుటుంబ సహాయం</button>
      </div>

      {state.rescue && <FamilyRescuePanel rescue={state.rescue}
        onRepeat={() => session.repeatRescue()}
        onDismiss={() => {
          session.dismissRescue()
          requestAnimationFrame(() => rescueButton.current?.focus())
        }} />}

      {monitoring && <section aria-labelledby="guardian-risk" className={`space-y-3 rounded-lg border-2 p-5 ${risk.color}`}>
        <div role="status" aria-atomic="true">
          <h2 id="guardian-risk" className="text-2xl font-bold">
            {analyzerUnavailable && state.risk === 'LISTENING' ? 'రక్షణ విశ్లేషణకు అంతరాయం' : risk.label}
          </h2>
          {state.risk === 'CAUTION' && <p>{caution}</p>}
        </div>
        {analyzerUnavailable && <p role="alert">
          ప్రస్తుతం మోసం కోసం తనిఖీ చేయలేకపోతున్నాం. మైక్రోఫోన్ ఇంకా ఆన్‌లో ఉంది.
        </p>}
        {showWarning && !state.rescue && <>
          <p className="font-bold">{warningText}</p>
          {state.risk === 'CRITICAL' && <p>
            కాల్ పెట్టేసిన తర్వాత మీకు నమ్మకమైన కుటుంబ సభ్యుడికి మీరే ఫోన్ చేయండి.
          </p>}
          <button type="button" disabled={state.recognition === 'PAUSED'}
            className="min-h-12 rounded border border-current px-4 py-2 font-semibold disabled:opacity-50"
            onClick={() => session.repeatWarning()}>హెచ్చరిక మళ్లీ వినండి</button>
          {state.warningPlaying && <p role="status">హెచ్చరిక వినిపిస్తోంది…</p>}
          {state.warningFailed && <p role="alert">ఆడియో వినిపించలేదు. పైన ఉన్న సూచన చదవండి లేదా మళ్లీ వినండి.</p>}
        </>}
      </section>}

      <details className="rounded-lg border border-slate-300 p-4">
        <summary className="cursor-pointer font-semibold">విశ్లేషణ వివరాలు</summary>
        <div className="mt-3 min-h-20 whitespace-pre-wrap wrap-anywhere rounded-lg bg-slate-100 p-4">
          {state.transcript || state.interim ? <>
            <span lang={language}>{state.transcript}</span>
            {state.interim && <p lang={language} className="text-slate-700">{state.interim}</p>}
          </> : <p>ఇంకా మాటలు గుర్తించలేదు.</p>}
        </div>
        {state.result && <div className="mt-3 space-y-2">
          <p>చివరి విశ్లేషణ · {state.result.risk_score}/100</p>
          <p lang="en">{state.result.explanation}</p>
          {state.result.evidence.length > 0 && <ul lang={language} className="list-disc space-y-1 pl-6">
            {state.result.evidence.map((evidence) => <li key={evidence} className="wrap-anywhere">{evidence}</li>)}
          </ul>}
          <pre className="whitespace-pre-wrap wrap-anywhere">{state.result.normalized_transcript}</pre>
        </div>}
      </details>
    </main>
  )
}
