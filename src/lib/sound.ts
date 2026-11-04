/**
 * Little sounds, made on the fly with Web Audio (no sound files to download):
 * a paper rustle for page turns, a soft thump-and-chime for opening a book, a
 * click and a halo of bells for unlocking the diary, and tiny glitter bells.
 * Everything is quiet by design, and she can switch it all off from the menu.
 */
const KEY = 'library:sound'
const listeners = new Set<(on: boolean) => void>()

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* not remembered — fine */
  }
  listeners.forEach((l) => l(on))
  if (on) sfx.sparkle()
}
/** 0..1, remembered on this device. */
const VOLUME_KEY = 'library:volume'
export function soundVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7
  } catch {
    return 0.7
  }
}
export function setSoundVolume(v: number) {
  const vol = Math.min(1, Math.max(0, v))
  try {
    localStorage.setItem(VOLUME_KEY, String(vol))
  } catch {
    /* not remembered — fine */
  }
  if (out && ctx) out.gain.setTargetAtTime(MASTER * vol, ctx.currentTime, 0.02)
}

export function onSoundChange(l: (on: boolean) => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

let ctx: AudioContext | undefined
let out: GainNode | undefined
const MASTER = 0.8
let noise: AudioBuffer | undefined

/** The audio context, only when sound is on (and only after she has tapped something). */
function audio() {
  if (!soundOn() || typeof AudioContext === 'undefined') return
  try {
    if (!ctx) {
      ctx = new AudioContext()
      out = ctx.createGain()
      out.gain.value = MASTER * soundVolume()
      // a gentle limiter so overlapping sparkles never get harsh
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 6
      out.connect(comp).connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return undefined
  }
}

/**
 * Start the audio engine on her first touch, before any sound is needed — creating it is
 * slow on phones, and doing it during the first book-open made that tap feel laggy.
 */
export function warmAudio() {
  const c = audio()
  if (!c) return
  // The paper-rustle noise is ~50k random samples: build it when the phone is idle, not mid-tap.
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => noiseBuffer(c), { timeout: 3000 })
  else setTimeout(() => noiseBuffer(c), 1200)
}

function noiseBuffer(c: AudioContext) {
  if (noise) return noise
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}

/** One bell-like note: a sine with a soft overtone, quick attack, long fade. */
function bell(c: AudioContext, freq: number, at: number, dur = 1.2, vol = 0.12) {
  for (const [mult, v] of [[1, 1], [2.01, 0.25], [3.98, 0.08]] as const) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.value = freq * mult
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(vol * v, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur * (mult === 1 ? 1 : 0.5))
    o.connect(g).connect(out!)
    o.start(at)
    o.stop(at + dur + 0.05)
  }
}

/** A burst of filtered noise — paper, a click, a breath. */
function hiss(c: AudioContext, at: number, dur: number, from: number, to: number, vol: number, q = 0.9) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = q
  bp.frequency.setValueAtTime(from, at)
  bp.frequency.exponentialRampToValueAtTime(to, at + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(vol, at + dur * 0.18)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(bp).connect(g).connect(out!)
  src.start(at, Math.random() * 0.5)
  src.stop(at + dur + 0.05)
}

/** A soft low knock, like a book set down on wood. */
function thump(c: AudioContext, at: number, vol = 0.25) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, at)
  o.frequency.exponentialRampToValueAtTime(60, at + 0.14)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(vol, at + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
  o.connect(g).connect(out!)
  o.start(at)
  o.stop(at + 0.2)
}

// A dreamy pentatonic scale, so random sparkles always sound pretty together.
const SPARKLE_NOTES = [1568, 1760, 2093, 2349, 2637, 3136, 3520]
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export const sfx = {
  /** Paper sliding over paper, then settling. */
  pageTurn() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    hiss(c, t, 0.28, 2600, 900, 0.32)
    hiss(c, t + 0.12, 0.22, 4200, 1800, 0.12, 1.4)
    hiss(c, t + 0.26, 0.09, 700, 300, 0.1, 0.7)
  },
  /** A book lifted off the shelf: a soft knock and a little rising chime. */
  bookOpen() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    thump(c, t, 0.2)
    hiss(c, t, 0.18, 1800, 700, 0.08)
    ;[1047, 1319, 1568, 2093].forEach((f, i) => bell(c, f, t + 0.06 + i * 0.055, 0.9, 0.06))
  },
  /** Back onto the shelf: a gentle falling chime and a soft knock. */
  bookClose() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    ;[1568, 1319].forEach((f, i) => bell(c, f, t + i * 0.06, 0.6, 0.045))
    thump(c, t + 0.32, 0.14)
  },
  /** The diary's little lock clicking open. */
  unlockClick() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    hiss(c, t, 0.035, 5200, 3000, 0.35, 2.5)
    hiss(c, t + 0.07, 0.05, 3800, 2000, 0.28, 2.5)
  },
  /** A halo of bells as the diary opens. */
  halo() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.02
    // a slow-blooming chord underneath…
    for (const f of [523, 659, 784, 988]) {
      const o = c.createOscillator()
      const o2 = c.createOscillator()
      const g = c.createGain()
      o.type = o2.type = 'sine'
      o.frequency.value = f
      o2.frequency.value = f * 1.003 // a slight detune, for shimmer
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.035, t + 0.5)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
      o.connect(g)
      o2.connect(g)
      g.connect(out!)
      o.start(t)
      o2.start(t)
      o.stop(t + 2.7)
      o2.stop(t + 2.7)
    }
    // …with bells twinkling up over it
    ;[1047, 1319, 1568, 2093, 2637, 3136].forEach((f, i) => bell(c, f, t + 0.1 + i * 0.09, 1.4, 0.05))
  },
  /** A wrong PIN: two soft low notes. */
  nope() {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    bell(c, 392, t, 0.35, 0.07)
    bell(c, 330, t + 0.12, 0.45, 0.07)
  },
  /** Tiny glitter bells. */
  sparkle(count = 4) {
    const c = audio()
    if (!c) return
    const t = c.currentTime + 0.01
    for (let i = 0; i < count; i++) bell(c, pick(SPARKLE_NOTES), t + i * 0.035 + Math.random() * 0.02, 0.5, 0.035)
  },
  /** A soft tick for small buttons (keypad, tools). */
  tap() {
    const c = audio()
    if (!c) return
    hiss(c, c.currentTime + 0.005, 0.03, 3000, 2200, 0.12, 3)
  },
}
