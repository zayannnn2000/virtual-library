/**
 * Motion helpers: Lenis smooth scrolling for the page, and a "shared element"
 * flight that carries a book's cover from the shelf to the details card and
 * back — the same idea as Stripe Press's book transitions.
 */
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- smooth scrolling ---------- */

let lenis: Lenis | null = null
let raf = 0

export function startSmoothScroll() {
  if (lenis || reducedMotion()) return
  lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 })
  const loop = (t: number) => {
    lenis?.raf(t)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
}
export function stopSmoothScroll() {
  cancelAnimationFrame(raf)
  lenis?.destroy()
  lenis = null
}
/** Freeze page scrolling while a dialog is open. */
export const pauseScroll = (paused: boolean) => (paused ? lenis?.stop() : lenis?.start())

/* ---------- cover flight ---------- */

let origin: { id: string; rect: DOMRect } | undefined

/** Remember where a book's spine sat on the shelf just before it opens. */
export function rememberOrigin(id: string, button: Element | null) {
  if (!button) return
  const rect = button.querySelector('.face.spine')?.getBoundingClientRect()
  if (rect && rect.width > 0) origin = { id, rect }
}
export function takeOrigin(id: string) {
  const o = origin?.id === id ? origin.rect : undefined
  origin = undefined
  return o
}
/** Where the book sits on the shelf right now (for the flight home). */
export function shelfRect(id: string) {
  const el = document.querySelector(`[data-book="${CSS.escape(id)}"] .face.spine`)
  const r = el?.getBoundingClientRect()
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight ? r : undefined
}

/**
 * Fly a copy of `target` (the cover in the card) between the book's spine on
 * the shelf and its place in the card, the way a real book moves: the cover
 * hinges on its spine edge, so on the shelf it's turned edge-on exactly as
 * wide as the spine. At the shelf end it crossfades with the real spine, so
 * the book seems to slot in (or slide out) with no flash or leftover ghost.
 * `direction: 'in'` goes shelf → card; `'out'` goes card → shelf.
 */
export async function flyCover(target: HTMLElement, shelf: DOMRect, direction: 'in' | 'out', duration = 720, bookId?: string) {
  const to = target.getBoundingClientRect()
  if (!to.width || !shelf.height) return
  const ghost = target.cloneNode(true) as HTMLElement
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: '0',
    zIndex: '400',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    willChange: 'transform, opacity',
  })
  ghost.classList.add('cover-ghost')
  document.body.appendChild(ghost)
  // Scale evenly by height so the cover is never squashed; its left (spine) edge sits on the spine.
  const s = shelf.height / to.height
  const dx = shelf.left - to.left
  const dy = shelf.top - to.top
  // Turned this far, the cover's visible width matches the spine's. It turns away from her (into the
  // shelf), so the spine edge stays exactly spine-sized and nothing swells up in perspective.
  const turn = Math.acos(Math.max(0.06, Math.min(0.95, shelf.width / (to.width * s)))) * (180 / Math.PI)
  const atShelf = `translate(${dx}px, ${dy}px) scale(${s}) perspective(${2400 / s}px) rotateY(${turn}deg)`
  const atCard = `translate(0px, 0px) scale(1) perspective(2400px) rotateY(0deg)`
  // The real book on the shelf hides while the copy is in the air, and the two swap at the shelf.
  const book = bookId ? document.querySelector<HTMLElement>(`[data-book="${CSS.escape(bookId)}"]`) : null
  // Each stretch has its own easing: the flight glides, the swap at the shelf is a quick crossfade.
  const SWAP = 0.16
  const frames: Keyframe[] =
    direction === 'in'
      ? [
          { transform: atShelf, opacity: 0, offset: 0, easing: 'linear' },
          { transform: atShelf, opacity: 1, offset: SWAP * 0.6, easing: EASE },
          { transform: atCard, opacity: 1, offset: 1 },
        ]
      : [
          { transform: atCard, opacity: 1, offset: 0, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
          { transform: atShelf, opacity: 1, offset: 1 - SWAP, easing: 'ease-in' },
          { transform: atShelf, opacity: 0, offset: 1 },
        ]
  const bookFrames: Keyframe[] =
    direction === 'in'
      ? [{ opacity: 1, offset: 0 }, { opacity: 0, offset: SWAP * 0.6 }, { opacity: 0, offset: 0.92 }, { opacity: 1, offset: 1 }]
      : [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 1 - SWAP - 0.02 }, { opacity: 1, offset: 1 }]
  // Coming home under a resting mouse, the book would spring back out on hover the moment
  // the card is gone. It stays put until the mouse moves off it.
  const wrap = direction === 'out' ? book?.closest<HTMLElement>('.book') : null
  if (wrap) {
    wrap.classList.add('settling')
    const off = (e: PointerEvent) => {
      if (wrap.contains(e.target as Node)) return
      wrap.classList.remove('settling')
      window.removeEventListener('pointermove', off)
    }
    window.setTimeout(() => window.addEventListener('pointermove', off), duration)
  }
  target.style.visibility = 'hidden'
  try {
    const flights = [ghost.animate(frames, { duration, easing: 'linear', fill: 'forwards' })]
    if (book) flights.push(book.animate(bookFrames, { duration, easing: 'linear' }))
    await Promise.all(flights.map((a) => a.finished))
  } catch {
    /* interrupted — fine */
  } finally {
    ghost.remove()
    target.style.visibility = ''
  }
}
