/**
 * Search for ebooks that are free to download and keep, across Internet
 * Archive, Google Books and the open-access libraries OAPEN and DOAB.
 *
 * Every result says plainly what's actually available:
 *   full       a whole PDF/EPUB she may download and keep (verified before "Add & Read" is offered)
 *   preview    some pages to read on the source's site
 *   borrow     a lending-library copy (borrow on the source's site; never imported)
 *   restricted only for print-disabled readers, or otherwise locked
 *   metadata   the book's details only
 * Only "full" books are fetched. For everything else she can upload her own copy.
 */

export type SourceId = 'archive' | 'google' | 'oapen' | 'doab'
export const SOURCE_NAMES: Record<SourceId, 'Internet Archive' | 'Google Books' | 'OAPEN' | 'DOAB'> = {
  archive: 'Internet Archive',
  google: 'Google Books',
  oapen: 'OAPEN',
  doab: 'DOAB',
}

export type Access = 'full' | 'preview' | 'borrow' | 'restricted' | 'metadata'
export type SearchMode = 'any' | 'title' | 'author' | 'isbn'

export interface OpenFile {
  format: 'pdf' | 'epub'
  url: string
  size?: number
}

export interface OpenResult {
  key: string
  source: SourceId
  title: string
  authors: string[]
  year?: number
  language?: string
  publisher?: string
  isbn?: string
  coverUrl?: string
  description?: string
  access: Access
  /** Why it's not downloadable, or a short note about it. */
  note?: string
  license?: string
  licenseUrl?: string
  /** The book's page on the source (for previews, borrowing, or just a look). */
  pageUrl: string
  /** Candidate files for a "full" result; confirmed by verify(). */
  files: OpenFile[]
}

export interface SourceStatus {
  state: 'loading' | 'ok' | 'unavailable'
  message?: string
}

const json = async (url: string, signal?: AbortSignal) => {
  const r = await fetch(url, { signal })
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
  return r.json()
}

/** "isbn" when the text is an ISBN-10/13, so a pasted ISBN just works in "any". */
export function detectMode(q: string, mode: SearchMode): SearchMode {
  if (mode !== 'any') return mode
  const digits = q.replace(/[-\s]/g, '')
  return /^(97[89])?\d{9}[\dXx]$/.test(digits) ? 'isbn' : 'any'
}

/* ---------- Internet Archive ---------- */

// Collections that mean "lending library" or "print-disabled readers only" — never imported.
const IA_LENDING = ['inlibrary', 'lendinglibrary', 'internetarchivebooks']
const IA_PRINT_DISABLED = ['printdisabled']
// In the US (where Internet Archive is), books published before 1931 are in the public domain in 2026.
const PD_BEFORE = new Date().getFullYear() - 95

const iaEscape = (s: string) => s.replace(/[():"\\[\]{}^~*?!/]/g, ' ').trim()

export async function searchArchive(q: string, mode: SearchMode, signal?: AbortSignal): Promise<OpenResult[]> {
  const t = iaEscape(q)
  const clause =
    mode === 'isbn' ? `isbn:(${q.replace(/[^0-9Xx]/g, '')})` : mode === 'title' ? `title:(${t})` : mode === 'author' ? `creator:(${t})` : `(title:(${t}) OR creator:(${t}))`
  const fields = ['identifier', 'title', 'creator', 'language', 'date', 'year', 'publisher', 'isbn', 'licenseurl', 'collection', 'format', 'description']
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${clause} AND mediatype:texts`)}` +
    fields.map((f) => `&fl[]=${f}`).join('') +
    // Popular items come back first, so ask for enough that the right edition is in there;
    // the app then ranks them by how well the title matches.
    '&rows=50&sort[]=downloads+desc&output=json'
  const data = await json(url, signal)
  return (data.response?.docs ?? []).map(fromArchive)
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)])

