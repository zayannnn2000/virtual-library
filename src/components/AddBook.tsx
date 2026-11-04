import { useEffect, useRef, useState } from 'react'
import type { Book, ReadingStatus } from '../types'
import { getEditions, searchBooks, suggestGenres, type Edition, type SearchResult } from '../lib/metadata'
import { addBook, addCustomGenre, attachFile, findDuplicate, useGenres } from '../lib/library'
import { downloadGutenberg, downloadGutenbergCover, gutenbergCoverUrl, searchGutenberg, type FreeBook } from '../lib/gutenberg'
import { BatchImport } from './BatchImport'
import { ImportError, inspectFile, type FileInspection } from '../lib/fileImport'
import { Dialog, formatBytes, useToast } from './ui'
import { Icon } from './Art'
import { FetchOrUpload, OpenSearchResults } from './OpenSources'
import type { OpenResult, SearchMode, Verified } from '../lib/openSources'

type Step = 'search' | 'editions' | 'confirm'

interface Draft {
  title: string
  authors: string
  year?: number
  pages?: number
  isbn?: string
  olWorkKey?: string
  olEditionKey?: string
  coverUrl?: string
  coverSource: Book['coverSource']
  coverBlob?: Blob
  suggested: string[]
  genres: string[]
  status: ReadingStatus
}

