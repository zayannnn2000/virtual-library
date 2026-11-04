import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { coverAt, fetchDescription } from '../lib/metadata'
import { flyCover, reducedMotion, shelfRect, takeOrigin } from '../lib/motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateBook } from '../db'
import type { Book } from '../types'
import { addCustomGenre, attachFile, detachFile, setUploadedCover, useGenres } from '../lib/library'
import { ImportError, inspectFile } from '../lib/fileImport'
import { Dialog, formatBytes, useCoverSrc, useToast } from './ui'
import { Icon, PressedFlower } from './Art'
import { clothFor } from '../lib/color'
import { downloadGutenberg, findFreeCopy, type FreeBook } from '../lib/gutenberg'
import { sfx } from '../lib/sound'

/**
 * A short overview of the book, fetched once (Open Library, then Google Books)
 * and kept with the book so it shows instantly — and offline — afterwards.
 */
function AboutBook({ book }: { book: Book }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [open, setOpen] = useState(false)
  const look = useCallback(() => {
    const ctrl = new AbortController()
    setState('loading')
    fetchDescription(book, ctrl.signal).then(
      (d) => {
        setState('idle')
        // "No summary" is only remembered when the sources answered and had none — and even
        // then it's checked again after a week, since summaries get added over time.
        updateBook(book.id, d ? { description: d.text, descriptionSource: d.source } : { descriptionSource: 'none', descriptionCheckedAt: Date.now() }).catch(() => {})
      },
      (err) => (err as Error).name !== 'AbortError' && setState('failed'),
    )
    return () => ctrl.abort()
  }, [book])
  useEffect(() => {
    if (!navigator.onLine || book.description) return
    const stale = book.descriptionSource === 'none' && Date.now() - (book.descriptionCheckedAt ?? 0) > 7 * 24 * 3600 * 1000
    if (book.descriptionSource && !stale) return
    return look()
    // when the card opens for a book without a summary yet (or whose "none" is old)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  if (book.description) {
    const long = book.description.length > 420
    return (
      <section className="about-book">
        <h3>About this book</h3>
        <p className={`about-text ${open || !long ? 'open' : ''}`}>{book.description}</p>
        <div className="row">
          {long && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read more'}</button>}
          <span className="fine">via {book.descriptionSource === 'google' ? 'Google Books' : 'Open Library'}</span>
        </div>
      </section>
    )
  }
  return (
    <section className="about-book">
      <h3>About this book</h3>
      {state === 'loading' ? (
        <p className="about-loading" aria-busy>Finding a summary…</p>
      ) : (
        <p className="fine">
          {state === 'failed' || !book.descriptionSource ? "Couldn't load a summary right now. " : 'No summary found for this book. '}
          <button className="link-btn" onClick={look}>Try again</button>
        </p>
      )}
    </section>
  )
}

/** Look for a public-domain edition on Project Gutenberg and download it in one tap. */
function FreeCopy({ title, authors, onFound }: { title: string; authors: string[]; onFound: (fb: FreeBook) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'looking' | 'none' | 'found' | 'downloading' | 'error'>('idle')
  const [match, setMatch] = useState<FreeBook>()
  const [error, setError] = useState<string>()
  const look = async () => {
    setState('looking')
    try {
      const fb = await findFreeCopy(title, authors)
      setMatch(fb)
      setState(fb ? 'found' : 'none')
    } catch {
      setState('error')
      setError("Couldn't check for a free copy right now.")
    }
  }
  const download = async () => {
    if (!match) return
    setState('downloading')
    try {
      await onFound(match)
    } catch (err) {
      setState('error')
      setError((err as Error).message || 'Download failed.')
    }
  }
  if (state === 'idle') return <button className="link-btn" onClick={look}>Find a free copy</button>
  if (state === 'looking') return <p className="fine">Checking Project Gutenberg…</p>
  if (state === 'none') return <p className="fine">No free copy — this book is most likely still under copyright.</p>
  if (state === 'error') return <p className="file-error" role="alert">{error} <button className="link-btn" onClick={look}>Try again</button></p>
  return (
    <div className="row">
      <span className="badge free">Free public-domain copy found</span>
      <button className="btn btn-small" onClick={download} disabled={state === 'downloading'}>
        {state === 'downloading' ? 'Downloading…' : 'Download it'}
      </button>
    </div>
  )
}

/**
 * One book's cover, mounted fresh for each book (so the previous book's cover can never
 * linger while browsing). The small cover — usually already loaded — shows at once, and
 * the sharp large one fades in over it as soon as it's ready.
 */
function DetailCover({ book, large, small }: { book: Book; large?: string; small?: string }) {
  const img = useRef<HTMLImageElement>(null)
  const [sharp, setSharp] = useState(false)
  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth) setSharp(true)
  }, [large])
  if (!large && !small) {
    return (
      <div className="cloth-cover" style={{ backgroundColor: clothFor(book.spineColor, book.id).bg }}>
        <span>{book.title}</span>
      </div>
    )
  }
  return (
    <>
      <img className="cover-small" src={small ?? large} alt="" aria-hidden />
      {large && large !== small && (
        <img ref={img} className={`cover-large ${sharp ? 'in' : ''}`} src={large} alt={`Cover of ${book.title}`} onLoad={() => setSharp(true)} />
      )}
    </>
  )
}

