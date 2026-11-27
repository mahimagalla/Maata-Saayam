import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { App } from './App'
import { checkHealth } from './health'
import { browserSpeechProvider } from './speech/browserSpeech'
import { SpeechLab } from './speech/SpeechLab'

test('renders three navigation targets and a connection status', () => {
  const html = renderToStaticMarkup(<App />)
  for (const id of ['elder', 'family', 'demo']) {
    expect(html).toContain(`href="#${id}"`)
    expect(html).toContain(`id="${id}"`)
  }
  expect(html).toContain('role="status"')
  expect(html).toContain('lang="te"')
  expect(html).toContain('href="?view=speech-lab"')
  expect(html).toContain('href="?view=live-guardian"')
  expect(html).toContain('href="?view=family-setup"')
  expect(html).toContain('href="?view=family-guardian&amp;device=elder"')
})

test('Live Guardian exposes elder pairing and the deep link opens the Telugu code form', () => {
  const location = { search: '?view=live-guardian' }
  vi.stubGlobal('window', { location })
  try {
    const live = renderToStaticMarkup(<App />)
    expect(live).toContain('కుటుంబ పరికరం జత')
    expect(live).toContain('href="?view=family-guardian&amp;device=elder"')
    expect(live).toContain('కుటుంబ సహాయం')
    location.search = '?view=family-guardian&device=elder'
    const pairing = renderToStaticMarkup(<App />)
    expect(pairing).toContain('id="pair-code"')
    expect(pairing).toContain('కుటుంబ పేరును చూడండి')
    expect(pairing).not.toContain('Generate pairing code')
  } finally {
    vi.unstubAllGlobals()
  }
})

test('Speech Lab exposes three languages and a fallback when recognition is unavailable', () => {
  const html = renderToStaticMarkup(<SpeechLab provider={browserSpeechProvider(undefined)} />)
  for (const locale of ['te-IN', 'hi-IN', 'en-IN']) {
    expect(html).toContain(`value="${locale}"`)
  }
  expect(html).toContain('This browser does not expose speech recognition.')
  expect(html).toContain('Sample transcript')
  expect(html).toContain('disabled="">Start microphone')
})

test('only accepts a successful health response with the expected status', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: 'ok' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: 'unknown' }))
    .mockRejectedValueOnce(new TypeError('Connection failed'))
  vi.stubGlobal('fetch', fetch)
  const { signal } = new AbortController()

  try {
    await expect(checkHealth(signal)).resolves.toBe(true)
    await expect(checkHealth(signal)).resolves.toBe(false)
    await expect(checkHealth(signal)).resolves.toBe(false)
    await expect(checkHealth(signal)).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/health', { signal, cache: 'no-store' })
  } finally {
    vi.unstubAllGlobals()
  }
})