export function AddBook({ onClose, onAdded, onOpenExisting, onRead }: {
  onClose: () => void
  onAdded: (b: Book) => void
  onOpenExisting: (b: Book) => void
  /** Open a book straight in the reader (after "Add & Read"). */
  onRead: (b: Book) => void
}) {
  const toast = useToast()
  // Free & open sources: what to search by, a counter that starts each search,
  // and the book picked for "Add & Read" / "Upload your copy".
  const [mode, setMode] = useState<SearchMode>('any')
  const [openRun, setOpenRun] = useState(0)
  const [flow, setFlow] = useState<{ result: OpenResult; verified?: Verified; start: 'fetch' | 'upload' }>()
  const [step, setStep] = useState<Step>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string>()
  const [picked, setPicked] = useState<SearchResult>()
  const [editions, setEditions] = useState<Edition[] | null>(null)
  const [editionsError, setEditionsError] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const [file, setFile] = useState<{ file: File; info: FileInspection }>()
  const [fileError, setFileError] = useState<string>()
  const [inspecting, setInspecting] = useState(false)
  const [duplicate, setDuplicate] = useState<Book>()
  const [saving, setSaving] = useState(false)
  const [free, setFree] = useState<FreeBook[] | null>(null)
  const [freeState, setFreeState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [freeBusy, setFreeBusy] = useState<Record<number, string>>({})
  const [batch, setBatch] = useState<File[]>()
  const abort = useRef<AbortController | undefined>(undefined)

  const runSearch = async (q = query) => {
    if (!q.trim()) return
    abort.current?.abort()
    const ctrl = (abort.current = new AbortController())
    setSearching(true)
    setSearchError(undefined)
    setOpenRun((n) => n + 1)
    // Free classics load alongside — Gutendex can be slow, so it never holds up the main results.
    setFree(null)
    setFreeState('loading')
    searchGutenberg(q, ctrl.signal).then(
      (r) => {
        if (abort.current !== ctrl) return
        setFree(r)
        setFreeState('idle')
      },
      (err) => {
        if (abort.current === ctrl && (err as Error).name !== 'AbortError') setFreeState('error')
      },
    )
    try {
      setResults(await searchBooks(q, ctrl.signal))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setSearchError((err as Error).message || 'Search failed.')
        setResults(null)
      }
    } finally {
      if (abort.current === ctrl) setSearching(false)
    }
  }
  useEffect(() => () => abort.current?.abort(), [])

  /** "Try again" for just the free classics, without redoing the whole search. */
  const retryFree = () => {
    const q = query.trim()
    if (!q) return
    setFreeState('loading')
    searchGutenberg(q).then(
      (r) => {
        setFree(r)
        setFreeState('idle')
      },
      () => setFreeState('error'),
    )
  }

  /** One tap: download a public-domain EPUB from Project Gutenberg straight onto the shelf. */
  const downloadFree = async (fb: FreeBook) => {
    setFreeBusy((s) => ({ ...s, [fb.id]: 'Downloading…' }))
    try {
      const epub = await downloadGutenberg(fb)
      const info = await inspectFile(epub)
      const existing = await findDuplicate(fb.title, fb.authors)
      if (existing?.file) {
        toast({ message: `“${existing.title}” is already on your shelf with a file.` })
        return onOpenExisting(existing)
      }
      if (existing) {
        await attachFile(existing, epub, 'epub')
        toast({ message: `Free copy attached to “${existing.title}”.` })
        return onOpenExisting(existing)
      }
      setFreeBusy((s) => ({ ...s, [fb.id]: 'Shelving…' }))
      const cover = (await downloadGutenbergCover(fb.id)) ?? info.coverBlob
      const book = await addBook({
        title: fb.title,
        authors: fb.authors,
        coverSource: cover ? 'file' : 'none',
        coverBlob: cover,
        genres: suggestGenres(fb.subjects),
        status: 'want',
        file: { file: epub, format: 'epub' },
      })
      toast({ message: `“${book.title}” is on your shelf, ready to read.` })
      onAdded(book)
    } catch (err) {
      setFreeBusy((s) => ({ ...s, [fb.id]: err instanceof ImportError ? err.message : (err as Error).message || 'Download failed.' }))
      return
    }
  }

  const onFiles = (files: File[]) => {
    if (files.length > 1) setBatch(files)
    else onFile(files[0])
  }

  const onFile = async (f?: File) => {
    if (!f) return
    setFileError(undefined)
    setInspecting(true)
    try {
      const info = await inspectFile(f)
      setFile({ file: f, info })
      const q = [info.title, info.authors[0]].filter(Boolean).join(' ')
      if (step === 'search' && q) {
        setQuery(q)
        runSearch(q)
      }
    } catch (err) {
      setFileError(err instanceof ImportError ? err.message : "That file couldn't be read.")
    } finally {
      setInspecting(false)
    }
  }

  const choose = async (r: SearchResult) => {
    setPicked(r)
    if (r.source === 'openlibrary' && r.olWorkKey && (r.editionCount ?? 0) > 1) {
      setStep('editions')
      setEditions(null)
      setEditionsError(undefined)
      try {
        setEditions(await getEditions(r.olWorkKey))
      } catch {
        setEditionsError("Couldn't load editions. You can still use the main edition.")
        setEditions([])
      }
    } else {
      confirmFrom(r)
    }
  }

  const confirmFrom = async (r: SearchResult, e?: Edition) => {
    const suggested = suggestGenres(r.subjects)
    const coverUrl = e?.coverUrl ?? r.coverUrl
    const d: Draft = {
      title: r.title,
      authors: r.authors.join(', '),
      year: r.year,
      pages: e?.pages ?? r.pages,
      isbn: e?.isbn ?? r.isbn,
      olWorkKey: r.olWorkKey,
      olEditionKey: e?.key,
      coverUrl,
      coverSource: coverUrl ? r.source : file?.info.coverBlob ? 'file' : 'none',
      coverBlob: coverUrl ? undefined : file?.info.coverBlob,
      suggested,
      genres: suggested,
      status: 'want',
    }
    setDraft(d)
    setDuplicate(await findDuplicate(d.title, r.authors, r.olWorkKey))
    setStep('confirm')
  }

  const confirmWithoutMatch = async () => {
    const title = file?.info.title || query.trim()
    const authors = file?.info.authors ?? []
    setPicked(undefined)
    setDraft({
      title,
      authors: authors.join(', '),
      pages: file?.info.pages,
      coverSource: file?.info.coverBlob ? 'file' : 'none',
      coverBlob: file?.info.coverBlob,
      suggested: [],
      genres: [],
      status: 'want',
    })
    setDuplicate(await findDuplicate(title, authors))
    setStep('confirm')
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const book = await addBook({
        title: draft.title,
        authors: draft.authors.split(',').map((s) => s.trim()).filter(Boolean),
        year: draft.year,
        pages: file?.info.format === 'pdf' ? file.info.pages : draft.pages,
        isbn: draft.isbn,
        olWorkKey: draft.olWorkKey,
        olEditionKey: draft.olEditionKey,
        coverUrl: draft.coverUrl,
        coverSource: draft.coverSource,
        coverBlob: draft.coverBlob,
        genres: draft.genres,
        status: draft.status,
        file: file ? { file: file.file, format: file.info.format } : undefined,
      })
      toast({ message: `“${book.title}” is on your shelf.` })
      onAdded(book)
    } catch {
      setSaving(false)
    }
  }

  return (
    <Dialog label="Add a book" onClose={onClose} className="add-dialog">
      <header className="dialog-head">
        <p className="eyebrow">Add a book</p>
        <h2>
          {flow ? (flow.start === 'fetch' ? 'Add & read' : 'Add your copy') : step === 'search' ? 'Find it' : step === 'editions' ? 'Which edition is yours?' : 'Almost on the shelf'}
        </h2>
      </header>

      {flow && (
        <FetchOrUpload
          key={flow.result.key + flow.start}
          result={flow.result}
          verified={flow.verified}
          start={flow.start}
          onBack={() => setFlow(undefined)}
          onSaved={(book, message) => {
            if (message) toast({ message })
            onRead(book)
          }}
        />
      )}

      {flow ? null : batch ? (
        <BatchImport files={batch} onDone={onClose} />
      ) : (
        <FileSlot file={file} error={fileError} busy={inspecting} onFiles={onFiles} onClear={() => setFile(undefined)} />
      )}

      {!flow && !batch && step === 'search' && (
        <div className="add-search">
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault()
              runSearch()
            }}
          >
            <label className="sr-only" htmlFor="add-q">Title, author or ISBN</label>
            <input
              id="add-q"
              data-autofocus
              className="input"
              placeholder="Title, author or ISBN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <button className="btn" disabled={!query.trim() || searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          <div className="chips search-modes" role="group" aria-label="Search by">
            {(['any', 'title', 'author', 'isbn'] as const).map((m) => (
              <button key={m} type="button" className={`chip ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {{ any: 'Anything', title: 'Title', author: 'Author', isbn: 'ISBN' }[m]}
              </button>
            ))}
          </div>

          {/* Clean, proofread classics first; then scans and open-access books from the other sources. */}
          <FreeClassics free={free} freeState={freeState} freeBusy={freeBusy} onDownload={downloadFree} onRetry={retryFree} />

          <OpenSearchResults
            query={query}
            mode={mode}
            run={openRun}
            onAddRead={(result, verified) => setFlow({ result, verified, start: 'fetch' })}
            onUpload={(result) => setFlow({ result, start: 'upload' })}
          />
          {(searching || results) && <h3 className="section-label">Book details · add with your own copy</h3>}

          {searching && (
            <ul className="results" aria-busy>
              {[0, 1, 2].map((i) => (
                <li key={i} className="result skeleton" />
              ))}
            </ul>
          )}
          {!searching && searchError && (
            <div className="state-box error">
              <p>{searchError}</p>
              <button className="btn btn-ghost" onClick={() => runSearch()}>Try again</button>
              {file && <button className="btn btn-ghost" onClick={confirmWithoutMatch}>Add from the file instead</button>}
            </div>
          )}
          {!searching && results && results.length === 0 && (
            <div className="state-box">
              <p>No books matched “{query}”. Try fewer words, the author's surname, or the ISBN.</p>
              <button className="btn btn-ghost" onClick={confirmWithoutMatch}>Add it by hand</button>
            </div>
          )}
          {!searching && results && results.length > 0 && (
            <>
              <ul className="results">
                {results.map((r) => (
                  <li key={r.id}>
                    <button className="result" onClick={() => choose(r)}>
                      <span className="result-cover">
                        {r.coverUrl ? <img src={r.coverUrl.replace('-L.jpg', '-S.jpg')} alt="" loading="lazy" /> : <span className="no-cover" />}
                      </span>
                      <span className="result-body">
                        <strong>{r.title}</strong>
                        <span>{r.authors.join(', ') || 'Unknown author'}{r.year ? ` · ${r.year}` : ''}</span>
                        <span className="badges">
                          <span className="badge">Book info</span>
                          {r.coverUrl && <span className="badge">Cover</span>}
                          {(r.editionCount ?? 0) > 1 && <span className="badge soft">{r.editionCount} editions</span>}
                        </span>
                      </span>
                    </button>
                    {r.publicDomainUrl && (
                      <a className="badge link" href={r.publicDomainUrl} target="_blank" rel="noreferrer">
                        Free public-domain copy · Internet Archive <Icon name="link" size={12} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <button className="link-btn" onClick={confirmWithoutMatch}>None of these — add it by hand</button>
            </>
          )}
          {!searching && !results && !searchError && (
            <p className="state-quiet">Search to find the real cover and details — or a free classic to download.</p>
          )}
        </div>
      )}

      {step === 'editions' && picked && (
        <div>
          <button className="link-btn" onClick={() => setStep('search')}>
            <Icon name="chevL" size={14} /> Back to results
          </button>
          {editions === null && <p className="state-quiet">Looking through editions…</p>}
          {editionsError && <p className="state-quiet">{editionsError}</p>}
          {editions && (
            <ul className="editions">
              <li>
                <button className="edition" onClick={() => confirmFrom(picked)}>
                  <span className="result-cover">{picked.coverUrl ? <img src={picked.coverUrl.replace('-L.jpg', '-M.jpg')} alt="" /> : <span className="no-cover" />}</span>
                  <span><strong>Main edition</strong><span className="fine">Most common cover</span></span>
                </button>
              </li>
              {editions.slice(0, 18).map((e) => (
                <li key={e.key}>
                  <button className="edition" onClick={() => confirmFrom(picked, e)}>
                    <span className="result-cover">{e.coverUrl ? <img src={e.coverUrl.replace('-L.jpg', '-M.jpg')} alt="" loading="lazy" /> : <span className="no-cover" />}</span>
                    <span>
                      <strong>{e.publisher ?? 'Unknown publisher'}</strong>
                      <span className="fine">{[e.year, e.language?.toUpperCase(), e.pages && `${e.pages} pp`, e.isbn && `ISBN ${e.isbn}`].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 'confirm' && draft && (
        <ConfirmStep
          draft={draft}
          setDraft={setDraft}
          duplicate={duplicate}
          saving={saving}
          hasFile={!!file}
          onBack={() => setStep('search')}
          onSave={save}
          onOpenExisting={onOpenExisting}
        />
      )}
    </Dialog>
  )
}

/** Public-domain books that come with a readable file — shown first because they're one tap from reading. */
function FreeClassics({ free, freeState, freeBusy, onDownload, onRetry }: {
  free: FreeBook[] | null
  freeState: 'idle' | 'loading' | 'error'
  freeBusy: Record<number, string>
  onDownload: (fb: FreeBook) => void
  onRetry?: () => void
}) {
  if (freeState === 'error')
    return (
      <p className="fine">
        Free classics couldn't be searched just now.{' '}
        {onRetry && <button className="link-btn" onClick={onRetry}>Try again</button>}
      </p>
    )
  if (freeState !== 'loading' && !free?.length) return null
  return (
    <section className="free-section" aria-label="Free classics from Project Gutenberg">
      <h3>
        Best free editions <span className="fine">· clean, proofread classics from Project Gutenberg</span>
      </h3>
      {freeState === 'loading' && <p className="state-quiet">Looking for free copies…</p>}
      {free && (
        <ul className="results">
          {free.map((fb) => {
            const busy = freeBusy[fb.id]
            const working = busy === 'Downloading…' || busy === 'Shelving…'
            return (
              <li key={fb.id} className="free-item">
                <span className="result-cover">
                  <img src={gutenbergCoverUrl(fb.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                </span>
                <span className="result-body">
                  <strong>{fb.title}</strong>
                  <span>{fb.authors.join(', ') || 'Unknown author'}</span>
                  <span className="badges">
                    <span className="badge free">Readable file · free</span>
                  </span>
                  {busy && !working && <span className="file-error" role="alert">{busy}</span>}
                </span>
                <button className="btn btn-small" onClick={() => onDownload(fb)} disabled={working}>
                  {working ? busy : 'Download to shelf'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function FileSlot({ file, error, busy, onFiles, onClear }: {
  file?: { file: File; info: FileInspection }
  error?: string
  busy: boolean
  onFiles: (files: File[]) => void
  onClear: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`file-slot ${over ? 'over' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files])
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      {busy ? (
        <span>Reading the file…</span>
      ) : file ? (
        <>
          <span className="file-chip">
            <Icon name="book" size={16} /> {file.file.name} · {file.info.format.toUpperCase()} · {formatBytes(file.file.size)}
            {file.info.pages ? ` · ${file.info.pages} pages` : ''}
          </span>
          <button className="link-btn" onClick={onClear}>Remove</button>
        </>
      ) : (
        <>
          <span>Have PDFs or EPUBs? <span className="fine">Drop one or several here, or</span></span>
          <button className="btn btn-ghost btn-small" onClick={() => input.current?.click()}>
            <Icon name="upload" size={16} /> Choose files
          </button>
        </>
      )}
      {error && <p className="file-error" role="alert">{error}</p>}
    </div>
  )
}

function ConfirmStep({ draft, setDraft, duplicate, saving, hasFile, onBack, onSave, onOpenExisting }: {
  draft: Draft
  setDraft: (d: Draft) => void
  duplicate?: Book
  saving: boolean
  hasFile: boolean
  onBack: () => void
  onSave: () => void
  onOpenExisting: (b: Book) => void
}) {
  const genres = useGenres()
  const [newGenre, setNewGenre] = useState('')
  const coverInput = useRef<HTMLInputElement>(null)
  const [blobUrl, setBlobUrl] = useState<string>()
  useEffect(() => {
    if (!draft.coverBlob) return setBlobUrl(undefined)
    const u = URL.createObjectURL(draft.coverBlob)
    setBlobUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [draft.coverBlob])
  const coverSrc = draft.coverBlob ? blobUrl : draft.coverUrl
  const sourceNote = {
    openlibrary: 'Published cover · Open Library',
    google: 'Published cover · Google Books',
    archive: 'Cover · Internet Archive',
    file: 'Cover taken from your file',
    upload: 'Your own cover',
    none: 'No cover found — it will get a plain cloth cover',
  }[draft.coverSource]

  const toggle = (g: string) =>
    setDraft({ ...draft, genres: draft.genres.includes(g) ? draft.genres.filter((x) => x !== g) : [...draft.genres, g] })

  return (
    <div className="confirm">
      <button className="link-btn" onClick={onBack}>
        <Icon name="chevL" size={14} /> Back
      </button>
      {duplicate && (
        <div className="state-box warn" role="alert">
          <p>“{duplicate.title}” is already on your shelf.</p>
          <button className="btn btn-ghost btn-small" onClick={() => onOpenExisting(duplicate)}>Open that one</button>
        </div>
      )}
      <div className="confirm-grid">
        <figure className="confirm-cover">
          {coverSrc ? <img src={coverSrc} alt={`Cover of ${draft.title}`} /> : <div className="cloth-cover"><span>{draft.title}</span></div>}
          <figcaption className="fine">{sourceNote}</figcaption>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setDraft({ ...draft, coverBlob: f, coverSource: 'upload' })
            }}
          />
          <button className="link-btn" onClick={() => coverInput.current?.click()}>Use my own image</button>
        </figure>
        <div className="confirm-fields">
          <label className="field">
            <span>Title</span>
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Author</span>
            <input className="input" value={draft.authors} onChange={(e) => setDraft({ ...draft, authors: e.target.value })} />
          </label>
          <fieldset className="field">
            <legend>Genres {draft.suggested.length > 0 && <span className="fine">· suggested ones are ticked, change freely</span>}</legend>
            <div className="chips wrap">
              {genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`chip ${draft.genres.includes(g) ? 'on' : ''}`}
                  aria-pressed={draft.genres.includes(g)}
                  onClick={() => toggle(g)}
                >
                  {g}
                  {draft.suggested.includes(g) && <span className="sugg" title="Suggested from the book's subjects">✦</span>}
                </button>
              ))}
            </div>
            {draft.genres.length === 0 && <p className="fine">Leaving it blank files it under Uncategorized.</p>}
            <form
              className="inline-add"
              onSubmit={async (e) => {
                e.preventDefault()
                const g = newGenre.trim()
                if (!g) return
                await addCustomGenre(g)
                setDraft({ ...draft, genres: [...new Set([...draft.genres, g])] })
                setNewGenre('')
              }}
            >
              <input className="input input-small" placeholder="New genre" value={newGenre} onChange={(e) => setNewGenre(e.target.value)} />
              <button className="btn btn-ghost btn-small" disabled={!newGenre.trim()}>Add</button>
            </form>
          </fieldset>
          <fieldset className="field">
            <legend>Status</legend>
            <div className="segmented">
              {(['want', 'reading', 'finished'] as const).map((s) => (
                <button key={s} type="button" className={draft.status === s ? 'on' : ''} aria-pressed={draft.status === s} onClick={() => setDraft({ ...draft, status: s })}>
                  {{ want: 'Want to read', reading: 'Reading', finished: 'Finished' }[s]}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="fine">{hasFile ? 'The file above will be attached so she can read it here.' : 'No file attached — it will sit on the shelf, and a file can be added any time.'}</p>
        </div>
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={onSave} disabled={saving || !draft.title.trim()}>
          {saving ? 'Shelving…' : duplicate ? 'Add another copy' : 'Put it on the shelf'}
        </button>
      </div>
    </div>
  )
}
