import Dexie, { type EntityTable } from 'dexie'
import type { Annotation, Book, Setting, StoredBlob } from './types'

/** A local change waiting to be sent to the cloud. */
export interface OutboxItem {
  key: string
  kind: 'book' | 'annotation' | 'setting' | 'blob'
  id: string
  at: number
}

export const db = new Dexie('virtual-library') as Dexie & {
  books: EntityTable<Book, 'id'>
  blobs: EntityTable<StoredBlob, 'key'>
  annotations: EntityTable<Annotation, 'id'>
  settings: EntityTable<Setting, 'key'>
  outbox: EntityTable<OutboxItem, 'key'>
}

db.version(1).stores({
  books: 'id, title, status, favorite, addedAt, removedAt, olWorkKey',
  blobs: 'key, bookId',
  annotations: 'id, bookId, kind, [bookId+kind]',
  settings: 'key',
})
db.version(2).stores({
  outbox: 'key, kind',
})

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/* ---------- save status (shown in the header) ---------- */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Listener = (s: SaveState, msg?: string) => void
const listeners = new Set<Listener>()
let pending = 0
export function onSaveState(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
function emit(s: SaveState, msg?: string) {
  listeners.forEach((l) => l(s, msg))
}

/** Wrap every write so the UI can show saving / saved / error. */
export async function save<T>(fn: () => Promise<T>): Promise<T> {
  pending++
  emit('saving')
  try {
    const result = await fn()
    pending--
    if (pending === 0) emit('saved')
    return result
  } catch (err) {
    pending--
    const msg =
      err instanceof Error && err.name === 'QuotaExceededError'
        ? 'Storage is full — export a backup and remove a few files.'
        : "Couldn't save that change. Please try again."
    emit('error', msg)
    console.error(err)
    throw err
  }
}

/** Settings that belong to this device only and never sync. */
export const isLocalSetting = (key: string) => key.startsWith('sync:')

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return (row?.value as T) ?? fallback
}
export function setSetting(key: string, value: unknown) {
  return save(() => db.settings.put({ key, value }))
}

/* ---------- books ---------- */

export function updateBook(id: string, changes: Partial<Book>) {
  return save(() => db.books.update(id, { ...changes, updatedAt: Date.now() }))
}

export async function getFileBlob(bookId: string) {
  return (await db.blobs.get(`${bookId}:file`))?.blob
}

/** Set by the sync layer: fetches a file or cover that lives in the cloud but not on this device yet. */
let remoteBlob: ((key: string, bookId: string) => Promise<Blob | undefined>) | undefined
export function setRemoteBlobFetcher(f: typeof remoteBlob) {
  remoteBlob = f
}
export const canFetchRemote = () => !!remoteBlob
export async function downloadBlob(bookId: string, which: 'file' | 'cover' | 'photo') {
  return remoteBlob?.(`${bookId}:${which}`, bookId)
}

/** Soft remove — can be undone until purgeRemoved runs. */
export function removeBook(id: string) {
  return updateBook(id, { removedAt: Date.now() })
}
export function restoreBook(id: string) {
  return save(() => db.books.update(id, { removedAt: undefined }))
}
export async function purgeBook(id: string) {
  await save(() =>
    db.transaction('rw', db.books, db.blobs, db.annotations, async () => {
      await db.books.delete(id)
      await db.blobs.where('bookId').equals(id).delete()
      await db.annotations.where('bookId').equals(id).delete()
    }),
  )
}
/** Removals older than this are made permanent on start-up (undo window has passed). */
export async function purgeStaleRemovals() {
  const stale = await db.books.filter((b) => !!b.removedAt && Date.now() - b.removedAt > 60_000).toArray()
  for (const b of stale) await purgeBook(b.id)
}

/* ---------- annotations ---------- */

export function putAnnotation(a: Annotation) {
  return save(() => db.annotations.put({ ...a, updatedAt: Date.now() }))
}
export function deleteAnnotation(id: string) {
  return save(() => db.annotations.delete(id))
}

/* ---------- backup ---------- */

export async function exportBackup(): Promise<Blob> {
  const [books, annotations, settings] = await Promise.all([
    db.books.toArray(),
    db.annotations.toArray(),
    db.settings.toArray(),
  ])
  const data = {
    app: 'virtual-library',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Books, reading progress, bookmarks, highlights and notes. Ebook files are not included — keep your PDFs/EPUBs too.',
    books: books.filter((b) => !b.removedAt).map(({ epubLocations: _l, ...b }) => b),
    annotations,
    settings,
  }
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

export async function importBackup(file: File): Promise<{ books: number; annotations: number }> {
  let data: { app?: string; books?: Book[]; annotations?: Annotation[]; settings?: Setting[] }
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error("That file isn't a library backup.")
  }
  if (data.app !== 'virtual-library' || !Array.isArray(data.books)) {
    throw new Error("That file isn't a library backup.")
  }
  await save(() =>
    db.transaction('rw', db.books, db.annotations, db.settings, async () => {
      // Keep any file already attached on this device.
      for (const b of data.books!) {
        const existing = await db.books.get(b.id)
        await db.books.put({ ...b, file: existing?.file })
      }
      await db.annotations.bulkPut(data.annotations ?? [])
      await db.settings.bulkPut(data.settings ?? [])
    }),
  )
  return { books: data.books.length, annotations: data.annotations?.length ?? 0 }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    /* not supported — fine */
  }
}
