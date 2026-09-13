/* Tiny synthesized sound engine — no audio assets, pure WebAudio.
   Respects the SOUND toggle in settings. */

import { useSettings } from '../store/settings'

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (!useSettings.getState().sound) return null
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** browsers start audio suspended until a gesture — call this on pointerdown */
export function unlockAudio() {
  const c = ac()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  try {
    // tiny silent buffer — the trick that unlocks Safari/iOS too
    const b = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = b
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* ignore */
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.05, when = 0, slideTo?: number) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + when
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export type Sfx = 'click' | 'boot' | 'coin' | 'alert' | 'launch' | 'error' | 'open' | 'win'

export function play(name: Sfx) {
  switch (name) {
    case 'click':
      // crisp two-layer terminal "tack" — clearly audible
      tone(1500, 0.035, 'square', 0.08)
      tone(380, 0.06, 'square', 0.06, 0.025)
      break
    case 'open':
      // rising blip — a program launching off the desktop
      tone(520, 0.06, 'square', 0.06)
      tone(1040, 0.09, 'square', 0.06, 0.05)
      break
    case 'boot':
      tone(120, 0.5, 'sawtooth', 0.04, 0, 880)
      tone(440, 0.12, 'square', 0.03, 0.5)
      break
    case 'coin':
      tone(988, 0.09, 'square', 0.05)
      tone(1319, 0.22, 'square', 0.05, 0.09)
      break
    case 'alert':
      tone(220, 0.1, 'square', 0.05)
      tone(220, 0.1, 'square', 0.05, 0.15)
      break
    case 'launch':
      tone(80, 1.2, 'sawtooth', 0.08, 0, 220)
      tone(110, 0.9, 'square', 0.04, 0.1, 440)
      break
    case 'win':
      tone(523, 0.12, 'square', 0.07)
      tone(659, 0.12, 'square', 0.07, 0.11)
      tone(784, 0.12, 'square', 0.07, 0.22)
      tone(1046, 0.32, 'square', 0.08, 0.34)
      tone(784, 0.2, 'square', 0.05, 0.5)
      break
    case 'error':
      tone(160, 0.18, 'sawtooth', 0.06)
      tone(110, 0.28, 'sawtooth', 0.06, 0.18)
      break
  }
}
