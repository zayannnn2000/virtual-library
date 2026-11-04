/**
 * Cloud sync with Supabase. The library always works from IndexedDB first;
 * every local change is queued in `outbox` and pushed in the background, and
 * changes from her other devices are pulled by a server-side change counter.
 * Conflicts resolve as "most recent edit wins".
 *
 * Sync is off unless VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
 */
import Dexie, { type Transaction } from 'dexie'
import { createClient, type Session } from '@supabase/supabase-js'
import { db, isLocalSetting, setRemoteBlobFetcher, type OutboxItem } from './db'
import type { Annotation, Book } from './types'
import { forgetPinOnThisDevice, pinPassword } from './lib/pin'

// Strip invisible characters (a byte-order mark from Windows shells broke the first deploy).
const clean = (s?: string) => s?.replace(/^﻿/, '').trim() || undefined
const URL_ = clean(import.meta.env.VITE_SUPABASE_URL)
const KEY = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

function makeClient() {
  if (!URL_ || !KEY) return null
  try {
    return createClient(URL_, KEY)
  } catch (err) {
    // A bad config should never blank the page — fall back to this-device-only.
    console.error('Supabase config is invalid; running without sync', err)
    return null
  }
}
export const supabase = makeClient()

/** "Look around first": use the library on this device without an account. */
const GUEST_KEY = 'library:guest'
export function isGuest() {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
}
export function setGuest(on: boolean) {
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1')
    else localStorage.removeItem(GUEST_KEY)
  } catch {
    /* storage blocked — guest mode just won't be remembered */
  }
}

/** Sync is on when Supabase is configured and she isn't just looking around. */
export const syncEnabled = !!supabase && !isGuest()
/** Supabase is configured, so signing in is possible (even from guest mode). */
export const canSignIn = !!supabase
const BUCKET = 'library'

/* ---------- status ---------- */

export type SyncState = 'off' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
const listeners = new Set<(s: SyncState, detail?: string) => void>()
let state: SyncState = syncEnabled ? 'idle' : 'off'
let detail: string | undefined
export function onSyncState(l: (s: SyncState, detail?: string) => void) {
  listeners.add(l)
  l(state, detail)
  return () => {
    listeners.delete(l)
  }
}
function setState(s: SyncState, d?: string) {
  state = s
  detail = d
  listeners.forEach((l) => l(s, d))
}

/* ---------- change tracking ---------- */

type Kind = OutboxItem['kind']
const REMOTE = '__fromCloud'
const isRemote = (tx: Transaction | undefined) => !!(tx as any)?.[REMOTE]

function track(kind: Kind, id: string, tx: Transaction) {
  if (isRemote(tx)) return
  if (kind === 'setting' && isLocalSetting(id)) return
  // Write the outbox entry once the change itself has committed.
  tx.on('complete', () => {
    db.outbox.put({ key: `${kind}:${id}`, kind, id, at: Date.now() }).then(requestSync, () => {})
  })
}

if (syncEnabled) {
  for (const [table, kind] of [
    [db.books, 'book'],
    [db.annotations, 'annotation'],
    [db.settings, 'setting'],
    [db.blobs, 'blob'],
  ] as const) {
    table.hook('creating', function (key, _obj, tx) {
      track(kind, String(key), tx)
    })
    table.hook('updating', function (_mods, key, _obj, tx) {
      track(kind, String(key), tx)
    })
    table.hook('deleting', function (key, _obj, tx) {
      track(kind, String(key), tx)
    })
  }
}

/** Run Dexie writes that came from the cloud without queueing them to be sent back. */
function fromCloud<T>(tables: Dexie.Table[], fn: () => Promise<T>) {
  return db.transaction('rw', tables, () => {
    ;(Dexie.currentTransaction as any)[REMOTE] = true
    return fn()
  })
}

/* ---------- auth ---------- */

let session: Session | null = null
export async function getSession() {
  if (!supabase || !syncEnabled) return null
  session = (await supabase.auth.getSession()).data.session
  return session
}
export function onAuth(cb: (s: Session | null, event: string) => void) {
  if (!supabase || !syncEnabled) return () => {}
  const { data } = supabase.auth.onAuthStateChange((e, s) => {
    session = s
    cb(s, e)
  })
  return () => data.subscription.unsubscribe()
}

