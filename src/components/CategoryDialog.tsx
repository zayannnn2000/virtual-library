import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { addCustomGenre, removeGenre, useGenres } from '../lib/library'
import { Icon } from './Art'
import { Dialog, useToast } from './ui'

/** Her category list: add a new one, or take any off (with Undo). */
export function CategoryDialog({ onClose, onAdded, onRemoved }: { onClose: () => void; onAdded: (g: string) => void; onRemoved: (g: string) => void }) {
  const genres = useGenres()
  const toast = useToast()
  const [name, setName] = useState('')
  const counts = useLiveQuery(async () => {
    const tally: Record<string, number> = {}
    await db.books.filter((b) => !b.removedAt).each((b) => b.genres.forEach((g) => (tally[g] = (tally[g] ?? 0) + 1)))
    return tally
  }, [])

  const add = async () => {
    const g = name.trim()
    if (!g) return
    await addCustomGenre(g)
    setName('')
    onAdded(g)
    toast({ message: `“${g}” added.` })
  }

  const remove = async (g: string) => {
    const undo = await removeGenre(g)
    onRemoved(g)
    toast({ message: `“${g}” removed.`, action: { label: 'Undo', run: undo } })
  }

  return (
    <Dialog label="Categories" onClose={onClose} className="category-dialog">
      <header className="dialog-head">
        <p className="eyebrow">Your categories</p>
        <h2>Sort the shelf your way</h2>
      </header>
      <form
        className="category-new"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Cozy Mystery" aria-label="New category name" maxLength={32} />
        <button className="btn btn-small" disabled={!name.trim()}>
          <Icon name="plus" size={15} /> Add
        </button>
      </form>
      <ul className="category-list">
        {genres.map((g) => (
          <li key={g}>
            <span className="category-name">{g}</span>
            <span className="category-count">{counts?.[g] ? `${counts[g]} book${counts[g] === 1 ? '' : 's'}` : ''}</span>
            <button className="icon-btn category-remove" aria-label={`Remove ${g}`} onClick={() => remove(g)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="fine">Removing a category doesn’t remove any books — they just lose that label.</p>
    </Dialog>
  )
}
