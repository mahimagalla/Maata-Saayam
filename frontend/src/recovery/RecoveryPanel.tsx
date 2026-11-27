import { useEffect, useRef, useState } from 'react'
import { playTeluguMessage } from '../guardian/warningAudio'
import { recoveryReasons, type RecoverySummary } from './summary'

export const recoveryAudioUrl = '/audio/telugu-recovery-guidance.wav'
export const recoveryAudioText = 'ఓటీపీ, పిన్, బ్యాంకు వివరాలు ఎవరికీ చెప్పకండి. ఇక డబ్బు పంపకండి. నమ్మకమైన కుటుంబ సభ్యుడికి మీరే ఫోన్ చేయండి. డబ్బు పంపినా, బ్యాంకు వివరాలు చెప్పినా, వెంటనే బ్యాంకు అధికారిక నంబరుకు ఫోన్ చేయండి. ఆర్థిక సైబర్ మోసం గురించి తెలియజేయడానికి ఒకటి తొమ్మిది మూడు సున్నాకి ఫోన్ చేయండి.'

const titles = {
  caution: 'జాగ్రత్తగా ఉండండి',
  warning: 'మోసం జరిగే అవకాశం ఉంది',
  critical: 'తీవ్ర హెచ్చరిక వచ్చింది',
}
const button = 'inline-flex min-h-14 items-center justify-center rounded-lg px-5 py-3 text-xl font-bold'

export function RecoveryPanel({ summary, onDismiss }: { summary: RecoverySummary; onDismiss: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const playback = useRef<AbortController | null>(null)
  const [audio, setAudio] = useState<'idle' | 'playing' | 'failed'>('idle')

  useEffect(() => {
    heading.current?.focus()
    const cancel = () => playback.current?.abort()
    window.addEventListener('pagehide', cancel)
    return () => {
      window.removeEventListener('pagehide', cancel)
      cancel()
    }
  }, [])

  async function listen() {
    if (playback.current) return
    const controller = new AbortController()
    playback.current = controller
    setAudio('playing')
    try {
      await playTeluguMessage(recoveryAudioText, recoveryAudioUrl, controller.signal)
      if (!controller.signal.aborted) setAudio('idle')
    } catch {
      if (!controller.signal.aborted) setAudio('failed')
    } finally {
      playback.current = null
    }
  }

  return (
    <main lang="te" className="mx-auto max-w-3xl space-y-6 px-5 py-8 text-lg text-slate-950">
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">{titles[summary.level]}</h1>
      <p>మైక్రోఫోన్ పర్యవేక్షణ ఆగింది. ఫోన్ కాల్ ఇంకా కొనసాగుతుంటే మీరే పెట్టేయండి.</p>
      {summary.reasons.length > 0 && <section aria-labelledby="recovery-reasons" className="space-y-2">
        <h2 id="recovery-reasons" className="text-xl font-bold">ఎందుకు జాగ్రత్త చెప్పాం?</h2>
        <ul className="list-disc space-y-2 pl-6">
          {summary.reasons.map((reason) => <li key={reason}>{recoveryReasons[reason]}</li>)}
        </ul>
      </section>}
      <p>ఇవి జాగ్రత్త పడాల్సిన సూచనలు మాత్రమే. మోసం జరిగిందని రుజువు కాదు.</p>
      <section aria-labelledby="recovery-next" className="space-y-3 rounded-xl border border-teal-700 bg-teal-50 p-5">
        <h2 id="recovery-next" className="text-2xl font-bold">ఇప్పుడు ఏం చేయాలి?</h2>
        <p>ఓటీపీ, పిన్ లేదా బ్యాంకు వివరాలు ఎవరికీ చెప్పకండి. ఇక డబ్బు పంపకండి.</p>
        <p>మీకు తెలిసిన నంబరుతో కుటుంబ సభ్యుడికి లేదా బ్యాంకు అధికారిక నంబరుకు మీరే ఫోన్ చేయండి.</p>
        <button type="button" className={button + ' bg-teal-800 text-white disabled:opacity-60'}
          disabled={audio === 'playing'} onClick={() => void listen()}>సూచనలు వినండి</button>
        {audio === 'playing' && <p role="status">సూచనలు వినిపిస్తున్నాయి…</p>}
        {audio === 'failed' && <p role="alert">ఆడియో వినిపించలేదు. ఇక్కడ ఉన్న సూచనలు చదవండి.</p>}
      </section>
      <section aria-labelledby="recovery-money" className="space-y-3 rounded-xl border border-amber-700 bg-amber-50 p-5">
        <h2 id="recovery-money" className="text-2xl font-bold">డబ్బు పంపారా? బ్యాంకు వివరాలు చెప్పారా?</h2>
        <p>అలా అయితే వెంటనే మీ బ్యాంకు అధికారిక మోసాల సహాయ నంబరుకు ఫోన్ చేయండి. ఆలస్యం చేయకుండా ఫిర్యాదు చేయండి.</p>
        <p>భారతదేశంలో ఆర్థిక సైబర్ మోసం జరిగిందని అనుమానం ఉంటే 1930కి తెలియజేయవచ్చు. అనుమానాస్పద కాల్ గురించి అధికారిక వెబ్‌సైట్‌లో కూడా ఫిర్యాదు చేయవచ్చు.</p>
        <div className="flex flex-wrap gap-3">
          <a href="tel:1930" className={button + ' bg-amber-950 text-white'}>1930కి ఫోన్ చేయండి</a>
          <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener noreferrer"
            className={button + ' border border-amber-950'}>అధికారిక ఫిర్యాదు వెబ్‌సైట్</a>
        </div>
      </section>
      <button type="button" onClick={onDismiss} className={button + ' border border-teal-800 text-teal-950'}>
        పర్యవేక్షణ తెరకు తిరిగి వెళ్ళండి
      </button>
      <a href="./" className="inline-flex min-h-14 items-center px-4 text-teal-800 underline">ముఖ్య తెరకు వెళ్ళండి</a>
    </main>
  )
}
