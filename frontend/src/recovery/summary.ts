import type { AnalysisResult } from '../speech/analysisApi'

const categoryReasons = {
  authority_impersonation: 'అధికారినని చెప్పిన మాటలు వినిపించాయి.',
  legal_threat: 'అరెస్టు లేదా చట్టపరమైన చర్య గురించి బెదిరింపు వినిపించింది.',
  secrecy_isolation: 'ఈ విషయం ఇతరులకు చెప్పవద్దని అడిగినట్లు వినిపించింది.',
  financial_manipulation: 'డబ్బు పంపమని లేదా చెల్లించమని ఒత్తిడి చేసినట్లు వినిపించింది.',
  credential_theft: 'ఓటీపీ, పిన్ లేదా బ్యాంకు వివరాలు అడిగినట్లు వినిపించింది. ఇవి చెబితే మీ ఖాతాను ఇతరులు వాడే ప్రమాదం ఉంది.',
  urgency: 'వెంటనే ఏదైనా చేయాలని తొందర పెట్టినట్లు వినిపించింది.',
  parcel_scam: 'పార్సిల్‌లో సమస్య ఉందని చెప్పిన మాటలు వినిపించాయి.',
  coercion: 'ఫోన్ పెట్టేయవద్దని ఒత్తిడి చేసినట్లు వినిపించింది.',
}

export const recoveryReasons = {
  ...categoryReasons,
  cbi: 'సీబీఐ నుంచి మాట్లాడుతున్నట్లు చెప్పిన మాటలు వినిపించాయి.',
  digitalArrest: 'డిజిటల్ అరెస్టు పేరుతో బెదిరించినట్లు వినిపించింది.',
  safeAccount: 'సురక్షిత ఖాతా అని చెప్పి దానికి డబ్బు పంపమన్నట్లు వినిపించింది.',
}

type Reason = keyof typeof recoveryReasons
const levels = { SHOW_CAUTION: 'caution', SPOKEN_WARNING: 'warning', FAMILY_RESCUE: 'critical' } as const
type Level = typeof levels[keyof typeof levels]
const priority: Record<Level, number> = { caution: 1, warning: 2, critical: 3 }

export type RecoverySummary = { level: Level; reasons: Reason[] }

export function rememberRecovery(previous: RecoverySummary | null, result: AnalysisResult): RecoverySummary | null {
  if (result.recommended_action === 'CONTINUE_LISTENING') return previous
  const level = levels[result.recommended_action]
  if (previous && priority[previous.level] > priority[level]) return previous

  const reasons = new Map<string, Reason>()
  for (const { category, evidence } of result.detected_signals) {
    if (!Object.hasOwn(categoryReasons, category)) continue
    const phrase = evidence.normalize('NFKC')
    let reason = category as Reason
    if (category === 'authority_impersonation' && /\bc\s*b\s*i\b|సీ\s*బీ\s*ఐ|సి\s*బి\s*ఐ|सी\s*बी\s*आई/iu.test(phrase)) reason = 'cbi'
    if (category === 'legal_threat' && /\bdigital\s+arrest\b|డిజిటల్\s*అరెస్ట్|डिजिटल\s*अरेस्ट/iu.test(phrase)) reason = 'digitalArrest'
    if (category === 'financial_manipulation' && /\bsafe\s+account\b|సేఫ్\s*అకౌంట్|సురక్షిత\s*ఖాతా|सेफ\s*अकाउंट|सुरक्षित\s*खाते?/iu.test(phrase)) reason = 'safeAccount'
    if (!reasons.has(category) || reason !== category) reasons.set(category, reason)
  }
  return { level, reasons: [...reasons.values()] }
}
