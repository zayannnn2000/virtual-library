import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, purgeBook, purgeStaleRemovals, removeBook, requestPersistentStorage, restoreBook, updateBook } from './db'
import type { Book, ReadingStatus } from './types'
import { seedOnce } from './lib/seed'
import { clothFor } from './lib/color'
import { migrateGenres, useGenres } from './lib/library'
import { CategoryDialog } from './components/CategoryDialog'
import { Header } from './components/Header'
import { Shelf, Sparkle } from './components/Shelf'
import { BookDetail } from './components/BookDetail'
import { AddBook } from './components/AddBook'
import { DiaryGate } from './components/DiaryGate'
import { GlitterDefs, Icon, SleepyCat } from './components/Art'
import { useCoverSrc, useToast } from './components/ui'
import { hasVerifier, isUnlocked, lockAgain, markUnlocked, needsLock } from './lib/pin'
import { startSmoothScroll, stopSmoothScroll } from './lib/motion'
import { occasionSlogan } from './lib/slogans'
import { QuoteNote } from './components/QuoteNotes'
import { Pinboard } from './components/Pinboard'
import { GlitterTrail } from './components/GlitterTrail'
import { Butterflies } from './components/Whimsy'
import { getSession, initialSync, onAuth, syncEnabled } from './sync'

const Reader = lazy(() => import('./reader/Reader'))

type Filter = 'all' | 'favorites' | string

type View = ReadingStatus | 'all'
const VIEWS: { value: View; title: string; flourish: string; empty: string }[] = [
  { value: 'finished', title: 'Books I’ve Read', flourish: 'the stories you’ve lived', empty: 'Finished books land here with a little bow.' },
  { value: 'reading', title: 'Reading Now', flourish: 'the ones keeping you up at night', empty: 'Open a book to start a new adventure.' },
  { value: 'want', title: 'To Be Read', flourish: 'the stack of someday', empty: 'Nothing waiting — add a book you can’t wait to start.' },
  { value: 'all', title: 'Every Book', flourish: 'the whole library', empty: 'Your shelves are waiting for their first story.' },
]
const UNCATEGORIZED = 'Uncategorized'

