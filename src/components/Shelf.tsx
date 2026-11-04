import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Book } from '../types'
import { updateBook } from '../db'
import { SPINE_COLOR_VERSION, clothFor, hashNumber, spineColorFromImage } from '../lib/color'
import { coverAt } from '../lib/metadata'
import { SPINE_VARIANTS, SpineBottom, SpineTop, type SpineVariant } from './SpineArt'
import { rememberOrigin } from '../lib/motion'
import { sparkleBurst } from './GlitterTrail'
import { Icon, PressedFlower } from './Art'
import { useCoverSrc } from './ui'
import { sfx } from '../lib/sound'

const STATUS_LABEL = { want: 'Want to read', reading: 'Currently reading', finished: 'Finished' } as const

export function bookLabel(b: Book) {
  return `${b.title}${b.authors.length ? ` by ${b.authors.join(', ')}` : ''}`
}

/** Spine width in px at full size — also used to pack books onto shelves. */
export function spineWidth(book: Book) {
  const pages = book.pages ?? hashNumber(book.title, 220, 460)
  return Math.round(Math.min(64, Math.max(30, pages / 9.5)))
}

const GAP = 3
/** How far books scale to fill the bookcase on a laptop (1 = normal size). */
const K_MIN = 0.55
const K_MAX = 2
const DECOR = 150 + 74 // room kept on the last shelf for the "add a book" slot and the little lying stack

/** Fill each shelf left to right; when one is full, carry on on a new shelf below. */
function packRows(books: Book[], room: number, k: number): Book[][] {
  if (!room) return [books]
  const rows: Book[][] = [[]]
  let used = 0
  for (const b of books) {
    const w = spineWidth(b) * k + GAP
    if (used + w > room && rows[rows.length - 1].length) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1].push(b)
    used += w
  }
  // Give the decorative stack its own space at the end if the last shelf is full.
  if (used + DECOR > room && rows[rows.length - 1].length > 1) {
    const last = rows[rows.length - 1]
    let free = room - used
    const moved: Book[] = []
    while (free < DECOR && last.length > 1) {
      const b = last.pop()!
      free += spineWidth(b) * k + GAP
      moved.unshift(b)
    }
    if (moved.length) rows.push(moved)
  }
  return rows
}

