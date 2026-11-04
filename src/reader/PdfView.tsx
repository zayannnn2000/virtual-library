import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { pdfjs } from '../lib/pdf'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { PdfRect } from '../types'
import type { ViewHandle, ViewProps } from './types'
import { highlightFill } from '../components/Art'
import { reducedMotion } from '../lib/motion'
import { animateCurl, drawCurl } from './pageCurl'
import { PageBookmark } from './PageBookmark'
import { sfx } from '../lib/sound'

/**
 * Single-page PDF view. The page keeps its own colours and layout; highlights
 * are stored as rectangles relative to the page (0..1) so they line up at any zoom.
 */
export const PdfView = forwardRef<ViewHandle, ViewProps>(function PdfView(props, ref) {
  const { blob, book, annotations, prefs, onReady, onError, onRelocate, onSelect, onAnnotationClick, onTapCenter, onPdfInfo, onToggleBookmark } = props
  const [doc, setDoc] = useState<PDFDocumentProxy>()
  const [page, setPage] = useState(() => Math.max(1, parseInt(book.progress?.location ?? '1', 10) || 1))
  const [size, setSize] = useState<{ w: number; h: number }>()
  const [scale, setScale] = useState(1)
  const [scanned, setScanned] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const pageBox = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const renderTask = useRef<RenderTask | undefined>(undefined)
  const [avail, setAvail] = useState({ w: 800, h: 600 })

  /* load */
  useEffect(() => {
    let destroyed = false
    let loaded: PDFDocumentProxy | undefined
    blob
      .arrayBuffer()
      .then((buf) => pdfjs.getDocument({ data: new Uint8Array(buf) }).promise)
      .then((d) => {
        loaded = d
        if (destroyed) return d.destroy()
        setDoc(d)
        setPage((p) => Math.min(p, d.numPages))
      })
      .catch(() => onError("This PDF couldn't be opened. Try attaching the file again."))
    return () => {
      destroyed = true
      loaded?.destroy()
    }
  }, [blob, onError])

  /* available space */
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setAvail({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* scale from zoom preference */
  useEffect(() => {
    if (!size) return
    // Phones: the page fills the screen edge to edge, like a real book.
    const pad = avail.w <= 640 ? 0 : 32
    const fitW = (avail.w - pad) / size.w
    const fitP = Math.min(fitW, (avail.h - pad) / size.h)
    const s = prefs.pdfZoom === 'fit-width' ? fitW : prefs.pdfZoom === 'fit-page' ? fitP : prefs.pdfZoom
    setScale(Math.max(0.3, Math.min(5, s)))
  }, [size, avail, prefs.pdfZoom])

  /* page size for current page */
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    doc.getPage(page).then((p) => {
      if (cancelled) return
      const v = p.getViewport({ scale: 1 })
      setSize({ w: v.width, h: v.height })
    })
    return () => {
      cancelled = true
    }
  }, [doc, page])

  /* render — the pages either side are drawn ahead of time, so turning is instant */
  const cache = useRef(new Map<string, HTMLCanvasElement>())
  const flipSheet = useRef<HTMLCanvasElement>(null)
  // The page-curl in progress: a picture of the page being turned, lying over the new one.
  const turn = useRef<{ dir: 1 | -1; p: number; from: number; snap: HTMLCanvasElement } | undefined>(undefined)
  const hideSheetAfterPaint = useRef(false)

  const hideSheet = () => {
    const sheet = flipSheet.current
    if (sheet) sheet.style.display = 'none'
    turn.current = undefined
  }

  useEffect(() => {
    if (!doc || !size) return
    let cancelled = false
    ;(async () => {
      const p = await doc.getPage(page)
      if (cancelled) return
      const viewport = p.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const c = canvas.current!
      c.width = Math.floor(viewport.width * dpr)
      c.height = Math.floor(viewport.height * dpr)
      c.style.width = `${viewport.width}px`
      c.style.height = `${viewport.height}px`
      renderTask.current?.cancel()
      const cached = cache.current.get(`${page}@${scale}`)
      let painted: Promise<unknown>
      if (cached && cached.width === c.width) {
        c.getContext('2d')!.drawImage(cached, 0, 0)
        painted = Promise.resolve()
      } else {
        const task = p.render({ canvasContext: c.getContext('2d')!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        renderTask.current = task
        painted = task.promise.catch(() => {}) // cancelled when the page or zoom changes mid-render
      }
      // A cancelled turn put the old page back underneath: now the curl overlay can go.
      painted.then(() => {
        if (!cancelled && hideSheetAfterPaint.current) {
          hideSheetAfterPaint.current = false
          hideSheet()
        }
      })
      const tl = textLayer.current!
      tl.replaceChildren()
      const content = await p.getTextContent()
      if (cancelled) return
      const isScanned = content.items.length === 0
      setScanned(isScanned)
      onPdfInfo?.({ scanned: isScanned, scale })
      const layer = new pdfjs.TextLayer({ textContentSource: content, container: tl, viewport })
      await layer.render().catch(() => {})
      await painted
      if (cancelled) return
      onReady()
      // Quietly draw the pages either side so the next turn, forward or back, needs no waiting.
      const keep = new Set<string>([`${page}@${scale}`])
      for (const n of [page + 1, page - 1]) {
        if (n < 1 || n > doc.numPages || cancelled) continue
        const key = `${n}@${scale}`
        keep.add(key)
        if (cache.current.has(key)) continue
        const np = await doc.getPage(n)
        const nv = np.getViewport({ scale })
        const off = document.createElement('canvas')
        off.width = Math.floor(nv.width * dpr)
        off.height = Math.floor(nv.height * dpr)
        await np.render({ canvasContext: off.getContext('2d')!, viewport: nv, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise.catch(() => {})
        if (!cancelled) cache.current.set(key, off)
      }
      // The current page goes in the cache too (it's the "previous" one after a turn).
      if (!cancelled) {
        const self = document.createElement('canvas')
        self.width = c.width
        self.height = c.height
        self.getContext('2d')!.drawImage(c, 0, 0)
        cache.current.set(`${page}@${scale}`, self)
        for (const k of cache.current.keys()) if (!keep.has(k)) cache.current.delete(k)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, page, scale, size, onReady, onPdfInfo])

  /* report location */
  useEffect(() => {
    if (!doc) return
    onRelocate({
      location: String(page),
      label: `Page ${page} of ${doc.numPages}`,
      percent: doc.numPages > 1 ? (page - 1) / (doc.numPages - 1) : 1,
      atStart: page <= 1,
      atEnd: page >= doc.numPages,
    })
    onSelect(null)
  }, [doc, page, onRelocate, onSelect])

  /**
   * Start a page turn: a picture of the current page is laid on top, and the
   * new page is drawn underneath. The curl is then driven by a drag or an animation.
   */
  const beginTurn = useCallback(
    (dir: 1 | -1) => {
      if (!doc || turn.current) return false
      const target = page + dir
      if (target < 1 || target > doc.numPages) return false
      const c = canvas.current
      const sheet = flipSheet.current
      window.getSelection()?.removeAllRanges()
      if (!c || !sheet || reducedMotion()) {
        sfx.pageTurn()
        setPage(target)
        return false
      }
      const snap = document.createElement('canvas')
      snap.width = c.width
      snap.height = c.height
      snap.getContext('2d')!.drawImage(c, 0, 0)
      sheet.width = c.width
      sheet.height = c.height
      sheet.style.width = c.style.width
      sheet.style.height = c.style.height
      sheet.style.display = 'block'
      turn.current = { dir, p: 0, from: page, snap }
      drawCurl(sheet, snap, 0, dir)
      setPage(target)
      return true
    },
    [doc, page],
  )

  const drawTurn = (p: number) => {
    const t = turn.current
    const sheet = flipSheet.current
    if (!t || !sheet) return
    t.p = p
    drawCurl(sheet, t.snap, p, t.dir)
  }

  /** Finish the turn (to = 1) or let the page fall back flat (to = 0). */
  const settleTurn = useCallback(async (to: 0 | 1) => {
    const t = turn.current
    if (!t) return
    const dist = Math.abs(to - t.p)
    if (to === 1) sfx.pageTurn()
    await animateCurl(drawTurn, t.p, to, 160 + 620 * dist)
    if (to === 1) hideSheet()
    else {
      // Put the old page back underneath, then lift the overlay once it's painted.
      hideSheetAfterPaint.current = true
      setPage(t.from)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = useCallback(
    (p: number) => {
      if (!doc) return
      const target = Math.max(1, Math.min(doc.numPages, p))
      if (target === page || turn.current) return
      if (Math.abs(target - page) === 1) {
        if (beginTurn(target > page ? 1 : -1)) settleTurn(1)
        return
      }
      window.getSelection()?.removeAllRanges()
      setPage(target)
    },
    [doc, page, beginTurn, settleTurn],
  )

  useImperativeHandle(
    ref,
    () => ({
      next: () => go(page + 1),
      prev: () => go(page - 1),
      goTo: (loc) => go(parseInt(loc, 10) || 1),
      isVisible: (loc) => loc === String(page),
      clearSelection: () => window.getSelection()?.removeAllRanges(),
    }),
    [go, page],
  )

  /* selection → normalised rects */
  const readSelection = useCallback(() => {
    const sel = window.getSelection()
    const box = pageBox.current
    if (!sel || sel.isCollapsed || !box || !sel.rangeCount) return onSelect(null)
    const range = sel.getRangeAt(0)
    if (!textLayer.current?.contains(range.commonAncestorContainer)) return onSelect(null)
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text) return onSelect(null)
    const b = box.getBoundingClientRect()
    const raw = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1)
    const rects = mergeRects(
      raw.map((r) => ({ x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width, h: r.height / b.height })),
    )
    if (!rects.length) return onSelect(null)
    const first = raw[0]
    const last = raw[raw.length - 1]
    onSelect({ location: String(page), rects, text, anchor: { x: (first.left + last.right) / 2, y: first.top, bottom: last.bottom } })
  }, [onSelect, page])

  useEffect(() => {
    let t: number
    const onChange = () => {
      window.clearTimeout(t)
      t = window.setTimeout(readSelection, 250)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      window.clearTimeout(t)
    }
  }, [readSelection])

  /* pointer: drag or swipe to turn (the page follows), tap edges to turn, tap highlights */
  const down = useRef<{ x: number; y: number; t: number; canDrag: boolean; flickOnly: boolean; dragging: boolean; angle: number } | undefined>(undefined)
  const pannable = () => !!stage.current && stage.current.scrollWidth > stage.current.clientWidth + 2

  /* highlighter on touch: a finger run over the words selects them, like a real highlighter */
  const penDrag = useRef<{ node: Node; offset: number } | undefined>(undefined)
  const caretAt = (x: number, y: number) => {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const p = d.caretPositionFromPoint?.(x, y)
    const c = p ? { node: p.offsetNode, offset: p.offset } : (() => {
      const r = d.caretRangeFromPoint?.(x, y)
      return r ? { node: r.startContainer, offset: r.startOffset } : undefined
    })()
    return c && textLayer.current?.contains(c.node) ? c : undefined
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return
    if (props.pen && e.pointerType !== 'mouse') {
      const start = caretAt(e.clientX, e.clientY)
      if (start) {
        penDrag.current = start
        window.getSelection()?.removeAllRanges()
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          /* fine without capture */
        }
        return
      }
    }
    // Mouse on the words: a slow drag selects text (for highlights), a quick sideways flick
    // turns the page. From the outer edges of the page, any drag turns it.
    const onText = !!(e.target as Element).closest('.textLayer span')
    const b = pageBox.current?.getBoundingClientRect()
    const rel = b ? (e.clientX - b.left) / b.width : 0.5
    const atEdge = rel < 0.2 || rel > 0.8
    const flickOnly = e.pointerType === 'mouse' && onText && !atEdge
    down.current = { x: e.clientX, y: e.clientY, t: Date.now(), canDrag: !pannable(), flickOnly, dragging: false, angle: 0 }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const start = penDrag.current
    if (start) {
      const end = caretAt(e.clientX, e.clientY)
      if (end) window.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset)
      return
    }
    const d = down.current
    if (!d?.canDrag || !doc) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      if (d.flickOnly) {
        // Only a fast, clearly sideways movement counts as a page flick; anything slower is selecting.
        if (Date.now() - d.t > 260 || Math.abs(dx) < 26 || Math.abs(dx) < Math.abs(dy) * 2) {
          d.canDrag = false
          return
        }
      } else if (window.getSelection()?.toString()) return
      // Drag left = next page; drag right = previous page. Nothing to turn at the ends.
      if (!beginTurn(dx < 0 ? 1 : -1)) {
        d.canDrag = false
        return
      }
      textLayer.current?.classList.add('turning')
      d.dragging = true
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* capture is a nicety; the drag works without it */
      }
    }
    // The fold follows the pointer: dragging across the page's width turns it fully.
    const width = pageBox.current?.getBoundingClientRect().width ?? 600
    const t = turn.current
    if (!t) return
    const p = Math.max(0, Math.min(0.98, ((t.dir === 1 ? -dx : dx) / width) * 1.1))
    d.angle = p
    drawTurn(p)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (penDrag.current) {
      penDrag.current = undefined
      // Hand the words over now (not after the usual settle delay), so the highlight lands as the finger lifts.
      readSelection()
      return
    }
    const d = down.current
    down.current = undefined
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.dragging) {
      textLayer.current?.classList.remove('turning')
      window.getSelection()?.removeAllRanges()
      const t = turn.current
      if (!t) return
      // Far enough, or flicked: the page completes its turn. Otherwise it falls back flat.
      const velocity = (t.dir === 1 ? -dx : dx) / Math.max(1, Date.now() - d.t)
      return settleTurn(d.angle > 0.28 || velocity > 0.45 ? 1 : 0)
    }
    const selecting = !!window.getSelection()?.toString()
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6 || Date.now() - d.t > 500 || selecting) return
    const box = pageBox.current?.getBoundingClientRect()
    if (box) {
      const px = (e.clientX - box.left) / box.width
      const py = (e.clientY - box.top) / box.height
      const hit = annotations.find((a) => a.kind === 'highlight' && a.location === String(page) && a.rects?.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h))
      if (hit) return onAnnotationClick(hit.id, { x: e.clientX, y: e.clientY - 8, bottom: e.clientY + 8 })
    }
    const sw = stage.current!.getBoundingClientRect()
    const rel = (e.clientX - sw.left) / sw.width
    if (rel < 0.18) go(page - 1)
    else if (rel > 0.82) go(page + 1)
    else onTapCenter()
  }

  const pageHighlights = annotations.filter((a) => a.kind === 'highlight' && a.location === String(page))
  const bookmark = annotations.find((a) => a.kind === 'bookmark' && a.location === String(page))
  const w = size ? size.w * scale : 0
  const h = size ? size.h * scale : 0

  return (
    <div
      className={`pdf-stage ${size && w > (stage.current?.clientWidth ?? Infinity) ? 'pannable' : ''}`}
      ref={stage}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        penDrag.current = undefined
        const wasDragging = down.current?.dragging
        down.current = undefined
        textLayer.current?.classList.remove('turning')
        if (wasDragging) settleTurn(0)
      }}
    >
      {size && (
        <div className="pdf-page-wrap" style={{ width: w, height: h }}>
          <div className="pdf-page" ref={pageBox} style={{ width: w, height: h, ['--scale-factor' as string]: scale }}>
            <canvas ref={canvas} />
            <div className="hl-layer" aria-hidden>
              {pageHighlights.flatMap((a) =>
                (a.rects ?? []).map((r, i) => (
                  <span
                    key={`${a.id}-${i}`}
                    className={`pdf-hl glitter ${a.note ? 'has-note' : ''}`}
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, ['--hl' as string]: highlightFill(a.color) }}
                  />
                )),
              )}
            </div>
            <div className="textLayer" ref={textLayer} />
          </div>
          {props.overlay}
          <canvas ref={flipSheet} className="flip-sheet" aria-hidden />
          <PageBookmark flower={bookmark?.flower} onToggle={onToggleBookmark} />
        </div>
      )}
      {scanned && (
        <p className="scan-note">This page is a scanned image, so its text can't be highlighted — flower bookmarks and page notes still work.</p>
      )}
    </div>
  )
})

/** Merge per-span rectangles into one rectangle per line. */
function mergeRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: PdfRect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5
    if (sameLine && r.x <= last.x + last.w + 0.02) {
      const x = Math.min(last.x, r.x)
      const y = Math.min(last.y, r.y)
      last.w = Math.max(last.x + last.w, r.x + r.w) - x
      last.h = Math.max(last.y + last.h, r.y + r.h) - y
      last.x = x
      last.y = y
    } else out.push({ ...r })
  }
  return out.map((r) => ({ x: +r.x.toFixed(5), y: +r.y.toFixed(5), w: +r.w.toFixed(5), h: +r.h.toFixed(5) }))
}
