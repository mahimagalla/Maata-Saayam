import { useEffect, useRef } from 'react'
import type { RescueState } from '../guardian/GuardianSession'

export function FamilyRescuePanel({ rescue, onRepeat, onDismiss }: {
  rescue: RescueState
  onRepeat: () => void
  onDismiss: () => void
}) {
  const panel = useRef<HTMLElement>(null)

  useEffect(() => { panel.current?.focus() }, [])

  return (
    <section ref={panel} tabIndex={-1} aria-labelledby="family-rescue-title"
      className="space-y-4 rounded-xl border-2 border-indigo-900 bg-indigo-50 p-5 text-indigo-950 sm:p-7">
      <div role="status" aria-atomic="true">
        <h2 id="family-rescue-title" className="wrap-anywhere text-3xl font-bold">
          {rescue.displayName ? `${rescue.displayName} — కుటుంబ సందేశం` : 'కుటుంబ సహాయం'}
        </h2>
        <p className="mt-2 font-semibold">
          {rescue.loading ? 'సేవ్ చేసిన సందేశం కోసం చూస్తున్నాం…' :
            rescue.displayName ? 'ముందుగా రికార్డ్ చేసిన సందేశం' : 'మాట సాయం భద్రతా సందేశం'}
        </p>
      </div>
      <p className="whitespace-pre-wrap wrap-anywhere text-2xl font-semibold leading-relaxed">{rescue.message}</p>
      {rescue.playing && <p role="status">సందేశం వినిపిస్తోంది…</p>}
      {rescue.failed && <p role="alert">ఆడియో వినిపించలేదు. పై సందేశాన్ని చదవండి లేదా మళ్లీ వినండి.</p>}
      <p>కుటుంబ సభ్యుడికి ఫోన్ చేయాలంటే, మీ ఫోన్‌లో వారి నంబరుకు మీరే కాల్ చేయండి.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={rescue.loading || rescue.playing}
          className="min-h-14 rounded-lg bg-indigo-900 px-5 py-3 text-xl font-bold text-white disabled:opacity-50"
          onClick={onRepeat}>సందేశం మళ్లీ వినండి</button>
        <button type="button" className="min-h-14 rounded-lg border-2 border-indigo-900 px-5 py-3 text-xl font-bold"
          onClick={onDismiss}>సందేశాన్ని మూసి కొనసాగించండి</button>
      </div>
    </section>
  )
}
