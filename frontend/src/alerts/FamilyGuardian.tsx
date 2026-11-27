import { useEffect, useRef, useState } from 'react'
import { useFamilyLink, familyApi, FamilyApiError, type Credentials, type FamilyAlert } from './familyLink'
import { AlertNotifications } from './notifications'
import { playAudio } from '../guardian/warningAudio'

const primary = 'min-h-12 rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white hover:bg-teal-900 disabled:opacity-50'
const secondary = 'min-h-12 rounded-xl border border-teal-800 px-5 py-3 font-semibold text-teal-900 disabled:opacity-50'
const field = 'w-full rounded-xl border border-slate-400 bg-white px-4 py-3 text-slate-900'
const card = 'rounded-2xl border border-slate-200 bg-white p-5 sm:p-7'
const connectionLabels = { unpaired: 'Not paired', connecting: 'Connecting…', connected: 'Connected to server', offline: 'Reconnecting…', revoked: 'Pairing expired or was removed' }
const protectionLabels = { idle: 'Monitoring is off', listening: 'Listening', caution: 'Caution', warning: 'Warning', critical: 'Critical', unavailable: 'Status unavailable' }
const threatLabels = {
  authority_impersonation: 'Authority impersonation', legal_threat: 'Legal threat', secrecy_isolation: 'Isolation',
  financial_manipulation: 'Payment pressure', credential_theft: 'Credential request', urgency: 'Time pressure',
  parcel_scam: 'Parcel scam', coercion: 'Call control', other: 'Suspicious manipulation',
}
const alertLabels = { warning: 'Spoken warning', critical: 'Critical threat', rescue: 'Family rescue' }
const errors: Record<string, string> = {
  invalid_code: 'That code is invalid or has already been used. Ask for a new code.',
  expired_code: 'That code expired. Ask your family member for a new one.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  invalid_credential: 'This device is no longer paired. Pair the devices again.',
  secure_transport_required: 'Use the secure HTTPS address for family pairing.',
  already_paired: 'This device is already paired.',
  alert_changed: 'The alert was updated. Review it before acknowledging.',
  unknown_alert: 'This alert is no longer available.',
}
const elderErrors: Record<string, string> = {
  invalid_code: 'కోడ్ తప్పుగా ఉంది లేదా ఇప్పటికే వాడారు. కొత్త కోడ్ అడగండి.',
  expired_code: 'ఈ కోడ్ గడువు ముగిసింది. కొత్త కోడ్ అడగండి.',
  rate_limited: 'చాలాసార్లు ప్రయత్నించారు. ఒక నిమిషం తర్వాత మళ్లీ ప్రయత్నించండి.',
  invalid_credential: 'ఈ పరికరం జత కాలేదు. మళ్లీ జత చేయండి.',
  secure_transport_required: 'జత చేయడానికి సురక్షితమైన HTTPS చిరునామా తెరవండి.',
}
type Invitation = { code: string; expires_at: string }
type Preview = { pair_id: string; family_name: string }
const datetime = (value: string) => new Date(value).toLocaleString()
const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[\s-]/g, '')

function inviteUrl(code: string) {
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('view', 'family-guardian')
  url.hash = `pair=${code}`
  return url.toString()
}

