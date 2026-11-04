import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import ePub, { EpubCFI } from 'epubjs'
import type { Book as EpubBook, Rendition } from 'epubjs'
import { updateBook } from '../db'
import type { ViewHandle, ViewProps } from './types'
import { EASE, reducedMotion } from '../lib/motion'
import { PageBookmark } from './PageBookmark'
import { sfx } from '../lib/sound'
import { drawCurl, freeze, playCurl, type Frozen } from './epubCurl'

const FONTS = {
  serif: "'Literata', Georgia, serif",
  classic: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
}
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap'

/**
 * Reflowable EPUB view. Annotations are anchored with CFIs, so they stay on
 * the right passage when font size, spacing or screen width change.
 */
/**
 * Some EPUBs (Internet Archive's scanned books, for one) list pages in their
 * reading order that aren't actually in the book — e.g. a "cover" with no file.
 * epub.js crashes on those, so they're dropped and the rest renumbered, which
 * keeps "next page" from skipping a chapter.
 */
/** "Page 42 of 310": a book page is one slice of the location map (~1400 characters). */
function pageLabel(book: any, cfi: string) {
  const total = book.locations.length()
  const at = Math.max(0, book.locations.locationFromCfi(cfi) ?? 0)
  return `Page ${Math.min(total, at + 1)} of ${total}`
}

function repairSpine(book: any) {
  const spine = book.spine
  const items: any[] = spine?.spineItems ?? []
  const broken = items.filter((s) => !s.href)
  if (!broken.length) return
  for (const s of broken) spine.remove(s)
  spine.spineItems.forEach((s: any, i: number) => (s.index = i))
  spine.length = spine.spineItems.length
}