function fromArchive(d: Record<string, unknown>): OpenResult {
  const id = String(d.identifier)
  const collections = arr(d.collection)
  const formats = arr(d.format)
  const year = parseInt(String(d.year ?? d.date ?? ''), 10) || undefined
  const licenseUrl = arr(d.licenseurl)[0]
  const base: OpenResult = {
    key: `archive:${id}`,
    source: 'archive',
    title: arr(d.title)[0] ?? id,
    authors: arr(d.creator).map(tidyName).slice(0, 3),
    year,
    language: arr(d.language)[0],
    publisher: arr(d.publisher)[0],
    isbn: arr(d.isbn)[0],
    coverUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    description: stripHtml(arr(d.description)[0]),
    access: 'metadata',
    pageUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    files: [],
  }
  if (collections.some((c) => IA_LENDING.includes(c)) && collections.includes('inlibrary')) {
    return { ...base, access: 'borrow', note: 'A lending-library copy — it can only be borrowed on Internet Archive.' }
  }
  if (collections.some((c) => IA_PRINT_DISABLED.includes(c))) {
    return { ...base, access: 'restricted', note: 'Only available to readers with print disabilities.' }
  }
  const hasFile = formats.includes('EPUB') || formats.includes('Text PDF')
  if (!hasFile) return { ...base, note: 'No PDF or EPUB on Internet Archive.' }
  // Open files on Internet Archive are only imported when they're clearly free to keep:
  // a Creative Commons / public-domain mark, published long enough ago, or a later reprint
  // of an author who died long enough ago that the text itself is out of copyright
  // (library records carry the dates, e.g. "Gaskell, Elizabeth Cleghorn, 1810-1865").
  const died = Math.max(0, ...arr(d.creator).map((c) => parseInt(/\d{4}\s*-\s*(\d{4})/.exec(c)?.[1] ?? '', 10) || 0))
  const license =
    licenseLabel(licenseUrl) ??
    (year && year < PD_BEFORE ? `Public domain (published ${year})` : died && died < PD_BEFORE ? `Public domain (author died ${died})` : undefined)
  if (!license) {
    return { ...base, note: 'Open on Internet Archive, but its copyright isn’t clear — upload your own copy instead.' }
  }
  return { ...base, access: 'full', license, licenseUrl }
}

/** Find the actual, unencrypted, public file on Internet Archive (nothing is assumed from search results). */
async function archiveFiles(r: OpenResult, signal?: AbortSignal): Promise<OpenFile[]> {
  const id = r.key.slice('archive:'.length)
  const m = await json(`https://archive.org/metadata/${encodeURIComponent(id)}`, signal)
  if (m.is_dark || String(m.metadata?.['access-restricted-item']) === 'true') return []
  const files: { name: string; format?: string; size?: string; private?: string }[] = m.files ?? []
  const open = files.filter((f) => String(f.private) !== 'true')
  const pick = (fmt: string, ext: RegExp) => open.find((f) => f.format === fmt && ext.test(f.name))
  const epub = pick('EPUB', /\.epub$/i)
  const pdf = pick('Text PDF', /\.pdf$/i)
  return [epub && { format: 'epub' as const, f: epub }, pdf && { format: 'pdf' as const, f: pdf }]
    .filter((x): x is { format: 'pdf' | 'epub'; f: (typeof files)[number] } => !!x)
    .map(({ format, f }) => ({
      format,
      url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      size: Number(f.size) || undefined,
    }))
}

/* ---------- Google Books ---------- */

const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_BOOKS_KEY as string | undefined)?.trim()

