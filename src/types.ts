export type ReadingStatus = 'want' | 'reading' | 'finished'
export type FileFormat = 'pdf' | 'epub'
export type CoverSource = 'openlibrary' | 'google' | 'archive' | 'upload' | 'file' | 'none'

/** Where a book's file came from, and the licence it was shared under. */
export interface BookSource {
  name: 'Internet Archive' | 'Google Books' | 'OAPEN' | 'DOAB' | 'Project Gutenberg'
  /** The source's own id for the book, so the same book is never imported twice. */
  id: string
  url: string
  license?: string
  licenseUrl?: string
  /** 'fetched' = the app downloaded it; 'uploaded' = she added her own copy. */
  via: 'fetched' | 'uploaded'
}

export interface BookFileInfo {
  name: string
  format: FileFormat
  size: number
  addedAt: number
}

export interface ReadingProgress {
  /** EPUB: CFI of the first visible location. PDF: page number as a string. */
  location: string
  /** 0..1 */
  percent: number
  /** Human label, e.g. "Page 34 of 300" */
  label?: string
  updatedAt: number
}

export interface Book {
  id: string
  title: string
  authors: string[]
  year?: number
  pages?: number
  isbn?: string
  olWorkKey?: string
  olEditionKey?: string
  /** Remote cover URL (real published cover) */
  coverUrl?: string
  coverSource: CoverSource
  spineColor?: string
  /** Short summary shown on the book's card, fetched once from Open Library / Google Books. */
  description?: string
  descriptionSource?: 'openlibrary' | 'google' | 'none'
  /** When "no summary" was last confirmed (it's looked up again after a while). */
  descriptionCheckedAt?: number
  genres: string[]
  /** Genres suggested automatically and not yet confirmed by her */
  suggestedGenres?: string[]
  status: ReadingStatus
  favorite: boolean
  file?: BookFileInfo
  source?: BookSource
  language?: string
  publisher?: string
  progress?: ReadingProgress
  /** Taken off "Continue reading" at this time; it comes back once she reads it again. */
  continueHiddenAt?: number
  /** epub.js locations cache, JSON string */
  epubLocations?: string
  addedAt: number
  updatedAt: number
  /** Set while the removal can still be undone */
  removedAt?: number
}

export interface StoredBlob {
  /** `${bookId}:file` or `${bookId}:cover` */
  key: string
  bookId: string
  blob: Blob
}

export type AnnotationKind = 'bookmark' | 'highlight' | 'note'
export type FlowerKind = 'lavender' | 'forgetmenot' | 'blossom'
export type HighlightColor = 'lavender' | 'rose' | 'butter' | 'mint'
export type NoteColor = 'lilac' | 'pink' | 'cream'
export type StickerKind = 'none' | 'heart' | 'star' | 'butterfly' | 'bow' | 'moon' | 'sparkle'

export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  bookId: string
  kind: AnnotationKind
  /** EPUB: CFI (range for passages, point for pages). PDF: page number as string. */
  location: string
  /** PDF only: highlight rectangles normalised to the page (0..1). */
  rects?: PdfRect[]
  /** Passage text for highlights / passage notes */
  text?: string
  /** "Page 12" or "34%" — shown in lists */
  label?: string
  color?: HighlightColor
  flower?: FlowerKind
  note?: string
  noteColor?: NoteColor
  sticker?: StickerKind
  /** Page notes stuck at a spot on the page: position as a fraction of the page (0..1). */
  pos?: { x: number; y: number }
  createdAt: number
  updatedAt: number
}

export interface Setting {
  key: string
  value: unknown
}
