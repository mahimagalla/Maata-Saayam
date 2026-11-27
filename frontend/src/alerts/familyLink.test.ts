import { afterEach, expect, test, vi } from 'vitest'
import { FamilyLink, type FamilyAlert, type Snapshot } from './familyLink'
import { AlertNotifications } from './notifications'

class Socket {
  readyState = 0
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number }) => void
  send = vi.fn<(data: string) => void>()
  open() { this.readyState = 1; this.onopen?.() }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
  close(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

const snapshot: Snapshot = {
  type: 'snapshot', paired: true, family_name: 'అబ్బాయి', elder_name: 'అమ్మ',
  phone: null, peer_online: false, protection: 'listening', alerts: [],
}
const notice = { id: 'a'.repeat(32), category: 'legal_threat', state: 'warning' } as const
const alert: FamilyAlert = {
  ...notice, timestamp: '2026-11-27T00:00:00Z', elder_name: 'అమ్మ', explanation: 'Legal threat', acknowledged_at: null,
}

function setup() {
  vi.useFakeTimers()
  const sockets: Socket[] = []
  const link = new FamilyLink(vi.fn(), () => {
    const socket = new Socket()
    sockets.push(socket)
    return socket as unknown as WebSocket
  })
  return { link, sockets }
}

afterEach(() => vi.useRealTimers())

test('keeps unconfirmed alerts queued, resends on reconnect, and clears on server confirmation', async () => {
  const { link, sockets } = setup()
  link.start({ role: 'elder', token: 'test credential' })
  link.setProtection('warning')
  sockets[0].open()
  expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toEqual({ type: 'auth', token: 'test credential' })
  sockets[0].receive(snapshot)
  expect(sockets[0].send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'status', protection: 'warning' }))
  sockets[0].close()
  link.publish(notice)
  link.publish(notice)
  expect(link.state).toMatchObject({ connection: 'offline', pending: 1 })
  await vi.advanceTimersByTimeAsync(1000)
  sockets[1].open()
  sockets[1].receive(snapshot)
  expect(sockets[1].send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'publish', ...notice }))
  expect(link.state.pending).toBe(1)
  sockets[1].receive({ ...snapshot, alerts: [alert] })
  expect(link.state).toMatchObject({ connection: 'connected', pending: 0, snapshot: { peer_online: false } })
  sockets[1].receive({ ...snapshot, alerts: [{ ...alert, acknowledged_at: alert.timestamp }] })
  expect(link.state.snapshot?.alerts[0].acknowledged_at).toBe(alert.timestamp)
  sockets[1].close(4401)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(link.state).toMatchObject({ connection: 'revoked', snapshot: null })
  expect(sockets).toHaveLength(2)
  link.stop()
})

test('family acknowledges the actual displayed alert state and cannot publish', () => {
  const { link, sockets } = setup()
  link.start({ role: 'family', token: 'test credential' })
  sockets[0].open()
  sockets[0].receive(snapshot)
  link.publish(notice)
  expect(sockets[0].send).toHaveBeenCalledTimes(1)
  link.acknowledge(alert)
  expect(sockets[0].send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'ack', id: alert.id, state: 'warning' }))
  link.stop()
})

test('does not notify for replayed alerts, but surfaces a new alert or upgraded state', () => {
  const notifications = new AlertNotifications()
  expect(notifications.update([])).toBeUndefined()
  expect(notifications.update([alert])).toEqual({ alert, audible: true })
  expect(notifications.update([alert])).toBeUndefined()
  const upgrade = { ...alert, state: 'rescue' } as const
  expect(notifications.update([upgrade])).toEqual({ alert: upgrade, audible: false })
  expect(notifications.update([upgrade])).toBeUndefined()
})