export async function searchGoogle(q: string, mode: SearchMode, signal?: AbortSignal): Promise<OpenResult[]> {
  const t = q.replace(/"/g, ' ').trim()
  const query = mode === 'isbn' ? `isbn:${q.replace(/[^0-9Xx]/g, '')}` : mode === 'title' ? `intitle:"${t}"` : mode === 'author' ? `inauthor:"${t}"` : t
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&printType=books${GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : ''}`
  try {
    const data = await json(url, signal)
    return (data.items ?? []).map(fromGoogle)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 429 || status === 403) {
      throw new Error(GOOGLE_KEY ? 'Google Books is busy right now — try again in a little while.' : 'Google Books needs an API key (its shared free allowance is used up).')
    }
    throw err
  }
}

type GVolume = {
  id: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    publishedDate?: string
    publisher?: string
    language?: string
    description?: string
    industryIdentifiers?: { type: string; identifier: string }[]
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    infoLink?: string
    previewLink?: string
  }
  accessInfo?: {
    viewability?: string
    publicDomain?: boolean
    webReaderLink?: string
    epub?: { isAvailable?: boolean; downloadLink?: string }
    pdf?: { isAvailable?: boolean; downloadLink?: string }
  }
}

function fromGoogle(v: GVolume): OpenResult {
  const vi = v.volumeInfo ?? {}
  const ai = v.accessInfo ?? {}
  const ids = vi.industryIdentifiers ?? []
  const base: OpenResult = {
    key: `google:${v.id}`,
    source: 'google',
    title: vi.subtitle && vi.title ? `${vi.title}: ${vi.subtitle}` : vi.title ?? 'Untitled',
    authors: (vi.authors ?? []).slice(0, 3),
    year: parseInt(vi.publishedDate ?? '', 10) || undefined,
    language: vi.language,
    publisher: vi.publisher,
    isbn: ids.find((i) => i.type === 'ISBN_13')?.identifier ?? ids.find((i) => i.type === 'ISBN_10')?.identifier,
    coverUrl: (vi.imageLinks?.thumbnail ?? vi.imageLinks?.smallThumbnail)?.replace(/^http:/, 'https:'),
    description: stripHtml(vi.description),
    access: 'metadata',
    pageUrl: vi.infoLink ?? `https://books.google.com/books?id=${encodeURIComponent(v.id)}`,
    files: [],
  }
  // Google only offers downloads of public-domain books.
  const files: OpenFile[] = []
  if (ai.publicDomain && ai.epub?.downloadLink) files.push({ format: 'epub', url: ai.epub.downloadLink })
  if (ai.publicDomain && ai.pdf?.downloadLink) files.push({ format: 'pdf', url: ai.pdf.downloadLink })
  if (files.length) return { ...base, access: 'full', files, license: 'Public domain' }
  if (ai.viewability === 'PARTIAL' || ai.viewability === 'ALL_PAGES') {
    return { ...base, access: 'preview', pageUrl: ai.webReaderLink ?? vi.previewLink ?? base.pageUrl, note: 'A preview on Google Books — not a downloadable copy.' }
  }
  return { ...base, note: 'Book details only on Google Books.' }
}

/* ---------- OAPEN / DOAB (through the app's backend) ---------- */

export async function searchOpenAccess(source: 'oapen' | 'doab', q: string, mode: SearchMode, signal?: AbortSignal): Promise<OpenResult[]> {
  const r = await fetch(`/api/oa-search?source=${source}&mode=${mode}&q=${encodeURIComponent(q)}`, { signal })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.error) throw new Error(data.message ?? `${SOURCE_NAMES[source]} isn’t available right now.`)
  return (data.items ?? []).map(
    (it: { id: string; title: string; authors: string[]; year?: number; language?: string; publisher?: string; isbn?: string; license?: string; licenseUrl?: string; url: string; files: OpenFile[] }): OpenResult => ({
      key: it.id,
      source,
      title: it.title,
      authors: it.authors.map(tidyName),
      year: it.year,
      language: it.language,
      publisher: it.publisher,
      isbn: it.isbn,
      access: it.files.length ? 'full' : 'metadata',
      note: it.files.length ? undefined : `No downloadable file listed on ${SOURCE_NAMES[source]} — it may be on the publisher’s site.`,
      license: it.license ?? (it.files.length ? 'Open access' : undefined),
      licenseUrl: it.licenseUrl,
      pageUrl: it.url,
      files: it.files,
    }),
  )
}

/* ---------- verifying a file really exists ---------- */

export interface Verified {
  ok: boolean
  file?: OpenFile & { format: 'pdf' | 'epub' }
  message?: string
}

/**
 * Before "Add & Read" is offered, make sure a whole PDF/EPUB is really there:
 * the backend opens the file and checks its first bytes. An EPUB is preferred
 * (it reflows nicely on her phone) — except on Internet Archive, whose EPUBs are
 * machine-read from page scans and full of misread words: there the scanned
 * PDF, which shows the real printed pages, is the better copy.
 */