export function BookDetail({ bookId, onClose, onRead, onRemove, onPrev, onNext, shelf = [] }: {
  bookId: string
  onClose: () => void
  onRead: (b: Book) => void
  onRemove: (b: Book) => void
  /** The books either side on the shelf, to browse without closing the card. */
  onPrev?: () => void
  onNext?: () => void
  /** The books on the shelf, in order — their covers are loaded ahead of time for browsing. */
  shelf?: Book[]
}) {
  // Warm up covers so browsing shows them instantly: the small cover of every book on the
  // shelf (light), and the sharp cover of the three books either side — nearest first.
  const warm = useRef(new Map<string, HTMLImageElement>())
  const shelfKey = shelf.map((b) => b.id).join(',')
  useEffect(() => {
    const at = shelf.findIndex((b) => b.id === bookId)
    const byDistance = shelf.map((b, i) => ({ b, d: at < 0 ? i : Math.abs(i - at) })).sort((x, y) => x.d - y.d)
    const urls: string[] = []
    for (const { b, d } of byDistance) {
      if (!b.coverUrl || b.coverSource === 'upload' || b.coverSource === 'file') continue // local covers load instantly
      if (d <= 3) urls.push(coverAt(b.coverUrl, 'L')!)
      urls.push(coverAt(b.coverUrl, 'M')!)
    }
    const start = () => {
      for (const url of urls) {
        if (!url || warm.current.has(url)) continue
        const img = new Image()
        img.decoding = 'async'
        img.src = url
        img.decode?.().catch(() => {})
        warm.current.set(url, img)
      }
    }
    // When the card first opens, wait for the cover's flight to finish so the downloads and
    // decoding don't compete with it (that made the first tap feel laggy on phones).
    if (warm.current.size) return start()
    const t = window.setTimeout(start, 850)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, shelfKey])
  // Which way the last browse went, so the new book slides in from that side.
  const [dir, setDir] = useState<1 | -1>(1)
  const browse = useCallback(
    (d: 1 | -1) => {
      const go = d === 1 ? onNext : onPrev
      if (!go) return
      setDir(d)
      sfx.pageTurn()
      go()
    },
    [onNext, onPrev],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') browse(1)
      else if (e.key === 'ArrowLeft') browse(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [browse])
  // A sideways swipe on the card (phones) does the same.
  const swipe = useRef<{ x: number; y: number; t: number } | undefined>(undefined)
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const counts = useLiveQuery(async () => {
    const all = await db.annotations.where('bookId').equals(bookId).toArray()
    return {
      bookmark: all.filter((a) => a.kind === 'bookmark').length,
      highlight: all.filter((a) => a.kind === 'highlight').length,
      note: all.filter((a) => a.kind === 'note' || (a.kind === 'highlight' && a.note)).length,
    }
  }, [bookId])
  const cover = useCoverSrc(book ?? undefined, 'L')
  const genres = useGenres()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useState<string>()
  const [newGenre, setNewGenre] = useState('')
  const [editing, setEditing] = useState(false)
  const shelfCover = useCoverSrc(book ?? undefined, 'M')
  const coverRef = useRef<HTMLDivElement>(null)
  const flown = useRef(false)
  const [closing, setClosing] = useState(false)
  // false while the cover flies in; the card's lower sections render after (see below)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), 700)
    return () => window.clearTimeout(t)
  }, [])

  // The cover glides from its spot on the shelf into the card…
  useLayoutEffect(() => {
    if (!book || flown.current || !coverRef.current) return
    flown.current = true
    const from = takeOrigin(bookId)
    if (from && !reducedMotion()) flyCover(coverRef.current, from, 'in', 720, bookId)
  }, [book, bookId])

  // …and back onto the shelf when the card closes.
  const close = useCallback(async () => {
    if (closing) return
    sfx.bookClose()
    const home = shelfRect(bookId)
    if (home && coverRef.current && !reducedMotion()) {
      setClosing(true)
      await flyCover(coverRef.current, home, 'out', 640, bookId)
    }
    onClose()
  }, [bookId, closing, onClose])

  if (!book) return null
  const pct = book.progress ? Math.round(book.progress.percent * 100) : 0
  const started = !!book.progress && pct > 0

  const onFile = async (f?: File) => {
    if (!f) return
    setFileBusy(true)
    setFileError(undefined)
    try {
      const info = await inspectFile(f)
      await attachFile(book, f, info.format, info.pages)
      if (book.coverSource === 'none' && info.coverBlob) await setUploadedCover(book, info.coverBlob, 'file')
      toast({ message: `${info.format.toUpperCase()} attached — ready to read.` })
    } catch (err) {
      setFileError(err instanceof ImportError ? err.message : "That file couldn't be attached.")
    } finally {
      setFileBusy(false)
    }
  }

  const toggleGenre = (g: string) =>
    updateBook(book.id, {
      genres: book.genres.includes(g) ? book.genres.filter((x) => x !== g) : [...book.genres, g],
    })

  return (
    <Dialog
      label={book.title}
      onClose={close}
      closing={closing}
      className="detail-dialog"
      outside={
        !closing && (
          <>
            {onPrev && (
              <button className="detail-nav prev" aria-label="Previous book on the shelf" onClick={() => browse(-1)}>
                <Icon name="chevL" size={26} />
              </button>
            )}
            {onNext && (
              <button className="detail-nav next" aria-label="Next book on the shelf" onClick={() => browse(1)}>
                <Icon name="chevR" size={26} />
              </button>
            )}
          </>
        )
      }
    >
      <div
        className={`detail ${flown.current ? (dir === 1 ? 'slide-next' : 'slide-prev') : ''}`}
        key={bookId}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() }
        }}
        onPointerUp={(e) => {
          const s = swipe.current
          swipe.current = undefined
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 700) browse(dx < 0 ? 1 : -1)
        }}
        onPointerCancel={() => (swipe.current = undefined)}
      >
        <figure className="detail-cover">
          <div className="cover-3d" ref={coverRef}>
            <DetailCover key={book.id} book={book} large={cover} small={shelfCover} />
            {book.favorite && (
              <span className="detail-flower">
                <PressedFlower kind="blossom" size={30} />
              </span>
            )}
          </div>
          <figcaption className="fine">
            {{ openlibrary: 'Published cover · Open Library', google: 'Published cover · Google Books', archive: 'Cover · Internet Archive', file: 'Cover from her file', upload: 'Her own cover image', none: 'No published cover found' }[book.coverSource]}
          </figcaption>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setUploadedCover(book, f).then(() => toast({ message: 'Cover updated.' }))
            }}
          />
          <button className="link-btn" onClick={() => coverInput.current?.click()}>Replace cover</button>
        </figure>

        <div className="detail-body">
          {editing ? (
            <form
              className="edit-meta"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                updateBook(book.id, {
                  title: String(fd.get('title')).trim() || book.title,
                  authors: String(fd.get('authors')).split(',').map((s) => s.trim()).filter(Boolean),
                })
                setEditing(false)
              }}
            >
              <input className="input" name="title" defaultValue={book.title} aria-label="Title" data-autofocus />
              <input className="input" name="authors" defaultValue={book.authors.join(', ')} aria-label="Author" />
              <button className="btn btn-small">Save</button>
            </form>
          ) : (
            <header>
              <h2 className="detail-title">{book.title}</h2>
              <p className="detail-author">
                {book.authors.join(', ') || 'Unknown author'}
                {book.year ? <span className="fine"> · {book.year}</span> : null}
                <button className="icon-btn small" aria-label="Edit title and author" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={14} />
                </button>
              </p>
            </header>
          )}

          <AboutBook book={book} />

          <div className="detail-read">
            {book.file ? (
              <>
                <button className="btn btn-big" onClick={() => onRead(book)} data-autofocus>
                  <Icon name="book" /> {started ? 'Continue reading' : 'Start reading'}
                </button>
                <div className="progress-line" aria-label={`${pct}% read`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="fine">
                  {book.file.format.toUpperCase()} · {formatBytes(book.file.size)}
                  {book.progress?.label ? ` · ${book.progress.label}` : ''}
                </p>
              </>
            ) : (
              <div className="no-file">
                <p><strong>On the shelf, no file yet.</strong> Attach a PDF or EPUB to read it here.</p>
                <FreeCopy title={book.title} authors={book.authors} onFound={async (fb) => {
                  const epub = await downloadGutenberg(fb)
                  await inspectFile(epub)
                  await attachFile(book, epub, 'epub')
                  toast({ message: 'Free copy downloaded — ready to read.' })
                }} />
              </div>
            )}
            <input ref={fileInput} type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
            <div className="row">
              <button className="btn btn-ghost btn-small" onClick={() => fileInput.current?.click()} disabled={fileBusy}>
                <Icon name="upload" size={16} /> {fileBusy ? 'Reading file…' : book.file ? 'Replace file' : 'Attach PDF / EPUB'}
              </button>
              {book.file && (
                <button className="link-btn" onClick={() => detachFile(book).then(() => toast({ message: 'File removed. The book stays on the shelf.' }))}>
                  Remove file
                </button>
              )}
            </div>
            {fileError && <p className="file-error" role="alert">{fileError}</p>}
          </div>

          {/* The lower part of the card (favourite, status, genres…) joins once the cover has landed,
              so opening a book only builds what's on screen at first — smoother on phones. */}
          {settled && (<>
          {counts && counts.bookmark + counts.highlight + counts.note > 0 && (
            <p className="fine annot-summary">
              {counts.bookmark} flower bookmark{counts.bookmark === 1 ? '' : 's'} · {counts.highlight} highlight{counts.highlight === 1 ? '' : 's'} · {counts.note} note{counts.note === 1 ? '' : 's'}
            </p>
          )}

          <div className="row">
            <button
              className={`chip-btn ${book.favorite ? 'on' : ''}`}
              aria-pressed={book.favorite}
              onClick={() => updateBook(book.id, { favorite: !book.favorite })}
            >
              <Icon name={book.favorite ? 'heartFill' : 'heart'} size={16} /> {book.favorite ? 'Favorite' : 'Add to favorites'}
            </button>
          </div>

          <fieldset className="field">
            <legend>Status</legend>
            <div className="segmented">
              {(['want', 'reading', 'finished'] as const).map((s) => (
                <button key={s} className={book.status === s ? 'on' : ''} aria-pressed={book.status === s} onClick={() => updateBook(book.id, { status: s })}>
                  {{ want: 'Want to read', reading: 'Reading', finished: 'Finished' }[s]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Genres</legend>
            <div className="chips wrap">
              {genres.map((g) => (
                <button key={g} className={`chip ${book.genres.includes(g) ? 'on' : ''}`} aria-pressed={book.genres.includes(g)} onClick={() => toggleGenre(g)}>
                  {g}
                </button>
              ))}
            </div>
            <form
              className="inline-add"
              onSubmit={async (e) => {
                e.preventDefault()
                const g = newGenre.trim()
                if (!g) return
                await addCustomGenre(g)
                await updateBook(book.id, { genres: [...new Set([...book.genres, g])] })
                setNewGenre('')
              }}
            >
              <input className="input input-small" placeholder="New genre" value={newGenre} onChange={(e) => setNewGenre(e.target.value)} />
              <button className="btn btn-ghost btn-small" disabled={!newGenre.trim()}>Add</button>
            </form>
          </fieldset>

          <div className="detail-footer">
            <button className="link-btn danger" onClick={() => onRemove(book)}>
              <Icon name="trash" size={15} /> Remove from shelf
            </button>
          </div>
          </>)}
        </div>
      </div>
    </Dialog>
  )
}
