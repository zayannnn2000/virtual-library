import ePub from 'epubjs'
import type { FileFormat } from '../types'
import { pdfjs } from './pdf'

export interface FileInspection {
  format: FileFormat
  title?: string
  authors: string[]
  pages?: number
  /** First page (PDF) or the cover the EPUB declares — clearly from her file. */
  coverBlob?: Blob
}

export class ImportError extends Error {}

const MAX_BYTES = 200 * 1024 * 1024

export async function inspectFile(file: File): Promise<FileInspection> {
  if (file.size === 0) throw new ImportError('That file is empty.')
  if (file.size > MAX_BYTES) throw new ImportError('That file is over 200 MB — too large to keep in the library.')
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 // %PDF
  const isZip = head[0] === 0x50 && head[1] === 0x4b // PK
  if (isPdf) return inspectPdf(file)
  if (isZip && /\.epub$/i.test(file.name)) return inspectEpub(file)
  if (isZip) return inspectEpub(file)
  throw new ImportError('Only PDF and EPUB files can be read here.')
}

async function inspectPdf(file: File): Promise<FileInspection> {
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  } catch (err) {
    if ((err as Error).name === 'PasswordException') throw new ImportError('That PDF is password-protected.')
    throw new ImportError("That PDF couldn't be opened — it may be damaged or incomplete.")
  }
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as Record<string, string>
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const scale = 360 / viewport.width
    const v = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.width)
    canvas.height = Math.round(v.height)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: v }).promise
    const coverBlob = await new Promise<Blob | undefined>((r) => canvas.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.85))
    return {
      format: 'pdf',
      title: cleanTitle(info.Title) ?? titleFromName(file.name),
      authors: info.Author ? [info.Author.trim()] : [],
      pages: doc.numPages,
      coverBlob,
    }
  } finally {
    doc.destroy()
  }
}

async function inspectEpub(file: File): Promise<FileInspection> {
  const book = ePub(await file.arrayBuffer())
  try {
    await book.opened.catch(() => {
      throw new ImportError("That EPUB couldn't be opened — it may be damaged.")
    })
    // DRM check: encryption.xml that encrypts more than embedded fonts means it's locked.
    const zip = (book as any).archive?.zip
    const enc = zip?.file('META-INF/encryption.xml')
    if (enc) {
      const xml: string = await enc.async('string')
      const algorithms = [...xml.matchAll(/Algorithm="([^"]+)"/g)].map((m) => m[1])
      const fontOnly = algorithms.every((a) => /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a))
      if (!fontOnly) throw new ImportError('That EPUB is DRM-protected, so it can only be opened in the app it was bought from.')
    }
    const meta = await book.loaded.metadata
    let coverBlob: Blob | undefined
    try {
      const url = await book.coverUrl()
      if (url) coverBlob = await (await fetch(url)).blob()
    } catch {
      /* no cover in the file */
    }
    return {
      format: 'epub',
      title: cleanTitle(meta.title) ?? titleFromName(file.name),
      authors: meta.creator ? [meta.creator] : [],
      coverBlob,
    }
  } finally {
    // Let epub.js finish its own background loading before tearing it down.
    await Promise.allSettled([book.loaded.navigation])
    book.destroy()
  }
}

function cleanTitle(t?: string) {
  const s = t?.trim()
  if (!s || /^(untitled|microsoft word|document\d*)/i.test(s) || /\.(docx?|pdf|indd)$/i.test(s)) return undefined
  return s
}

function titleFromName(name: string) {
  return name
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(oceanofpdf|com|ebook|pdf|epub)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
