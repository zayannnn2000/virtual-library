import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon, PressedFlower } from './Art'
import { QuoteNote } from './QuoteNotes'
import { sparkleBurst } from './GlitterTrail'
import { useToast } from './ui'
import {
  FRAMES,
  addBoardPhotos,
  getPhotoBlob,
  removeBoardPhoto,
  restoreBoardPhoto,
  useBoardPhotos,
  usePhotoUrl,
  type BoardPhoto,
  type Frame,
} from '../lib/board'

/** A push pin, in cherry red or pearl. */
function Pin({ color = '#c8234a' }: { color?: string }) {
  return (
    <svg className="pin" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="9" r="6.5" fill={color} />
      <circle cx="8" cy="7" r="2" fill="#fff" opacity="0.55" />
      <ellipse cx="11" cy="17" rx="4" ry="1.4" fill="#000" opacity="0.15" />
    </svg>
  )
}

function Kiss() {
  return (
    <svg viewBox="0 0 120 70" className="kiss" aria-hidden>
      <path d="M8 34 C22 14 40 10 52 22 C56 18 64 18 68 22 C80 10 98 14 112 34 C96 38 82 40 60 40 C38 40 24 38 8 34z" fill="#c8234a" opacity="0.92" />
      <path d="M8 36 C26 42 42 44 60 44 C78 44 94 42 112 36 C98 58 80 66 60 66 C40 66 22 58 8 36z" fill="#b01c40" opacity="0.92" />
      <path d="M14 36 C34 40 86 40 106 36" stroke="#7a1030" strokeWidth="2" fill="none" opacity="0.6" />
      <path d="M30 50 C40 54 50 55 58 55" stroke="#fff" strokeWidth="2" fill="none" opacity="0.25" strokeLinecap="round" />
    </svg>
  )
}

function Cherries() {
  return (
    <svg viewBox="0 0 70 70" className="cherries" aria-hidden>
      <path d="M22 44 C26 26 34 14 46 8 M46 8 C44 22 46 34 48 44" stroke="#5f7a52" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M46 8 C54 4 62 8 64 14 C56 16 50 14 46 8z" fill="#7d9a64" />
      <circle cx="22" cy="50" r="13" fill="#c8234a" />
      <circle cx="48" cy="52" r="13" fill="#b01c40" />
      <circle cx="17" cy="45" r="3.5" fill="#fff" opacity="0.5" />
      <circle cx="43" cy="47" r="3.5" fill="#fff" opacity="0.5" />
    </svg>
  )
}

function Pinned({ children, className, tilt, pin }: { children: ReactNode; className: string; tilt: number; pin?: string }) {
  return (
    <div
      className={`pinned-item ${className}`}
      style={{ ['--tilt' as string]: `${tilt}deg` } as CSSProperties}
      onClick={(e) => sparkleBurst(e.clientX, e.clientY, 22)}
    >
      {pin !== 'none' && <Pin color={pin} />}
      {children}
    </div>
  )
}

/** One of her own pictures, in the frame she chose. */
function PhotoTile({ photo, onRemove }: { photo: BoardPhoto; onRemove: () => void }) {
  const url = usePhotoUrl(photo.id)
  return (
    <div className={`board-photo frame-${photo.frame}`} style={{ ['--tilt' as string]: `${photo.tilt}deg` } as CSSProperties}>
      {photo.frame === 'polaroid' && <Pin />}
      {photo.frame === 'tape' && <span className="photo-tape" aria-hidden />}
      <span className="photo-inner">{url ? <img src={url} alt="A picture on her board" draggable={false} /> : <span className="photo-loading" />}</span>
      <button className="photo-remove" aria-label="Take this picture off the board" onClick={onRemove}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

/**
 * The pinboard: a bit of attitude to go with the lace and flowers, and a place
 * for her own pictures (from her files, dropped in, or pasted from Pinterest).
 */
export function Pinboard() {
  const photos = useBoardPhotos()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const [frame, setFrame] = useState<Frame>('polaroid')
  const [over, setOver] = useState(false)
  const frameRef = useRef(frame)
  frameRef.current = frame

  const add = async (files: Blob[]) => {
    try {
      const n = await addBoardPhotos(files, frameRef.current)
      toast({ message: n === 1 ? 'Pinned to your board.' : `${n} pictures pinned to your board.` })
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' })
    }
  }

  // Paste a picture copied from Pinterest (or anywhere) straight onto the board.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        add(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = async (p: BoardPhoto) => {
    const blob = await getPhotoBlob(p.id)
    await removeBoardPhoto(p.id)
    toast({ message: 'Picture taken down.', action: blob ? { label: 'Undo', run: () => restoreBoardPhoto(p, blob) } : undefined })
  }

  return (
    <section
      className={`pinboard ${over ? 'drop-over' : ''}`}
      aria-label="Pinboard"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        setOver(false)
        if (files.length) {
          e.preventDefault()
          add(files)
        }
      }}
    >
      <header className="board-head">
        <span className="board-title">pin your mood</span>
        <div className="board-add-wrap">
          <button className="board-add" onClick={() => setPicking(!picking)} aria-expanded={picking} aria-label="Add a picture to the board">
            <Icon name="plus" size={18} />
          </button>
          {picking && (
            <div className="popover frame-picker" role="dialog" aria-label="Choose a frame">
              <p className="fine">Pick a frame, then choose pictures — or paste one copied from Pinterest (Ctrl/⌘ + V).</p>
              <div className="frame-options">
                {FRAMES.map((f) => (
                  <button key={f.frame} className={`frame-option ${frame === f.frame ? 'on' : ''}`} aria-pressed={frame === f.frame} onClick={() => setFrame(f.frame)}>
                    <span className={`frame-sample frame-${f.frame}`}>
                      <span className="photo-inner" />
                    </span>
                    {f.name}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-small"
                onClick={() => {
                  setPicking(false)
                  input.current?.click()
                }}
              >
                Choose pictures
              </button>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) add(files)
            }}
          />
        </div>
      </header>

      <div className="board-items">
        {photos.map((p) => (
          <PhotoTile key={p.id} photo={p} onRemove={() => remove(p)} />
        ))}

        <Pinned className="poster" tilt={-3}>
          <span className="poster-text">
            Pretty
            <br />
            girls
            <br />
            read
            <br />
            books
          </span>
          <span className="poster-heart" aria-hidden>♡</span>
        </Pinned>

        <Pinned className="label" tilt={2} pin="#f3f0ea">
          <span>reading is sexy.</span>
        </Pinned>

        <Pinned className="kiss-card" tilt={-6} pin="none">
          <Kiss />
        </Pinned>

        <QuoteNote slot={3} className="on-board" />

        <Pinned className="polaroid" tilt={4} pin="#c8234a">
          <span className="polaroid-photo">
            <PressedFlower kind="blossom" size={40} />
            <PressedFlower kind="lavender" size={34} />
          </span>
          <span className="polaroid-caption">pressed &amp; obsessed</span>
        </Pinned>

        <Pinned className="cherry-sticker" tilt={-8} pin="none">
          <Cherries />
        </Pinned>

        <Pinned className="label label-red" tilt={-2} pin="#c8234a">
          <span>do not disturb — chapter 27</span>
        </Pinned>
      </div>
      {over && <div className="drop-hint">Drop to pin it ♡</div>}
    </section>
  )
}