export const EpubView = forwardRef<ViewHandle, ViewProps>(function EpubView(props, ref) {
  const { blob, book, annotations, prefs, onReady, onError, onRelocate, onSelect, onAnnotationClick, onTapCenter, onToggleBookmark } = props
  const host = useRef<HTMLDivElement>(null)
  const edges = useRef({ atStart: true, atEnd: false })
  const paper = useRef<HTMLDivElement>(null)
  // resolves when the book has moved to the new page (set while a turn waits for it)
  const moved = useRef<(() => void) | undefined>(undefined)
  const curling = useRef<Frozen | undefined>(undefined)

  /**
   * Turn like a real page: a still copy of this page lies on top, the next page is laid out
   * underneath, then the copy curls over and away (the same paper curl as the PDFs).
   */
  const turn = useRef<(dir: 1 | -1) => void>(() => {})
  turn.current = async (dir) => {
    const r = rendition.current
    const h = host.current
    const p = paper.current
    if (!r) return
    if ((dir > 0 && edges.current.atEnd) || (dir < 0 && edges.current.atStart)) return
    sfx.pageTurn()
    if (h) {
      h.getAnimations().forEach((a) => a.cancel())
      h.style.transform = ''
      h.style.opacity = ''
    }
    // a turn already curling finishes at once, so quick taps keep up
    curling.current?.el.remove()
    curling.current = undefined
    if (!p || reducedMotion()) {
      dir > 0 ? r.next() : r.prev()
      return
    }
    const still = await freeze(p).catch(() => undefined)
    if (!still) {
      dir > 0 ? r.next() : r.prev()
      return
    }
    curling.current = still
    drawCurl(still, 0, dir)
    await new Promise<void>((res) => {
      moved.current = res
      ;(dir > 0 ? r.next() : r.prev())?.catch?.(() => res())
      window.setTimeout(res, 700) // the book didn't move (e.g. the very end): just lift it off
    })
    moved.current = undefined
    if (curling.current !== still) return still.el.remove()
    await playCurl(still, dir)
    still.el.remove()
    if (curling.current === still) curling.current = undefined
  }
  const rendition = useRef<Rendition | undefined>(undefined)
  const epub = useRef<EpubBook | undefined>(undefined)
  const range = useRef<{ start: string; end: string } | undefined>(undefined)
  const [loc, setLoc] = useState<{ start: string; end: string }>()
  const shown = useRef(new Map<string, { cfi: string; key: string }>()) // annotation id -> what's drawn
  const [ready, setReady] = useState(false)
  const cb = useRef({ onRelocate, onSelect, onAnnotationClick, onTapCenter })
  cb.current = { onRelocate, onSelect, onAnnotationClick, onTapCenter }
  const cfi = useRef(new EpubCFI())

  /* open */
  useEffect(() => {
    let cancelled = false
    const el = host.current!
    ;(async () => {
      try {
        const b = ePub(await blob.arrayBuffer())
        epub.current = b
        await b.ready
        if (cancelled) return
        repairSpine(b)
        const r = b.renderTo(el, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false } as any)
        rendition.current = r
        r.hooks.content.register((contents: any) => {
          contents.addStylesheet(FONT_CSS)
          // Internet Archive's scanned-book EPUBs start every page with a machine note
          // ("The text on this page is estimated to be only 28% accurate") — not part of the book.
          contents.document?.querySelectorAll('body > b').forEach((el: Element) => {
            if (/estimated to be only [\d.]+% accurate/i.test(el.textContent ?? '')) el.remove()
          })
        })
        applyTheme(r, prefs)

        r.on('relocated', (l: any) => {
          edges.current = { atStart: !!l.atStart, atEnd: !!l.atEnd }
          // the new page is laid out under the curl: let the old one turn away (next frame,
          // so highlights are drawn on it first)
          const done = moved.current
          if (done) requestAnimationFrame(() => done())
          range.current = { start: l.start.cfi, end: l.end.cfi }
          setLoc(range.current)
          const hasLocs = (b.locations as any).length?.() > 0
          const pct = hasLocs ? b.locations.percentageFromCfi(l.start.cfi) : l.start.percentage ?? 0
          const label = hasLocs
            ? pageLabel(b, l.start.cfi)
            : l.start.displayed ? `Page ${l.start.displayed.page} of ${l.start.displayed.total} in this chapter` : ''
          cb.current.onRelocate({ location: l.start.cfi, label, percent: pct, atStart: !!l.atStart, atEnd: !!l.atEnd })
          cb.current.onSelect(null)
        })
        r.on('selected', (cfiRange: string, contents: any) => {
          const rg: Range | null = r.getRange(cfiRange)
          const text = rg?.toString().replace(/\s+/g, ' ').trim()
          if (!rg || !text) return
          const frame = contents.document.defaultView.frameElement as HTMLIFrameElement
          const f = frame.getBoundingClientRect()
          const rects = [...rg.getClientRects()]
          const first = rects[0] ?? rg.getBoundingClientRect()
          const last = rects[rects.length - 1] ?? first
          cb.current.onSelect({
            location: cfiRange,
            text,
            anchor: { x: f.left + (first.left + last.right) / 2, y: f.top + first.top, bottom: f.top + last.bottom },
          })
        })
        r.on('keyup', (e: KeyboardEvent) => {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') turn.current(1)
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn.current(-1)
        })
        // Taps inside the page: edges turn, centre toggles tools, collapsed selection clears.
        r.on('click', (e: MouseEvent) => {
          const doc = (e.target as Node)?.ownerDocument
          if (doc?.getSelection()?.toString()) return
          if ((e.target as Element)?.closest?.('a')) return
          const frame = doc?.defaultView?.frameElement as HTMLElement | null
          const hostRect = el.getBoundingClientRect()
          const x = (frame?.getBoundingClientRect().left ?? 0) + e.clientX
          const rel = (x - hostRect.left) / hostRect.width
          if (rel < 0.15) turn.current(-1)
          else if (rel > 0.85) turn.current(1)
          else cb.current.onTapCenter()
          cb.current.onSelect(null)
        })
        // A quick sideways mouse flick across the text turns the page (a slow drag still selects).
        let press: { x: number; y: number; t: number } | undefined
        r.on('mousedown', (e: MouseEvent) => (press = { x: e.screenX, y: e.screenY, t: Date.now() }))
        r.on('mouseup', (e: MouseEvent) => {
          const p = press
          press = undefined
          if (!p) return
          const dx = e.screenX - p.x
          const dy = e.screenY - p.y
          if (Date.now() - p.t < 420 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) {
            ;(e.target as Node)?.ownerDocument?.getSelection()?.removeAllRanges()
            cb.current.onSelect(null)
            turn.current(dx < 0 ? 1 : -1)
          }
        })
        let touch: { x: number; y: number } | undefined
        r.on('touchstart', (e: TouchEvent) => (touch = { x: e.changedTouches[0].screenX, y: e.changedTouches[0].screenY }))
        r.on('touchend', (e: TouchEvent) => {
          if (!touch) return
          const dx = e.changedTouches[0].screenX - touch.x
          const dy = e.changedTouches[0].screenY - touch.y
          touch = undefined
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) turn.current(dx < 0 ? 1 : -1)
        })

        await r.display(book.progress?.location || undefined).catch(() => r.display())
        if (cancelled) return
        setReady(true)
        onReady()

        // Percentages need a location map; cache it so it's only built once per book.
        if (book.epubLocations) {
          b.locations.load(book.epubLocations)
        } else {
          await b.locations.generate(1400)
          if (!cancelled) updateBook(book.id, { epubLocations: b.locations.save() }).catch(() => {})
        }
        if (!cancelled && range.current) {
          const pct = b.locations.percentageFromCfi(range.current.start)
          cb.current.onRelocate({ location: range.current.start, label: pageLabel(b, range.current.start), percent: pct, atStart: false, atEnd: false })
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) onError("This EPUB couldn't be opened. It may be damaged or DRM-protected.")
      }
    })()
    return () => {
      cancelled = true
      shown.current.clear()
      rendition.current?.destroy()
      epub.current?.destroy()
      rendition.current = undefined
      epub.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  /* typography */
  useEffect(() => {
    const r = rendition.current
    if (!r) return
    const at = range.current?.start
    applyTheme(r, prefs)
    if (at) r.display(at).catch(() => {})
  }, [prefs.fontSize, prefs.lineHeight, prefs.font])

  /* highlights — redraw only the ones that changed */
  useEffect(() => {
    const r = rendition.current
    if (!r || !ready) return
    const want = new Map(annotations.filter((a) => a.kind === 'highlight').map((a) => [a.id, a]))
    for (const [id, drawn] of shown.current) {
      const a = want.get(id)
      if (!a || drawn.key !== drawKey(a)) {
        r.annotations.remove(drawn.cfi, 'highlight')
        shown.current.delete(id)
      }
    }
    for (const a of want.values()) {
      if (shown.current.has(a.id)) continue
      try {
        r.annotations.highlight(
        a.location,
        { id: a.id },
        (e: MouseEvent) => {
          const t = e.target as Element
          const rr = t.getBoundingClientRect()
          cb.current.onAnnotationClick(a.id, { x: rr.left + rr.width / 2, y: rr.top, bottom: rr.bottom })
        },
        a.note ? 'epub-hl-note' : 'epub-hl', // epub.js accepts a single class token
        { fill: `url(#glitter-${a.color ?? 'lavender'})`, 'fill-opacity': '0.7' },
        )
        shown.current.set(a.id, { cfi: a.location, key: drawKey(a) })
      } catch (err) {
        // A passage the book no longer contains shouldn't break the reader.
        console.warn('Could not draw highlight', a.id, err)
      }
    }
  }, [annotations, ready])

  const visible = (location: string) => {
    const cur = range.current
    if (!cur) return false
    try {
      return cfi.current.compare(location, cur.start) >= 0 && cfi.current.compare(location, cur.end) <= 0
    } catch {
      return false
    }
  }

  useImperativeHandle(ref, () => ({
    next: () => turn.current(1),
    prev: () => turn.current(-1),
    goTo: (l) => rendition.current?.display(l),
    isVisible: visible,
    clearSelection: () => {
      const contents = (rendition.current as any)?.getContents?.() ?? []
      for (const c of contents) c.window?.getSelection()?.removeAllRanges()
    },
    // The table of contents, flattened (sub-chapters indented by depth).
    chapters: () => {
      const out: { label: string; href: string; depth: number }[] = []
      const walk = (items: any[], depth: number) => {
        for (const it of items ?? []) {
          const label = String(it.label ?? '').replace(/\s+/g, ' ').trim()
          if (label && it.href) out.push({ label, href: it.href, depth })
          walk(it.subitems, depth + 1)
        }
      }
      walk((epub.current as any)?.navigation?.toc ?? [], 0)
      return out
    },
    // Book pages are the location map's ~1400-character slices (about a paperback page),
    // so the numbers stay put whatever text size she reads at.
    goToPage: (n) => {
      const b = epub.current as any
      const total = b?.locations?.length?.() ?? 0
      if (!total) return
      rendition.current?.display(b.locations.cfiFromLocation(Math.min(total, Math.max(1, n)) - 1))
    },
    // By the precise location map once it's built; until then, by chapter position.
    goToPercent: (p) => {
      const b = epub.current as any
      const r = rendition.current
      if (!b || !r) return
      const clamped = Math.min(1, Math.max(0, p))
      if (b.locations?.length?.()) return void r.display(b.locations.cfiFromPercentage(clamped))
      const items = b.spine?.spineItems ?? []
      const item = items[Math.min(items.length - 1, Math.floor(clamped * items.length))]
      if (item) r.display(item.href)
    },
  }))

  const bookmark = loc ? annotations.find((a) => a.kind === 'bookmark' && visible(a.location)) : undefined

  // Dragging in the page margins (outside the text frame) with a mouse or finger turns the page;
  // the page follows the pointer a little so it feels like it's being pushed aside.
  const drag = useRef<{ x: number; y: number; t: number; on: boolean } | undefined>(undefined)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0 || (e.target as Element).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, t: Date.now(), on: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const h = host.current
    if (!d || !h) return
    const dx = e.clientX - d.x
    if (!d.on) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return
      d.on = true
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* capture is a nicety; the drag works without it */
      }
    }
    h.style.transform = `translateX(${dx * 0.35}px)`
    h.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = undefined
    const h = host.current
    if (!d?.on || !h) return
    const dx = e.clientX - d.x
    const v = dx / Math.max(1, Date.now() - d.t)
    h.style.opacity = ''
    if (dx < -60 || v < -0.5) return turn.current(1)
    if (dx > 60 || v > 0.5) return turn.current(-1)
    h.animate([{ transform: h.style.transform }, { transform: 'translateX(0)' }], { duration: 260, easing: EASE })
    h.style.transform = ''
  }

  return (
    <div className="epub-paper paper" ref={paper} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => (drag.current = undefined)}>
      <div className="epub-host" ref={host} />
      {props.overlay}
      <PageBookmark flower={bookmark?.flower} onToggle={onToggleBookmark} />
    </div>
  )
})

const drawKey = (a: { location: string; color?: string; note?: string }) => `${a.location}|${a.color}|${a.note ? 1 : 0}`

function applyTheme(r: Rendition, prefs: ViewProps['prefs']) {
  r.themes.default({
    body: {
      'font-family': `${FONTS[prefs.font]} !important`,
      color: '#3a2c33',
      background: 'transparent !important',
      'line-height': `${prefs.lineHeight} !important`,
      'text-rendering': 'optimizeLegibility',
      '-webkit-font-smoothing': 'antialiased',
    },
    'p, li, blockquote, div': { 'line-height': `${prefs.lineHeight} !important` },
    'p': { 'font-family': `${FONTS[prefs.font]} !important` },
    '::selection': { background: 'rgba(178, 154, 214, 0.45)' },
    a: { color: '#7d5a9e' },
    img: { 'max-width': '100% !important' },
  })
  r.themes.fontSize(`${prefs.fontSize}%`)
}
