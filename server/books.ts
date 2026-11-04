/**
 * Virtual Library's small backend: it fetches ebook files and open-access search
 * results that the browser can't reach directly. Shared by the Vercel
 * functions in /api and the Vite dev/preview server, so both behave the same.
 *
 * It only ever talks to the sources below, over HTTPS, along their documented
 * download paths. Every redirect is checked against the same list, files are
 * capped in size, and a download only goes through if its first bytes really
 * are a PDF or an EPUB — never a sign-in page, an error page or anything else.
 */

const UA = 'VirtualLibrary/1.0 (personal reading app)'
export const MAX_BYTES = 200 * 1024 * 1024
const HEADER_TIMEOUT = 25_000

/** Hosts and download paths each source documents for its files. */
const ALLOWED: { host: RegExp; path: RegExp }[] = [
  // Internet Archive: /download/{item}/{file}, which redirects to a data node (/{n}/items/{item}/{file})
  { host: /^archive\.org$/, path: /^\/download\/[^/]+\/.+/ },
  // (data nodes look like ia800300.us.archive.org or dn760105.eu.archive.org)
  { host: /^([a-z0-9-]+\.)+archive\.org$/, path: /^\/(\d+\/items|download)\/.+/ },
  // Google Books: public-domain download links, which redirect to googleusercontent
  { host: /^books\.google\.[a-z.]+$/, path: /^\/books\/(download|content)/ },
  { host: /^books\.googleusercontent\.com$/, path: /^\/.+/ },
  // OAPEN / DOAB: DSpace bitstreams
  { host: /^library\.oapen\.org$|^directory\.doabooks\.org$/, path: /^\/(bitstream|rest\/bitstreams)\/.+/ },
]

export type FetchErrorCode = 'not_allowed' | 'restricted' | 'not_found' | 'too_large' | 'not_a_book' | 'unavailable'

const MESSAGES: Record<FetchErrorCode, string> = {
  not_allowed: 'That link isn’t one of the supported book sources.',
  restricted: 'This file is restricted (borrow-only or sign-in required), so it can’t be imported.',
  not_found: 'The source says this file no longer exists.',
  too_large: 'This file is over 200 MB — too large to keep in the library.',
  not_a_book: 'The source didn’t send a PDF or EPUB (it may be asking for a sign-in or a captcha).',
  unavailable: 'The source didn’t answer right now.',
}

