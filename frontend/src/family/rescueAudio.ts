import { playAudio } from '../guardian/warningAudio'
import type { FamilyVoice } from './familyVoiceStore'

export const exampleFamilyMessage = 'అమ్మా, ఫోన్ పెట్టేయ్. ఇది మోసం కావచ్చు. భయపడకు, నేను నీకు ఇప్పుడే ఫోన్ చేస్తాను.'
export const fallbackMessage = 'భయపడకండి. అనుమానం ఉంటే ఫోన్ పెట్టేయండి. మీకు నమ్మకమైన కుటుంబ సభ్యుడికి మీరే ఫోన్ చేయండి.'

export async function playFamilyRescue(
  voice: FamilyVoice | null,
  signal: AbortSignal,
  fallback: () => void,
  ring: boolean,
) {
  if (signal.aborted) return
  if (ring) {
    try {
      await playAudio('/audio/family-rescue-ring.wav', signal)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error
      // A missing ringtone should not prevent the safety message.
    }
  }
  if (signal.aborted) return
  if (voice) {
    try {
      await playVoiceClip(voice.audio, signal)
      return
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw error
      fallback()
    }
  }
  await playAudio('/audio/family-rescue-fallback.wav', signal)
}

export async function playVoiceClip(clip: Blob, signal: AbortSignal) {
  if (signal.aborted) return
  const url = URL.createObjectURL(clip)
  try {
    await playAudio(url, signal, clip.type)
  } finally {
    URL.revokeObjectURL(url)
  }
}
