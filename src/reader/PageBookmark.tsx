import type { FlowerKind } from '../types'
import { PressedFlower } from '../components/Art'

/**
 * The page's top-right corner: a little folded dog-ear invites a bookmark; once
 * bookmarked, a pressed flower sits there instead. Tap either to toggle.
 */
export function PageBookmark({ flower, onToggle }: { flower?: FlowerKind; onToggle: () => void }) {
  return (
    <button
      className={`page-bookmark ${flower ? 'on' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={flower ? 'Remove the flower bookmark from this page' : 'Bookmark this page with a pressed flower'}
      aria-pressed={!!flower}
      title={flower ? 'Remove bookmark (B)' : 'Bookmark this page (B)'}
    >
      {flower ? (
        <span className="flower-bookmark">
          <PressedFlower kind={flower} size={34} />
        </span>
      ) : (
        <span className="dog-ear" aria-hidden />
      )}
    </button>
  )
}
