/**
 * Book information search. Open Library first (free, no key, CORS-friendly),
 * Google Books as a fallback. These services give book *information* and
 * published covers only — never ebook files.
 */

export interface SearchResult {
  id: string
  source: 'openlibrary' | 'google'
  title: string
  authors: string[]
  year?: number
  pages?: number
  isbn?: string
  coverUrl?: string
  olWorkKey?: string
  editionCount?: number
  subjects: string[]
  /** Link to a free, public-domain copy on an external site (Internet Archive), when one exists. */
  publicDomainUrl?: string
}

export interface Edition {
  key: string
  title: string
  publisher?: string
  year?: string
  isbn?: string
  pages?: number
  language?: string
  coverUrl?: string
}

export const olCover = (id: number | string, size: 'S' | 'M' | 'L' = 'L') =>
  `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`

export const coverAt = (url: string | undefined, size: 'M' | 'L') =>
  url?.includes('covers.openlibrary.org') ? url.replace(/-[SML]\.jpg$/, `-${size}.jpg`) : url

const isbnLike = (q: string) => /^(97[89])?\d{9}[\dXx]$/.test(q.replace(/[-\s]/g, ''))

async function getJson(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []
  let olError: unknown
  try {
    const fields =
      'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,edition_count,ebook_access,ia'
    const param = isbnLike(q) ? `isbn=${q.replace(/[-\s]/g, '')}` : `q=${encodeURIComponent(q)}`
    const data = await getJson(
      `https://openlibrary.org/search.json?${param}&limit=12&fields=${fields}`,
      signal,
    )
    const results: SearchResult[] = (data.docs ?? []).map((d: Record<string, any>) => ({
      id: d.key,
      source: 'openlibrary' as const,
      title: d.title,
      authors: d.author_name ?? [],
      year: d.first_publish_year,
      pages: d.number_of_pages_median,
      coverUrl: d.cover_i ? olCover(d.cover_i) : undefined,
      olWorkKey: d.key,
      editionCount: d.edition_count,
      subjects: (d.subject ?? []).slice(0, 40),
      publicDomainUrl:
        d.ebook_access === 'public' && d.ia?.[0] ? `https://archive.org/details/${d.ia[0]}` : undefined,
    }))
    if (results.length) return results
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    olError = err
  }
  try {
    return await searchGoogle(q, signal)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    if (olError) throw new Error('Book search is unreachable right now. Check the connection and try again.')
    return []
  }
}

/** "&key=…" when a Google Books API key is set (the shared keyless allowance runs out most days). */
const googleKey = () => {
  const k = (import.meta.env.VITE_GOOGLE_BOOKS_KEY as string | undefined)?.trim()
  return k ? `&key=${encodeURIComponent(k)}` : ''
}

async function searchGoogle(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const query = isbnLike(q) ? `isbn:${q.replace(/[-\s]/g, '')}` : q
  const data = await getJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&printType=books${googleKey()}`,
    signal,
  )
  return (data.items ?? []).map((item: Record<string, any>) => {
    const v = item.volumeInfo ?? {}
    const isbn =
      v.industryIdentifiers?.find((i: any) => i.type === 'ISBN_13')?.identifier ??
      v.industryIdentifiers?.find((i: any) => i.type === 'ISBN_10')?.identifier
    const thumb: string | undefined = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail
    return {
      id: item.id,
      source: 'google' as const,
      title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
      authors: v.authors ?? [],
      year: v.publishedDate ? parseInt(v.publishedDate, 10) : undefined,
      pages: v.pageCount,
      isbn,
      coverUrl: thumb?.replace('http://', 'https://').replace('&edge=curl', ''),
      subjects: v.categories ?? [],
    }
  })
}

export async function getEditions(workKey: string, signal?: AbortSignal): Promise<Edition[]> {
  const data = await getJson(`https://openlibrary.org${workKey}/editions.json?limit=40`, signal)
  const editions: Edition[] = (data.entries ?? []).map((e: Record<string, any>) => ({
    key: e.key,
    title: e.title,
    publisher: e.publishers?.[0],
    year: e.publish_date,
    isbn: e.isbn_13?.[0] ?? e.isbn_10?.[0],
    pages: e.number_of_pages,
    language: e.languages?.[0]?.key?.replace('/languages/', ''),
    coverUrl: e.covers?.find((c: number) => c > 0) ? olCover(e.covers.find((c: number) => c > 0)) : undefined,
  }))
  // Editions with a cover and in English first — those are the ones she'll recognise.
  const score = (e: Edition) => (e.coverUrl ? 2 : 0) + (e.language === 'eng' ? 1 : 0)
  return editions.sort((a, b) => score(b) - score(a))
}

/* ---------- book summary ---------- */

