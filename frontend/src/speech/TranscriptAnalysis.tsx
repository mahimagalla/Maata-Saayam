import { useEffect, useRef, useState } from 'react'
import { requestAnalysis, transcriptLimit, type AnalysisLanguage, type AnalysisResult } from './analysisApi'

const levels: Record<AnalysisResult['risk_level'], string> = {
  low: 'Low risk', suspicious: 'Suspicious', high_caution: 'High caution', critical: 'Critical risk',
}
const actions: Record<AnalysisResult['recommended_action'], string> = {
  CONTINUE_LISTENING: 'Continue listening',
  SHOW_CAUTION: 'Show caution',
  SPOKEN_WARNING: 'Spoken warning',
  FAMILY_RESCUE: 'Family rescue',
}

export function AnalysisResults({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-3" aria-labelledby="analysis-result">
      <h3 id="analysis-result" className="text-xl font-semibold">
        {levels[result.risk_level]} · {result.risk_score}/100
      </h3>
      <p><strong>Recommended action</strong> · {actions[result.recommended_action]}</p>
      <p>{result.explanation}</p>
      <p><strong>Transcript quality</strong> · {result.transcript_quality.status}
        {result.transcript_quality.duplicates_removed > 0 &&
          ` · ${result.transcript_quality.duplicates_removed} repeated items removed`}
      </p>
      <h4 className="font-semibold">Detected signals</h4>
      {result.detected_signals.length === 0 ? <p>No matching signals.</p> : (
        <ul className="space-y-3">
          {result.detected_signals.map((entry) => (
            <li key={entry.category} className="rounded bg-slate-100 p-3">
              <p className="font-semibold capitalize">{entry.category.replaceAll('_', ' ')} · {entry.severity}</p>
              <p>{entry.explanation}</p>
              <blockquote className="mt-1 whitespace-pre-wrap wrap-anywhere border-l-2 border-slate-400 pl-3">
                {entry.evidence}
              </blockquote>
              <p className="text-sm text-slate-700">
                {entry.match_quality === 'direct' ? 'Direct pattern match' : 'Matched after normalization'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TranscriptAnalysis({ transcript, language, source, disabled = false }: {
  transcript: string
  language: AnalysisLanguage
  source: 'Sample or pasted text' | 'Microphone transcript'
  disabled?: boolean
}) {
  const current = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AnalysisResult>()
  const [error, setError] = useState('')
  const tooLong = transcript.length > transcriptLimit

  useEffect(() => {
    function reset() {
      const request = current.current
      current.current = null
      request?.abort()
      setPending(false)
      setError('')
      setResult(undefined)
    }
    reset()
    window.addEventListener('pagehide', reset)
    return () => {
      window.removeEventListener('pagehide', reset)
      current.current?.abort()
      current.current = null
    }
  }, [transcript, language, disabled])

  async function analyze() {
    if (!transcript.trim() || tooLong || disabled || current.current) return
    const controller = new AbortController()
    current.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 10_000)
    setPending(true)
    setError('')
    setResult(undefined)

    try {
      const data = await requestAnalysis(transcript, language, controller.signal)
      if (current.current === controller && !controller.signal.aborted) setResult(data)
    } catch (err) {
      if (current.current === controller) {
        setError(controller.signal.aborted ? 'Analysis timed out. Try again.' :
          err instanceof Error ? err.message : 'Analysis failed. Try again.')
      }
    } finally {
      window.clearTimeout(timeout)
      if (current.current === controller) {
        current.current = null
        setPending(false)
      }
    }
  }

  return (
    <section aria-labelledby="analysis-title" className="mt-5 space-y-3 border-t border-slate-300 pt-4">
      <h2 id="analysis-title" className="text-2xl font-semibold">Transcript analysis</h2>
      <p><strong>Source</strong> · {source}</p>
      <p id="analysis-notice">Analyze sends this text to the Maata-Saayam backend for a rule-based assessment.
        The score is a heuristic. Recommended actions appear here for review.</p>
      <button type="button" aria-describedby="analysis-notice"
        className="rounded bg-teal-800 px-4 py-2 text-white disabled:opacity-50"
        disabled={disabled || pending || tooLong || !transcript.trim()} onClick={() => void analyze()}>
        Analyze
      </button>
      {tooLong && <p role="alert">Use a transcript of 20,000 characters or fewer.</p>}
      <div role="status">
        {pending && <p>Analyzing transcript…</p>}
        {result && <AnalysisResults result={result} />}
      </div>
      {error && <p role="alert" className="text-red-800">{error}</p>}
    </section>
  )
}