export function FamilyGuardian({ initialRole = 'family' }: { initialRole?: 'family' | 'elder' }) {
  const { credentials, state, setDevice, link } = useFamilyLink()
  const [role, setRole] = useState(initialRole)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [consent, setConsent] = useState(false)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [qr, setQr] = useState('')
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<FamilyAlert | null>(null)
  const [sound, setSound] = useState(false)
  const notifications = useRef(new AlertNotifications())
  const playback = useRef<AbortController | null>(null)
  const snapshot = state.snapshot
  const paired = Boolean(snapshot?.paired)
  const connected = state.connection === 'connected'
  const isFamily = credentials?.role === 'family'
  const alertList = snapshot?.alerts
  const featured = alertList?.find((alert) => alert.id === banner?.id && !alert.acknowledged_at) ??
    alertList?.find((alert) => !alert.acknowledged_at)
  const expired = invitation && Date.parse(invitation.expires_at) <= now

  useEffect(() => {
    const scanned = new URLSearchParams(location.hash.slice(1)).get('pair')
    if (scanned === null) return
    history.replaceState(null, '', location.pathname + location.search)
    setRole('elder')
    setCode(normalizeCode(scanned).slice(0, 12))
  }, [])

  useEffect(() => {
    if (!invitation || paired) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    let active = true
    void import('qrcode').then((QRCode) => QRCode.toDataURL(inviteUrl(invitation.code), { width: 224, margin: 2 }))
      .then((image) => { if (active) setQr(image) }).catch(() => { if (active) setQr('') })
    return () => { active = false; clearInterval(tick) }
  }, [invitation, paired])

  useEffect(() => {
    notifications.current = new AlertNotifications()
    setBanner(null)
  }, [credentials])

  function playChime() {
    if (playback.current) return
    const controller = new AbortController()
    playback.current = controller
    void playAudio('/audio/family-rescue-ring.wav', controller.signal).catch(() => {}).finally(() => {
      if (playback.current === controller) playback.current = null
    })
  }

  useEffect(() => () => playback.current?.abort(), [])

  useEffect(() => {
    if (!isFamily || !connected || !alertList) return
    const notification = notifications.current.update(alertList)
    if (notification) {
      setBanner(notification.alert)
      if (sound && notification.audible) playChime()
    }
  }, [alertList, connected, isFamily, sound])

  function changeDevice(next: Credentials | null) {
    if (!setDevice(next)) setError('Browser storage is unavailable. Pairing will last only while this page stays open.')
  }

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await work() } catch (err) {
      if (err instanceof FamilyApiError) {
        if (err.status === 401) {
          changeDevice(null)
          setInvitation(null)
          setQr('')
        }
        setError(elderView
          ? elderErrors[err.code] ?? 'వివరాలు తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.'
          : errors[err.code] ?? 'The request could not be completed. Check the details and try again.')
      } else setError(elderView
        ? 'సర్వర్ అందుబాటులో లేదు. ఇంటర్నెట్ కనెక్షన్ తనిఖీ చేసి మళ్లీ ప్రయత్నించండి.'
        : 'The server is unavailable. Check the network and try again.')
    } finally { setBusy(false) }
  }

  function showInvite(next: Invitation) {
    setQr('')
    setNow(Date.now())
    setInvitation(next)
  }

  function startFamily() {
    void run(async () => {
      const result = await familyApi<Invitation & { token: string }>('register', { name: name.trim() })
      showInvite({ code: result.code, expires_at: result.expires_at })
      changeDevice({ role: 'family', token: result.token })
    })
  }

  function confirmPairing() {
    if (!preview || !consent) return
    void run(async () => {
      const result = await familyApi<{ token: string }>('confirm', {
        code: normalizeCode(code), pair_id: preview.pair_id, name: name.trim(), phone: phone.trim() || null, consent: true,
      })
      changeDevice({ role: 'elder', token: result.token })
      setCode('')
      setPhone('')
      setPreview(null)
      setConsent(false)
    })
  }

  function forget() {
    changeDevice(null)
    setInvitation(null)
    setPreview(null)
    setConsent(false)
    setQr('')
  }

  const elderView = credentials ? !isFamily : role === 'elder'
  return (
    <main lang={elderView ? 'te' : 'en'} className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <a className="text-teal-800 underline" href={elderView ? '?view=live-guardian' : './'}>{elderView ? 'ప్రత్యక్ష రక్షణకు తిరిగి వెళ్ళండి' : 'Back to Maata-Saayam'}</a>
        <header className="rounded-3xl bg-teal-950 p-6 text-white sm:p-9">
          <p lang="te" className="font-semibold text-teal-200">కుటుంబ రక్షణ</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-5xl">{elderView ? 'కుటుంబ పరికరం జత' : 'Family Guardian'}</h1>
          <p className="mt-3 max-w-xl text-teal-100">{elderView ? 'తీవ్ర హెచ్చరికలను పంచుకోవడానికి కుటుంబ సభ్యుడి పరికరాన్ని జత చేయండి.' : 'Pair two devices to receive serious scam alerts and check in with your elder.'}</p>
        </header>
        {(error || state.error) && <p role="alert" className="rounded-xl bg-red-50 p-4 font-medium text-red-950">
          {error || errors[state.error] || 'The server did not accept the last action. Try again.'}
        </p>}

        {!credentials && <section className={card} aria-label="Pair family devices">
          <fieldset disabled={busy} className="space-y-4">
            <legend className="text-xl font-bold">{elderView ? 'ఇది ఎవరి పరికరం?' : 'Which device is this?'}</legend>
            <div className="flex flex-wrap gap-4">
              <label className="py-2"><input type="radio" name="role" checked={role === 'family'} onChange={() => { setRole('family'); setPreview(null) }} /> Family device</label>
              <label lang="te" className="py-2"><input type="radio" name="role" checked={role === 'elder'} onChange={() => { setRole('elder'); setPreview(null) }} /> పెద్దల పరికరం</label>
            </div>
            <label className="block font-semibold" htmlFor="pair-name">{role === 'family' ? 'Your display name' : 'మీ పేరు'}</label>
            <input id="pair-name" value={name} maxLength={60} className={field} onChange={(event) => setName(event.target.value)} />
            {role === 'family' ? <button type="button" className={primary} disabled={!name.trim()} onClick={startFamily}>Generate pairing code</button> : <>
              <label className="block font-semibold" htmlFor="pair-code">జత చేసే కోడ్ · Pairing code</label>
              <input id="pair-code" value={code} maxLength={17} autoComplete="off" spellCheck={false} className={field}
                onChange={(event) => { setCode(event.target.value); setPreview(null); setConsent(false) }} />
              <p className="text-base text-slate-700">మీ కుటుంబ సభ్యుడు ఇచ్చిన కోడ్‌ను నమోదు చేయండి లేదా ఫోన్ కెమెరాతో వారి QR కోడ్‌ను స్కాన్ చేయండి.</p>
              {!preview && <button type="button" className={secondary} disabled={normalizeCode(code).length !== 12}
                onClick={() => void run(async () => setPreview(await familyApi<Preview>('inspect', { code: normalizeCode(code) })))}>కుటుంబ పేరును చూడండి</button>}
              {preview && <div className="space-y-3 rounded-xl bg-teal-50 p-4">
                <p role="status"><strong className="wrap-anywhere">{preview.family_name}</strong> ఈ పరికరంతో జత అవుతారు.</p>
                <label htmlFor="elder-phone" className="block font-semibold">మీ ఫోన్ నంబరు · Optional</label>
                <input id="elder-phone" type="tel" autoComplete="off" value={phone} maxLength={16} className={field} onChange={(event) => setPhone(event.target.value)} />
                <label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>తీవ్ర హెచ్చరికలు, నా పేరు, నేను ఇచ్చిన ఫోన్ నంబరును ఈ కుటుంబ సభ్యుడితో పంచుకోవడానికి అంగీకరిస్తున్నాను.</span>
                </label>
                <button type="button" className={primary} disabled={!consent || !name.trim() || Boolean(phone.trim() && !/^\+?\d{7,15}$/.test(phone.trim()))} onClick={confirmPairing}>జత చేయండి · Confirm pairing</button>
              </div>}
            </>}
          </fieldset>
        </section>}

        {credentials && <div className="space-y-5">
          <p role="status" className="rounded-xl bg-teal-100 px-4 py-3 font-semibold text-teal-950">{elderView ? {
            unpaired: 'జత కాలేదు', connecting: 'కనెక్ట్ అవుతోంది…', connected: 'సర్వర్‌కు కనెక్ట్ అయింది',
            offline: 'మళ్లీ కనెక్ట్ అవుతోంది…', revoked: 'పరికరం జత ముగిసింది',
          }[state.connection] : connectionLabels[state.connection]}</p>
          {state.connection === 'revoked' ? <section className={card}>
            <p>The server no longer recognizes this pairing. This can happen after a restart or when either device unlinks.</p>
            <button type="button" className={primary + ' mt-4'} onClick={forget}>Set up again · మళ్లీ జత చేయండి</button>
          </section> : <>
            {isFamily && !paired && <section className={card + ' space-y-3'}>
              <h2 className="text-2xl font-bold">Pair your elder’s device</h2>
              {invitation && !expired ? <>
                <p>Open Family Guardian on the elder’s device or scan this QR with its camera. Confirm there to pair.</p>
                <p className="break-all font-mono text-2xl font-bold tracking-widest">{invitation.code}</p>
                <p>Expires {datetime(invitation.expires_at)} · {Math.max(0, Math.ceil((Date.parse(invitation.expires_at) - now) / 1000))} seconds</p>
                {qr && <img src={qr} width={224} height={224} alt="Pairing QR code" />}
              </> : <p>{expired ? 'The pairing code expired.' : 'Waiting for the elder to pair.'}</p>}
              <button type="button" className={secondary} disabled={busy || !connected}
                onClick={() => void run(async () => showInvite(await familyApi<Invitation>('invite', undefined, credentials)))}>Generate a new code</button>
              <button type="button" className={secondary + ' block'} disabled={busy}
                onClick={() => void run(async () => { await familyApi('unlink', undefined, credentials); forget() })}>Cancel pairing</button>
            </section>}
            {snapshot && paired && <section className={card + ' space-y-4'}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-sm font-semibold text-teal-800">{isFamily ? 'Your paired elder' : 'జత చేసిన కుటుంబ సభ్యుడు'}</p>
                  <h2 className="wrap-anywhere text-2xl font-bold">{isFamily ? snapshot.elder_name : snapshot.family_name}</h2></div>
                <span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold">
                  {elderView ? (!connected ? 'కనెక్షన్ స్థితి తెలియదు' : snapshot.peer_online ? 'కుటుంబ పరికరం ఆన్‌లైన్‌లో ఉంది' : 'కుటుంబ పరికరం ఆఫ్‌లైన్‌లో ఉంది')
                    : !connected ? 'Connection unknown' : snapshot.peer_online ? 'Device online' : 'Device offline'}
                </span>
              </div>
              {isFamily ? <>
                <p><strong>Protection</strong> · {connected ? protectionLabels[snapshot.protection] : 'Status unavailable'}</p>
                {snapshot.phone ? <a className={secondary + ' inline-block'} href={`tel:${snapshot.phone}`}>Contact elder</a> :
                  <p>Use your usual way of contacting your elder. They have not shared a phone number here.</p>}
                <button type="button" className={secondary + ' block'} aria-pressed={sound} onClick={() => {
                  setSound(!sound)
                  if (!sound) playChime()
                  else playback.current?.abort()
                }}>{sound ? 'Mute alert sound' : 'Enable alert sound'}</button>
              </> : <a className={primary + ' inline-block'} href="?view=live-guardian">ప్రత్యక్ష రక్షణ తెరవండి</a>}
              <button type="button" disabled={busy}
                className="block min-h-12 rounded-lg border border-red-700 px-4 text-red-900 disabled:opacity-50"
                onClick={() => {
                  if (!window.confirm('Unlink both devices? / రెండు పరికరాల జతను తొలగించాలా?')) return
                  void run(async () => { await familyApi('unlink', undefined, credentials); forget() })
                }}>{elderView ? 'జత తొలగించండి' : 'Unlink devices'}</button>
            </section>}
            {isFamily && paired && <section className="space-y-4" aria-labelledby="recent-alerts">
              {featured &&
                <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-xl font-bold text-red-950">
                  {alertLabels[featured.state]} · Check in with {featured.elder_name}
                </p>}
              <h2 id="recent-alerts" className="text-2xl font-bold">Recent alerts</h2>
              {!alertList?.length && <p className={card}>No alerts yet. Serious warnings will appear here when your elder’s device sends them.</p>}
              {alertList?.map((alert) => <article key={alert.id} className={card + ' space-y-3'}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="text-xl font-bold">{threatLabels[alert.category]}</h3>
                  <span className="font-semibold text-red-800">{alertLabels[alert.state]}</span>
                </div>
                <time dateTime={alert.timestamp} className="text-sm text-slate-700">{datetime(alert.timestamp)}</time>
                <p>{alert.explanation}</p>
                {alert.acknowledged_at ? <p className="font-medium text-teal-800">Acknowledged · {datetime(alert.acknowledged_at)}</p> :
                  <button type="button" className={primary} disabled={!connected} onClick={() => link.acknowledge(alert)}>Acknowledge</button>}
              </article>)}
            </section>}
          </>}
        </div>}
      </div>
    </main>
  )
}
