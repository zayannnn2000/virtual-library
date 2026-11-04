import type { ReactNode } from 'react'
import type { Annotation, Book, PdfRect } from '../types'

export interface Relocation {
  location: string
  label: string
  percent: number
  atStart: boolean
  atEnd: boolean
}

export interface TextSelection {
  location: string
  rects?: PdfRect[]
  text: string
  /** Viewport rectangle used to place the selection toolbar */
  anchor: { x: number; y: number; bottom: number }
}

export interface ViewHandle {
  next(): void
  prev(): void
  goTo(location: string): void
  /** True if the location (page or CFI) is on screen right now */
  isVisible(location: string): boolean
  clearSelection(): void
  /** EPUB: the book's chapters (from its table of contents), to jump to one. */
  chapters?(): { label: string; href: string; depth: number }[]
  /** EPUB: jump to a point in the book, 0..1. */
  goToPercent?(p: number): void
  /** EPUB: jump to a book page (1-based), once page numbers are worked out. */
  goToPage?(n: number): void
}

export interface ReaderPrefs {
  fontSize: number
  lineHeight: number
  font: 'serif' | 'classic' | 'sans'
  pdfZoom: 'fit-page' | 'fit-width' | number
}

export const DEFAULT_PREFS: ReaderPrefs = { fontSize: 105, lineHeight: 1.65, font: 'serif', pdfZoom: 'fit-page' }

export interface ViewProps {
  book: Book
  blob: Blob
  annotations: Annotation[]
  prefs: ReaderPrefs
  onReady: () => void
  onError: (message: string) => void
  onRelocate: (r: Relocation) => void
  onSelect: (s: TextSelection | null) => void
  onAnnotationClick: (id: string, anchor: { x: number; y: number; bottom: number }) => void
  onTapCenter: () => void
  /** Add or remove the flower bookmark on the page being shown. */
  onToggleBookmark: () => void
  /** Drawn over the page, sized to it (sticky notes stuck on the page). */
  overlay?: ReactNode
  /** A highlighter colour is picked: on touch, a finger drag over the words highlights them. */
  pen?: boolean
  onPdfInfo?: (info: { scanned: boolean; scale: number }) => void
}
