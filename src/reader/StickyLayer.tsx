import { useRef } from 'react'
import type { Annotation } from '../types'
import { Sticker } from '../components/Art'

/**
 * Sticky notes stuck anywhere on the page. In "placing" mode, a tap on the page
 * says where the new note goes. Placed notes are small squares (so they don't
 * hide the text); hover or tap to read, drag to move, tap to edit.
 */
export function StickyLayer({
  notes,
  placing,
  onPlace,
  onMove,
  onOpen,
}: {
  notes: Annotation[]
  placing: boolean
  onPlace: (pos: { x: number; y: number }) => void
  onMove: (note: Annotation, pos: { x: number; y: number }) => void
  onOpen: (note: Annotation) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean; el: HTMLElement } | undefined>(undefined)

  const toPos = (clientX: number, clientY: number) => {
    const r = layer.current!.getBoundingClientRect()
    return {
      x: Math.min(0.94, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(0.94, Math.max(0, (clientY - r.top) / r.height)),
    }
  }

  return (
    <div
      ref={layer}
      className={`sticky-layer ${placing ? 'placing' : ''}`}
      onPointerDown={(e) => {
        if (!placing) return
        e.stopPropagation()
        onPlace(toPos(e.clientX, e.clientY))
      }}
    >
      {placing && <p className="placing-hint">Tap anywhere on the page to stick your note</p>}
      {notes.map((n, i) => (
        <button
          key={n.id}
          className={`page-sticky sticky-${n.noteColor ?? 'pink'}`}
          style={{ left: `${(n.pos?.x ?? 0) * 100}%`, top: `${(n.pos?.y ?? 0) * 100}%`, ['--tilt' as string]: `${i % 2 ? 4 : -4}deg` }}
          aria-label={`Sticky note: ${n.note || 'empty'}. Drag to move, tap to edit.`}
          onPointerDown={(e) => {
            e.stopPropagation()
            const el = e.currentTarget
            const r = el.getBoundingClientRect()
            drag.current = { id: n.id, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, el }
            try {
              el.setPointerCapture(e.pointerId)
            } catch {
              /* fine */
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || d.id !== n.id) return
            const lr = layer.current!.getBoundingClientRect()
            const x = (e.clientX - d.dx - lr.left) / lr.width
            const y = (e.clientY - d.dy - lr.top) / lr.height
            if (!d.moved && Math.hypot(e.movementX, e.movementY) < 1) return
            d.moved = true
            d.el.style.left = `${Math.min(0.94, Math.max(0, x)) * 100}%`
            d.el.style.top = `${Math.min(0.94, Math.max(0, y)) * 100}%`
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            const d = drag.current
            drag.current = undefined
            if (!d) return
            if (d.moved) {
              const lr = layer.current!.getBoundingClientRect()
              onMove(n, {
                x: Math.min(0.94, Math.max(0, (e.clientX - d.dx - lr.left) / lr.width)),
                y: Math.min(0.94, Math.max(0, (e.clientY - d.dy - lr.top) / lr.height)),
              })
            } else onOpen(n)
          }}
        >
          {n.sticker && n.sticker !== 'none' ? <Sticker kind={n.sticker} size={22} /> : <span className="page-sticky-dot" />}
          <span className="page-sticky-preview">{n.note || 'Empty note'}</span>
        </button>
      ))}
    </div>
  )
}
