import { useCallback, useEffect, useRef, useState } from 'react'
import { QUOTES } from '../lib/quotes'
import { EASE, reducedMotion } from '../lib/motion'
import { Icon, PressedFlower } from './Art'
import { Butterflies, DIARY_FLOWERS, Flowerbed } from './Whimsy'
import { PinPanel } from './PinGate'
import { DiaryCoverArt } from './DiaryCoverArt'
import { sfx } from '../lib/sound'

type Phase = 'closed' | 'pin' | 'unlocking' | 'open' | 'turning' | 'gone'

/**
 * The front door: a locked diary. Tap the heart lock → (PIN) → the lock clicks
 * open, the cover swings away, and she swipes the first page to step inside.
 * The shelves are already rendered underneath, so the turning page reveals them.
 */
export function DiaryGate({
  pinMode,
  libraryReady,
  onUnlocked,
  onDone,
}: {
  /** Which PIN step is needed, or null when the library is already hers on this device. */
  pinMode: 'enter' | 'lock' | 'recovery' | null
  /** The shelves behind the diary are loaded — only then may the diary dissolve into them. */
  libraryReady: boolean
  onUnlocked: () => void
  onDone: () => void
}) {
  const readyRef = useRef(libraryReady)
  readyRef.current = libraryReady
  const [waiting, setWaiting] = useState(false)
  const [phase, setPhase] = useState<Phase>(pinMode === 'recovery' ? 'pin' : 'closed')
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)])
  const lockRef = useRef<HTMLButtonElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const turnBtn = useRef<HTMLButtonElement>(null)
  const reduced = reducedMotion()

  useEffect(() => {
    if (phase === 'closed') lockRef.current?.focus()
    if (phase === 'open') turnBtn.current?.focus({ preventScroll: true })
  }, [phase])

  const open = useCallback(() => {
    // The lock clicks, then a halo of bells as the cover swings open.
    sfx.unlockClick()
    window.setTimeout(() => sfx.halo(), 180)
    setPhase('unlocking')
    window.setTimeout(() => setPhase('open'), reduced ? 0 : 620)
  }, [reduced])

  const tapLock = () => {
    if (phase !== 'closed') return
    if (pinMode) setPhase('pin')
    else open()
  }

  /* ---------- turning the page ---------- */

  const angle = useRef(0)
  const drag = useRef<{ x: number; t: number; w: number } | undefined>(undefined)

  const setAngle = (a: number) => {
    angle.current = a
    const el = pageRef.current
    if (el) el.style.transform = `perspective(1600px) rotateY(${a}deg)`
  }

  // The page lifts and, in the same motion, the diary dissolves into the library behind it.
  const finishTurn = useCallback(() => {
    if (phase === 'turning' || phase === 'gone') return
    // Never dissolve into a half-loaded page: hold the page until the shelves are ready.
    if (!readyRef.current) {
      setWaiting(true)
      return
    }
    setWaiting(false)
    setPhase('gone')
    sfx.pageTurn()
    const el = pageRef.current
    const from = angle.current
    window.setTimeout(onDone, reduced ? 0 : 700)
    if (!el || reduced) return
    el.animate(
      [{ transform: `perspective(1600px) rotateY(${from}deg)` }, { transform: 'perspective(1600px) rotateY(-120deg)' }],
      { duration: 650, easing: EASE, fill: 'forwards' },
    )
  }, [phase, onDone, reduced])

  // The shelves finished loading while she waited: carry on with the turn.
  useEffect(() => {
    if (waiting && libraryReady) finishTurn()
  }, [waiting, libraryReady, finishTurn])

  const springBack = () => {
    const el = pageRef.current
    if (!el) return
    const from = angle.current
    el.animate(
      [{ transform: `perspective(1600px) rotateY(${from}deg)` }, { transform: 'perspective(1600px) rotateY(0deg)' }],
      { duration: 380, easing: EASE },
    )
    setAngle(0)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase !== 'open' || (e.target as Element).closest('button')) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* fine without capture */
    }
    drag.current = { x: e.clientX, t: performance.now(), w: (e.currentTarget as HTMLElement).getBoundingClientRect().width }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = Math.min(0, e.clientX - d.x)
    // The page follows the finger: a full page-width drag is a full turn.
    setAngle(Math.max(-178, (dx / d.w) * 180))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = undefined
    if (!d) return
    const dx = e.clientX - d.x
    const velocity = dx / Math.max(1, performance.now() - d.t) // px per ms
    if (angle.current < -55 || velocity < -0.45) finishTurn()
    else if (Math.abs(dx) < 6) finishTurn() // a simple tap/click turns it too
    else springBack()
  }

  useEffect(() => {
    if (phase !== 'open') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        finishTurn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, finishTurn])

  return (
    <div className={`diary-scene phase-${phase}`} role="dialog" aria-modal="true" aria-label="The library diary">
      <div className="diary-sparkles" aria-hidden>
        {Array.from({ length: 16 }).map((_, i) => (
          <span key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, animationDelay: `${(i % 7) * 0.4}s` }} />
        ))}
      </div>
      <Butterflies count={7} className="behind" />
      <Flowerbed spots={DIARY_FLOWERS} />

      <div className="diary">
        <div
          className="diary-page"
          ref={pageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={springBack}
        >
          <div className="diary-page-front">
            <p className="diary-hello">Hi, reader.</p>
            <p className="diary-quote">“{quote.text}”</p>
            {quote.by && <p className="diary-by">— {quote.by}</p>}
            <div className="swipe-hint" aria-hidden>
              <span className="swipe-hand" />
              <span>{waiting ? 'dusting the shelves…' : 'swipe to turn the page'}</span>
            </div>
            <button ref={turnBtn} className="diary-turn" onClick={finishTurn} tabIndex={phase === 'open' ? 0 : -1} aria-label="Turn the page and enter the library">
              <Icon name="chevR" size={22} />
            </button>
            <span className="diary-pressed" aria-hidden>
              <PressedFlower kind="lavender" size={34} />
            </span>
            <span className="page-curl" aria-hidden />
          </div>
          <div className="diary-page-back" aria-hidden />
        </div>

        <div className="diary-cover" aria-hidden={phase !== 'closed' && phase !== 'pin'}>
          <DiaryCoverArt />
          <div className="diary-cover-title">
            <p className="diary-kicker">welcome to</p>
            <h1 className="diary-name">
              Virtual
              <br />
              Library
            </h1>
          </div>
          <span className="diary-ribbon" aria-hidden />
          {/* inside of the cover: a floral endpaper with a tiny bookplate */}
          <div className="diary-cover-back" aria-hidden>
            <div className="bookplate">
              <span>ex libris</span>
              <strong>Virtual Library</strong>
            </div>
          </div>
          <div className="diary-strap">
            <button ref={lockRef} className="diary-lock" onClick={tapLock} aria-label="Open the diary" disabled={phase !== 'closed'}>
              <svg viewBox="0 0 40 44" aria-hidden>
                <path className="shackle" d="M12 20 V13 a8 8 0 0 1 16 0 V20" fill="none" stroke="#e8c77a" strokeWidth="4" strokeLinecap="round" />
                <path d="M20 41 C8 33 4 27 6 22 C8 17 14 17 20 22 C26 17 32 17 34 22 C36 27 32 33 20 41z" fill="#e8c77a" stroke="#b8924a" strokeWidth="1.5" />
                <circle cx="20" cy="27" r="2.4" fill="#7a5a26" />
                <path d="M20 28 v5" stroke="#7a5a26" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            {/* a little speech bubble pointing at the lock, so she knows where to tap */}
            {phase === 'closed' && (
              <span className="lock-bubble" aria-hidden>
                Tap the heart lock to open 💜
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="diary-below">
        {phase === 'closed' && <p className="diary-hint">Unlock the library for some shelf-care. 🔓📚</p>}
        {phase === 'pin' && pinMode && (
          <PinPanel
            initial={pinMode}
            onUnlocked={() => {
              onUnlocked()
              open()
            }}
          />
        )}
      </div>
    </div>
  )
}