/* ---------- PIN (her Supabase password) ---------- */

const back = () => location.origin + location.pathname

/** Friendly wording for Supabase auth errors. */
function pinError(err: { message?: string; status?: number } | null): Error {
  const m = err?.message ?? ''
  if (!navigator.onLine) return new Error("You're offline — connect to the internet and try again.")
  if (/invalid login credentials/i.test(m)) return new Error("That PIN isn't right.")
  if (/not confirmed/i.test(m)) return new Error('Open the activation email first — then your PIN will work.')
  if (/rate|too many|seconds/i.test(m) || err?.status === 429) return new Error('Too many tries — wait a minute, then try again.')
  if (/weak|password should/i.test(m)) return new Error('Please choose a different PIN.')
  return new Error("Something went wrong. Please try again.")
}

export async function signInWithPin(email: string, pin: string) {
  if (!supabase) throw new Error('Sync is not set up.')
  setGuest(false)
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pinPassword(pin) })
  if (error) throw pinError(error)
}

/** First-time setup. Returns 'signed-in', or 'check-email' when the address must be confirmed first. */
export async function createPin(email: string, pin: string): Promise<'signed-in' | 'check-email' | 'exists'> {
  if (!supabase) throw new Error('Sync is not set up.')
  setGuest(false)
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pinPassword(pin), options: { emailRedirectTo: back() } })
  if (error) {
    if (/already registered|already exists/i.test(error.message)) return 'exists'
    throw pinError(error)
  }
  // Supabase hides whether an address exists: an existing account comes back with no identities.
  if (data.user && data.user.identities?.length === 0) return 'exists'
  return data.session ? 'signed-in' : 'check-email'
}

export async function sendPinReset(email: string) {
  if (!supabase) throw new Error('Sync is not set up.')
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: back() })
  if (error) throw pinError(error)
}

export async function changePin(pin: string) {
  if (!supabase) throw new Error('Sync is not set up.')
  const { error } = await supabase.auth.updateUser({ password: pinPassword(pin) })
  if (error) {
    if (/different from the old/i.test(error.message)) throw new Error("That's already your PIN — pick a new one.")
    throw pinError(error)
  }
}

export async function signOut() {
  if (!supabase) return
  await runSync().catch(() => {})
  await supabase.auth.signOut()
  forgetPinOnThisDevice()
  // Leave nothing private behind on a shared device.
  await db.delete()
  location.reload()
}

/* ---------- first sync after signing in ---------- */

const cursorKey = () => `sync:cursor:${session?.user.id}`

/**
 * Pull everything, then queue whatever only exists on this device so the
 * cloud ends up with the union of both.
 */
export async function initialSync() {
  if (!session) return
  const before = new Set((await db.books.toCollection().primaryKeys()).map(String))
  await pull()
  await mergeDuplicates(before)
  const remoteKeys = new Set<string>()
  let from = 0
  for (;;) {
    const { data, error } = await supabase!.from('records').select('kind,id').range(from, from + 999)
    if (error) throw error
    data.forEach((r) => remoteKeys.add(`${r.kind}:${r.id}`))
    if (data.length < 1000) break
    from += 1000
  }
  const now = Date.now()
  const queue: OutboxItem[] = []
  const add = (kind: Kind, id: string) => !remoteKeys.has(`${kind}:${id}`) && queue.push({ key: `${kind}:${id}`, kind, id, at: now })
  ;(await db.books.toCollection().primaryKeys()).forEach((k) => add('book', String(k)))
  ;(await db.annotations.toCollection().primaryKeys()).forEach((k) => add('annotation', String(k)))
  ;(await db.settings.toCollection().primaryKeys()).forEach((k) => !isLocalSetting(String(k)) && add('setting', String(k)))
  // Files and covers: upload anything this device has (upload is idempotent).
  ;(await db.blobs.toCollection().primaryKeys()).forEach((k) => queue.push({ key: `blob:${k}`, kind: 'blob', id: String(k), at: now }))
  if (queue.length) await db.outbox.bulkPut(queue)
  await runSync()
}

const sameBook = (a: Book, b: Book) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  (a.authors[0] ?? '').trim().toLowerCase() === (b.authors[0] ?? '').trim().toLowerCase()

