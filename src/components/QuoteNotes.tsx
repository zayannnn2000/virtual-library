import { useEffect, useState } from 'react'
import { QUOTES } from '../lib/quotes'
import { reducedMotion } from '../lib/motion'

type Paper = 'sticky-lilac' | 'sticky-pink' | 'sticky-cream' | 'pinned' | 'torn'
const PAPERS: Paper[] = ['sticky-pink', 'pinned', 'sticky-lilac', 'torn', 'sticky-cream']

/* One shared counter, so notes showing at the same time never repeat a quote. */
let nextQuote = Math.floor(Math.random() * QUOTES.length)
const takeQuote = () => {
  const i = nextQuote
  nextQuote = (nextQuote + 1) % QUOTES.length
  return i
}

/**
 * A spot on the page where quotes come and go as little pieces of paper — a
 * sticky note, a pinned card, a torn strip. Several spots run at once, each on
 * its own rhythm, so the page always has two or three notes. Tap one for another.
 */
export function QuoteNote({ slot, className = '' }: { slot: number; className?: string }) {
  const [note, setNote] = useState(() => ({ i: takeQuote(), paper: PAPERS[slot % PAPERS.length], leaving: false }))

  const next = () => {
    setNote((n) => ({ ...n, leaving: true }))
    window.setTimeout(() => setNote((n) => ({ i: takeQuote(), paper: PAPERS[(PAPERS.indexOf(n.paper) + 2) % PAPERS.length], leaving: false })), reducedMotion() ? 0 : 650)
  }

  useEffect(() => {
    // Staggered timings so the notes never all change together.
    const every = 12000 + slot * 3100
    const t = window.setInterval(() => !document.hidden && next(), every)
    return () => window.clearInterval(t)
  }, [slot])

  const q = QUOTES[note.i]
  const tilt = ((note.i * 7 + slot * 3) % 9) - 4
  return (
    <div className={`quote-slot slot-${slot} ${className}`}>
      <button
        key={note.i}
        className={`quote-note paper-${note.paper} ${note.leaving ? 'leaving' : ''}`}
        style={{ ['--tilt' as string]: `${tilt}deg` }}
        onClick={next}
        title="Tap for another"
      >
        <span className="quote-note-text">“{q.text}”</span>
        {q.by && <span className="quote-note-by">— {q.by}</span>}
      </button>
    </div>
  )
}
