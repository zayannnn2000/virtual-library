import { useEffect, useRef, useState } from 'react'
import type { Book } from '../types'
import {
  FetchBookError,
  SOURCE_NAMES,
  detectMode,
  fetchBookFile,
  groupResults,
  languageName,
  matchTier,
  normalTitle,
  searchArchive,
  searchGoogle,
  searchOpenAccess,
  verify,
  type OpenResult,
  type ResultGroup,
  type SearchMode,
  type SourceId,
  type SourceStatus,
  type Verified,
} from '../lib/openSources'
import { addBook, attachFile, findBySource, findDuplicate } from '../lib/library'
import { ImportError, inspectFile, type FileInspection } from '../lib/fileImport'
import { db } from '../db'
import { formatBytes } from './ui'
import { Icon } from './Art'

const ACCESS_LABEL = {
  full: 'Full book · free to keep',
  preview: 'Preview only',
  borrow: 'Borrow only',
  restricted: 'Restricted',
  metadata: 'Details only',
} as const

/* ---------- search results ---------- */

/**
 * Searches Internet Archive, Google Books, OAPEN and DOAB together, merges
 * editions of the same book, and checks — for real — which ones have a whole
 * PDF/EPUB that can be fetched. "Add & Read" only lights up once that check passes.
 */
