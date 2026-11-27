import { useEffect, useRef, useState } from 'react'
import { deleteFamilyVoice, readFamilyVoice, saveFamilyVoice, type FamilyVoice } from './familyVoiceStore'
import { recordVoice, recordingLimitSeconds } from './recordVoice'
import { exampleFamilyMessage, playVoiceClip } from './rescueAudio'

const button = 'min-h-12 rounded-lg border border-teal-800 px-4 py-2 font-semibold text-teal-900 disabled:opacity-50'
const primary = 'min-h-12 rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50'

function recordError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'మైక్రోఫోన్ అనుమతి లేదు. బ్రౌజర్ సెట్టింగ్స్‌లో అనుమతి ఇవ్వండి.'
    }
    if (error.name === 'NotSupportedError') return 'ఈ బ్రౌజర్‌లో ఆడియో రికార్డింగ్ అందుబాటులో లేదు.'
    if (error.name === 'NotFoundError') return 'మైక్రోఫోన్ దొరకలేదు. పరికరాన్ని తనిఖీ చేయండి.'
  }
  return 'రికార్డింగ్ పూర్తి కాలేదు. మైక్రోఫోన్‌ను తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.'
}

export function FamilySetup() {
  const [saved, setSaved] = useState<FamilyVoice | null>(null)
  const [draft, setDraft] = useState<Blob | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState(exampleFamilyMessage)
  const [loading, setLoading] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recordStatus, setRecordStatus] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle')
  const [playing, setPlaying] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const capture = useRef<AbortController | null>(null)
  const stopCapture = useRef<(() => void) | null>(null)
  const playback = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    void readFamilyVoice().then((voice) => {
      if (!active || !voice) return
      setSaved(voice)
      setDisplayName(voice.displayName)
      setMessage(voice.message)
    }).catch(() => {
      if (active) {
        setReadFailed(true)
        setError('ఈ బ్రౌజర్‌లో స్థానిక రికార్డింగ్‌ను చదవలేకపోయాం. కొత్త రికార్డింగ్‌ని సేవ్ చేయడానికి ప్రయత్నించండి.')
      }
    }).finally(() => { if (active) setLoading(false) })

    const cancel = () => {
      capture.current?.abort()
      playback.current?.abort()
    }
    window.addEventListener('pagehide', cancel)
    return () => {
      active = false
      window.removeEventListener('pagehide', cancel)
      cancel()
    }
  }, [])

  async function record() {
    if (capture.current || playback.current || saving) return
    const controller = new AbortController()
    capture.current = controller
    setRecordStatus('requesting')
    setError('')
    setNotice('')
    try {
      const audio = await recordVoice(controller.signal, (stop) => {
        stopCapture.current = stop
        setRecordStatus('recording')
      })
      if (!controller.signal.aborted) {
        setDraft(audio)
        setNotice('కొత్త రికార్డింగ్ సిద్ధంగా ఉంది. విని, తర్వాత సేవ్ చేయండి.')
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(recordError(err))
    } finally {
      if (capture.current === controller) {
        capture.current = null
        stopCapture.current = null
        setRecordStatus('idle')
      }
    }
  }

  async function preview(audio: Blob) {
    if (playback.current || capture.current) return
    const controller = new AbortController()
    playback.current = controller
    setError('')
    setPlaying(true)
    try {
      await playVoiceClip(audio, controller.signal)
    } catch {
      if (!controller.signal.aborted) setError('రికార్డింగ్ వినిపించలేదు. మరోసారి రికార్డ్ చేయండి లేదా ఈ బ్రౌజర్‌లో మళ్లీ ప్రయత్నించండి.')
    } finally {
      if (playback.current === controller) {
        playback.current = null
        setPlaying(false)
      }
    }
  }

  async function save() {
    if (!draft || !displayName.trim() || !message.trim() || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const voice = { audio: draft, displayName: displayName.trim(), message: message.trim() }
      await saveFamilyVoice(voice)
      setSaved(voice)
      setReadFailed(false)
      setDraft(null)
      setNotice('కుటుంబ సందేశం ఈ బ్రౌజర్‌లో సేవ్ అయింది.')
    } catch {
      setError('రికార్డింగ్ సేవ్ కాలేదు. బ్రౌజర్ నిల్వకు అనుమతి ఉందో చూసి మళ్లీ ప్రయత్నించండి.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await deleteFamilyVoice()
      setSaved(null)
      setReadFailed(false)
      setNotice('సేవ్ చేసిన కుటుంబ సందేశం తొలగించబడింది.')
    } catch {
      setError('రికార్డింగ్ తొలగించలేకపోయాం. మళ్లీ ప్రయత్నించండి.')
    } finally {
      setSaving(false)
    }
  }

  const busy = loading || saving || playing || recordStatus !== 'idle'

  return (
    <main lang="te" className="mx-auto max-w-3xl space-y-6 px-6 py-10 text-lg text-slate-900">
      <a href="./" className="text-teal-800 underline">మాట సాయంకి తిరిగి వెళ్ళండి</a>
      <h1 className="text-4xl font-bold">కుటుంబ సందేశం <span lang="en" className="text-xl">Family Setup</span></h1>
      <p>మీ పెద్దలకు ధైర్యం చెప్పే చిన్న తెలుగు సందేశాన్ని మీ స్వరంతో రికార్డ్ చేయండి.</p>
      <p id="family-privacy">
        పేరు, సందేశం, ఆడియో ఈ బ్రౌజర్‌లో మాత్రమే నిల్వ అవుతాయి. సర్వర్‌కు పంపము.
        కొత్త సందేశాన్ని సేవ్ చేస్తే పాతది మారుతుంది. ఇక్కడే తొలగించవచ్చు లేదా ఈ సైట్ నిల్వను బ్రౌజర్‌లో క్లియర్ చేయవచ్చు.
      </p>

      <fieldset disabled={busy} className="space-y-3">
        <label htmlFor="family-name" className="block font-semibold">చూపించాల్సిన పేరు</label>
        <input id="family-name" maxLength={60} placeholder="అబ్బాయి" value={displayName}
          className="w-full rounded border border-slate-400 p-3" onChange={(event) => setDisplayName(event.target.value)} />
        <label htmlFor="family-message" className="block font-semibold">రికార్డింగ్‌లో చెప్పే మాటలు</label>
        <textarea id="family-message" rows={4} maxLength={400} value={message} aria-describedby="family-message-help"
          className="w-full rounded border border-slate-400 p-3" onChange={(event) => setMessage(event.target.value)} />
        <p id="family-message-help">మీరు చెప్పిన మాటలనే ఇక్కడ రాయండి. సందేశం వినిపించేటప్పుడు ఈ మాటలు కనిపిస్తాయి.</p>
      </fieldset>

      <p id="record-consent">రికార్డ్ ఎంచుకుంటే మైక్రోఫోన్ ఆన్ అవుతుంది. గరిష్ఠంగా {recordingLimitSeconds} సెకన్లు.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={busy} aria-describedby="record-consent"
          onClick={() => void record()}>{draft || saved ? 'మళ్లీ రికార్డ్ చేయండి' : 'రికార్డ్ చేయండి'}</button>
        {recordStatus === 'recording' && <button type="button" className={button} onClick={() => {
          setRecordStatus('finishing')
          stopCapture.current?.()
        }}>రికార్డింగ్ ఆపండి</button>}
        {recordStatus === 'requesting' && <button type="button" className={button} onClick={() => {
          capture.current?.abort()
          capture.current = null
          setRecordStatus('idle')
        }}>రద్దు చేయండి</button>}
        {draft && <button type="button" className={button} disabled={busy}
          onClick={() => void preview(draft)}>కొత్త రికార్డింగ్ వినండి</button>}
        {playing && <button type="button" className={button} onClick={() => playback.current?.abort()}>ఆడియో ఆపండి</button>}
        {draft && <button type="button" className={primary}
          disabled={busy || !displayName.trim() || !message.trim()} onClick={() => void save()}>
          {saved ? 'కొత్త సందేశంతో మార్చండి' : 'సందేశం సేవ్ చేయండి'}
        </button>}
      </div>

      <div role="status">
        {loading && <p>సేవ్ చేసిన సందేశం కోసం చూస్తున్నాం…</p>}
        {recordStatus === 'requesting' && <p>మైక్రోఫోన్ అనుమతి కోసం చూస్తున్నాం…</p>}
        {recordStatus === 'recording' && <p>మైక్రోఫోన్ ఆన్‌లో ఉంది. రికార్డ్ చేస్తున్నాం.</p>}
        {recordStatus === 'finishing' && <p>రికార్డింగ్ సిద్ధం చేస్తున్నాం…</p>}
        {notice && <p>{notice}</p>}
      </div>
      {error && <p role="alert" className="text-red-900">{error}</p>}

      {!loading && <section className="space-y-3 rounded-lg border border-slate-300 p-5" aria-labelledby="saved-family-title">
        <h2 id="saved-family-title" className="text-2xl font-semibold">సేవ్ చేసిన సందేశం</h2>
        {saved ? <>
          <p className="font-semibold">{saved.displayName}</p>
          <p className="whitespace-pre-wrap wrap-anywhere">{saved.message}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={button} disabled={busy} onClick={() => void preview(saved.audio)}>సేవ్ చేసిన సందేశం వినండి</button>
            <button type="button" className={button} disabled={busy} onClick={() => void remove()}>సేవ్ చేసిన సందేశం తొలగించండి</button>
          </div>
        </> : <p>ఇంకా కుటుంబ సందేశం సేవ్ కాలేదు.</p>}
        {readFailed && <button type="button" className={button} disabled={busy}
          onClick={() => void remove()}>స్థానిక సందేశాన్ని తొలగించండి</button>}
      </section>}
      <a href="?view=live-guardian" className="inline-block py-2 text-teal-800 underline">ప్రత్యక్ష రక్షణ తెరవండి</a>
    </main>
  )
}