export async function verify(r: OpenResult, signal?: AbortSignal): Promise<Verified> {
  if (r.access !== 'full') return { ok: false, message: r.note }
  try {
    const files = r.source === 'archive' ? await archiveFiles(r, signal) : r.files
    if (!files.length) return { ok: false, message: 'No open PDF or EPUB file was found for this book.' }
    let last = 'The file couldn’t be reached.'
    const preferred = r.source === 'archive' ? 'pdf' : 'epub'
    for (const f of [...files].sort((a, b) => (a.format === preferred ? -1 : 0) - (b.format === preferred ? -1 : 0))) {
      const res = await fetch(`/api/fetch-book?check=1&url=${encodeURIComponent(f.url)}`, { signal })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) return { ok: true, file: { ...f, format: data.format, size: data.size ?? f.size } }
      last = data.message ?? last
    }
    return { ok: false, message: last }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    return { ok: false, message: 'Couldn’t check this file right now.' }
  }
}

/* ---------- fetching the file ---------- */

export class FetchBookError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

// Tuned on the live site: 4 MB pieces in 8 lanes moved a 28 MB scan ~20% faster than 2 MB × 6.
const PIECE = 4 * 1024 * 1024
const LANES = 8

/**
 * Download through the backend, reporting progress (0..1, or -1 when the size isn't known).
 * Big files come down as several pieces at once — some sources (Internet Archive, from far
 * away) cap the speed of each connection, so several lanes at once are much faster.
 */
export async function fetchBookFile(file: OpenFile, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (file.size && file.size > PIECE * 2) {
    try {
      return await fetchInPieces(file, file.size, onProgress, signal)
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (err instanceof FetchBookError && !(err as FetchBookError & { fallback?: boolean }).fallback)) throw err
      // The source wouldn't send pieces: fall back to one straight download.
    }
  }
  return fetchWhole(file, onProgress, signal)
}

