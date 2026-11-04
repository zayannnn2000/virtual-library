import { useLiveQuery } from 'dexie-react-hooks'
import { db, save, setSetting, uid } from '../db'
import type { Book, FileFormat } from '../types'
import { DEFAULT_GENRES, RENAMED_GENRES, coverAt, normalise } from './metadata'
import { spineColorFromImage } from './color'

export function useGenres(): string[] {
  const custom = useLiveQuery(async () => ((await db.settings.get('customGenres'))?.value as string[]) ?? [], [])
  const hidden = useLiveQuery(async () => ((await db.settings.get('hiddenGenres'))?.value as string[]) ?? [], [])
  return [...DEFAULT_GENRES.filter((g) => !hidden?.includes(g)), ...(custom ?? [])]
}

/**
 * Takes a category off her list (a built-in one is hidden, her own is deleted) and off
 * every book that had it. Returns an undo that puts it all back.
 */
export async function removeGenre(name: string): Promise<() => Promise<void>> {
  const custom = ((await db.settings.get('customGenres'))?.value as string[]) ?? []
  const hidden = ((await db.settings.get('hiddenGenres'))?.value as string[]) ?? []
  const tagged = await db.books.filter((b) => b.genres.includes(name)).toArray()
  const isDefault = DEFAULT_GENRES.includes(name)
  if (isDefault) await setSetting('hiddenGenres', [...hidden.filter((g) => g !== name), name])
  else await setSetting('customGenres', custom.filter((g) => g !== name))
  for (const b of tagged) await db.books.update(b.id, { genres: b.genres.filter((g) => g !== name), updatedAt: Date.now() })
  return async () => {
    await setSetting('customGenres', custom)
    await setSetting('hiddenGenres', hidden)
    for (const b of tagged) await db.books.update(b.id, { genres: b.genres, updatedAt: Date.now() })
  }
}

/** One-time move of books from the old category names onto the current list. */
export async function migrateGenres() {
  const books = await db.books.toArray()
  for (const b of books) {
    if (!b.genres.some((g) => g in RENAMED_GENRES)) continue
    const genres = [...new Set(b.genres.map((g) => RENAMED_GENRES[g] ?? g))]
    await db.books.update(b.id, { genres, updatedAt: Date.now() })
  }
}

export async function addCustomGenre(name: string) {
  const g = name.trim()
  if (!g) return
  const row = await db.settings.get('customGenres')
  const list = (row?.value as string[]) ?? []
  // Bringing back a built-in category she'd removed just un-hides it.
  const hidden = ((await db.settings.get('hiddenGenres'))?.value as string[]) ?? []
  const builtIn = DEFAULT_GENRES.find((x) => x.toLowerCase() === g.toLowerCase())
  if (builtIn) {
    if (hidden.includes(builtIn)) await setSetting('hiddenGenres', hidden.filter((x) => x !== builtIn))
    return
  }
  if (list.some((x) => x.toLowerCase() === g.toLowerCase())) return
  await setSetting('customGenres', [...list, g])
}

export async function findDuplicate(title: string, authors: string[], olWorkKey?: string) {
  const books = await db.books.filter((b) => !b.removedAt).toArray()
  const t = normalise(title)
  const a = normalise(authors[0] ?? '')
  return books.find(
    (b) =>
      (olWorkKey && b.olWorkKey === olWorkKey) ||
      (normalise(b.title) === t && (!a || !b.authors[0] || normalise(b.authors[0]) === a)),
  )
}

export interface NewBook {
  title: string
  authors: string[]
  year?: number
  pages?: number
  isbn?: string
  olWorkKey?: string
  olEditionKey?: string
  coverUrl?: string
  coverSource: Book['coverSource']
  coverBlob?: Blob
  genres: string[]
  status: Book['status']
  file?: { file: File; format: FileFormat }
  source?: Book['source']
  language?: string
  publisher?: string
}

/** The book already imported from this exact source record, if any. */
export async function findBySource(sourceId: string) {
  return db.books.filter((b) => !b.removedAt && b.source?.id === sourceId).first()
}

