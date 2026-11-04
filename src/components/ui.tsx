import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { canFetchRemote, db, downloadBlob } from '../db'
import type { Book } from '../types'
import { coverAt } from '../lib/metadata'
import { Icon } from './Art'
import { pauseScroll } from '../lib/motion'

/* ---------- cover source ---------- */

/** Uploaded / file covers live in IndexedDB; published covers are remote URLs. */
export function useCoverSrc(book: Book | undefined, size: 'M' | 'L' = 'L') {
  const blob = useLiveQuery(
    async () => (book && (book.coverSource === 'upload' || book.coverSource === 'file') ? (await db.blobs.get(`${book.id}:cover`))?.blob ?? null : null),
    [book?.id, book?.coverSource, book?.updatedAt],
  )
  // Which book the object URL belongs to, so switching books never shows the previous one's cover.
  const [owned, setOwned] = useState<{ id: string; url: string }>()
  const url = owned && owned.id === book?.id ? owned.url : undefined
  // A cover she uploaded on another device: fetch it once; the live query picks it up.
  useEffect(() => {
    if (blob === null && book && (book.coverSource === 'upload' || book.coverSource === 'file') && canFetchRemote()) {
      downloadBlob(book.id, 'cover').catch(() => {})
    }
  }, [blob, book?.id, book?.coverSource])
  useEffect(() => {
    if (!blob || !book) {
      setOwned(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setOwned({ id: book.id, url: u })
    return () => URL.revokeObjectURL(u)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])
  if (!book) return undefined
  if (book.coverSource === 'upload' || book.coverSource === 'file') return url
  return coverAt(book.coverUrl, size)
}

/* ---------- toasts ---------- */

interface Toast {
  id: number
  message: string
  tone?: 'info' | 'error'
  action?: { label: string; run: () => void }
  onExpire?: () => void
  duration?: number
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<number, number>())
  const live = useRef(new Map<number, Toast>())
  const dismiss = useCallback((id: number, expired: boolean) => {
    const t = live.current.get(id)
    if (!t) return
    live.current.delete(id)
    if (expired) t.onExpire?.()
    setToasts((ts) => ts.filter((x) => x.id !== id))
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      live.current.set(id, { ...t, id })
      setToasts((ts) => [...ts, { ...t, id }])
      timers.current.set(id, window.setTimeout(() => dismiss(id, true), t.duration ?? 7000))
    },
    [dismiss],
  )
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id, false)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn small" aria-label="Dismiss" onClick={() => dismiss(t.id, true)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- dialog ---------- */

let openDialogs = 0

export function Dialog({
  label,
  onClose,
  children,
  className = '',
  closing = false,
  outside,
}: {
  label: string
  onClose: () => void
  children: ReactNode
  className?: string
  /** True while an exit animation plays, so the backdrop can fade out with it. */
  closing?: boolean
  /** Things that sit beside the card rather than in it (e.g. previous / next arrows). */
  outside?: ReactNode
}) {
  useEffect(() => {
    pauseScroll(true)
    // Lets the page behind rest (butterflies, twinkling lights) while a dialog is open.
    openDialogs++
    document.documentElement.classList.add('dialog-open')
    return () => {
      pauseScroll(false)
      if (--openDialogs === 0) document.documentElement.classList.remove('dialog-open')
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  // The latest onClose, without re-running the focus setup each time the parent re-renders.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current!
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el
    first.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const items = [...scrim.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.hasAttribute('disabled') && x.offsetParent !== null,
        )
        if (!items.length) return
        const [a, b] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    // On the whole overlay, so keys still work while focus is on something beside the card (an arrow).
    const scrim = el.parentElement ?? el
    scrim.addEventListener('keydown', onKey)
    return () => {
      scrim.removeEventListener('keydown', onKey)
      prev?.focus?.({ preventScroll: true })
    }
  }, [])
  return (
    <div className={`scrim ${closing ? 'closing' : ''}`} data-lenis-prevent onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
        {children}
      </div>
      {outside}
    </div>
  )
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
