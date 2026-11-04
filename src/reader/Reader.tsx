import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { canFetchRemote, db, deleteAnnotation, downloadBlob, getFileBlob, getSetting, putAnnotation, setSetting, uid, updateBook } from '../db'
import type { Annotation, FlowerKind, HighlightColor } from '../types'
import { FLOWERS, HIGHLIGHTS, Icon, NOTE_COLORS, PressedFlower, STICKERS, Sticker, highlightFill } from '../components/Art'
import { prefersReducedMotion, useToast } from '../components/ui'
import { PdfView } from './PdfView'
import { StickyLayer } from './StickyLayer'
import { EpubView } from './EpubView'
import { DEFAULT_PREFS, type ReaderPrefs, type Relocation, type TextSelection, type ViewHandle } from './types'

type Panel = null | 'notes' | 'type' | 'flowers' | 'pen'
/** The highlighter in her hand: a colour, the eraser, or nothing. */
type Pen = HighlightColor | 'erase' | null
type Anchor = { x: number; y: number; bottom: number }

export default function Reader({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const toast = useToast()
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const blob = useLiveQuery(async () => (await getFileBlob(bookId)) ?? null, [bookId, book?.file?.addedAt])
  const annotations = useLiveQuery(() => db.annotations.where('bookId').equals(bookId).sortBy('createdAt'), [bookId]) ?? []
  // The file lives in her cloud library but not on this device yet: bring it down once.
  const [fetching, setFetching] = useState<'idle' | 'loading' | string>('idle')
  useEffect(() => {
    if (blob !== null || !book?.file || !canFetchRemote()) return
    setFetching('loading')
    downloadBlob(bookId, 'file').then(
      () => setFetching('idle'),
      (err: Error) => setFetching(err.message),
    )
  }, [blob, book?.file, bookId])
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [where, setWhere] = useState<Relocation>()
  const [selection, setSelection] = useState<TextSelection | null>(null)
  const [hlMenu, setHlMenu] = useState<{ id: string; anchor: Anchor }>()
  const [editing, setEditing] = useState<Annotation>()
  const [panel, setPanel] = useState<Panel>(null)
  // "Sticky note" pressed: the next tap on the page says where the note goes.
  const [placing, setPlacing] = useState(false)
  const [pen, setPen] = useState<Pen>(null)
  // Phones: the tools fold away behind one floating button, so the page gets the whole screen.
  const [toolsOpen, setToolsOpen] = useState(false)
  // "Go to page" box (PDFs): opened by tapping the page number
  const [jumping, setJumping] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [lastFlower, setLastFlower] = useState<FlowerKind>('lavender')
  const view = useRef<ViewHandle>(null)

  useEffect(() => {
    getSetting<ReaderPrefs>('readerPrefs', DEFAULT_PREFS).then((p) => {
      setPrefs({ ...DEFAULT_PREFS, ...p })
      setPrefsLoaded(true)
    })
    getSetting<FlowerKind>('lastFlower', 'lavender').then(setLastFlower)
  }, [])
  const changePrefs = (p: Partial<ReaderPrefs>) => {
    const next = { ...prefs, ...p }
    setPrefs(next)
    setSetting('readerPrefs', next).catch(() => {})
  }

  /* save reading position (debounced) */
  const saveTimer = useRef<number | undefined>(undefined)
  const onRelocate = useCallback(
    (r: Relocation) => {
      setWhere(r)
      setHlMenu(undefined)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        db.books.get(bookId).then((b) => {
          if (!b) return
          const changes: Parameters<typeof updateBook>[1] = {
            progress: { location: r.location, percent: r.percent, label: r.label, updatedAt: Date.now() },
          }
          if (b.status === 'want' && r.percent > 0) changes.status = 'reading'
          updateBook(bookId, changes).catch(() => {})
        })
      }, 600)
    },
    [bookId],
  )
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  /* tools stay visible (so bookmarks and notes are always findable); tapping the page centre hides/shows them */
  const poke = useCallback(() => setChrome(true), [])
  const keepChrome = panel !== null || !!selection || !!hlMenu || !!editing

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [role="dialog"]')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') view.current?.next()
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') view.current?.prev()
      else if (e.key === 'Escape') {
        if (panel || hlMenu || selection) {
          setPanel(null)
          setHlMenu(undefined)
          setSelection(null)
        } else onClose()
        return
      } else if (e.key === 'b' || e.key === 'B') toggleBookmark()
      else return
      poke()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* bookmarks */
  const currentBookmark = where ? annotations.find((a) => a.kind === 'bookmark' && view.current?.isVisible(a.location)) : undefined
  const addBookmark = (flower: FlowerKind) => {
    if (!where) return
    setLastFlower(flower)
    setSetting('lastFlower', flower).catch(() => {})
    const now = Date.now()
    putAnnotation({ id: uid(), bookId, kind: 'bookmark', location: where.location, label: where.label, flower, createdAt: now, updatedAt: now })
    setPanel(null)
    setToolsOpen(false)
  }
  function toggleBookmark() {
    if (currentBookmark) removeWithUndo(currentBookmark, 'Bookmark removed.')
    else addBookmark(lastFlower)
  }

  const removeWithUndo = (a: Annotation, message: string) => {
    deleteAnnotation(a.id)
    setHlMenu(undefined)
    toast({ message, action: { label: 'Undo', run: () => putAnnotation(a) } })
  }

  /* highlights + notes */
  const highlight = (color: HighlightColor, withNote = false) => {
    if (!selection || !where) return
    const now = Date.now()
    const a: Annotation = {
      id: uid(),
      bookId,
      kind: 'highlight',
      location: selection.location,
      rects: selection.rects,
      text: selection.text.slice(0, 1200),
      label: where.label,
      color,
      createdAt: now,
      updatedAt: now,
    }
    putAnnotation(a)
    view.current?.clearSelection()
    setSelection(null)
    if (withNote) setEditing({ ...a, noteColor: 'lilac', sticker: 'none' })
  }
  /** A sticky note stuck at the spot she tapped on the page. */
  const pageNote = (pos: { x: number; y: number }) => {
    setPlacing(false)
    if (!where) return
    const now = Date.now()
    setEditing({ id: uid(), bookId, kind: 'note', location: where.location, label: where.label, noteColor: 'pink', sticker: 'heart', note: '', pos, createdAt: now, updatedAt: now })
  }

  const notesOnThisPage = useMemo(
    () => (where ? annotations.filter((a) => (a.kind === 'note' || (a.kind === 'highlight' && a.note)) && view.current?.isVisible(a.location)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [annotations, where],
  )
  // Notes stuck on the page sit on the page; passage notes (and older page notes) sit in the margin.
  const stuckNotes = notesOnThisPage.filter((a) => a.kind === 'note' && a.pos)
  const notesHere = notesOnThisPage.filter((a) => !(a.kind === 'note' && a.pos))

  const onSelect = useCallback((s: TextSelection | null) => {
    setSelection(s)
    if (s) setHlMenu(undefined)
  }, [])
  // The colour waiting on the selected words: it previews on the selection, and Save keeps it.
  const [draft, setDraft] = useState<HighlightColor>('lavender')
  useEffect(() => {
    if (pen && pen !== 'erase') setDraft(pen)
  }, [pen])
  const latest = useRef({ pen })
  latest.current = { pen }
  const onAnnotationClick = useCallback((id: string, anchor: Anchor) => {
    const { pen: p } = latest.current
    if (p === 'erase') {
      const a = annotationsRef.current.find((x) => x.id === id)
      if (a) eraseRef.current(a)
      return
    }
    setHlMenu({ id, anchor })
  }, [])
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const eraseRef = useRef((a: Annotation) => removeWithUndo(a, 'Highlight erased.'))
  eraseRef.current = (a: Annotation) => removeWithUndo(a, 'Highlight erased.')
  const onReady = useCallback(() => setReady(true), [])
  const onError = useCallback((m: string) => setError(m), [])
  const onTapCenter = useCallback(() => setChrome((c) => !c), [])

  if (book === undefined || blob === undefined || !prefsLoaded) return <div className="reader-loading">Opening the book…</div>
  if (book?.file && !blob && fetching === 'loading') return <div className="reader-loading">Bringing the book down from your library…</div>
  if (book?.file && !blob && fetching !== 'idle') {
    return (
      <div className="reader reader-missing">
        <div className="state-box error">
          <p>{fetching}</p>
          <button className="btn" onClick={onClose}>Back to the shelf</button>
        </div>
      </div>
    )
  }
  if (!book || !book.file || !blob) {
    return (
      <div className="reader reader-missing">
        <div className="state-box">
          <p>{!book ? "This book isn't on the shelf anymore." : "This book's file isn't on this device yet. Attach the PDF or EPUB from the book's page."}</p>
          <button className="btn" onClick={onClose}>Back to the shelf</button>
        </div>
      </div>
    )
  }

  const View = book.file.format === 'pdf' ? PdfView : EpubView
  // "Page 14 of 435": PDFs have real pages; EPUBs get book pages once their location map is
  // built (until then they jump by chapter or % through).
  const isEpub = book.file.format === 'epub'
  const pageInfo = (() => {
    const m = where?.label?.match(/^Page (\d+) of (\d+)$/)
    return m ? { page: +m[1], total: +m[2] } : undefined
  })()
  const canJump = !!pageInfo || (isEpub && !!where)
  const menuAnnotation = hlMenu && annotations.find((a) => a.id === hlMenu.id)

  return (
    <div className={`reader ${chrome || keepChrome || toolsOpen ? 'chrome-on' : 'chrome-off'} fmt-${book.file.format} ${pen === 'erase' ? 'erasing' : pen ? 'penning' : ''} ${toolsOpen ? 'tools-open' : ''}`}
      style={{ ['--sel' as string]: highlightFill(draft) }} onMouseMove={(e) => e.clientY < 90 && poke()}>
      <header className="reader-bar" onFocus={poke}>
        <button className="icon-btn" onClick={onClose} aria-label="Back to the shelf">
          <Icon name="back" />
        </button>
        <div className="reader-title">
          <strong>{book.title}</strong>
          {canJump ? (
            <button className="page-jump-btn" onClick={() => setJumping(true)} title={pageInfo ? 'Go to a page' : 'Go to a chapter'}>
              {where?.label} <Icon name="chevR" size={11} />
            </button>
          ) : (
            <span className="fine">{where?.label ?? ''}</span>
          )}
        </div>
        <button
          className={`tools-fab ${toolsOpen ? 'on' : ''} ${pen || placing || currentBookmark ? 'busy' : ''}`}
          aria-label={toolsOpen ? 'Hide reading tools' : 'Show reading tools'}
          aria-expanded={toolsOpen}
          onClick={() => {
            setToolsOpen((o) => !o)
            setPanel(null)
          }}
        >
          <Icon name={toolsOpen ? 'close' : 'marker'} size={22} />
        </button>
        <div className="reader-tools">
          <div className="pop-wrap">
            <button
              className={`tool-btn ${currentBookmark ? 'on' : ''}`}
              aria-label={currentBookmark ? 'Remove flower bookmark' : 'Bookmark this page with a pressed flower'}
              aria-pressed={!!currentBookmark}
              onClick={() => (currentBookmark ? toggleBookmark() : setPanel(panel === 'flowers' ? null : 'flowers'))}
              title="Bookmark (B)"
            >
              <Icon name="flower" size={24} />
              <span>{currentBookmark ? 'Bookmarked' : 'Bookmark'}</span>
            </button>
            {panel === 'flowers' && (
              <div className="popover flower-picker" role="menu" aria-label="Choose a pressed flower">
                {FLOWERS.map((f) => (
                  <button key={f.kind} role="menuitem" onClick={() => addBookmark(f.kind)} className={f.kind === lastFlower ? 'on' : ''}>
                    <PressedFlower kind={f.kind} size={26} />
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`tool-btn ${placing ? 'on' : ''}`}
            aria-label="Add a sticky note — then tap where it should go"
            aria-pressed={placing}
            onClick={() => {
              setPlacing((p) => !p)
              setToolsOpen(false)
            }}
          >
            <Icon name="note" size={24} />
            <span>{placing ? 'Tap the page' : 'Sticky note'}</span>
          </button>
          <div className="pop-wrap">
            <button
              className={`tool-btn ${pen ? 'on' : ''}`}
              aria-label="Highlighter and eraser"
              aria-expanded={panel === 'pen'}
              onClick={() => setPanel(panel === 'pen' ? null : 'pen')}
            >
              {pen && pen !== 'erase' && <span className="pen-dot" style={{ background: highlightFill(pen) }} aria-hidden />}
              <Icon name={pen === 'erase' ? 'eraser' : 'marker'} size={24} />
              <span>{pen === 'erase' ? 'Erasing' : pen ? 'Highlighting' : 'Highlight'}</span>
            </button>
            {panel === 'pen' && (
              <div className="popover pen-panel" role="dialog" aria-label="Highlighter">
                <p className="fine">
                  {matchMedia('(pointer: coarse)').matches
                    ? 'Pick a colour, run your finger over the words, then tap Save.'
                    : 'Pick a colour, select the words, then tap Save.'}
                </p>
                <div className="row pen-swatches">
                  {HIGHLIGHTS.map((h) => (
                    <button
                      key={h.color}
                      className={`swatch ${pen === h.color ? 'on' : ''}`}
                      style={{ background: h.fill }}
                      aria-label={`${h.name} highlighter`}
                      aria-pressed={pen === h.color}
                      onClick={() => {
                        setPen(h.color)
                        setPanel(null)
                        setToolsOpen(false)
                        if (selection) highlight(h.color)
                      }}
                    />
                  ))}
                </div>
                <button
                  className={`bar-btn eraser-btn ${pen === 'erase' ? 'on' : ''}`}
                  aria-pressed={pen === 'erase'}
                  onClick={() => {
                    setPen('erase')
                    setPanel(null)
                    setToolsOpen(false)
                    toast({ message: 'Eraser on — tap any highlight to erase it.' })
                  }}
                >
                  <Icon name="eraser" size={18} /> Eraser
                </button>
                {pen && (
                  <button className="link-btn" onClick={() => { setPen(null); setPanel(null) }}>
                    Put it down
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="pop-wrap">
            <button className="tool-btn" aria-label={book.file.format === 'pdf' ? 'Zoom' : 'Text settings'} aria-expanded={panel === 'type'} onClick={() => setPanel(panel === 'type' ? null : 'type')}>
              <Icon name={book.file.format === 'pdf' ? 'zoomIn' : 'aa'} size={24} />
              <span>{book.file.format === 'pdf' ? 'Zoom' : 'Text'}</span>
            </button>
            {panel === 'type' && <TypePanel format={book.file.format} prefs={prefs} onChange={changePrefs} />}
          </div>
          <button
            className="tool-btn"
            aria-label="Bookmarks, highlights and notes"
            aria-expanded={panel === 'notes'}
            onClick={() => {
              setPanel(panel === 'notes' ? null : 'notes')
              setToolsOpen(false)
            }}
          >
            <Icon name="list" size={24} />
            <span>My notes</span>
          </button>
        </div>
      </header>

      <div className="reader-body">
        <button className="turn prev" aria-label="Previous page" onClick={() => view.current?.prev()} disabled={where?.atStart}>
          <Icon name="chevL" size={26} />
        </button>
        <div
          className="reader-stage"
          onPointerDown={() => {
            setPanel((p) => (p === 'notes' ? p : null))
            setToolsOpen(false)
          }}
        >
          {!ready && !error && <div className="reader-loading inline">Opening the book…</div>}
          {error ? (
            <div className="state-box error">
              <p>{error}</p>
              <button className="btn" onClick={onClose}>Back to the shelf</button>
            </div>
          ) : (
            <View
              ref={view}
              book={book}
              blob={blob}
              annotations={annotations}
              prefs={prefs}
              onReady={onReady}
              onError={onError}
              onRelocate={onRelocate}
              onSelect={onSelect}
              onAnnotationClick={onAnnotationClick}
              onTapCenter={onTapCenter}
              onToggleBookmark={toggleBookmark}
              pen={!!pen && pen !== 'erase'}
              overlay={
                <StickyLayer
                  notes={stuckNotes}
                  placing={placing}
                  onPlace={pageNote}
                  onMove={(n, pos) => putAnnotation({ ...n, pos })}
                  onOpen={(n) => setEditing(n)}
                />
              }
            />
          )}
        </div>
        <button className="turn next" aria-label="Next page" onClick={() => view.current?.next()} disabled={where?.atEnd}>
          <Icon name="chevR" size={26} />
        </button>

        {notesHere.length > 0 && (
          <aside className="margin-notes" aria-label="Notes on this page">
            {notesHere.map((n, i) => (
              <button key={n.id} className={`sticky sticky-${n.noteColor ?? 'lilac'}`} style={{ ['--tilt' as string]: `${i % 2 ? 2 : -2}deg` }} onClick={() => setEditing(n)}>
                {n.sticker && n.sticker !== 'none' && <span className="sticky-sticker"><Sticker kind={n.sticker} size={26} /></span>}
                {n.text && <span className="sticky-quote">“{n.text.slice(0, 80)}{n.text.length > 80 ? '…' : ''}”</span>}
                <span className="sticky-text">{n.note || 'Empty note'}</span>
              </button>
            ))}
          </aside>
        )}
      </div>

      <footer className="reader-foot">
        {canJump ? (
          <button className="foot-label page-jump-btn" onClick={() => setJumping(true)}>
            {where?.label} · {pageInfo ? 'go to page' : 'go to…'}
          </button>
        ) : (
          <span className="foot-label" aria-hidden>{where?.label ?? ''}</span>
        )}
        <div className="progress-line" aria-hidden>
          <span style={{ width: `${Math.round((where?.percent ?? 0) * 100)}%` }} />
        </div>
      </footer>

      {/* outside the footer: on phones the footer lets taps through to the page */}
      {jumping && pageInfo && !isEpub && (
        <GoToPage
          current={pageInfo.page}
          total={pageInfo.total}
          onGo={(n) => {
            view.current?.goTo(String(n))
            setJumping(false)
          }}
          onClose={() => setJumping(false)}
        />
      )}
      {jumping && isEpub && canJump && (
        <GoToPlace
          pages={pageInfo}
          onPage={(n) => {
            view.current?.goToPage?.(n)
            setJumping(false)
          }}
          percent={Math.round((where?.percent ?? 0) * 100)}
          chapters={view.current?.chapters?.() ?? []}
          onChapter={(href) => {
            view.current?.goTo(href)
            setJumping(false)
          }}
          onPercent={(p) => {
            view.current?.goToPercent?.(p / 100)
            setJumping(false)
          }}
          onClose={() => setJumping(false)}
        />
      )}

      {selection && (
        <FloatingBar anchor={selection.anchor} label="Highlight selected text">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.color}
              className={`swatch ${draft === h.color ? 'on' : ''}`}
              style={{ background: h.fill }}
              aria-label={`${h.name}`}
              aria-pressed={draft === h.color}
              onClick={() => setDraft(h.color)}
            />
          ))}
          <button className="bar-btn save-hl" onClick={() => highlight(draft)}>
            <Icon name="check" size={16} /> Save
          </button>
          <button className="bar-btn" onClick={() => highlight(draft, true)}>
            <Icon name="note" size={16} /> Note
          </button>
          <button
            className="bar-btn icon-only"
            aria-label="Cancel"
            onClick={() => {
              view.current?.clearSelection()
              setSelection(null)
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </FloatingBar>
      )}

      {hlMenu && menuAnnotation && (
        <FloatingBar anchor={hlMenu.anchor} label="Highlight options">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.color}
              className={`swatch ${menuAnnotation.color === h.color ? 'on' : ''}`}
              style={{ background: h.fill }}
              aria-label={`Change to ${h.name}`}
              onClick={() => {
                putAnnotation({ ...menuAnnotation, color: h.color })
                setHlMenu(undefined)
              }}
            />
          ))}
          <button className="bar-btn" onClick={() => { setEditing({ noteColor: 'lilac', sticker: 'none', ...menuAnnotation }); setHlMenu(undefined) }}>
            <Icon name="note" size={16} /> {menuAnnotation.note ? 'Edit note' : 'Add note'}
          </button>
          <button className="bar-btn" onClick={() => removeWithUndo(menuAnnotation, 'Highlight erased.')}>
            <Icon name="eraser" size={16} /> Erase
          </button>
        </FloatingBar>
      )}

      {panel === 'notes' && (
        <NotesPanel
          annotations={annotations}
          onClose={() => setPanel(null)}
          onGo={(a) => {
            view.current?.goTo(a.location)
            if (window.innerWidth < 900) setPanel(null)
          }}
          onEdit={setEditing}
          onDelete={(a) => removeWithUndo(a, a.kind === 'bookmark' ? 'Bookmark removed.' : a.kind === 'note' ? 'Note deleted.' : 'Highlight removed.')}
        />
      )}

      {editing && (
        <NoteEditor
          annotation={editing}
          onCancel={() => setEditing(undefined)}
          onSave={(a) => {
            putAnnotation(a)
            setEditing(undefined)
          }}
          onDelete={(a) => {
            setEditing(undefined)
            if (a.kind === 'highlight') putAnnotation({ ...a, note: undefined })
            else if (annotations.some((x) => x.id === a.id)) removeWithUndo(a, 'Note deleted.')
          }}
        />
      )}
    </div>
  )
}

/** A little box to type a page number and jump straight there, like in a PDF viewer. */
function GoToPage({ current, total, onGo, onClose }: { current: number; total: number; onGo: (n: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(current))
  const [error, setError] = useState<string>()
  const go = () => {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n) || n < 1 || n > total) return setError(`Pick a page from 1 to ${total}.`)
    onGo(n)
  }
  return (
    <div className="scrim light" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="goto-page"
        noValidate
        role="dialog"
        aria-label="Go to page"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <p className="goto-title">Go to page</p>
        <div className="goto-row">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={total}
            value={value}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValue(e.target.value)
              setError(undefined)
            }}
            aria-label={`Page number, 1 to ${total}`}
          />
          <span className="fine">of {total}</span>
          <button className="btn btn-small">Go</button>
        </div>
        {error && <p className="pin-error" role="alert">{error}</p>}
        <button type="button" className="link-btn goto-cancel" onClick={onClose}>Cancel</button>
      </form>
    </div>
  )
}

