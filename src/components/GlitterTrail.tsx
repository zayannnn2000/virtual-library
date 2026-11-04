import { useEffect, useRef } from 'react'
import { sfx } from '../lib/sound'

const COLORS = ['#c8b4e6', '#f6b3cc', '#f3cf6b', '#ffffff', '#b29ad6']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  max: number
  color: string
  spin: number
  star: boolean
}

/**
 * A soft trail of glitter and tiny four-point stars behind the mouse.
 * Off for touch screens and reduced-motion; it only animates while there
 * are sparkles left, so it costs nothing when the mouse is still.
 */
/** Set while a GlitterTrail is mounted: throws a puff of glitter at a screen point. */
let burstAt: ((x: number, y: number, count?: number) => void) | undefined
/** `sound: false` for sparkles that go with their own sound (opening a book) or none (hover). */
export function sparkleBurst(x: number, y: number, count = 30, sound = true) {
  burstAt?.(x, y, count)
  if (sound) sfx.sparkle(count > 20 ? 5 : 3)
}

export function GlitterTrail() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    // The trail follows a mouse; bursts (tapping butterflies and flowers) work on touch too.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (reduced.matches) return
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const particles: Particle[] = []
    let raf = 0
    let last = { x: -1, y: -1 }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      c.width = innerWidth * dpr
      c.height = innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const drawStar = (p: Particle, alpha: number) => {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.spin)
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = 6
      const s = p.size * (0.6 + alpha * 0.4)
      if (p.star) {
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0)
        ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s)
        ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0)
        ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s)
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life++
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.035
        p.spin += 0.05
        const alpha = 1 - p.life / p.max
        if (alpha <= 0) particles.splice(i, 1)
        else drawStar(p, alpha * (0.75 + Math.sin(p.life * 0.5) * 0.25))
      }
      raf = particles.length ? requestAnimationFrame(tick) : 0
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const dist = Math.hypot(e.clientX - last.x, e.clientY - last.y)
      if (dist < 6) return
      last = { x: e.clientX, y: e.clientY }
      const n = Math.min(3, 1 + Math.floor(dist / 25))
      for (let i = 0; i < n && particles.length < 90; i++) {
        particles.push({
          x: e.clientX + (Math.random() - 0.5) * 8,
          y: e.clientY + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 0.8,
          vy: Math.random() * 0.4 - 0.2,
          size: 2.5 + Math.random() * 4.5,
          life: 0,
          max: 34 + Math.random() * 26,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          spin: Math.random() * Math.PI,
          star: Math.random() < 0.55,
        })
      }
      if (!raf) raf = requestAnimationFrame(tick)
    }

    // A burst: glitter flung outward in a soft ring, then drifting down.
    burstAt = (x, y, count = 30) => {
      for (let i = 0; i < count && particles.length < 220; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
        const speed = 1.2 + Math.random() * 2.6
        particles.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 1.2,
          size: 3 + Math.random() * 5,
          life: 0,
          max: 48 + Math.random() * 30,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          spin: Math.random() * Math.PI,
          star: Math.random() < 0.6,
        })
      }
      if (!raf) raf = requestAnimationFrame(tick)
    }

    if (finePointer) window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      burstAt = undefined
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvas} className="glitter-trail" aria-hidden />
}
