export async function checkHealth(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { signal, cache: 'no-store' })
    if (!response.ok) return false

    const body = await response.json()
    return body?.status === 'ok'
  } catch {
    return false
  }
}