function fail(code: FetchErrorCode, status = 502, detail?: string) {
  return Response.json(
    { error: code, message: MESSAGES[code], detail, retryable: code === 'unavailable' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function isAllowed(raw: string) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && ALLOWED.some((a) => a.host.test(u.hostname) && a.path.test(u.pathname))
  } catch {
    return false
  }
}

/** GET with redirects followed by hand, so every hop is checked against the allow-list. */
async function getChecked(raw: string, signal: AbortSignal, range?: string) {
  let url = raw
  for (let hop = 0; hop < 6; hop++) {
    if (!isAllowed(url)) return { error: 'not_allowed' as const }
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/pdf, application/epub+zip, */*;q=0.5' }
    if (range) headers.Range = `bytes=${range}`
    let r: Response
    try {
      r = await fetch(url, { redirect: 'manual', signal, headers })
    } catch (err) {
      // Remember which server didn't answer, so another copy can be tried.
      throw Object.assign(err as Error, { host: new URL(url).hostname })
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      r.body?.cancel().catch(() => {})
      url = new URL(r.headers.get('location')!, url).toString()
      continue
    }
    return { res: r, url }
  }
  return { error: 'unavailable' as const }
}

/** Sniff the first bytes: a real PDF starts with %PDF, a real EPUB is a zip whose first entry is its mimetype. */
export function sniff(head: Uint8Array): 'pdf' | 'epub' | undefined {
  const text = new TextDecoder('latin1').decode(head.slice(0, 1024))
  if (text.startsWith('%PDF')) return 'pdf'
  if (head[0] === 0x50 && head[1] === 0x4b && text.includes('mimetypeapplication/epub+zip')) return 'epub'
  return undefined
}

/**
 * GET /api/fetch-book?url=…[&check=1]
 * check=1 answers { ok, format, size } after looking at the first bytes (so the
 * app can verify a file really exists before offering "Add & Read"); otherwise
 * the file is streamed through.
 */
export async function handleFetchBook(req: Request): Promise<Response> {
  const res = await fetchBook(req)
  // For a check, "this file isn't usable" is an answer, not an error: the app reads ok / message.
  if (new URL(req.url).searchParams.get('check') === '1' && !res.ok) {
    const data = await res.json()
    return Response.json({ ok: false, ...data }, { headers: { 'Cache-Control': 'no-store' } })
  }
  return res
}

async function fetchBook(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const target = params.get('url') ?? ''
  const check = params.get('check') === '1'
  if (!isAllowed(target)) return fail('not_allowed', 400)

  // range=start-end: one piece of a big file. Some sources limit speed per connection,
  // so the app fetches large files as several pieces at once and joins them.
  const m = /^(\d{1,10})-(\d{1,10})$/.exec(params.get('range') ?? '')
  const range = m && !check ? { start: +m[1], end: +m[2] } : undefined
  if (range && (range.end < range.start || range.end - range.start >= 16 * 1024 * 1024 || range.end >= MAX_BYTES)) return fail('not_allowed', 400)

  // Internet Archive keeps each item on more than one storage server and its download link
  // picks one per request; now and then the one picked doesn't answer (a connect timeout).
  // A fresh request usually lands on another, so a stalled connection is retried a few times.
  let got: Awaited<ReturnType<typeof getChecked>> | undefined
  let lastErr: unknown
  for (let attempt = 0; attempt < 3 && !got; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HEADER_TIMEOUT)
    try {
      got = await getChecked(target, ctrl.signal, range && `${range.start}-${range.end}`)
    } catch (err) {
      lastErr = err
    } finally {
      clearTimeout(timer)
    }
  }
  // Still nothing: go straight to the item's other storage servers (listed in its metadata).
  if (!got) {
    const failedHost = (lastErr as { host?: string })?.host
    for (const alt of await archiveCopies(target, failedHost)) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), HEADER_TIMEOUT)
      try {
        got = await getChecked(alt, ctrl.signal, range && `${range.start}-${range.end}`)
        break
      } catch (err) {
        lastErr = err
      } finally {
        clearTimeout(timer)
      }
    }
  }
  if (!got) {
    // Keep the underlying reason (e.g. a reset or timed-out connection) for diagnosing.
    const cause = (lastErr as { cause?: { code?: string; message?: string } }).cause
    return fail('unavailable', 504, [(lastErr as Error)?.message, cause?.code, cause?.message].filter(Boolean).join(' · '))
  }
  if ('error' in got) return fail(got.error!, got.error === 'not_allowed' ? 400 : 502)
  const { res } = got
  if (res.status === 401 || res.status === 403) return fail('restricted', 403)
  if (res.status === 404 || res.status === 410) return fail('not_found', 404)
  if (!res.ok || !res.body) return fail('unavailable', 502, `HTTP ${res.status}`)

  if (range) {
    // The source must really send just that piece; otherwise the app falls back to one download.
    if (res.status !== 206) {
      res.body.cancel().catch(() => {})
      return Response.json({ error: 'no_range', message: 'This source sends the file in one go.', retryable: false }, { status: 416 })
    }
    // The first piece still has to look like a PDF or EPUB.
    if (range.start === 0) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let have = 0
      while (have < 1024) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
        have += value.length
      }
      const head = concat(chunks, have)
      if (!sniff(head)) {
        reader.cancel().catch(() => {})
        return fail('not_a_book', 415)
      }
      const rest = new ReadableStream<Uint8Array>({
        start: (c) => c.enqueue(head),
        async pull(c) {
          const { value, done } = await reader.read()
          if (done) c.close()
          else c.enqueue(value)
        },
        cancel: () => void reader.cancel().catch(() => {}),
      })
      return new Response(rest, { status: 206, headers: pieceHeaders(res) })
    }
    return new Response(res.body, { status: 206, headers: pieceHeaders(res) })
  }

  const size = Number(res.headers.get('content-length')) || undefined
  if (size && size > MAX_BYTES) {
    res.body.cancel().catch(() => {})
    return fail('too_large', 413)
  }

  // Read just enough to know what it is.
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let have = 0
  while (have < 1024) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    have += value.length
  }
  const head = concat(chunks, have)
  const format = sniff(head)
  if (!format) {
    reader.cancel().catch(() => {})
    return fail('not_a_book', 415)
  }
  if (check) {
    reader.cancel().catch(() => {})
    return Response.json({ ok: true, format, size }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Stream the rest straight through, still counting bytes against the cap.
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(head)
      sent = head.length
    },
    async pull(c) {
      const { value, done } = await reader.read()
      if (done) return c.close()
      sent += value.length
      if (sent > MAX_BYTES) {
        reader.cancel().catch(() => {})
        return c.error(new Error('too_large'))
      }
      c.enqueue(value)
    },
    cancel() {
      reader.cancel().catch(() => {})
    },
  })
  const headers = new Headers({
    'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    'X-Book-Format': format,
    'Cache-Control': 'no-store',
  })
  if (size) headers.set('Content-Length', String(size))
  return new Response(body, { status: 200, headers })
}

/**
 * For an Internet Archive download (archive.org/download/{item}/{file}), the same file on
 * the item's other storage servers — Archive lists them as d1 / d2 in the item's metadata.
 */
