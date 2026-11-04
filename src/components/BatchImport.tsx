import { useEffect, useRef, useState } from 'react'
import { ImportError, inspectFile } from '../lib/fileImport'
import { normalise, searchBooks, suggestGenres, type SearchResult } from '../lib/metadata'
import { addBook, attachFile, findDuplicate } from '../lib/library'
import { formatBytes, useToast } from './ui'
import { Icon } from './Art'

type Outcome =
  | { state: 'waiting' }
  | { state: 'working'; step: string }
  | { state: 'added'; title: string; matched: boolean }
  | { state: 'attached'; title: string }
  | { state: 'skipped'; title: string }
  | { state: 'failed'; reason: string }

const sameTitle = (a: string, b: string) => {
  const x = normalise(a)
  const y = normalise(b)
  return !!x && !!y && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '))
}

/** Pick an Open Library match only when title (and author, if known) clearly agree. */
function bestMatch(results: SearchResult[], title: string, author?: string) {
  const surname = author ? normalise(author).split(' ').slice(-1)[0] : ''
  return results.find(
    (r) => sameTitle(r.title, title) && (!surname || r.authors.some((a) => normalise(a).includes(surname))),
  )
}

/**
 * Shelve several PDFs/EPUBs at once. Each file is matched to its real book
 * (cover, author, genres) when the match is clear; otherwise it keeps the
 * details and cover from the file itself, which she can edit afterwards.
 */
export function BatchImport({ files, onDone }: { files: File[]; onDone: () => void }) {
  const toast = useToast()
  const [outcomes, setOutcomes] = useState<Outcome[]>(() => files.map(() => ({ state: 'waiting' })))
  const started = useRef(false)
  const set = (i: number, o: Outcome) => setOutcomes((all) => all.map((x, j) => (j === i ? o : x)))

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        try {
          set(i, { state: 'working', step: 'Reading the file…' })
          const info = await inspectFile(f)
          const title = info.title || f.name
          set(i, { state: 'working', step: 'Finding the real book…' })
          let match: SearchResult | undefined
          try {
            match = bestMatch(await searchBooks([title, info.authors[0]].filter(Boolean).join(' ')), title, info.authors[0])
          } catch {
            /* offline or no match — fall back to the file's own details */
          }
          const authors = match?.authors.length ? match.authors : info.authors
          const dup = await findDuplicate(match?.title ?? title, authors, match?.olWorkKey)
          if (dup?.file) {
            set(i, { state: 'skipped', title: dup.title })
            continue
          }
          if (dup) {
            await attachFile(dup, f, info.format, info.pages)
            set(i, { state: 'attached', title: dup.title })
            continue
          }
          await addBook({
            title: match?.title ?? title,
            authors,
            year: match?.year,
            pages: info.format === 'pdf' ? info.pages : match?.pages,
            olWorkKey: match?.olWorkKey,
            coverUrl: match?.coverUrl,
            coverSource: match?.coverUrl ? match.source : info.coverBlob ? 'file' : 'none',
            coverBlob: match?.coverUrl ? undefined : info.coverBlob,
            genres: match ? suggestGenres(match.subjects) : [],
            status: 'want',
            file: { file: f, format: info.format },
          })
          set(i, { state: 'added', title: match?.title ?? title, matched: !!match })
        } catch (err) {
          set(i, { state: 'failed', reason: err instanceof ImportError ? err.message : "Couldn't add this file." })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finished = outcomes.every((o) => o.state !== 'waiting' && o.state !== 'working')
  const added = outcomes.filter((o) => o.state === 'added' || o.state === 'attached').length

  return (
    <div className="batch">
      <p className="fine">
        {finished
          ? `${added} of ${files.length} shelved. Unmatched books keep the details from their file — tap one on the shelf to edit.`
          : `Shelving ${files.length} files…`}
      </p>
      <ul className="batch-list" aria-live="polite">
        {files.map((f, i) => {
          const o = outcomes[i]
          return (
            <li key={i} className={`batch-item ${o.state}`}>
              <span className="batch-icon" aria-hidden>
                {o.state === 'added' || o.state === 'attached' ? <Icon name="check" size={16} /> : o.state === 'failed' ? <Icon name="close" size={16} /> : o.state === 'skipped' ? '–' : '…'}
              </span>
              <span className="batch-main">
                <strong>{'title' in o ? o.title : f.name}</strong>
                <span className="fine">
                  {o.state === 'waiting' && `${formatBytes(f.size)} · waiting`}
                  {o.state === 'working' && o.step}
                  {o.state === 'added' && (o.matched ? 'On the shelf · matched with its real cover' : 'On the shelf · details from the file')}
                  {o.state === 'attached' && 'File attached to the book already on your shelf'}
                  {o.state === 'skipped' && 'Already on your shelf with a file — skipped'}
                  {o.state === 'failed' && `${f.name} · ${o.reason}`}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="dialog-actions">
        <button
          className="btn"
          disabled={!finished}
          onClick={() => {
            if (added) toast({ message: `${added} book${added === 1 ? '' : 's'} added to your shelf.` })
            onDone()
          }}
        >
          {finished ? 'Done' : 'Working…'}
        </button>
      </div>
    </div>
  )
}