/**
 * A book this device had before signing in that's also already in her cloud
 * library (the starter shelf on each device, or a book added on both) becomes
 * one book: this device's file, notes and progress move onto the cloud copy.
 */
async function mergeDuplicates(localIds: Set<string>) {
  const all = await db.books.toArray()
  const local = all.filter((b) => localIds.has(b.id) && !b.removedAt)
  const cloud = all.filter((b) => !localIds.has(b.id) && !b.removedAt)
  for (const mine of local) {
    const twin = cloud.find((c) => sameBook(c, mine))
    if (!twin) continue
    const changes: Partial<Book> = {}
    const blobs = await db.blobs.where('bookId').equals(mine.id).toArray()
    for (const row of blobs) {
      const which = row.key.split(':')[1]
      if (which === 'file' && twin.file) continue
      if (which === 'cover' && twin.coverSource === 'upload') continue
      await db.blobs.put({ ...row, key: `${twin.id}:${which}`, bookId: twin.id })
    }
    if (mine.file && !twin.file) Object.assign(changes, { file: mine.file, epubLocations: mine.epubLocations })
    if (mine.coverSource === 'upload' && twin.coverSource !== 'upload') Object.assign(changes, { coverSource: 'upload', coverUrl: mine.coverUrl })
    if (mine.progress && (!twin.progress || mine.progress.updatedAt > twin.progress.updatedAt) && (twin.file?.addedAt ?? mine.file?.addedAt) === mine.file?.addedAt)
      changes.progress = mine.progress
    if (mine.favorite && !twin.favorite) changes.favorite = true
    if (Object.keys(changes).length) await db.books.update(twin.id, { ...changes, updatedAt: Date.now() })
    await db.annotations.where('bookId').equals(mine.id).modify({ bookId: twin.id, updatedAt: Date.now() })
    // The duplicate never reached the cloud, so it leaves quietly.
    await fromCloud([db.books, db.blobs], async () => {
      await db.books.delete(mine.id)
      await db.blobs.where('bookId').equals(mine.id).delete()
    })
    localIds.delete(mine.id)
  }
}

/* ---------- push / pull ---------- */

let running: Promise<void> | null = null
let again = false
let timer: number | undefined

export function requestSync() {
  if (!syncEnabled || !session) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => runSync().catch(() => {}), 1200)
}

