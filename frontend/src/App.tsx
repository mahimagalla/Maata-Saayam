import { useEffect, useState } from 'react'
import { checkHealth } from './health'
import { browserSpeechProvider } from './speech/browserSpeech'
import { SpeechLab } from './speech/SpeechLab'
import { LiveGuardian } from './guardian/LiveGuardian'
import { FamilySetup } from './family/FamilySetup'

const sections = [
  { id: 'elder', title: 'Elder Protection', telugu: 'పెద్దల రక్షణ' },
  { id: 'family', title: 'Family Guardian', telugu: 'కుటుంబ సంరక్షకుడు' },
  { id: 'demo', title: 'Demo Sandbox', telugu: 'నమూనా సంభాషణలు' },
]

export function App() {
  if (typeof window !== 'undefined') {
    const view = new URLSearchParams(window.location.search).get('view')
    if (view === 'speech-lab') return <SpeechLab provider={browserSpeechProvider(window)} />
    if (view === 'live-guardian') return <LiveGuardian provider={browserSpeechProvider(window)} />
    if (view === 'family-setup') return <FamilySetup />
  }
  return <Landing />
}

function Landing() {
  const [status, setStatus] = useState('Checking connection…')

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 5_000)

    void checkHealth(controller.signal).then((connected) => {
      window.clearTimeout(timeout)
      if (active) setStatus(connected ? 'Backend connected' : 'Backend unavailable')
    })

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-lg text-slate-900">
      <h1 className="text-4xl font-bold">Maata-Saayam</h1>
      <p lang="te" className="mt-2 text-2xl">మాట సాయం</p>
      <p className="mt-5">A voice safety prototype for older adults and their families.</p>
      <p className="mt-2" role="status">{status}</p>

      <nav aria-label="Prototype areas" className="mt-8">
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          {sections.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-block rounded py-2 text-teal-800 underline">
                {title}
              </a>
            </li>
          ))}
          <li>
            <a href="?view=speech-lab" className="inline-block rounded py-2 text-teal-800 underline">Speech Lab</a>
          </li>
          <li>
            <a href="?view=live-guardian" className="inline-block rounded py-2 text-teal-800 underline">Live Guardian</a>
          </li>
        </ul>
      </nav>

      <div className="mt-6 grid gap-4">
        {sections.map(({ id, title, telugu }) => (
          <section id={id} key={id} tabIndex={-1} aria-labelledby={`${id}-title`}
            className="rounded-lg border border-slate-300 p-5">
            <h2 id={`${id}-title`} className="text-xl font-semibold">{title}</h2>
            <p lang="te">{telugu}</p>
            {id === 'family' ? <a href="?view=family-setup" className="inline-block py-2 text-teal-800 underline">Family Setup</a>
              : <p className="mt-1 text-slate-700">Planned for a later phase.</p>}
          </section>
        ))}
      </div>
    </main>
  )
}