async function archiveCopies(raw: string, skipHost?: string): Promise<string[]> {
  const m = /^https:\/\/archive\.org\/download\/([^/]+)\/(.+)$/.exec(raw)
  if (!m) return []
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(`https://archive.org/metadata/${m[1]}`, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
    clearTimeout(timer)
    if (!r.ok) return []
    const meta = (await r.json()) as { d1?: string; d2?: string; server?: string; dir?: string }
    if (!meta.dir) return []
    return [...new Set([meta.d2, meta.d1, meta.server])]
      .filter((h): h is string => !!h && h !== skipHost)
      .map((h) => `https://${h}${meta.dir}/${m[2]}`)
      .filter(isAllowed)
  } catch {
    return []
  }
}

function pieceHeaders(res: Response) {
  const h = new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' })
  const len = res.headers.get('content-length')
  if (len) h.set('Content-Length', len)
  const cr = res.headers.get('content-range')
  if (cr) h.set('X-Content-Range', cr)
  return h
}

function concat(chunks: Uint8Array[], length: number) {
  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/* ---------- OAPEN / DOAB search (their REST APIs don't allow browser requests) ---------- */

const OA_BASE = { oapen: 'https://library.oapen.org', doab: 'https://directory.doabooks.org' } as const

export interface OaItem {
  id: string
  title: string
  authors: string[]
  year?: number
  language?: string
  publisher?: string
  isbn?: string
  license?: string
  licenseUrl?: string
  url: string
  files: { format: 'pdf' | 'epub'; url: string; size?: number }[]
}

type DSpaceItem = {
  handle?: string
  name?: string
  metadata?: { key: string; value: string }[]
  bitstreams?: { name?: string; bundleName?: string; mimeType?: string; sizeBytes?: number; retrieveLink?: string }[]
}

/** GET /api/oa-search?source=oapen|doab&q=…&mode=title|author|isbn|any — the documented /rest/search endpoint. */
export async function handleOaSearch(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const source = params.get('source') === 'doab' ? 'doab' : 'oapen'
  const q = (params.get('q') ?? '').trim().slice(0, 200)
  const mode = params.get('mode') ?? 'any'
  if (!q) return Response.json({ items: [] })
  const clean = q.replace(/["\\]/g, ' ')
  const query =
    mode === 'title' ? `dc.title:"${clean}"` : mode === 'author' ? `dc.contributor.author:"${clean}"` : mode === 'isbn' ? `"${clean.replace(/[^0-9Xx]/g, '')}"` : clean
  const url = `${OA_BASE[source]}/rest/search?query=${encodeURIComponent(query)}&expand=metadata,bitstreams&limit=12`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } })
    // A source being unavailable is an expected answer for the app (it shows it per source), not a server error.
    if (r.status === 403) return Response.json({ error: 'blocked', message: `${source === 'oapen' ? 'OAPEN' : 'DOAB'} only answers approved servers.` })
    if (!r.ok) return Response.json({ error: 'unavailable', message: `${source === 'oapen' ? 'OAPEN' : 'DOAB'} didn’t answer (HTTP ${r.status}).` })
    const data = (await r.json()) as DSpaceItem[] | { items?: DSpaceItem[] }
    const list = Array.isArray(data) ? data : data.items ?? []
    return Response.json({ items: list.map((it) => toOaItem(it, source)).filter(Boolean) })
  } catch {
    return Response.json({ error: 'unavailable', message: `${source === 'oapen' ? 'OAPEN' : 'DOAB'} didn’t answer in time.` })
  } finally {
    clearTimeout(timer)
  }
}

function toOaItem(it: DSpaceItem, source: 'oapen' | 'doab'): OaItem | null {
  const md = (k: string) => it.metadata?.filter((m) => m.key === k).map((m) => m.value) ?? []
  const title = md('dc.title')[0] ?? it.name
  if (!title || !it.handle) return null
  const base = OA_BASE[source]
  const files: OaItem['files'] = []
  for (const b of it.bitstreams ?? []) {
    if ((b.bundleName ?? 'ORIGINAL') !== 'ORIGINAL' || !b.retrieveLink) continue
    const format = b.mimeType === 'application/pdf' || /\.pdf$/i.test(b.name ?? '') ? 'pdf' : b.mimeType === 'application/epub+zip' || /\.epub$/i.test(b.name ?? '') ? 'epub' : null
    const url = new URL(b.retrieveLink, base).toString()
    if (format && isAllowed(url)) files.push({ format, url, size: b.sizeBytes })
  }
  const year = parseInt(md('dc.date.issued')[0] ?? '', 10)
  return {
    id: `${source}:${it.handle}`,
    title,
    authors: [...md('dc.contributor.author'), ...md('dc.contributor.editor')].slice(0, 4),
    year: Number.isFinite(year) ? year : undefined,
    language: md('dc.language')[0],
    publisher: md('publisher.name')[0] ?? md('dc.publisher')[0],
    isbn: md('dc.identifier.isbn')[0] ?? md('oapen.identifier.isbn')[0],
    license: md('dc.rights')[0],
    licenseUrl: md('dc.rights.uri')[0],
    url: `${base}/handle/${it.handle}`,
    files,
  }
}