/**
 * The spine colour, measured from the cover before the book reaches the shelf, so it
 * appears in its own colour straight away (no placeholder that changes a moment later).
 * Gives up after a moment — the shelf measures it later if the cover is slow.
 */
async function measureSpine(n: NewBook): Promise<string | undefined> {
  const local = n.coverBlob && (n.coverSource === 'upload' || n.coverSource === 'file')
  const src = local ? URL.createObjectURL(n.coverBlob!) : n.coverUrl ? coverAt(n.coverUrl, 'M') : undefined
  if (!src) return undefined
  try {
    return await Promise.race([spineColorFromImage(src), new Promise<undefined>((r) => setTimeout(() => r(undefined), 2500))])
  } finally {
    if (local) URL.revokeObjectURL(src)
  }
}

export async function addBook(n: NewBook): Promise<Book> {
  const spineColor = await measureSpine(n).catch(() => undefined)
  const now = Date.now()
  const id = uid()
  const book: Book = {
    id,
    title: n.title.trim() || 'Untitled',
    authors: n.authors.map((a) => a.trim()).filter(Boolean),
    year: n.year,
    pages: n.pages,
    isbn: n.isbn,
    olWorkKey: n.olWorkKey,
    olEditionKey: n.olEditionKey,
    coverUrl: n.coverSource === 'openlibrary' || n.coverSource === 'google' || n.coverSource === 'archive' ? n.coverUrl : undefined,
    coverSource: n.coverSource,
    spineColor,
    source: n.source,
    language: n.language,
    publisher: n.publisher,
    genres: n.genres,
    status: n.status,
    favorite: false,
    file: n.file ? { name: n.file.file.name, format: n.file.format, size: n.file.file.size, addedAt: now } : undefined,
    addedAt: now,
    updatedAt: now,
  }
  await save(() =>
    db.transaction('rw', db.books, db.blobs, async () => {
      await db.books.add(book)
      if (n.file) await db.blobs.put({ key: `${id}:file`, bookId: id, blob: n.file.file })
      if (n.coverBlob && (n.coverSource === 'upload' || n.coverSource === 'file'))
        await db.blobs.put({ key: `${id}:cover`, bookId: id, blob: n.coverBlob })
    }),
  )
  return book
}

/** Attach or replace the readable file. Replacing a file resets position (pages may differ). */
export async function attachFile(book: Book, file: File, format: FileFormat, pages?: number, source?: Book['source']) {
  const replacing = !!book.file
  await save(() =>
    db.transaction('rw', db.books, db.blobs, async () => {
      await db.blobs.put({ key: `${book.id}:file`, bookId: book.id, blob: file })
      await db.books.update(book.id, {
        file: { name: file.name, format, size: file.size, addedAt: Date.now() },
        ...(source ? { source } : {}),
        pages: format === 'pdf' && pages ? pages : book.pages,
        progress: replacing ? undefined : book.progress,
        epubLocations: undefined,
        updatedAt: Date.now(),
      })
    }),
  )
}

export async function detachFile(book: Book) {
  await save(() =>
    db.transaction('rw', db.books, db.blobs, async () => {
      await db.blobs.delete(`${book.id}:file`)
      await db.books.update(book.id, { file: undefined, progress: undefined, epubLocations: undefined, updatedAt: Date.now() })
    }),
  )
}

export async function setUploadedCover(book: Book, blob: Blob, source: 'upload' | 'file' = 'upload') {
  await save(() =>
    db.transaction('rw', db.books, db.blobs, async () => {
      await db.blobs.put({ key: `${book.id}:cover`, bookId: book.id, blob })
      await db.books.update(book.id, { coverSource: source, spineColor: undefined, updatedAt: Date.now() })
    }),
  )
}

export async function setRemoteCover(book: Book, url: string, source: 'openlibrary' | 'google') {
  await save(() =>
    db.transaction('rw', db.books, db.blobs, async () => {
      await db.blobs.delete(`${book.id}:cover`)
      await db.books.update(book.id, { coverUrl: url, coverSource: source, spineColor: undefined, updatedAt: Date.now() })
    }),
  )
}
