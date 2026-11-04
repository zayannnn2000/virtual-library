/**
 * Free, public-domain ebooks from Project Gutenberg. Search uses Gutenberg's
 * own OPDS catalogue feed and files come from its cache — both through the
 * app's own /gutenberg-search and /gutenberg/ paths (see vite.config.ts and
 * vercel.json), because gutenberg.org doesn't allow cross-site requests.
 */
import { normalise } from './metadata'

export interface FreeBook {
  id: number
  title: string
  authors: string[]
  subjects: string[]
}

// Searches already answered this visit, so repeating one is instant (and survives a Gutenberg hiccup).
const answered = new Map<string, FreeBook[]>()

/**
 * Gutenberg's catalogue sometimes stalls or turns a request away for a moment, so a failed
 * search is retried twice (after a short pause) before it's reported as unavailable.
 */
export async function searchGutenberg(query: string, signal?: AbortSignal): Promise<FreeBook[]> {
  const q = query.trim()
  if (!q) return []
  const key = q.toLowerCase()
  const known = answered.get(key)
  if (known) return known
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt))
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const books = await searchOnce(q, signal)
      answered.set(key, books)
      return books
    } catch (err) {
      if ((err as Error).name === 'AbortError' && signal?.aborted) throw err
      lastErr = err
    }
  }
  throw lastErr
}

async function searchOnce(q: string, signal?: AbortSignal): Promise<FreeBook[]> {
  const timeout = AbortSignal.timeout(12_000)
  const res = await fetch(`/gutenberg-search?query=${encodeURIComponent(q)}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml')
  const out: FreeBook[] = []
  for (const entry of xml.querySelectorAll('entry')) {
    // Real books have ids like https://www.gutenberg.org/ebooks/1342.opds; skip "sort by" links etc.
    const id = entry.querySelector('id')?.textContent?.match(/\/ebooks\/(\d+)\.opds$/)?.[1]
    if (!id) continue
    const title = entry.querySelector('title')?.textContent?.trim() ?? ''
    const author = entry.querySelector('content')?.textContent?.trim()
    if (!title) continue
    out.push({ id: Number(id), title: title.split(/[:;]/)[0].trim(), authors: author ? [author] : [], subjects: [] })
    if (out.length >= 6) break
  }
  return out
}

export const gutenbergCoverUrl = (id: number) => `/gutenberg/${id}/pg${id}.cover.medium.jpg`

/** Download the EPUB (illustrated edition first, plain edition as a fallback). */
export async function downloadGutenberg(book: FreeBook): Promise<File> {
  const name = `${normalise(book.title).replace(/ /g, '-') || `gutenberg-${book.id}`}.epub`
  for (const file of [`pg${book.id}-images-3.epub`, `pg${book.id}.epub`]) {
    try {
      const res = await fetch(`/gutenberg/${book.id}/${file}`)
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !/epub|zip|octet/.test(type)) continue
      const blob = await res.blob()
      if (blob.size > 0) return new File([blob], name, { type: 'application/epub+zip' })
    } catch {
      /* try the next edition */
    }
  }
  throw new Error(navigator.onLine ? "Project Gutenberg didn't send the book. Try again in a moment." : "You're offline — connect to download free classics.")
}

export async function downloadGutenbergCover(id: number): Promise<Blob | undefined> {
  try {
    const res = await fetch(gutenbergCoverUrl(id))
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return undefined
    return await res.blob()
  } catch {
    return undefined
  }
}

/** Find the Gutenberg edition of a book already on the shelf, if it's in the public domain. */
export async function findFreeCopy(title: string, authors: string[]): Promise<FreeBook | undefined> {
  const surname = authors[0]?.split(' ').slice(-1)[0] ?? ''
  const results = await searchGutenberg(`${title} ${surname}`)
  const t = normalise(title)
  return results.find(
    (r) =>
      (normalise(r.title) === t || normalise(r.title).startsWith(t)) &&
      (!surname || r.authors.some((a) => normalise(a).includes(normalise(surname)))),
  )
}