export function Shelf({
  header,
  emptyText,
  books,
  onOpen,
  onToggleFavorite,
  onAdd,
}: {
  header: ReactNode
  emptyText: string
  books: Book[]
  onOpen: (b: Book) => void
  onToggleFavorite: (b: Book) => void
  /** Shows an "add a book" slot at the end of the last shelf. */
  onAdd?: () => void
}) {
  const bookcase = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  // activeId = keyboard position on the shelf; pulledId = the book physically slid out.
  const [activeId, setActiveId] = useState<string>()
  const [pulledId, setPulledId] = useState<string>()
  const [hoverId, setHoverId] = useState<string>()
  const lastPointer = useRef<string>('mouse')
  // Focus coming back from the closed details shouldn't pull the book out again.
  const returning = useRef<string | undefined>(undefined)
  const active = books.find((b) => b.id === activeId)
  const shown = books.find((b) => b.id === (hoverId ?? pulledId))
  const [room, setRoom] = useState(0)
  // The bookcase's height on a laptop (0 on phones, which scroll at a fixed size).
  const [avail, setAvail] = useState(0)

  // Measure how much book-width fits on one shelf, and re-pack when the window changes.
  useLayoutEffect(() => {
    const el = measure.current
    const box = bookcase.current
    if (!el || !box) return
    const update = () => {
      const cs = getComputedStyle(el)
      setRoom(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))
      setAvail(window.matchMedia('(min-width: 900px)').matches ? box.clientHeight : 0)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // On a laptop the shelves fill the bookcase: the biggest book size whose rows still fit its
  // height (a small library gets grand spines; as it grows, books step down and rows are added).
  // A row is the books (292px tall at full size) plus 74px of headroom and the 34px plank; a little
  // spare room (the lace, rounding) keeps the shelves from overflowing into a scrollable, jumpy bookcase.
  const k = useMemo(() => {
    if (!avail || !room) return avail ? 1 : 0.8
    for (let k = K_MAX; k > K_MIN; k -= 0.02) {
      if (packRows(books, room, k).length * (292 * k + 74 + 34) <= avail - 24) return Math.round(k * 100) / 100
    }
    return K_MIN
  }, [books, room, avail])

  const rows = useMemo(() => packRows(books, room, k), [books, room, k])
  // When every shelf fits the bookcase it never needs to scroll — and mustn't: a book sliding
  // out tilts toward her and pokes past the edge, which would flash a scrollbar and jolt the shelf.
  const fits = !!avail && rows.length * (292 * k + 74 + 34) <= avail - 24

  // A little puff of glitter from the top of whichever book slides out.
  const shownId = shown?.id
  useEffect(() => {
    if (!shownId) return
    const t = window.setTimeout(() => {
      const r = bookcase.current?.querySelector(`[data-book="${CSS.escape(shownId)}"] .face.spine`)?.getBoundingClientRect()
      if (r) sparkleBurst(r.left + r.width / 2, r.top + 6, 14, false)
    }, 220) // once the book has lifted
    return () => window.clearTimeout(t)
  }, [shownId])

  useEffect(() => {
    if (activeId && !books.some((b) => b.id === activeId)) setActiveId(undefined)
    if (pulledId && !books.some((b) => b.id === pulledId)) setPulledId(undefined)
  }, [books, activeId, pulledId])

  const focusBook = (id: string) => {
    setActiveId(id)
    setPulledId(id)
    const el = bookcase.current?.querySelector<HTMLElement>(`[data-book="${CSS.escape(id)}"]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = books.findIndex((b) => b.id === activeId)
    let next = -1
    if (e.key === 'ArrowRight') next = Math.min(books.length - 1, i + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = books.length - 1
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && i >= 0) {
      // Jump to the book in the same spot on the shelf above / below.
      const r = rows.findIndex((row) => row.some((b) => b.id === activeId))
      const col = rows[r].findIndex((b) => b.id === activeId)
      const target = rows[r + (e.key === 'ArrowDown' ? 1 : -1)]
      if (target?.length) next = books.indexOf(target[Math.min(col, target.length - 1)])
    } else if ((e.key === 'f' || e.key === 'F') && active) {
      e.preventDefault()
      onToggleFavorite(active)
      return
    }
    if (next >= 0) {
      e.preventDefault()
      focusBook(books[next].id)
    }
  }

  // Once the shelf is idle, quietly fetch each book's cover image, so the very first book she
  // opens has its cover ready to fly into the card (otherwise it flew in blank and felt laggy).
  const coverKey = books.map((b) => b.coverUrl ?? '').join('|')
  useEffect(() => {
    const urls = books
      .filter((b) => b.coverUrl && (b.coverSource === 'openlibrary' || b.coverSource === 'google' || b.coverSource === 'archive'))
      .map((b) => coverAt(b.coverUrl, 'M')!)
    const warm = () => urls.forEach((u) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = u
    })
    if ('requestIdleCallback' in window) {
      const t = window.requestIdleCallback(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback(t)
    }
    const t = setTimeout(warm, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverKey])

  const rovingId = activeId ?? books[0]?.id

  return (
    <section className="shelf-section">
      {header}
      <div
        className={`bookcase ${fits ? 'fits' : ''}`}
        ref={bookcase}
        style={{ ['--k' as string]: k } as CSSProperties}
        data-lenis-prevent
        onKeyDown={onKeyDown}
        onPointerDown={(e) => (lastPointer.current = e.pointerType)}
      >
        {rows.map((row, ri) => (
          <div className="shelf-row" key={ri}>
            <div className="shelf-back">
              {ri === 0 && <FairyLights />}
              <div className="shelf-books" role="list" aria-label={`Shelf ${ri + 1}`} ref={ri === 0 ? measure : undefined}>
                {row.map((b) => (
              <Spine
                key={b.id}
                book={b}
                active={b.id === pulledId}
                tabbable={b.id === rovingId}
                onFocus={(e) => {
                  setActiveId(b.id)
                  if (returning.current === b.id) {
                    returning.current = undefined
                    return
                  }
                  // Tabbing in with the keyboard pulls the book out; a mouse click doesn't need to.
                  if (e.currentTarget.matches(':focus-visible')) setPulledId(b.id)
                }}
                onHover={(on) => setHoverId(on ? b.id : undefined)}
                onActivate={(el) => {
                  // Touch flies straight from the spine (no pause to slide it out first), with a lighter sparkle.
                  const touch = lastPointer.current === 'touch'
                  rememberOrigin(b.id, el)
                  const r = el.getBoundingClientRect()
                  sparkleBurst(r.left + r.width / 2, r.top + r.height * 0.4, touch ? 16 : 36, false)
                  sfx.bookOpen()
                  returning.current = b.id
                  setPulledId(undefined)
                  setHoverId(undefined)
                  onOpen(b)
                }}
              />
                ))}
                {ri === rows.length - 1 && onAdd && <AddSlot onAdd={onAdd} />}
                {/* an empty shelf's message sits beside the add slot, in the free space (never on top of it) */}
                {books.length === 0 && <p className="shelf-empty">{emptyText}</p>}
                {ri === rows.length - 1 && <DecorStack />}
              </div>
            </div>
            <div className="shelf-plank" aria-hidden />
          </div>
        ))}
        <div className="shelf-lace" aria-hidden />
      </div>

      {<div className="shelf-caption" aria-live="polite">
        {shown ? (
          <>
            <div className="caption-text">
              <strong>{shown.title}</strong>
              {shown.authors.length > 0 && <span> · {shown.authors.join(', ')}</span>}
              <span className="caption-meta">
                {STATUS_LABEL[shown.status]} · {shown.file ? `${shown.file.format.toUpperCase()} attached` : 'No file yet'}
                {shown.progress && shown.file ? ` · ${Math.round(shown.progress.percent * 100)}%` : ''}
              </span>
            </div>
            <div className="caption-actions">
              <button
                className={`chip-btn ${shown.favorite ? 'on' : ''}`}
                aria-pressed={shown.favorite}
                onClick={() => onToggleFavorite(shown)}
              >
                <Icon name={shown.favorite ? 'heartFill' : 'heart'} size={16} />
                {shown.favorite ? 'Favorite' : 'Add to favorites'}
              </button>
              <button
                className="btn btn-small"
                onClick={() => {
                  rememberOrigin(shown.id, bookcase.current?.querySelector(`[data-book="${CSS.escape(shown.id)}"]`) ?? null)
                  setPulledId(undefined)
                  setHoverId(undefined)
                  onOpen(shown)
                }}
              >
                Open
              </button>
            </div>
          </>
        ) : (
          <p className="caption-hint">
            {/* keyboard tips for laptops; phones get touch wording (CSS picks one) */}
            <span className="hint-keys">
              Hover a spine to pull it out · <kbd>←</kbd> <kbd>→</kbd> to browse · <kbd>Enter</kbd> to open · <kbd>F</kbd> to favorite
            </span>
            <span className="hint-touch">Tap a book to open it · swipe the card to see the next one</span>
          </p>
        )}
      </div>}
    </section>
  )
}

export function Sparkle() {
  return (
    <svg className="title-sparkle" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 1 C10.8 7 13 9.2 19 10 C13 10.8 10.8 13 10 19 C9.2 13 7 10.8 1 10 C7 9.2 9.2 7 10 1z" fill="currentColor" />
    </svg>
  )
}

/** A string of tiny fairy lights draped along the top of each shelf. */
function FairyLights() {
  const bulbs = 15
  return (
    <svg className="fairy-lights" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden>
      <path d="M0 8 Q 83 46 166 12 T 333 12 T 500 12 T 666 12 T 833 12 T 1000 8" fill="none" stroke="#2a1a10" strokeWidth="1.5" />
      {Array.from({ length: bulbs }).map((_, i) => {
        const x = 30 + (i * 940) / (bulbs - 1)
        const t = (x % 166.6) / 166.6
        const y = 12 + Math.sin(t * Math.PI) * 24
        const colors = ['#ffe7a3', '#f6c2d6', '#d6c4f2', '#fff3c4']
        return <circle key={i} className="bulb" cx={x} cy={y + 5} r="4.2" fill={colors[i % colors.length]} style={{ animationDelay: `${(i % 5) * 0.7}s` }} />
      })}
    </svg>
  )
}

function Spine({
  book,
  active,
  tabbable,
  onFocus,
  onHover,
  onActivate,
}: {
  book: Book
  active: boolean
  tabbable: boolean
  onFocus: (e: React.FocusEvent<HTMLButtonElement>) => void
  onHover: (on: boolean) => void
  onActivate: (el: HTMLElement) => void
}) {
  const cover = useCoverSrc(book, 'M')
  useEffect(() => {
    // Measure (or re-measure, after the colour method changed) this cover's main colour.
    if (book.spineColor?.startsWith(SPINE_COLOR_VERSION) || !cover) return
    let cancelled = false
    spineColorFromImage(cover).then((c) => {
      if (!cancelled && c) updateBook(book.id, { spineColor: c }).catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [book.id, book.spineColor, cover])

  const width = spineWidth(book)
  const height = Math.round(hashNumber(book.id + book.title, 236, 292))
  const variant = (Math.floor(hashNumber(book.id + book.title, 0, SPINE_VARIANTS)) % SPINE_VARIANTS) as SpineVariant
  const cloth = clothFor(book.spineColor, book.id)
  const style = {
    '--w': `${width}px`,
    '--h': `${height}px`,
    '--d': `${Math.round(height * 0.68)}px`,
    '--spine': cloth.bg,
    '--ink': cloth.ink,
    '--gilt': cloth.gilt,
  } as CSSProperties

  const label = [
    bookLabel(book),
    book.favorite ? 'favorite' : '',
    book.file ? `${book.file.format.toUpperCase()} attached` : 'no file attached',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className={`book ${active ? 'is-active' : ''}`} style={style} role="listitem">
      <button
        className="book-btn"
        data-book={book.id}
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        onFocus={onFocus}
        // Real mice only: on a phone, a hover that changes the page makes the browser swallow the first tap.
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(false)}
        onClick={(e) => onActivate(e.currentTarget)}
      >
        <span className="book-3d">
          <span className={`face spine v${variant} ${cloth.light ? 'light' : 'dark'}`}>
            <SpineTop variant={variant} inks={cloth} />
            {/* Titles shrink to fit down the spine; really long ones run as two lines, so the whole name shows. */}
            {(() => {
              const two = book.title.length > 18 && book.title.includes(' ')
              const chars = two ? Math.max(...book.title.split(' ').map((w) => w.length), Math.ceil(book.title.length / 2)) : book.title.length
              return (
                <span className={`spine-title ${two ? 'two' : ''}`} style={{ '--tchars': chars } as CSSProperties}>
                  {book.title}
                </span>
              )
            })()}
            {book.authors[0] && (() => {
              const surname = book.authors[0].split(' ').slice(-1)[0]
              // the label shrinks for long surnames so the whole name fits on the spine
              return <span className="spine-author" style={{ '--chars': surname.length } as CSSProperties}>{surname}</span>
            })()}
            <SpineBottom variant={variant} inks={cloth} />
          </span>
          <span className="face cover">
            {cover ? <img src={cover} alt="" draggable={false} /> : <span className="cover-fallback">{book.title}</span>}
          </span>
        </span>
        {book.favorite && (
          <span className="fav-flower">
            <PressedFlower kind="blossom" size={20} />
          </span>
        )}
        {book.file && <span className="ribbon" title="Readable file attached" />}
      </button>
    </div>
  )
}

/** An empty spot on the shelf, waiting for the next book: tap it to add one. */
function AddSlot({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="add-slot-wrap" role="listitem">
      <button
        type="button"
        className="add-slot"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          sparkleBurst(r.left + r.width / 2, r.top + r.height * 0.4, 16)
          onAdd()
        }}
        aria-label="Add a book"
        title="Add a book"
      >
        <span className="add-slot-plus" aria-hidden>
          <Icon name="plus" size={20} />
        </span>
        <span className="add-slot-label">Add a book</span>
      </button>
    </div>
  )
}

/** A little decorative stack lying at the end of the shelf. */
function DecorStack() {
  return (
    <div className="decor-stack" aria-hidden>
      <span style={{ '--c': '#b29ad6', width: 104 } as CSSProperties} />
      <span style={{ '--c': '#e3a8c4', width: 96 } as CSSProperties} />
      <span style={{ '--c': '#6b4f8a', width: 110 } as CSSProperties} />
      <div className="decor-top">
        <span className="decor-vase">
          <PressedFlower kind="lavender" size={22} />
          <PressedFlower kind="forgetmenot" size={20} />
        </span>
        <HeartPlush />
      </div>
    </div>
  )
}

/** A little heart plush sitting on the book stack. Give it a poke. */
function HeartPlush() {
  const [boop, setBoop] = useState(0)
  return (
    <button
      type="button"
      className="heart-plush"
      key={boop}
      data-boop={boop > 0 || undefined}
      tabIndex={-1}
      aria-label="Heart plush"
      onClick={(e) => {
        setBoop((n) => n + 1)
        sparkleBurst(e.clientX, e.clientY, 18)
      }}
    >
      <svg viewBox="0 0 100 108" aria-hidden>
        <defs>
          <radialGradient id="plush-red" cx="38%" cy="30%" r="78%">
            <stop offset="0" stopColor="#ffb3c8" />
            <stop offset="0.55" stopColor="#f27fa0" />
            <stop offset="1" stopColor="#cf5480" />
          </radialGradient>
        </defs>
        {/* stubby felt legs, dangling over the edge of the stack */}
        <rect x="32" y="84" width="11" height="20" rx="5.5" fill="#d98aa8" />
        <rect x="57" y="84" width="11" height="20" rx="5.5" fill="#d98aa8" />
        <ellipse cx="37.5" cy="102" rx="6.5" ry="4" fill="#f4e6ef" />
        <ellipse cx="62.5" cy="102" rx="6.5" ry="4" fill="#f4e6ef" />
        {/* the whole plush is one big heart */}
        <path
          d="M50 26 C43 8 8 6 6 34 C4 56 30 74 50 90 C70 74 96 56 94 34 C92 6 57 8 50 26z"
          fill="url(#plush-red)"
          stroke="#a33a5e"
          strokeWidth="1.2"
        />
        {/* stitched seam around the edge */}
        <path d="M50 31 C44 16 14 14 12 35 C11 53 33 68 50 82 C67 68 89 53 88 35 C86 14 56 16 50 31z" stroke="#ffe0ea" strokeWidth="0.9" strokeDasharray="2.2 2.6" fill="none" opacity="0.7" />
        <ellipse cx="27" cy="22" rx="9" ry="5" fill="#fff" opacity="0.25" transform="rotate(-25 27 22)" />
        {/* a lavender bow on one lobe */}
        <path d="M70 14 L60 8 L61 20z M70 14 L80 8 L79 20z" fill="#b39ddb" stroke="#7e64b3" strokeWidth="1" strokeLinejoin="round" />
        <circle cx="70" cy="14" r="3" fill="#9c82cf" />
        {/* button eyes, rosy cheeks, stitched smile */}
        <circle cx="37" cy="42" r="4.6" fill="#3a2433" />
        <circle cx="63" cy="42" r="4.6" fill="#3a2433" />
        <circle cx="38.4" cy="40.5" r="1.4" fill="#fff" />
        <circle cx="64.4" cy="40.5" r="1.4" fill="#fff" />
        <ellipse cx="27" cy="51" rx="6" ry="4" fill="#ff8fb0" opacity="0.75" />
        <ellipse cx="73" cy="51" rx="6" ry="4" fill="#ff8fb0" opacity="0.75" />
        <path d="M44 51 Q50 57 56 51" stroke="#3a2433" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {/* hugging a tiny book */}
        <rect x="38" y="60" width="24" height="17" rx="1.5" fill="#6b4f8a" stroke="#4a3463" strokeWidth="1" />
        <rect x="40.5" y="62" width="19" height="13" fill="none" stroke="#e8c77a" strokeWidth="0.9" />
        <path d="M50 64 C48 62 45.5 64 47.5 66.5 L50 69 L52.5 66.5 C54.5 64 52 62 50 64z" fill="#e8c77a" />
        <ellipse cx="36" cy="66" rx="6" ry="4.5" fill="#e86d92" transform="rotate(-20 36 66)" />
        <ellipse cx="64" cy="66" rx="6" ry="4.5" fill="#e86d92" transform="rotate(20 64 66)" />
      </svg>
    </button>
  )
}
