import { useEffect, useMemo, useState } from 'react'

export type Role = 'family' | 'elder'
export type Protection = 'idle' | 'listening' | 'caution' | 'warning' | 'critical' | 'unavailable'
export type Threat = 'authority_impersonation' | 'legal_threat' | 'secrecy_isolation' | 'financial_manipulation' |
  'credential_theft' | 'urgency' | 'parcel_scam' | 'coercion' | 'other'
export type AlertState = 'warning' | 'critical' | 'rescue'
export type AlertNotice = { id: string; category: Threat; state: AlertState }
export type FamilyAlert = AlertNotice & { timestamp: string; elder_name: string; explanation: string; acknowledged_at: string | null }
export type Credentials = { role: Role; token: string }
export type Snapshot = {
  type: 'snapshot'; paired: boolean; family_name: string; elder_name: string | null; phone: string | null;
  peer_online: boolean; protection: Protection; alerts: FamilyAlert[];
}
export type LinkState = {
  connection: 'unpaired' | 'connecting' | 'connected' | 'offline' | 'revoked';
  snapshot: Snapshot | null;
  pending: number;
  error: string;
}
type ServerEvent = Snapshot | { type: 'pong' } | { type: 'error'; code: string }

const storageKey = 'maata-saayam.family-device.v1'
const initial: LinkState = { connection: 'unpaired', snapshot: null, pending: 0, error: '' }
const priority = { warning: 0, critical: 1, rescue: 2 }

export function readCredentials(): Credentials | null {
  try {
    const item = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if ((item?.role === 'family' || item?.role === 'elder') && typeof item.token === 'string') return item
  } catch { /* Storage can be disabled. */ }
  return null
}

export function storeCredentials(credentials: Credentials | null) {
  try {
    if (credentials) localStorage.setItem(storageKey, JSON.stringify(credentials))
    else localStorage.removeItem(storageKey)
    return true
  } catch { return false }
}

export class FamilyApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export async function familyApi<T>(path: string, body?: object, credentials?: Credentials): Promise<T> {
  const response = await fetch(`/api/family/${path}`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new FamilyApiError(typeof payload?.detail === 'string' ? payload.detail : 'request_failed', response.status)
  }
  return payload as T
}

export class FamilyLink {
  state = initial
  private socket?: WebSocket
  private credentials?: Credentials
  private retry?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private attempts = 0
  private heardAt = 0
  private protection?: Protection
  private outbox = new Map<string, AlertNotice>()

  constructor(private onState: (state: LinkState) => void, private openSocket = () =>
    new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/family/socket`)) {}

  start(credentials: Credentials | null) {
    this.stop()
    this.credentials = credentials ?? undefined
    this.update(initial)
    if (credentials) this.connect()
  }

  stop() {
    this.credentials = undefined
    this.outbox.clear()
    this.attempts = 0
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  setProtection(protection: Protection) {
    if (this.protection === protection) return
    this.protection = protection
    if (this.credentials?.role === 'elder' && this.state.connection === 'connected') this.send({ type: 'status', protection })
  }

  publish(alert: AlertNotice) {
    if (this.credentials?.role !== 'elder') return
    const prior = this.outbox.get(alert.id)
    if (prior && priority[prior.state] >= priority[alert.state]) return
    if (!prior && this.outbox.size >= 40) this.outbox.delete(this.outbox.keys().next().value!)
    this.outbox.set(alert.id, alert)
    this.update({ pending: this.outbox.size })
    if (this.state.connection === 'connected') this.send({ type: 'publish', ...alert })
  }

  acknowledge(alert: FamilyAlert) {
    if (this.credentials?.role === 'family' && this.state.connection === 'connected') {
      this.send({ type: 'ack', id: alert.id, state: alert.state })
    }
  }

  private update(patch: Partial<LinkState>) {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  private send(payload: object) {
    if (this.socket?.readyState !== 1) return
    try { this.socket.send(JSON.stringify(payload)) } catch { this.socket.close() }
  }

  private retryLater() {
    this.update({ connection: 'offline' })
    this.retry = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempts++, 15_000))
  }

  private connect() {
    const credentials = this.credentials
    if (!credentials) return
    this.update({ connection: 'connecting' })
    let socket: WebSocket
    try { socket = this.openSocket() } catch { this.retryLater(); return }
    this.socket = socket
    this.heardAt = Date.now()
    socket.onopen = () => {
      if (socket === this.socket) this.send({ type: 'auth', token: credentials.token })
    }
    socket.onmessage = (event) => {
      if (socket !== this.socket) return
      let message: ServerEvent
      try { message = JSON.parse(event.data) } catch { return }
      this.heardAt = Date.now()
      if (message.type === 'error') {
        this.update({ error: message.code })
        return
      }
      if (message.type !== 'snapshot') return
      const reconnected = this.state.connection !== 'connected'
      for (const alert of message.alerts) {
        const pending = this.outbox.get(alert.id)
        if (pending && priority[alert.state] >= priority[pending.state]) this.outbox.delete(alert.id)
      }
      this.attempts = 0
      this.update({ snapshot: message, connection: 'connected', error: '', pending: this.outbox.size })
      if (reconnected && credentials.role === 'elder') {
        if (this.protection) this.send({ type: 'status', protection: this.protection })
        for (const alert of this.outbox.values()) this.send({ type: 'publish', ...alert })
      }
    }
    socket.onclose = (event) => {
      if (socket !== this.socket) return
      this.socket = undefined
      clearInterval(this.heartbeat)
      if (event.code === 4401) {
        this.credentials = undefined
        this.outbox.clear()
        this.update({ connection: 'revoked', snapshot: null, pending: 0 })
      } else this.retryLater()
    }
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.heardAt >= 25_000) socket.close()
      else this.send({ type: 'ping' })
    }, 10_000)
  }
}

export function useFamilyLink() {
  const [credentials, setCredentials] = useState(readCredentials)
  const [state, setState] = useState(initial)
  const link = useMemo(() => new FamilyLink(setState), [])
  useEffect(() => {
    link.start(credentials)
    return () => link.stop()
  }, [credentials, link])
  function setDevice(device: Credentials | null) {
    const stored = storeCredentials(device)
    setCredentials(device)
    return stored
  }
  return { state, credentials, setDevice, link }
}

export function alertId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')
}