export async function runSync(): Promise<void> {
  if (!supabase || !session) return
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      if (!navigator.onLine) {
        setState('offline')
        return
      }
      setState('syncing')
      try {
        await push()
        await pull()
        const left = await db.outbox.count()
        setState(left ? 'syncing' : 'synced')
      } catch (err) {
        console.error('sync failed', err)
        setState(navigator.onLine ? 'error' : 'offline', (err as Error).message)
        return
      }
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

async function push() {
  const items = await db.outbox.toArray()
  if (!items.length) return
  const uid = session!.user.id

  const rows = []
  const blobs: OutboxItem[] = []
  for (const it of items) {
    if (it.kind === 'blob') {
      blobs.push(it)
      continue
    }
    if (it.kind === 'book') {
      const b = await db.books.get(it.id)
      if (b) {
        const { epubLocations: _l, ...data } = b
        rows.push({ user_id: uid, kind: 'book', id: it.id, data, deleted: false, updated_at: b.updatedAt ?? it.at })
      } else rows.push({ user_id: uid, kind: 'book', id: it.id, data: null, deleted: true, updated_at: it.at })
    } else if (it.kind === 'annotation') {
      const a = await db.annotations.get(it.id)
      rows.push(a
        ? { user_id: uid, kind: 'annotation', id: it.id, data: a, deleted: false, updated_at: a.updatedAt ?? it.at }
        : { user_id: uid, kind: 'annotation', id: it.id, data: null, deleted: true, updated_at: it.at })
    } else {
      const s = await db.settings.get(it.id)
      rows.push(s
        ? { user_id: uid, kind: 'setting', id: it.id, data: { value: s.value }, deleted: false, updated_at: it.at }
        : { user_id: uid, kind: 'setting', id: it.id, data: null, deleted: true, updated_at: it.at })
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase!.from('records').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' })
    if (error) throw error
  }

  for (const it of blobs) {
    const [bookId, which] = it.id.split(':')
    const path = `${uid}/${bookId}/${which}`
    const row = await db.blobs.get(it.id)
    if (row) {
      const { error } = await supabase!.storage.from(BUCKET).upload(path, row.blob, {
        upsert: true,
        contentType: row.blob.type || 'application/octet-stream',
      })
      if (error) throw error
    } else {
      await supabase!.storage.from(BUCKET).remove([path])
    }
  }

  // Clear only entries that weren't changed again while we were pushing.
  await db.transaction('rw', db.outbox, async () => {
    for (const it of items) {
      const cur = await db.outbox.get(it.key)
      if (cur && cur.at === it.at) await db.outbox.delete(it.key)
    }
  })
}

interface Row {
  kind: 'book' | 'annotation' | 'setting'
  id: string
  data: any
  deleted: boolean
  updated_at: number
  seq: number
}

async function pull() {
  let cursor = ((await db.settings.get(cursorKey()))?.value as number) ?? 0
  for (;;) {
    const { data, error } = await supabase!
      .from('records')
      .select('kind,id,data,deleted,updated_at,seq')
      .gt('seq', cursor)
      .order('seq', { ascending: true })
      .limit(500)
    if (error) throw error
    const rows = data as Row[]
    if (!rows.length) break
    await applyRemote(rows)
    cursor = rows[rows.length - 1].seq
    await db.settings.put({ key: cursorKey(), value: cursor })
    if (rows.length < 500) break
  }
}

async function applyRemote(rows: Row[]) {
  const pending = new Set((await db.outbox.toCollection().primaryKeys()).map(String))
  await fromCloud([db.books, db.annotations, db.settings, db.blobs], async () => {
    for (const r of rows) {
      // A local edit that hasn't been sent yet and is newer than the cloud copy wins.
      if (pending.has(`${r.kind}:${r.id}`)) {
        const local = r.kind === 'book' ? await db.books.get(r.id) : r.kind === 'annotation' ? await db.annotations.get(r.id) : undefined
        const localAt = (local as { updatedAt?: number } | undefined)?.updatedAt ?? Infinity
        if (localAt >= r.updated_at) continue
      }
      if (r.kind === 'book') {
        if (r.deleted) {
          await db.books.delete(r.id)
          await db.blobs.where('bookId').equals(r.id).delete()
        } else {
          const local = await db.books.get(r.id)
          const remote = r.data as Book
          // Ebook file changed elsewhere: drop the stale local copy so the new one is fetched.
          if (local?.file && remote.file && local.file.addedAt !== remote.file.addedAt) await db.blobs.delete(`${r.id}:file`)
          if (local && remote.coverSource !== local.coverSource) await db.blobs.delete(`${r.id}:cover`)
          await db.books.put({ ...remote, epubLocations: local?.file?.addedAt === remote.file?.addedAt ? local?.epubLocations : undefined })
        }
      } else if (r.kind === 'annotation') {
        if (r.deleted) await db.annotations.delete(r.id)
        else await db.annotations.put(r.data as Annotation)
      } else if (!isLocalSetting(r.id)) {
        if (r.deleted) await db.settings.delete(r.id)
        else await db.settings.put({ key: r.id, value: r.data?.value })
      }
    }
  })
}

/* ---------- files that live in the cloud ---------- */

if (syncEnabled) setRemoteBlobFetcher(async (key, bookId) => {
  if (!supabase || !session) return undefined
  const local = await db.blobs.get(key)
  if (local) return local.blob
  const which = key.split(':')[1]
  const { data, error } = await supabase.storage.from(BUCKET).download(`${session.user.id}/${bookId}/${which}`)
  if (error || !data) throw new Error(navigator.onLine ? "This book's file couldn't be fetched from the library." : "You're offline, and this book hasn't been downloaded to this device yet.")
  await fromCloud([db.blobs], () => db.blobs.put({ key, bookId, blob: data }))
  return data
})

/* ---------- background triggers ---------- */

if (syncEnabled) {
  window.addEventListener('online', () => runSync().catch(() => {}))
  window.addEventListener('offline', () => setState('offline'))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && runSync().catch(() => {}))
  window.setInterval(() => document.visibilityState === 'visible' && runSync().catch(() => {}), 60_000)
}
