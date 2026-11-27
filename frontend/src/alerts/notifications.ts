import type { FamilyAlert } from './familyLink'

export class AlertNotifications {
  private known = new Map<string, FamilyAlert['state']>()
  private initialized = false

  update(alerts: FamilyAlert[]) {
    const newest = alerts.find((alert) => !alert.acknowledged_at &&
      (!this.known.has(alert.id) || this.known.get(alert.id) !== alert.state))
    const audible = newest !== undefined && !this.known.has(newest.id)
    for (const alert of alerts) this.known.set(alert.id, alert.state)
    while (this.known.size > 256) this.known.delete(this.known.keys().next().value!)
    const notify = this.initialized
    this.initialized = true
    return notify && newest ? { alert: newest, audible } : undefined
  }
}