function cleanDescription(raw: string) {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split(/\n-{3,}|\n\*{3,}|\(\[source\]|\[source\]/i)[0] // drop trailing link lists and "source" notes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links → text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A short summary of the book, from Open Library first, then Google Books. */
/**
 * A short summary from Open Library, or Google Books if Open Library has none.
 * Resolves undefined only when the sources answered and simply have no summary;
 * if a source couldn't be reached (offline, rate-limited…) it throws instead, so a
 * hiccup is never remembered as "this book has no summary".
 */
export async function fetchDescription(b: { title: string; authors: string[]; olWorkKey?: string; isbn?: string }, signal?: AbortSignal): Promise<{ text: string; source: 'openlibrary' | 'google' } | undefined> {
  let unreachable = 0
  const miss = (err: unknown) => {
    if ((err as Error).name === 'AbortError') throw err
    unreachable++
  }
  let key = b.olWorkKey
  if (!key) {
    try {
      const q = encodeURIComponent([b.title, b.authors[0]].filter(Boolean).join(' '))
      const data = await getJson(`https://openlibrary.org/search.json?q=${q}&limit=3&fields=key,title`, signal)
      const hit = (data.docs ?? []).find((d: { title?: string }) => normalise(d.title ?? '').startsWith(normalise(b.title).slice(0, 12)))
      if (hit) key = hit.key
    } catch (err) {
      miss(err)
    }
  }
  if (key) {
    try {
      const work = await getJson(`https://openlibrary.org${key}.json`, signal)
      const raw = typeof work.description === 'string' ? work.description : work.description?.value
      const text = raw && cleanDescription(raw)
      if (text && text.length > 40) return { text, source: 'openlibrary' }
    } catch (err) {
      miss(err)
    }
  }
  // Google: by ISBN if known, otherwise by title and author (the quotes keep multi-word titles together).
  const queries = [
    b.isbn && `isbn:${b.isbn}`,
    `intitle:"${b.title.replace(/"/g, '')}"${b.authors[0] ? ` inauthor:"${b.authors[0].replace(/"/g, '')}"` : ''}`,
  ].filter(Boolean) as string[]
  for (const q of queries) {
    try {
      const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5${googleKey()}`, signal)
      const item = (data.items ?? []).find((i: any) => i.volumeInfo?.description && normalise(i.volumeInfo.title ?? '').startsWith(normalise(b.title).slice(0, 10)))
      const text = item && cleanDescription(item.volumeInfo.description)
      if (text && text.length > 40) return { text, source: 'google' }
    } catch (err) {
      miss(err)
    }
  }
  if (unreachable) throw new Error('A summary source couldn’t be reached.')
  return undefined
}

/* ---------- genres ---------- */

export const DEFAULT_GENRES = [
  'Fantasy',
  'Dark Romance',
  'Romance',
  'Crime & Mystery',
  'Thriller & Suspense',
  'Science Fiction',
  'Historical Fiction',
  'Horror',
  'Nonfiction',
]

/** Older category names, moved onto the current list. */
export const RENAMED_GENRES: Record<string, string> = {
  Crime: 'Crime & Mystery',
  Thriller: 'Thriller & Suspense',
  'Romantic comedy': 'Romance',
}

const GENRE_RULES: [string, RegExp][] = [
  ['Fantasy', /\b(fantasy|magic|wizards?|witch(es|craft)?|dragons?|fae|faerie|fairies|sorcer|elves|mythical)\b/i],
  ['Dark Romance', /\b(dark romance|mafia romance|bully romance|captive|obsession)\b/i],
  ['Romance', /\b(romance|love stories|love story|romantic)\b/i],
  ['Crime & Mystery', /\b(crime|criminals?|detectives?|murder|police|mystery|mysteries|heist|organized crime)\b/i],
  ['Thriller & Suspense', /\b(thrillers?|suspense|psychological fiction)\b/i],
  ['Science Fiction', /\b(science fiction|sci-?fi|space opera|dystopia|time travel|robots?|aliens?)\b/i],
  ['Historical Fiction', /\b(historical fiction|history\b.*fiction|regency|victorian|world war)\b/i],
  ['Horror', /\b(horror|ghost stories|ghosts?|haunted|supernatural|vampires?|zombies?)\b/i],
  ['Nonfiction', /\b(biography|autobiography|memoir|self-help|history$|essays|nonfiction|non-fiction|psychology|philosophy|science$)\b/i],
]

/**
 * Suggest categories from subject keywords. Only ones with clear evidence are
 * suggested; anything else is left uncategorised for her to decide.
 */
export function suggestGenres(subjects: string[]): string[] {
  return GENRE_RULES.filter(([, re]) => subjects.some((s) => re.test(s))).map(([g]) => g)
}

export const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
