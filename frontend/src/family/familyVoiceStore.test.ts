import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { deleteFamilyVoice, readFamilyVoice, saveFamilyVoice } from './familyVoiceStore'

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

test('commits, retrieves, replaces, and deletes a single locally saved voice', async () => {
  expect(await readFamilyVoice()).toBeNull()
  const voice = { displayName: 'అబ్బాయి', message: 'అమ్మా, భయపడకు.', audio: new Blob(['old'], { type: 'audio/webm' }) }
  await saveFamilyVoice(voice)
  const first = await readFamilyVoice()
  expect(first?.displayName).toBe(voice.displayName)
  expect(await first?.audio.text()).toBe('old')
  await saveFamilyVoice({ ...voice, message: 'అమ్మా, ఫోన్ పెట్టేయ్.', audio: new Blob(['new'], { type: 'audio/mp4' }) })
  const next = await readFamilyVoice()
  expect(next?.audio.type).toBe('audio/mp4')
  expect(await next?.audio.text()).toBe('new')
  await deleteFamilyVoice()
  expect(await readFamilyVoice()).toBeNull()
})

test('rejects an empty recording and detects unavailable local storage', async () => {
  await expect(saveFamilyVoice({ displayName: 'అబ్బాయి', message: 'Hello', audio: new Blob() })).rejects.toThrow()
  vi.stubGlobal('indexedDB', undefined)
  await expect(readFamilyVoice()).rejects.toThrow()
})