/** EPUBs: type a page (or, before pages are counted, a % through), or pick a chapter. */
function GoToPlace({ pages, onPage, percent, chapters, onChapter, onPercent, onClose }: {
  pages?: { page: number; total: number }
  onPage: (n: number) => void
  percent: number
  chapters: { label: string; href: string; depth: number }[]
  onChapter: (href: string) => void
  onPercent: (p: number) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(String(pages ? pages.page : percent))
  const [error, setError] = useState<string>()
  const go = () => {
    const n = parseFloat(value)
    if (pages) {
      if (!Number.isInteger(n) || n < 1 || n > pages.total) return setError(`Pick a page from 1 to ${pages.total}.`)
      return onPage(n)
    }
    if (!Number.isFinite(n) || n < 0 || n > 100) return setError('Pick a number from 0 to 100.')
    onPercent(n)
  }
  const row = (
    <form
      className="goto-row"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={pages ? 1 : 0}
        max={pages ? pages.total : 100}
        value={value}
        autoFocus={!!pages}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setValue(e.target.value)
          setError(undefined)
        }}
        aria-label={pages ? `Page number, 1 to ${pages.total}` : 'Percent through the book, 0 to 100'}
      />
      <span className="fine">{pages ? `of ${pages.total}` : '% through'}</span>
      <button className="btn btn-small">Go</button>
    </form>
  )
  const err = error && <p className="pin-error" role="alert">{error}</p>
  return (
    <div className="scrim light" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="goto-page goto-place" role="dialog" aria-label="Go to" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <p className="goto-title">{pages ? 'Go to page' : 'Go to…'}</p>
        {pages && row}
        {pages && err}
        {chapters.length > 0 && (
          <>
            <p className="goto-sub">{pages ? 'or a chapter' : 'a chapter'}</p>
            <ul className="goto-chapters">
              {chapters.map((c, i) => (
                <li key={`${c.href}-${i}`}>
                  <button style={{ paddingLeft: 12 + c.depth * 14 }} onClick={() => onChapter(c.href)}>
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!pages && <p className="goto-sub">or a point in the book</p>}
        {!pages && row}
        {!pages && err}
        <button type="button" className="link-btn goto-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function FloatingBar({ anchor, label, children }: { anchor: Anchor; label: string; children: React.ReactNode }) {
  const above = anchor.y > 90
  // Keep the whole bar on screen: centre it on the words, but never past either edge.
  const ref = useRef<HTMLDivElement>(null)
  const [half, setHalf] = useState(150)
  useLayoutEffect(() => {
    if (ref.current) setHalf(ref.current.offsetWidth / 2 + 8)
  }, [children])
  const x = Math.min(window.innerWidth - half, Math.max(half, anchor.x))
  return (
    <div
      ref={ref}
      className={`floating-bar ${above ? 'above' : 'below'}`}
      role="toolbar"
      aria-label={label}
      style={{ left: x, top: above ? anchor.y - 10 : anchor.bottom + 10 }}
      onPointerDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  )
}

function TypePanel({ format, prefs, onChange }: { format: 'pdf' | 'epub'; prefs: ReaderPrefs; onChange: (p: Partial<ReaderPrefs>) => void }) {
  if (format === 'pdf') {
    const z = typeof prefs.pdfZoom === 'number' ? prefs.pdfZoom : null
    const step = (d: number) => {
      const current = z ?? (document.querySelector('.pdf-page') as HTMLElement | null)?.style.getPropertyValue('--scale-factor')
      const base = typeof current === 'number' ? current : parseFloat(String(current)) || 1
      onChange({ pdfZoom: Math.round(Math.max(0.4, Math.min(4, base + d)) * 100) / 100 })
    }
    return (
      <div className="popover type-panel" role="dialog" aria-label="Zoom">
        <div className="row">
          <button className="icon-btn" aria-label="Zoom out" onClick={() => step(-0.15)}><Icon name="zoomOut" /></button>
          <span className="zoom-val">{z ? `${Math.round(z * 100)}%` : prefs.pdfZoom === 'fit-page' ? 'Fit page' : 'Fit width'}</span>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => step(0.15)}><Icon name="zoomIn" /></button>
        </div>
        <div className="segmented">
          <button className={prefs.pdfZoom === 'fit-page' ? 'on' : ''} aria-pressed={prefs.pdfZoom === 'fit-page'} onClick={() => onChange({ pdfZoom: 'fit-page' })}>
            <Icon name="fitP" size={16} /> Fit page
          </button>
          <button className={prefs.pdfZoom === 'fit-width' ? 'on' : ''} aria-pressed={prefs.pdfZoom === 'fit-width'} onClick={() => onChange({ pdfZoom: 'fit-width' })}>
            <Icon name="fitW" size={16} /> Fit width
          </button>
        </div>
        <p className="fine">PDFs keep their original page design, so page colour comes from the file.</p>
      </div>
    )
  }
  return (
    <div className="popover type-panel" role="dialog" aria-label="Text settings">
      <label className="field">
        <span>Text size · {prefs.fontSize}%</span>
        <input type="range" min={80} max={170} step={5} value={prefs.fontSize} onChange={(e) => onChange({ fontSize: +e.target.value })} />
      </label>
      <label className="field">
        <span>Line spacing · {prefs.lineHeight.toFixed(2)}</span>
        <input type="range" min={1.3} max={2.1} step={0.05} value={prefs.lineHeight} onChange={(e) => onChange({ lineHeight: +e.target.value })} />
      </label>
      <div className="segmented">
        {(['serif', 'classic', 'sans'] as const).map((f) => (
          <button key={f} className={`font-${f} ${prefs.font === f ? 'on' : ''}`} aria-pressed={prefs.font === f} onClick={() => onChange({ font: f })}>
            {{ serif: 'Literata', classic: 'Georgia', sans: 'Sans' }[f]}
          </button>
        ))}
      </div>
    </div>
  )
}

function NotesPanel({ annotations, onClose, onGo, onEdit, onDelete }: {
  annotations: Annotation[]
  onClose: () => void
  onGo: (a: Annotation) => void
  onEdit: (a: Annotation) => void
  onDelete: (a: Annotation) => void
}) {
  const [tab, setTab] = useState<'all' | 'bookmark' | 'highlight' | 'note'>('all')
  const list = annotations.filter((a) =>
    tab === 'all' ? true : tab === 'note' ? a.kind === 'note' || !!a.note : a.kind === tab,
  )
  const ordered = [...list].sort((a, b) => locSort(a) - locSort(b) || a.createdAt - b.createdAt)
  return (
    <aside className="notes-panel" aria-label="Bookmarks, highlights and notes">
      <header>
        <h2>Pressed between the pages</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="chips">
        {(['all', 'bookmark', 'highlight', 'note'] as const).map((t) => (
          <button key={t} className={`chip ${tab === t ? 'on' : ''}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {{ all: 'All', bookmark: 'Flowers', highlight: 'Highlights', note: 'Notes' }[t]}
          </button>
        ))}
      </div>
      {ordered.length === 0 ? (
        <div className="notes-empty">
          <PressedFlower kind="forgetmenot" size={34} />
          <p>
            {tab === 'bookmark' ? 'Tap the flower at the top to press one between these pages.' : tab === 'highlight' ? 'Select some words to highlight them.' : tab === 'note' ? 'Add a sticky note to a page or a highlighted passage.' : 'Nothing pressed between these pages yet.'}
          </p>
        </div>
      ) : (
        <ul className="notes-list">
          {ordered.map((a) => (
            <li key={a.id} className={`note-item kind-${a.kind}`}>
              <button className="note-go" onClick={() => onGo(a)}>
                <span className="note-icon" aria-hidden>
                  {a.kind === 'bookmark' ? (
                    <PressedFlower kind={a.flower ?? 'lavender'} size={14} />
                  ) : a.kind === 'highlight' ? (
                    <span className="mini-swatch" style={{ background: highlightFill(a.color) }} />
                  ) : (
                    <span className={`mini-sticky sticky-${a.noteColor ?? 'pink'}`} />
                  )}
                </span>
                <span className="note-main">
                  <span className="fine">{a.label ?? ''}</span>
                  {a.text && <span className="note-quote">“{a.text.length > 160 ? a.text.slice(0, 160) + '…' : a.text}”</span>}
                  {a.note && <span className="note-text">{a.note}</span>}
                  {a.kind === 'bookmark' && <span className="note-text">{FLOWERS.find((f) => f.kind === a.flower)?.name ?? 'Flower'} bookmark</span>}
                </span>
              </button>
              <span className="note-actions">
                {a.kind !== 'bookmark' && (
                  <button className="icon-btn small" aria-label="Edit note" onClick={() => onEdit({ noteColor: 'lilac', sticker: 'none', ...a })}>
                    <Icon name="edit" size={15} />
                  </button>
                )}
                <button className="icon-btn small" aria-label="Delete" onClick={() => onDelete(a)}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

const locSort = (a: Annotation) => {
  const n = parseInt(a.location, 10)
  return Number.isFinite(n) && !a.location.startsWith('epubcfi') ? n : 0
}

function NoteEditor({ annotation, onCancel, onSave, onDelete }: {
  annotation: Annotation
  onCancel: () => void
  onSave: (a: Annotation) => void
  onDelete: (a: Annotation) => void
}) {
  const [a, setA] = useState(annotation)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const reduced = prefersReducedMotion()
  return (
    <div className="scrim light" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`note-editor sticky-${a.noteColor ?? 'lilac'} ${reduced ? '' : 'pop-in'}`} role="dialog" aria-modal="true" aria-label="Sticky note">
        {a.sticker && a.sticker !== 'none' && <span className="sticky-sticker big"><Sticker kind={a.sticker} size={40} /></span>}
        {a.text && <p className="note-quote">“{a.text.length > 220 ? a.text.slice(0, 220) + '…' : a.text}”</p>}
        <label className="sr-only" htmlFor="note-text">Note</label>
        <textarea id="note-text" ref={ref} value={a.note ?? ''} placeholder="Write a little something…" onChange={(e) => setA({ ...a, note: e.target.value })} rows={5} />
        <div className="note-options">
          <div className="row" role="group" aria-label="Note colour">
            {NOTE_COLORS.map((c) => (
              <button key={c.color} className={`note-color sticky-${c.color} ${a.noteColor === c.color ? 'on' : ''}`} aria-label={c.name} aria-pressed={a.noteColor === c.color} onClick={() => setA({ ...a, noteColor: c.color })} />
            ))}
          </div>
          <div className="row stickers" role="group" aria-label="Sticker">
            {STICKERS.map((s) => (
              <button key={s} className={`sticker-btn ${a.sticker === s ? 'on' : ''}`} aria-label={s === 'none' ? 'No sticker' : `${s} sticker`} aria-pressed={a.sticker === s} onClick={() => setA({ ...a, sticker: s })}>
                {s === 'none' ? <Icon name="close" size={14} /> : <Sticker kind={s} size={22} />}
              </button>
            ))}
          </div>
        </div>
        <div className="note-buttons">
          {(annotation.note || annotation.kind === 'note') && (
            <button className="link-btn danger" onClick={() => onDelete(annotation)}>Delete note</button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-small"
            onClick={() => onSave({ ...a, note: a.note?.trim() || (a.kind === 'note' ? '' : undefined) })}
            disabled={a.kind === 'note' && !a.note?.trim()}
          >
            Stick it
          </button>
        </div>
      </div>
    </div>
  )
}
