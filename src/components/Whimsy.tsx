import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { sparkleBurst } from './GlitterTrail'
import { reducedMotion } from '../lib/motion'
import type { FlowerKind } from '../types'
import { PressedFlower } from './Art'

/* ---------- butterflies ---------- */

const WINGS = [
  { top: '#c8b4e6', bottom: '#e3a8d0', dots: '#fff7d6' },
  { top: '#f6b3cc', bottom: '#f9d3e0', dots: '#ffffff' },
  { top: '#a9cfe6', bottom: '#c8b4e6', dots: '#fff7d6' },
  { top: '#f3d98a', bottom: '#f6b3cc', dots: '#ffffff' },
  { top: '#b29ad6', bottom: '#a9cfe6', dots: '#fff7d6' },
]

function ButterflySvg({ palette }: { palette: (typeof WINGS)[number] }) {
  return (
    <svg viewBox="0 0 60 48" aria-hidden>
      <g className="wing left">
        <path d="M30 22 C22 4 6 0 4 10 C2 20 14 26 30 24z" fill={palette.top} />
        <path d="M30 25 C20 26 10 34 14 42 C18 48 27 38 30 27z" fill={palette.bottom} />
        <circle cx="13" cy="12" r="2.2" fill={palette.dots} opacity="0.9" />
        <circle cx="18" cy="36" r="1.6" fill={palette.dots} opacity="0.9" />
      </g>
      <g className="wing right">
        <path d="M30 22 C38 4 54 0 56 10 C58 20 46 26 30 24z" fill={palette.top} />
        <path d="M30 25 C40 26 50 34 46 42 C42 48 33 38 30 27z" fill={palette.bottom} />
        <circle cx="47" cy="12" r="2.2" fill={palette.dots} opacity="0.9" />
        <circle cx="42" cy="36" r="1.6" fill={palette.dots} opacity="0.9" />
      </g>
      <path d="M30 14 V36" stroke="#4a3263" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M30 14 C28 9 25 7 23 6 M30 14 C32 9 35 7 37 6" stroke="#4a3263" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  )
}

interface Flyer {
  x: number
  y: number
  vx: number
  vy: number
  tx: number
  ty: number
  speed: number
  startled: number
  phase: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * Butterflies that wander on soft, steering paths. Tap one and it puffs glitter
 * and darts away. They live behind the main content so they never block it.
 */
export function Butterflies({ count, className = '' }: { count: number; className?: string }) {
  const els = useRef<(HTMLButtonElement | null)[]>([])
  const [palettes] = useState(() => Array.from({ length: count }, (_, i) => WINGS[i % WINGS.length]))
  const [sizes] = useState(() => Array.from({ length: count }, () => Math.round(rand(30, 50))))
  const flyers = useRef<Flyer[]>([])

  useEffect(() => {
    const W = () => innerWidth
    const H = () => innerHeight
    const pick = (f: Flyer, far = false) => {
      const m = 30
      let tx = rand(m, W() - m)
      let ty = rand(m, H() - m)
      if (far) {
        // dart to the other side of the screen
        tx = f.x < W() / 2 ? rand(W() * 0.6, W() - m) : rand(m, W() * 0.4)
        ty = rand(m, H() - m)
      }
      f.tx = tx
      f.ty = ty
    }
    flyers.current = Array.from({ length: count }, () => {
      const f: Flyer = { x: rand(40, W() - 40), y: rand(40, H() - 40), vx: 0, vy: 0, tx: 0, ty: 0, speed: rand(0.6, 1.1), startled: 0, phase: rand(0, 100) }
      pick(f)
      return f
    })

    const place = () =>
      flyers.current.forEach((f, i) => {
        const el = els.current[i]
        if (!el) return
        const tilt = Math.max(-25, Math.min(25, f.vx * 9))
        const flip = f.vx < -0.05 ? -1 : 1
        el.style.transform = `translate3d(${f.x - sizes[i] / 2}px, ${f.y - sizes[i] / 2}px, 0) rotate(${tilt}deg) scaleX(${flip})`
      })

    if (reducedMotion()) {
      place()
      return
    }

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.7)
      last = now
      // Hold still behind an open dialog, so the book opening gets every frame.
      if (document.documentElement.classList.contains('dialog-open')) {
        raf = requestAnimationFrame(tick)
        return
      }
      for (const f of flyers.current) {
        f.phase += 0.03 * dt
        const dx = f.tx - f.x
        const dy = f.ty - f.y
        const dist = Math.hypot(dx, dy)
        if (dist < 40 || Math.random() < 0.002 * dt) pick(f)
        const boost = f.startled > 0 ? 3.2 : 1
        f.startled = Math.max(0, f.startled - dt)
        const s = f.speed * boost
        // steer gently toward the target, with a little flutter wobble
        f.vx += ((dx / (dist || 1)) * s - f.vx) * 0.03 * dt + Math.sin(f.phase * 3) * 0.04
        f.vy += ((dy / (dist || 1)) * s - f.vy) * 0.03 * dt + Math.cos(f.phase * 2.3) * 0.05
        f.x += f.vx * dt
        f.y += f.vy * dt + Math.sin(f.phase * 6) * 0.35
        f.x = Math.max(10, Math.min(W() - 10, f.x))
        f.y = Math.max(10, Math.min(H() - 10, f.y))
      }
      place()
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start())
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [count, sizes])

  const startle = (i: number) => {
    const f = flyers.current[i]
    if (!f) return
    sparkleBurst(f.x, f.y, 26)
    f.startled = 70
    const W = innerWidth
    f.tx = f.x < W / 2 ? rand(W * 0.6, W - 30) : rand(30, W * 0.4)
    f.ty = rand(30, innerHeight - 30)
    const el = els.current[i]
    el?.classList.remove('startled')
    void el?.offsetWidth
    el?.classList.add('startled')
  }

  return (
    <div className={`butterflies ${className}`} aria-hidden>
      {palettes.map((p, i) => (
        <button
          key={i}
          ref={(el) => {
            els.current[i] = el
          }}
          className="butterfly"
          style={{ width: sizes[i], height: sizes[i] * 0.8, ['--flap' as string]: `${rand(0.22, 0.34)}s` } as CSSProperties}
          tabIndex={-1}
          onPointerDown={(e) => {
            e.stopPropagation()
            startle(i)
          }}
        >
          <ButterflySvg palette={p} />
        </button>
      ))}
    </div>
  )
}

/* ---------- swaying flowers ---------- */

export interface FlowerSpot {
  kind: FlowerKind
  left: string
  bottom: string
  size: number
  tilt?: number
}

/** Flowers growing along the edges, swaying in a breeze; tap one for a glitter pop and falling petals. */
export function Flowerbed({ spots, className = '' }: { spots: FlowerSpot[]; className?: string }) {
  const pop = (e: React.PointerEvent<HTMLButtonElement>, kind: FlowerKind) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height * 0.22
    sparkleBurst(x, y, 34)
    el.classList.remove('popped')
    void el.offsetWidth
    el.classList.add('popped')
    if (reducedMotion()) return
    const color = { lavender: '#b29ad6', forgetmenot: '#9fbbe8', blossom: '#f2a9c4' }[kind]
    for (let i = 0; i < 5; i++) {
      const petal = document.createElement('span')
      petal.className = 'petal'
      petal.style.left = `${x}px`
      petal.style.top = `${y}px`
      petal.style.background = color
      document.body.appendChild(petal)
      const dx = rand(-70, 70)
      const dy = rand(90, 180)
      petal
        .animate(
          [
            { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.4}px) rotate(${rand(90, 200)}deg)`, opacity: 1, offset: 0.4 },
            { transform: `translate(${dx}px, ${dy}px) rotate(${rand(240, 420)}deg)`, opacity: 0 },
          ],
          { duration: rand(1300, 2000), easing: 'cubic-bezier(0.3, 0.2, 0.4, 1)' },
        )
        .finished.finally(() => petal.remove())
    }
  }

  return (
    <div className={`flowerbed ${className}`} aria-hidden>
      {spots.map((s, i) => (
        <button
          key={i}
          className="flower"
          tabIndex={-1}
          style={{ left: s.left, bottom: s.bottom, ['--tilt' as string]: `${s.tilt ?? 0}deg`, ['--sway' as string]: `${rand(3.2, 5.4)}s`, animationDelay: `${-rand(0, 4)}s` } as CSSProperties}
          onPointerDown={(e) => {
            e.stopPropagation()
            pop(e, s.kind)
          }}
        >
          <PressedFlower kind={s.kind} size={s.size} />
        </button>
      ))}
    </div>
  )
}

/** The front-door garden around the diary. */
export const DIARY_FLOWERS: FlowerSpot[] = [
  { kind: 'lavender', left: '3%', bottom: '-6px', size: 46, tilt: -8 },
  { kind: 'blossom', left: '8%', bottom: '-10px', size: 52, tilt: 4 },
  { kind: 'forgetmenot', left: '13%', bottom: '-8px', size: 40, tilt: -3 },
  { kind: 'lavender', left: '18%', bottom: '-12px', size: 38, tilt: 9 },
  { kind: 'blossom', left: '76%', bottom: '-10px', size: 44, tilt: -6 },
  { kind: 'lavender', left: '82%', bottom: '-6px', size: 52, tilt: 5 },
  { kind: 'forgetmenot', left: '88%', bottom: '-10px', size: 46, tilt: -4 },
  { kind: 'blossom', left: '93%', bottom: '-8px', size: 38, tilt: 8 },
]