export function OpenSearchResults({ query, mode, run, onAddRead, onUpload }: {
  query: string
  mode: SearchMode
  /** Bumped on each search. */
  run: number
  onAddRead: (r: OpenResult, v: Verified) => void
  onUpload: (r: OpenResult) => void
}) {
  const [status, setStatus] = useState<Partial<Record<SourceId, SourceStatus>>>({})
  const [results, setResults] = useState<OpenResult[]>([])
  const [checks, setChecks] = useState<Record<string, Verified | 'checking'>>({})

  useEffect(() => {
    if (!run || !query.trim()) return
    const ctrl = new AbortController()
    const m = detectMode(query, mode)
    setResults([])
    setChecks({})
    const sources: [SourceId, () => Promise<OpenResult[]>][] = [
      ['archive', () => searchArchive(query, m, ctrl.signal)],
      ['google', () => searchGoogle(query, m, ctrl.signal)],
      ['oapen', () => searchOpenAccess('oapen', query, m, ctrl.signal)],
      ['doab', () => searchOpenAccess('doab', query, m, ctrl.signal)],
    ]
    setStatus(Object.fromEntries(sources.map(([s]) => [s, { state: 'loading' }])))
    for (const [s, go] of sources) {
      go().then(
        (rs) => {
          if (ctrl.signal.aborted) return
          setStatus((st) => ({ ...st, [s]: { state: 'ok' } }))
          setResults((all) => [...all, ...rs])
          // Check the downloadable ones for real, a few at a time — closest matches to her search first.
          const q = m === 'isbn' ? '' : query
          const full = rs
            .filter((r) => r.access === 'full')
            .map((r, i) => ({ r, i, t: matchTier(r, q) }))
            .sort((a, b) => a.t - b.t || a.i - b.i)
            .slice(0, 8)
            .map((x) => x.r)
          setChecks((c) => ({ ...c, ...Object.fromEntries(full.map((r) => [r.key, 'checking' as const])) }))
          ;(async () => {
            for (let i = 0; i < full.length; i += 3) {
              await Promise.all(
                full.slice(i, i + 3).map(async (r) => {
                  const v = await verify(r, ctrl.signal).catch(() => null)
                  if (v && !ctrl.signal.aborted) setChecks((c) => ({ ...c, [r.key]: v }))
                }),
              )
            }
          })()
        },
        (err: Error) => {
          if (ctrl.signal.aborted) return
          setStatus((st) => ({ ...st, [s]: { state: 'unavailable', message: err.message } }))
        },
      )
    }
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  if (!run) return null
  const groups = groupResults(results, detectMode(query, mode) === 'isbn' ? '' : query)
  const loading = Object.values(status).some((s) => s?.state === 'loading')
  const shown = groups.slice(0, 14)

  return (
    <section className="open-section" aria-label="Free and open books">
      <header className="open-head">
        <h3>Find it free & open</h3>
        <ul className="source-status" aria-label="Sources">
          {(Object.keys(SOURCE_NAMES) as SourceId[]).map((s) => (
            <li key={s} className={`src-${status[s]?.state ?? 'loading'}`} title={status[s]?.message}>
              <span className="dot" /> {SOURCE_NAMES[s]}
              {status[s]?.state === 'unavailable' && <span className="src-why"> — {status[s]?.message}</span>}
            </li>
          ))}
        </ul>
      </header>
      {loading && !groups.length && (
        <ul className="results" aria-busy>
          {[0, 1].map((i) => (
            <li key={i} className="result skeleton" />
          ))}
        </ul>
      )}
      {!loading && !groups.length && <p className="state-quiet">No free or open copies turned up — the book’s details below can still go on your shelf, with your own copy.</p>}
      <ul className="open-results">
        {shown.map((g) => (
          <GroupCard key={g.key} group={g} checks={checks} onAddRead={onAddRead} onUpload={onUpload} />
        ))}
      </ul>
    </section>
  )
}

function GroupCard({ group, checks, onAddRead, onUpload }: {
  group: ResultGroup
  checks: Record<string, Verified | 'checking'>
  onAddRead: (r: OpenResult, v: Verified) => void
  onUpload: (r: OpenResult) => void
}) {
  const [open, setOpen] = useState(false)
  // Show the version that's actually ready first; never lead with one whose file failed its check
  // while another copy is still in the running.
  const failed = (r: OpenResult) => {
    const c = checks[r.key]
    return r.access === 'full' && !!c && c !== 'checking' && !c.ok
  }
  const ready = group.all.find((r) => {
    const c = checks[r.key]
    return c && c !== 'checking' && c.ok
  })
  const best = ready ?? group.all.find((r) => r.access === 'full' && !failed(r)) ?? group.all.find((r) => !failed(r)) ?? group.best
  const others = group.all.filter((r) => r !== best)
  return (
    <li className="open-group">
      <ResultCard r={best} check={checks[best.key]} onAddRead={onAddRead} onUpload={onUpload} />
      {others.length > 0 && (
        <>
          <button className="link-btn editions-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} {others.length} other edition{others.length === 1 ? '' : 's'} / source{others.length === 1 ? '' : 's'}
          </button>
          {open && (
            <ul className="open-editions">
              {others.map((r) => (
                <li key={r.key}>
                  <ResultCard r={r} check={checks[r.key]} onAddRead={onAddRead} onUpload={onUpload} compact />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}

function ResultCard({ r, check, onAddRead, onUpload, compact }: {
  r: OpenResult
  check?: Verified | 'checking'
  onAddRead: (r: OpenResult, v: Verified) => void
  onUpload: (r: OpenResult) => void
  compact?: boolean
}) {
  const verified = check && check !== 'checking' ? check : undefined
  const ready = r.access === 'full' && verified?.ok
  const checking = r.access === 'full' && (!check || check === 'checking')
  const failedCheck = r.access === 'full' && verified && !verified.ok
  const access = failedCheck ? 'metadata' : r.access
  const edition = [r.publisher, r.year].filter(Boolean).join(', ')
  return (
    <div className={`open-card ${compact ? 'compact' : ''}`}>
      <span className="result-cover">{r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" /> : <span className="no-cover" />}</span>
      <span className="open-body">
        <strong>{r.title}</strong>
        <span>{r.authors.join(', ') || 'Unknown author'}</span>
        <span className="fine">{[edition, languageName(r.language), r.isbn && `ISBN ${r.isbn}`].filter(Boolean).join(' · ')}</span>
        <span className="badges">
          <span className={`badge access-${access}`}>{ready ? ACCESS_LABEL.full : checking ? 'Checking the file…' : ACCESS_LABEL[access]}</span>
          <span className="badge soft">{SOURCE_NAMES[r.source]}</span>
          {ready && verified.file && (
            <span className="badge soft">
              {verified.file.format.toUpperCase()}
              {verified.file.size ? ` · ${formatBytes(verified.file.size)}` : ''}
            </span>
          )}
          {r.license && (r.access === 'full' || ready) && <span className="badge soft">{r.license}</span>}
        </span>
        {!ready && !checking && <span className="fine open-note">{failedCheck ? verified.message : r.note}</span>}
        {ready && (verified.file?.size ?? 0) > 60 * 1024 * 1024 && (
          <span className="fine open-note">A large scan — it may take a few minutes to fetch.</span>
        )}
      </span>
      <span className="open-actions">
        <button className="btn btn-small" disabled={!ready} onClick={() => ready && onAddRead(r, verified)} title={ready ? 'Fetch it, save it to your library and open it' : 'Only for books with a full, free file'}>
          <Icon name="book" size={15} /> Add &amp; Read
        </button>
        {!ready && !checking && (
          <button className="btn btn-ghost btn-small" onClick={() => onUpload(r)}>
            <Icon name="upload" size={15} /> Upload your copy
          </button>
        )}
        {(r.access === 'preview' || r.access === 'borrow' || !ready) && (
          <a className="link-btn small" href={r.pageUrl} target="_blank" rel="noreferrer">
            {r.access === 'preview' ? 'Read the preview' : r.access === 'borrow' ? 'Borrow on Internet Archive' : `View on ${SOURCE_NAMES[r.source]}`} <Icon name="link" size={12} />
          </a>
        )}
      </span>
    </div>
  )
}

/* ---------- fetch → (or upload) → save → read ---------- */

type Phase =
  | { kind: 'checking' }
  | { kind: 'already'; book: Book }
  | { kind: 'fetching'; progress: number }
  | { kind: 'saving' }
  | { kind: 'failed'; message: string; retryable: boolean }
  | { kind: 'upload'; error?: string; reason?: string }
  | { kind: 'confirm'; file: File; info: FileInspection }

/**
 * The selected book stays on screen the whole time: it's fetched (with progress)
 * and saved — or, if there's no file it can fetch, she uploads her own copy,
 * confirms it's the right book, and it's saved with these same details.
 * Nothing says "saved" until the file is actually in her library.
 */
export function FetchOrUpload({ result, verified, start, onBack, onSaved }: {
  result: OpenResult
  verified?: Verified
  start: 'fetch' | 'upload'
  onBack: () => void
  onSaved: (book: Book, message: string) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const ctrl = useRef<AbortController | undefined>(undefined)
  const started = useRef(0)

  // Imported before? Then there's nothing to fetch or upload — just read it.
  const existing = async () => {
    const bySource = await findBySource(result.key)
    const dup = bySource ?? (await findDuplicate(result.title, result.authors))
    return dup
  }

  const fetchIt = async () => {
    const file = verified?.file
    if (!file) return setPhase({ kind: 'upload', reason: 'We couldn’t fetch this book. Upload your PDF or EPUB to add it to your library.' })
    ctrl.current?.abort()
    const c = (ctrl.current = new AbortController())
    started.current = Date.now()
    setPhase({ kind: 'fetching', progress: 0 })
    try {
      const blob = await fetchBookFile(file, (p) => setPhase({ kind: 'fetching', progress: p }), c.signal)
      const named = new File([blob], `${safeName(result.title)}.${file.format}`, { type: blob.type })
      const info = await inspectFile(named) // the file is checked again here, in the app
      await save(named, info, 'fetched')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const retryable = err instanceof FetchBookError ? err.retryable : false
      const message = err instanceof FetchBookError || err instanceof ImportError ? err.message : 'Something went wrong while fetching the book.'
      setPhase({ kind: 'failed', message, retryable })
    }
  }

  const save = async (file: File, info: FileInspection, via: 'fetched' | 'uploaded') => {
    setPhase({ kind: 'saving' })
    const source = { name: SOURCE_NAMES[result.source], id: result.key, url: result.pageUrl, license: result.license, licenseUrl: result.licenseUrl, via }
    try {
      const dup = await existing()
      if (dup?.file) return setPhase({ kind: 'already', book: dup })
      let book: Book
      if (dup) {
        await attachFile(dup, file, info.format, info.pages, source)
        book = (await db.books.get(dup.id))!
      } else {
        const coverSource = result.coverUrl ? (result.source === 'google' ? 'google' : result.source === 'archive' ? 'archive' : 'none') : info.coverBlob ? 'file' : 'none'
        book = await addBook({
          title: result.title,
          authors: result.authors,
          year: result.year,
          pages: info.format === 'pdf' ? info.pages : undefined,
          isbn: result.isbn,
          coverUrl: coverSource === 'google' || coverSource === 'archive' ? result.coverUrl : undefined,
          coverSource,
          coverBlob: coverSource === 'file' ? info.coverBlob : undefined,
          genres: [],
          status: 'reading',
          file: { file, format: info.format },
          source,
          language: result.language,
          publisher: result.publisher,
        })
      }
      // Saved for real (the file is in her library) — only now say so.
      onSaved(book, via === 'fetched' ? `“${book.title}” is saved in your library.` : `Your copy of “${book.title}” is saved in your library.`)
    } catch (err) {
      const quota = (err as Error)?.name === 'QuotaExceededError'
      setPhase({
        kind: 'failed',
        message: quota ? 'Your device’s storage is full, so the book couldn’t be saved. Free up some space and try again.' : 'The book couldn’t be saved to your library. Please try again.',
        retryable: via === 'fetched',
      })
    }
  }

  const pick = async (f?: File) => {
    if (!f) return
    try {
      const info = await inspectFile(f)
      setPhase({ kind: 'confirm', file: f, info })
    } catch (err) {
      setPhase({ kind: 'upload', error: err instanceof ImportError ? err.message : 'That file couldn’t be read. Try a PDF or EPUB.' })
    }
  }

  useEffect(() => {
    ;(async () => {
      const dup = await existing()
      if (dup?.file) return setPhase({ kind: 'already', book: dup })
      if (start === 'fetch') fetchIt()
      else setPhase({ kind: 'upload', reason: result.access === 'full' ? undefined : uploadReason(result) })
    })()
    return () => ctrl.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const edition = [result.publisher, result.year, languageName(result.language)].filter(Boolean).join(' · ')
  return (
    <div className="fetch-flow">
      <button className="link-btn" onClick={onBack}>
        <Icon name="chevL" size={14} /> Back to results
      </button>
      <div className="fetch-book">
        <span className="result-cover big">{result.coverUrl ? <img src={result.coverUrl} alt="" /> : <span className="no-cover" />}</span>
        <div>
          <strong>{result.title}</strong>
          <p>{result.authors.join(', ') || 'Unknown author'}</p>
          <p className="fine">{[edition, `From ${SOURCE_NAMES[result.source]}`, result.license].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {phase.kind === 'checking' && <p className="state-quiet">Checking your library…</p>}

      {phase.kind === 'already' && (
        <div className="state-box">
          <p>“{phase.book.title}” is already in your library with its file — no need to fetch it again.</p>
          <button className="btn" onClick={() => onSaved(phase.book, '')}>
            <Icon name="book" size={16} /> Read it
          </button>
        </div>
      )}

      {phase.kind === 'fetching' && (
        <div className="fetch-progress" role="status" aria-live="polite">
          <p>Fetching the {verified?.file?.format.toUpperCase()} from {SOURCE_NAMES[result.source]}…</p>
          <div className={`bar ${phase.progress < 0 ? 'indeterminate' : ''}`}>
            <span style={{ width: `${Math.round(Math.max(0, phase.progress) * 100)}%` }} />
          </div>
          <p className="fine">
            {phase.progress >= 0 ? `${Math.round(phase.progress * 100)}%` : 'Downloading…'}
            {verified?.file?.size ? ` of ${formatBytes(verified.file.size)}` : ''}
            {timeLeft(started.current, phase.progress)}
          </p>
          <button className="link-btn" onClick={() => { ctrl.current?.abort(); setPhase({ kind: 'failed', message: 'Fetching was cancelled.', retryable: true }) }}>Cancel</button>
        </div>
      )}

      {phase.kind === 'saving' && <p className="state-quiet" role="status">Saving to your library…</p>}

      {phase.kind === 'failed' && (
        <div className="state-box error" role="alert">
          <p><strong>We couldn’t fetch this book.</strong> Upload your PDF or EPUB to add it to your library.</p>
          <p className="fine">{phase.message}</p>
          <div className="row">
            <button className="btn" onClick={() => input.current?.click()}>
              <Icon name="upload" size={16} /> Upload your copy
            </button>
            {phase.retryable && verified?.file && (
              <button className="btn btn-ghost" onClick={fetchIt}>Retry</button>
            )}
          </div>
        </div>
      )}

      {phase.kind === 'upload' && (
        <div
          className={`upload-zone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            pick(e.dataTransfer.files[0])
          }}
        >
          <p><strong>{phase.reason ?? 'We couldn’t fetch this book. Upload your PDF or EPUB to add it to your library.'}</strong></p>
          <button className="btn upload-big" onClick={() => input.current?.click()}>
            <Icon name="upload" size={18} /> Upload your copy
          </button>
          <p className="fine">…or drop the PDF or EPUB here. The details and cover above will be kept.</p>
          {phase.error && <p className="pin-error" role="alert">{phase.error}</p>}
        </div>
      )}

      {phase.kind === 'confirm' && (
        <ConfirmUpload
          result={result}
          file={phase.file}
          info={phase.info}
          onYes={() => save(phase.file, phase.info, 'uploaded')}
          onNo={() => setPhase({ kind: 'upload' })}
        />
      )}

      <input
        ref={input}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          pick(f)
        }}
      />
    </div>
  )
}

function ConfirmUpload({ result, file, info, onYes, onNo }: { result: OpenResult; file: File; info: FileInspection; onYes: () => void; onNo: () => void }) {
  const fileTitle = info.title?.trim()
  const matches = !fileTitle || normalTitle(fileTitle).includes(normalTitle(result.title)) || normalTitle(result.title).includes(normalTitle(fileTitle))
  return (
    <div className="state-box confirm-upload">
      <p><strong>Is this file “{result.title}”?</strong></p>
      <p className="fine">
        {file.name} · {info.format.toUpperCase()} · {formatBytes(file.size)}
        {info.pages ? ` · ${info.pages} pages` : ''}
      </p>
      {fileTitle && (
        <p className={matches ? 'fine' : 'mismatch'}>
          {matches ? `The file calls itself “${fileTitle}” — looks like a match.` : `Heads up: the file calls itself “${fileTitle}”. Make sure it’s the right book and edition.`}
        </p>
      )}
      <div className="row">
        <button className="btn" onClick={onYes}>
          <Icon name="check" size={16} /> Yes — save &amp; read
        </button>
        <button className="btn btn-ghost" onClick={onNo}>Choose a different file</button>
      </div>
    </div>
  )
}

function uploadReason(r: OpenResult) {
  if (r.access === 'borrow') return 'This book can only be borrowed on Internet Archive. Upload your own PDF or EPUB to add it to your library.'
  if (r.access === 'preview') return 'Only a preview is available. Upload your own PDF or EPUB to add it to your library.'
  return 'We couldn’t fetch this book. Upload your PDF or EPUB to add it to your library.'
}

/** " · about 2 min left", once there's enough progress to guess from. */
function timeLeft(start: number, p: number) {
  const elapsed = (Date.now() - start) / 1000
  if (p <= 0.03 || p >= 1 || elapsed < 3) return ''
  const left = (elapsed * (1 - p)) / p
  return left < 60 ? ` · about ${Math.max(5, Math.round(left / 5) * 5)} sec left` : ` · about ${Math.round(left / 60)} min left`
}

const safeName = (t: string) => t.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'book'