function readHash() {
  const m = location.hash.match(/^#\/read\/(.+)$/)
  return m ? decodeURIComponent(m[1]) : undefined
}

export default function App() {
  const toast = useToast()
  const [ready, setReady] = useState(false)
  // The diary greets her at the start of every visit.
  const [gate, setGate] = useState(() => !isUnlocked())
  // The landing shelf shows what she's read, so it looks full and loved.
  const [view, setView] = useState<View>('finished')
  // Just shelved a new book? The header has an opinion about that.
  const [justAdded, setJustAdded] = useState(false)
  const [readingId, setReadingId] = useState(readHash)
  const [detailId, setDetailId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const genres = useGenres()
  // Fade the category row's edge only where more categories are hidden.
  const chipRow = useRef<HTMLDivElement>(null)
  const [chipFade, setChipFade] = useState('')
  const updateChipFade = useCallback(() => {
    const el = chipRow.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setChipFade(`${left ? 'more-left' : ''} ${right ? 'more-right' : ''}`.trim())
  }, [])
  useEffect(() => {
    updateChipFade()
    window.addEventListener('resize', updateChipFade)
    return () => window.removeEventListener('resize', updateChipFade)
  }, [updateChipFade, genres.length])

  // 'local' = no cloud configured (or just looking around); otherwise her library waits for her PIN.
  const [auth, setAuth] = useState<'checking' | 'signed-out' | 'locked' | 'recovery' | 'signed-in' | 'local'>(syncEnabled ? 'checking' : 'local')

  useEffect(() => {
    let booted = false
    const boot = async () => {
      if (booted) return
      booted = true
      await purgeStaleRemovals().catch(() => {})
      if (syncEnabled) {
        // Pull her shelf first so a new device doesn't add the starter books twice.
        await initialSync().catch((err) => console.warn('first sync failed, continuing offline', err))
      }
      await seedOnce().catch(() => {})
      await migrateGenres().catch(() => {})
      setReady(true)
    }
    requestPersistentStorage()
    let off = () => {}
    if (syncEnabled) {
      getSession().then((s) => {
        setAuth((a) => (a === 'recovery' ? a : !s ? 'signed-out' : needsLock() ? 'locked' : 'signed-in'))
        if (s) boot()
      })
      off = onAuth((s, event) => {
        // Arrived from a "Forgot PIN?" email: she's signed in and must choose a new PIN.
        if (event === 'PASSWORD_RECOVERY') return setAuth('recovery')
        if (!s) return setAuth('signed-out')
        if (event === 'SIGNED_IN') setAuth((a) => (a === 'recovery' ? a : needsLock() ? 'locked' : 'signed-in'))
        boot()
      })
    } else boot()
    const onHash = () => setReadingId(readHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  // Buttery page scrolling on the shelves; the reader keeps native, precise scrolling.
  useEffect(() => {
    if (readingId || auth !== 'signed-in' && auth !== 'local') return
    startSmoothScroll()
    return () => stopSmoothScroll()
  }, [readingId, auth])

  const books = useLiveQuery(async () => (await db.books.orderBy('addedAt').toArray()).filter((b) => !b.removedAt), [])

  const visible = useMemo(() => {
    if (!books) return []
    const q = query.trim().toLowerCase()
    return books.filter((b) => {
      if (q && !`${b.title} ${b.authors.join(' ')}`.toLowerCase().includes(q)) return false
      if (filter === 'favorites') return b.favorite
      if (filter === UNCATEGORIZED) return b.genres.length === 0
      if (filter !== 'all') return b.genres.includes(filter)
      return true
    })
  }, [books, query, filter])

  // The books she's opened most recently — any shelf (reopening a finished one means a reread),
  // leaving out only those she's read to the very end.
  const continueBooks = useMemo(
    () =>
      (books ?? [])
        .filter((b) => b.file && b.progress && b.progress.percent < 0.99 && !((b.continueHiddenAt ?? 0) >= b.progress.updatedAt))
        .sort((a, b) => (b.progress!.updatedAt ?? 0) - (a.progress!.updatedAt ?? 0))
        .slice(0, 3),
    [books],
  )

  const openReader = useCallback((b: Book) => {
    setDetailId(undefined)
    location.hash = `#/read/${encodeURIComponent(b.id)}`
  }, [])
  const closeReader = useCallback(() => {
    history.pushState('', document.title, location.pathname + location.search)
    setReadingId(undefined)
  }, [])

  const remove = useCallback(
    async (b: Book) => {
      setDetailId(undefined)
      await removeBook(b.id)
      toast({
        message: `“${b.title}” was taken off the shelf.`,
        action: { label: 'Undo', run: () => restoreBook(b.id) },
        onExpire: () => {
          db.books.get(b.id).then((x) => {
            if (x?.removedAt) purgeBook(b.id)
          })
        },
        duration: 9000,
      })
    },
    [toast],
  )

  const toggleFavorite = useCallback((b: Book) => {
    updateBook(b.id, { favorite: !b.favorite })
  }, [])

  // The diary has dissolved into the (already painted) shelves; it stays away for this visit.
  const gateDone = useCallback(() => {
    markUnlocked()
    setGate(false)
  }, [])

  const pinMode = auth === 'signed-out' ? 'enter' : auth === 'locked' ? 'lock' : auth === 'recovery' ? 'recovery' : null
  // The diary is always the first child of the same fragment, so it keeps its place
  // (and its animation) while the library mounts underneath it after the PIN.
  const gateEl =
    (gate || pinMode) && auth !== 'checking' ? (
      <DiaryGate key="gate" pinMode={pinMode} libraryReady={ready && !!books} onUnlocked={() => setAuth('signed-in')} onDone={gateDone} />
    ) : null

  if (auth === 'checking') return <><div className="shelf-loading">Unlocking the library…</div></>
  if (pinMode) {
    return (
      <>
        {gateEl}
        <GlitterTrail />
      </>
    )
  }

  if (readingId) {
    return (
      <>
        {gateEl}
        <GlitterDefs />
        <ReaderBoundary onClose={closeReader}>
          <Suspense fallback={<div className="reader-loading">Opening the book…</div>}>
            <Reader bookId={readingId} onClose={closeReader} />
          </Suspense>
        </ReaderBoundary>
      </>
    )
  }

  const filtersActive = query.trim() !== '' || filter !== 'all'
  const currentView = VIEWS.find((v) => v.value === view) ?? VIEWS[0]
  const shelfBooks = view === 'all' ? visible : visible.filter((b) => b.status === view)
  // Browsing books from the open card, in shelf order; the shelf scrolls along so closing lands on the right spine.
  const detailIndex = detailId ? shelfBooks.findIndex((b) => b.id === detailId) : -1
  const browseTo = (id: string) => {
    setDetailId(id)
    // Only if that book is out of sight, scroll the bookcase itself (never the page) to it.
    const spine = document.querySelector<HTMLElement>(`[data-book="${CSS.escape(id)}"]`)
    const box = spine?.closest<HTMLElement>('.bookcase')
    if (!spine || !box) return
    const s = spine.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (s.top < b.top) box.scrollBy({ top: s.top - b.top - 12 })
    else if (s.bottom > b.bottom) box.scrollBy({ top: s.bottom - b.bottom + 12 })
  }

  return (
    <>
    {gateEl}
    {/* At the root, so the sparkles show above the diary as well as the shelves. */}
    <GlitterTrail />
    <div className="app">
      <GlitterDefs />
      <div className="wallpaper" aria-hidden />
      <Butterflies count={4} />
      <Header
        occasion={occasionSlogan({ filter, justAdded })}
        onAdd={() => setAdding(true)}
        onLock={() => {
          lockAgain()
          setGate(true)
          if (syncEnabled && hasVerifier()) setAuth('locked')
        }}
      />

      <main id="main">
        <div className="toolbar">
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">Search your shelf</span>
            <input type="search" placeholder="Search your shelf" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className={`chips scroll ${chipFade}`} ref={chipRow} onScroll={updateChipFade} role="group" aria-label="Filter by genre">
            {['all', 'favorites', ...genres, UNCATEGORIZED].map((g) => (
              <button key={g} className={`chip ${filter === g ? 'on' : ''} ${g === 'favorites' ? 'fav' : ''}`} aria-pressed={filter === g} onClick={() => setFilter(g)}>
                {g === 'all' ? 'All books' : g === 'favorites' ? <><Icon name="heartFill" size={13} /> Favorites</> : g}
              </button>
            ))}
            <CategoryChip onAdded={(g) => setFilter(g)} onRemoved={(g) => setFilter((f) => (f === g ? 'all' : f))} />
          </div>
        </div>

        {/* One screen: the bookcase on the left, her board on the right. */}
        <div className="home">
        <div className="home-shelf">
        {!ready || !books ? (
          <div className="shelf-loading" aria-busy>Dusting the shelves…</div>
        ) : books.length === 0 ? (
          <EmptyShelf
            title="Your shelf is waiting for its first story"
            body="Add a book you love, or one you can't wait to start."
            action={<button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add a book</button>}
          />
        ) : visible.length === 0 ? (
          filter === 'favorites' && !query ? (
            <EmptyShelf
              title="No favorites yet"
              body="Open a book you adore and tap the heart — it gets a little pressed flower on its spine."
            />
          ) : (
            <EmptyShelf
              title="Nothing here matches"
              body={query ? `No book on the shelf matches “${query}”.` : 'Try another genre.'}
              action={
                <div className="row">
                  <button className="btn btn-ghost" onClick={() => { setQuery(''); setFilter('all') }}>Show all books</button>
                  {query && <button className="btn" onClick={() => setAdding(true)}>Find “{query}” to add</button>}
                </div>
              }
            />
          )
        ) : (
          <Shelf
            header={<ShelfPlaque view={view} onChange={setView} count={shelfBooks.length} />}
            emptyText={currentView.empty}
            books={shelfBooks}
            onOpen={(b) => setDetailId(b.id)}
            onToggleFavorite={toggleFavorite}
            onAdd={() => setAdding(true)}
          />
        )}
        </div>
        <aside className="home-board">
          {continueBooks.length > 0 && !filtersActive && (
            <ContinueReading
              books={continueBooks}
              onRead={openReader}
              onHide={(b) => {
                updateBook(b.id, { continueHiddenAt: Date.now() })
                toast({ message: `“${b.title}” taken off Continue reading.`, action: { label: 'Undo', run: () => updateBook(b.id, { continueHiddenAt: undefined }) } })
              }}
            />
          )}
          <Pinboard />
        </aside>
        </div>
      </main>

      <footer className="site-footer">
        <span className="xoxo">happy reading</span>
      </footer>

      {detailId && (
        <BookDetail
          bookId={detailId}
          onClose={() => setDetailId(undefined)}
          onRead={openReader}
          onRemove={remove}
          onPrev={detailIndex > 0 ? () => browseTo(shelfBooks[detailIndex - 1].id) : undefined}
          onNext={detailIndex >= 0 && detailIndex < shelfBooks.length - 1 ? () => browseTo(shelfBooks[detailIndex + 1].id) : undefined}
          shelf={shelfBooks}
        />
      )}
      {adding && (
        <AddBook
          onClose={() => setAdding(false)}
          onAdded={(b) => {
            setAdding(false)
            setJustAdded(true)
            window.setTimeout(() => setJustAdded(false), 12_000)
            setQuery('')
            setFilter('all')
            setDetailId(b.id)
          }}
          onOpenExisting={(b) => {
            setAdding(false)
            setDetailId(b.id)
          }}
          onRead={(b) => {
            setAdding(false)
            setJustAdded(true)
            window.setTimeout(() => setJustAdded(false), 12_000)
            openReader(b)
          }}
        />
      )}
    </div>
    </>
  )
}

/** If the reader ever fails, offer a way back instead of a blank screen. Her data is untouched. */
class ReaderBoundary extends Component<{ onClose: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error(err)
    // The reader's code couldn't load (the site was updated while this tab was open): reload once.
    if (/dynamically imported module|Importing a module script failed|Loading chunk/i.test(String((err as Error)?.message ?? err))) {
      import('./main').then((m) => m.reloadForNewVersion()).catch(() => location.reload())
    }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="reader reader-missing">
        <div className="state-box error">
          <p>Something went wrong while showing this book. Your bookmarks, notes and progress are safe.</p>
          <button className="btn" onClick={this.props.onClose}>Back to the shelf</button>
        </div>
      </div>
    )
  }
}

/** "+ Categories" at the end of the category row: opens the add / remove popup. */
function CategoryChip({ onAdded, onRemoved }: { onAdded: (g: string) => void; onRemoved: (g: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="chip chip-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} /> Edit categories
      </button>
      {/* Out of the scrolling chip row, so the popup sits above the whole page. */}
      {open && createPortal(<CategoryDialog onClose={() => setOpen(false)} onAdded={onAdded} onRemoved={onRemoved} />, document.querySelector('.app') ?? document.body)}
    </>
  )
}

/** The shelf's name plate — it doubles as the dropdown for which books are shown. */
/**
 * The shelf's name plate doubles as the picker for which books are shown. It's our own
 * little menu rather than a native <select>, so phones show the same pretty card as the
 * laptop instead of the system's plain picker.
 */
function ShelfPlaque({ view, onChange, count }: { view: View; onChange: (v: View) => void; count: number }) {
  const current = VIEWS.find((v) => v.value === view) ?? VIEWS[0]
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    setHi(Math.max(0, VIEWS.findIndex((v) => v.value === view)))
    const onDoc = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open, view])
  const pick = (v: View) => {
    onChange(v)
    setOpen(false)
    button.current?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : VIEWS.length - 1)) % VIEWS.length)
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      pick(VIEWS[hi].value)
    }
  }
  return (
    <header className="shelf-head">
      <QuoteNote slot={1} />
      <QuoteNote slot={2} />
      <div className="shelf-picker" ref={wrap} onKeyDown={onKey}>
        <button
          ref={button}
          type="button"
          className={`shelf-title shelf-select ${open ? 'open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Showing ${current.title}. Choose a shelf`}
          onClick={() => setOpen(!open)}
        >
          <Sparkle />
          <span>{current.title}</span>
          <span className="shelf-caret" aria-hidden>▾</span>
          <Sparkle />
        </button>
        {open && (
          <ul className="shelf-menu" role="listbox" aria-label="Shelves" aria-activedescendant={`shelf-opt-${VIEWS[hi].value}`}>
            {VIEWS.map((v, i) => (
              <li
                key={v.value}
                id={`shelf-opt-${v.value}`}
                role="option"
                aria-selected={v.value === view}
                className={`${v.value === view ? 'on' : ''} ${i === hi ? 'hi' : ''}`}
                onPointerEnter={() => setHi(i)}
                onClick={() => pick(v.value)}
              >
                <span className="shelf-opt-text">
                  <strong>{v.title}</strong>
                  <span>{v.flourish}</span>
                </span>
                {v.value === view && <Icon name="check" size={16} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="shelf-flourish">
        {current.flourish} · {count === 0 ? 'empty for now' : `${count} book${count === 1 ? '' : 's'}`}
      </span>
    </header>
  )
}

/** Where she is: "Page 14 of 435" for a PDF; for an EPUB (whose pages depend on the screen) the share read. */
function whereLabel(book: Book) {
  const pct = Math.round((book.progress?.percent ?? 0) * 100)
  if (book.file?.format === 'pdf' && book.progress?.label) return book.progress.label
  return pct > 0 ? `${pct}% read` : 'Just started'
}

/** The book she's in the middle of, plus a couple more she's opened lately. Each can be taken off with ×. */
function ContinueReading({ books, onRead, onHide }: { books: Book[]; onRead: (b: Book) => void; onHide: (b: Book) => void }) {
  const [first, ...more] = books
  const pct = Math.round((first.progress?.percent ?? 0) * 100)
  const hide = (b: Book) => (
    <button className="continue-hide" aria-label={`Take “${b.title}” off Continue reading`} title="Take off Continue reading" onClick={() => onHide(b)}>
      <Icon name="close" size={13} />
    </button>
  )
  return (
    <div className="continue-stack">
      <div className="continue-item">
        <button className="continue-card" onClick={() => onRead(first)}>
          <MiniCover book={first} />
          <span className="continue-text">
            <span className="eyebrow">Continue reading</span>
            <strong>{first.title}</strong>
            <span className="progress-line small"><span style={{ width: `${pct}%` }} /></span>
            <span className="fine">{whereLabel(first)}</span>
          </span>
          <Icon name="chevR" />
        </button>
        {hide(first)}
      </div>
      {more.map((b) => (
        <div key={b.id} className="continue-item">
          <button className="continue-row" onClick={() => onRead(b)}>
            <MiniCover book={b} />
            <span className="continue-row-text">
              <strong>{b.title}</strong>
              <span className="fine">{whereLabel(b)}</span>
            </span>
            <Icon name="chevR" size={16} />
          </button>
          {hide(b)}
        </div>
      ))}
    </div>
  )
}

function MiniCover({ book }: { book: Book }) {
  const cover = useCoverSrc(book, 'M')
  return cover ? <img src={cover} alt="" /> : <span className="mini-cloth" style={{ background: clothFor(book.spineColor, book.id).bg }} />
}

function EmptyShelf({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <section className="empty">
      <div className="empty-shelf">
        <SleepyCat />
        <div className="shelf-plank small" aria-hidden />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  )
}