async function fetchInPieces(file: OpenFile, size: number, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const ranges: [number, number][] = []
  for (let s = 0; s < size; s += PIECE) ranges.push([s, Math.min(size, s + PIECE) - 1])
  const parts: ArrayBuffer[] = new Array(ranges.length)
  const done = new Array<number>(ranges.length).fill(0)
  const report = () => onProgress(Math.min(1, done.reduce((a, b) => a + b, 0) / size))
  let next = 0

  const getPiece = async (i: number) => {
    const [s, e] = ranges[i]
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/fetch-book?range=${s}-${e}&url=${encodeURIComponent(file.url)}`, { signal })
        if (res.status === 416) throw Object.assign(new FetchBookError('no pieces', false), { fallback: true })
        if (res.status !== 206 || !res.body) {
          const data = await res.json().catch(() => ({}))
          throw new FetchBookError(data.message ?? 'The book couldn’t be fetched.', data.retryable ?? res.status >= 500)
        }
        // Read the piece as it arrives, so the progress bar keeps moving.
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let got = 0
        for (;;) {
          const { value, done: end } = await reader.read()
          if (end) break
          chunks.push(value)
          got += value.length
          done[i] = got
          report()
        }
        if (got !== e - s + 1) throw new FetchBookError('A piece of the book came back incomplete.', true)
        const buf = new Uint8Array(got)
        let at = 0
        for (const c of chunks) {
          buf.set(c, at)
          at += c.length
        }
        parts[i] = buf.buffer
        return
      } catch (err) {
        done[i] = 0
        const retry = attempt < 2 && (err as Error).name !== 'AbortError' && !(err as { fallback?: boolean }).fallback && (!(err instanceof FetchBookError) || err.retryable)
        if (!retry) throw err instanceof FetchBookError || (err as Error).name === 'AbortError' ? err : new FetchBookError('The connection dropped while fetching the book.', true)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LANES, ranges.length) }, async () => {
      while (next < ranges.length) await getPiece(next++)
    }),
  )
  return new Blob(parts, { type: file.format === 'pdf' ? 'application/pdf' : 'application/epub+zip' })
}

async function fetchWhole(file: OpenFile, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(`/api/fetch-book?url=${encodeURIComponent(file.url)}`, { signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new FetchBookError(navigator.onLine ? 'The connection dropped while fetching the book.' : 'You’re offline.', true)
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new FetchBookError(data.message ?? 'The book couldn’t be fetched.', data.retryable ?? res.status >= 500)
  }
  const total = Number(res.headers.get('content-length')) || file.size || 0
  const reader = res.body.getReader()
  const parts: BlobPart[] = []
  let got = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      parts.push(value)
      got += value.length
      onProgress(total ? Math.min(1, got / total) : -1)
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new FetchBookError('The download stopped partway through.', true)
  }
  if (total && got < total) throw new FetchBookError('The download stopped partway through.', true)
  return new Blob(parts, { type: res.headers.get('content-type') ?? undefined })
}

/* ---------- combining results and finding duplicate editions ---------- */

export interface ResultGroup {
  key: string
  /** The best version to show first (downloadable before preview before details). */
  best: OpenResult
  /** Every version across sources, the best one first. */
  all: OpenResult[]
  /** How closely it matches the search (lower is closer). */
  tier: number
}

const RANK: Record<Access, number> = { full: 0, preview: 1, borrow: 2, restricted: 3, metadata: 4 }

/**
 * How well a result matches what she typed: 0 = the title is exactly it, 1 = the title starts
 * with it, 2 = contains it as a phrase, 3 = has all the words somewhere (incl. the author), 4 = loosely related.
 * The book she's looking for comes first; within that, the most readable copy.
 */
export function matchTier(r: OpenResult, query: string) {
  const q = normalTitle(query)
  if (!q) return 4
  const t = normalTitle(r.title)
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  if (` ${t} `.includes(` ${q} `)) return 2
  const hay = `${t} ${r.authors.join(' ').toLowerCase()}`
  return q.split(' ').every((w) => hay.includes(w)) ? 3 : 4
}

export function groupResults(results: OpenResult[], query = ''): ResultGroup[] {
  const groups = new Map<string, OpenResult[]>()
  for (const r of results) {
    const k = `${normalTitle(r.title)}|${surname(r.authors[0] ?? '')}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      // The very same edition from two sources (same ISBN) shows once, keeping the more open copy.
      const byIsbn = new Map<string, OpenResult>()
      const rest: OpenResult[] = []
      for (const r of [...list].sort((a, b) => RANK[a.access] - RANK[b.access])) {
        const isbn = r.isbn?.replace(/[^0-9Xx]/g, '')
        if (!isbn) rest.push(r)
        else if (!byIsbn.has(isbn)) byIsbn.set(isbn, r)
      }
      const all = [...byIsbn.values(), ...rest].sort((a, b) => RANK[a.access] - RANK[b.access] || (b.coverUrl ? 1 : 0) - (a.coverUrl ? 1 : 0))
      return { key, best: all[0], all, tier: Math.min(...all.map((r) => matchTier(r, query))) }
    })
    .sort((a, b) => a.tier - b.tier || RANK[a.best.access] - RANK[b.best.access])
}

export function normalTitle(t: string) {
  return t
    .toLowerCase()
    .split(/[:;(]/)[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function surname(name: string) {
  const n = name.toLowerCase().trim()
  if (!n) return ''
  return (n.includes(',') ? n.split(',')[0] : n.split(/\s+/).pop() ?? '').replace(/[^a-z]/g, '')
}

/** "Austen, Jane, 1775-1817" → "Jane Austen". */
function tidyName(n: string) {
  const parts = n.replace(/,?\s*\d{3,4}\s*-\s*(\d{3,4})?\.?$/, '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : parts.join(', ')
}

function licenseLabel(url?: string) {
  if (!url) return undefined
  if (/publicdomain|\/zero\//i.test(url)) return 'Public domain'
  const m = url.match(/licenses\/([a-z-]+)\/(\d(\.\d)?)/i)
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : /creativecommons/i.test(url) ? 'Creative Commons' : undefined
}

function stripHtml(s?: string) {
  return s?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
}

const LANGS: Record<string, string> = { en: 'English', eng: 'English', fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', es: 'Spanish', spa: 'Spanish', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', nl: 'Dutch', dut: 'Dutch', bn: 'Bengali', ben: 'Bengali', ur: 'Urdu', urd: 'Urdu', ar: 'Arabic', ara: 'Arabic' }
export const languageName = (code?: string) => (code ? LANGS[code.toLowerCase()] ?? code : undefined)
