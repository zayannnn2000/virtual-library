import type { FlowerKind, HighlightColor, NoteColor, StickerKind } from '../types'

/* ---------- pressed flowers (bookmarks + favourites) ---------- */

export const FLOWERS: { kind: FlowerKind; name: string }[] = [
  { kind: 'lavender', name: 'Lavender' },
  { kind: 'forgetmenot', name: 'Forget-me-not' },
  { kind: 'blossom', name: 'Pink blossom' },
]

export function PressedFlower({ kind, size = 48, className }: { kind: FlowerKind; size?: number; className?: string }) {
  const common = { width: size, height: size * 2, viewBox: '0 0 40 80', className, 'aria-hidden': true } as const
  if (kind === 'lavender') {
    return (
      <svg {...common}>
        <path d="M20 78 C19 60 21 40 20 14" stroke="#7a8a5a" strokeWidth="1.6" fill="none" />
        <path d="M20 52 C14 48 12 44 11 40" stroke="#7a8a5a" strokeWidth="1.2" fill="none" />
        {Array.from({ length: 9 }).map((_, i) => (
          <g key={i} transform={`translate(20 ${14 + i * 4.2})`}>
            <ellipse cx={-3.2} cy={0} rx={3} ry={2.1} fill={i % 2 ? '#9a7cc4' : '#b29ad6'} transform="rotate(-25)" />
            <ellipse cx={3.2} cy={1} rx={3} ry={2.1} fill={i % 2 ? '#b29ad6' : '#8a6bb8'} transform="rotate(25)" />
          </g>
        ))}
        <ellipse cx="20" cy="10" rx="2.2" ry="3" fill="#c8b4e6" />
      </svg>
    )
  }
  if (kind === 'forgetmenot') {
    const bloom = (x: number, y: number, r: number) => (
      <g transform={`translate(${x} ${y})`}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="0" cy={-r} rx={r * 0.62} ry={r * 0.8} fill="#9fbbe8" transform={`rotate(${a})`} />
        ))}
        <circle r={r * 0.42} fill="#f3e3a0" />
      </g>
    )
    return (
      <svg {...common}>
        <path d="M20 78 C18 62 22 44 19 26 M19 46 C25 40 27 32 28 24 M19 36 C13 30 12 24 12 18" stroke="#7d9064" strokeWidth="1.4" fill="none" />
        {bloom(19, 22, 5.5)}
        {bloom(28, 20, 4.4)}
        {bloom(12, 15, 4.2)}
        {bloom(23, 11, 3.6)}
        <path d="M19 60 c-6 -2 -9 -6 -9 -10 c5 1 8 4 9 10z" fill="#93a875" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M20 78 C21 62 18 46 20 30" stroke="#7d9064" strokeWidth="1.5" fill="none" />
      <path d="M20 56 c7 -3 11 -8 11 -13 c-6 1 -10 6 -11 13z" fill="#93a875" />
      <g transform="translate(20 22)">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path key={a} d="M0 0 C-6 -6 -6 -14 0 -16 C6 -14 6 -6 0 0z" fill={a % 120 ? '#f2a9c4' : '#e98fb2'} transform={`rotate(${a})`} />
        ))}
        {[30, 90, 150, 210, 270, 330].map((a) => (
          <path key={a} d="M0 0 C-3 -4 -3 -9 0 -10 C3 -9 3 -4 0 0z" fill="#f8c9da" transform={`rotate(${a})`} />
        ))}
        <circle r="2.6" fill="#f0c86e" />
      </g>
    </svg>
  )
}

/* ---------- stickers ---------- */

export const STICKERS: StickerKind[] = ['none', 'heart', 'star', 'butterfly', 'bow', 'moon', 'sparkle']

export function Sticker({ kind, size = 28 }: { kind: StickerKind; size?: number }) {
  if (kind === 'none') return null
  const p = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true } as const
  const outline = { stroke: '#fff', strokeWidth: 2.4, strokeLinejoin: 'round' as const, paintOrder: 'stroke' as const }
  switch (kind) {
    case 'heart':
      return (
        <svg {...p}>
          <path d="M16 27 C6 20 3 14 5.5 9.5 C8 5 13.5 5.5 16 10 C18.5 5.5 24 5 26.5 9.5 C29 14 26 20 16 27z" fill="#e98fb2" {...outline} />
          <path d="M9 11 c1-2 3-2.5 4-2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      )
    case 'star':
      return (
        <svg {...p}>
          <path d="M16 3 L19.6 11.6 L28.8 12.3 L21.8 18.3 L24 27.3 L16 22.4 L8 27.3 L10.2 18.3 L3.2 12.3 L12.4 11.6z" fill="#f3cf6b" {...outline} />
        </svg>
      )
    case 'butterfly':
      return (
        <svg {...p}>
          <path d="M16 16 C12 6 4 4 4 10 C4 15 9 17 16 16z M16 16 C20 6 28 4 28 10 C28 15 23 17 16 16z" fill="#b29ad6" {...outline} />
          <path d="M16 16 C11 18 7 22 9 25 C11 28 15 23 16 16z M16 16 C21 18 25 22 23 25 C21 28 17 23 16 16z" fill="#e3a8d0" {...outline} />
          <path d="M16 9 V24 M16 9 l-2 -4 M16 9 l2 -4" stroke="#5a3d78" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      )
    case 'bow':
      return (
        <svg {...p}>
          <path d="M16 15 C10 8 4 9 4 14 C4 19 10 20 16 15z M16 15 C22 8 28 9 28 14 C28 19 22 20 16 15z" fill="#f2a9c4" {...outline} />
          <path d="M15 16 L10 27 L13 26 L15 28 L16 17z M17 16 L22 27 L19 26 L17 28 L16 17z" fill="#e98fb2" {...outline} />
          <circle cx="16" cy="15" r="2.6" fill="#d6789f" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...p}>
          <path d="M20 4 C12 5 7 11 7 17.5 C7 24 12.5 29 19 29 C23 29 26 27.5 28 25 C20 25 15 20 15 13.5 C15 9.5 17 6 20 4z" fill="#c8b4e6" {...outline} />
          <circle cx="25" cy="8" r="1.4" fill="#f3cf6b" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...p}>
          <path d="M14 3 C15 11 17 13 25 14 C17 15 15 17 14 25 C13 17 11 15 3 14 C11 13 13 11 14 3z" fill="#f3cf6b" {...outline} />
          <path d="M25 20 C25.5 23 26 23.5 29 24 C26 24.5 25.5 25 25 28 C24.5 25 24 24.5 21 24 C24 23.5 24.5 23 25 20z" fill="#e3a8d0" />
        </svg>
      )
  }
}

/* ---------- colours ---------- */

export const HIGHLIGHTS: { color: HighlightColor; name: string; fill: string }[] = [
  { color: 'lavender', name: 'Lavender', fill: '#c9b3ef' },
  { color: 'rose', name: 'Rose', fill: '#f6b3cc' },
  { color: 'butter', name: 'Butter', fill: '#f7e08f' },
  { color: 'mint', name: 'Mint', fill: '#b9e4cc' },
]
export const highlightFill = (c?: HighlightColor) => HIGHLIGHTS.find((h) => h.color === c)?.fill ?? HIGHLIGHTS[0].fill

export const NOTE_COLORS: { color: NoteColor; name: string }[] = [
  { color: 'lilac', name: 'Lilac' },
  { color: 'pink', name: 'Pink' },
  { color: 'cream', name: 'Cream' },
]

/**
 * Shared SVG patterns for the shimmer highlights. Kept in the main document so
 * both the PDF overlay and epub.js's highlight layer can reference them.
 */
export function GlitterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {HIGHLIGHTS.map((h) => (
          <pattern key={h.color} id={`glitter-${h.color}`} width="22" height="14" patternUnits="userSpaceOnUse">
            <rect width="22" height="14" fill={h.fill} />
            <circle cx="3" cy="3" r="0.9" fill="#fff" opacity="0.9" />
            <circle cx="12" cy="9" r="0.7" fill="#fff" opacity="0.75" />
            <circle cx="18" cy="4" r="0.55" fill="#fff8d6" opacity="0.9" />
            <circle cx="7" cy="11.5" r="0.5" fill="#fff" opacity="0.7" />
            <path d="M16 11 l0.6 -1.6 l0.6 1.6 l1.6 0.6 l-1.6 0.6 l-0.6 1.6 l-0.6 -1.6 l-1.6 -0.6z" fill="#fff" opacity="0.8" />
          </pattern>
        ))}
      </defs>
    </svg>
  )
}

/* ---------- small illustrations ---------- */

export function SleepyCat({ size = 160 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 200 124" aria-hidden className="sleepy-cat">
      <ellipse cx="100" cy="112" rx="86" ry="9" fill="#5a3d78" opacity="0.12" />
      <path d="M30 104 C26 74 52 54 92 54 C132 54 162 66 166 92 C168 106 156 112 100 112 C52 112 32 112 30 104z" fill="#fffaf3" stroke="#5a3d78" strokeWidth="3" strokeLinejoin="round" />
      <path d="M160 96 C178 96 186 84 180 74" stroke="#5a3d78" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M44 66 L40 42 L60 56z M78 54 L84 34 L96 56z" fill="#fffaf3" stroke="#5a3d78" strokeWidth="3" strokeLinejoin="round" />
      <path d="M47 60 L45 49 L54 56z" fill="#f2a9c4" />
      <path d="M52 78 q6 5 12 0 M76 76 q6 5 12 0" stroke="#5a3d78" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M68 86 l-3 3 m3 -3 l3 3" stroke="#d6789f" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 86 l-14 -2 M40 90 l-13 3 M96 86 l14 -2 M96 90 l13 3" stroke="#5a3d78" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M120 70 c6 10 4 22 -2 30 M138 70 c6 10 4 22 -2 30" stroke="#c8b4e6" strokeWidth="5" fill="none" strokeLinecap="round" />
      <text x="150" y="40" fontFamily="Caveat, cursive" fontSize="20" fill="#8e6bb0">z</text>
      <text x="164" y="26" fontFamily="Caveat, cursive" fontSize="15" fill="#b29ad6">z</text>
    </svg>
  )
}

export function Butterfly({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 32" className={className} aria-hidden>
      <path d="M20 16 C15 4 4 2 4 10 C4 16 11 18 20 16z M20 16 C25 4 36 2 36 10 C36 16 29 18 20 16z" fill="currentColor" opacity="0.85" />
      <path d="M20 16 C14 19 9 24 12 27 C15 30 19 23 20 16z M20 16 C26 19 31 24 28 27 C25 30 21 23 20 16z" fill="currentColor" opacity="0.6" />
      <path d="M20 9 V25" stroke="#4a3263" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/* ---------- icons ---------- */

type IconName =
  | 'heart' | 'heartFill' | 'plus' | 'search' | 'close' | 'chevL' | 'chevR' | 'book' | 'menu' | 'trash'
  | 'upload' | 'note' | 'flower' | 'list' | 'aa' | 'zoomIn' | 'zoomOut' | 'fitW' | 'fitP' | 'back' | 'check' | 'edit' | 'link' | 'lock'
  | 'marker' | 'eraser' | 'sound' | 'soundOff'

const ICONS: Record<IconName, string> = {
  heart: 'M12 20s-7-4.4-9-8.6C1.6 8.2 3.6 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.2 0 5.2 3.2 3.8 6.4C19 15.6 12 20 12 20z',
  heartFill: 'M12 20s-7-4.4-9-8.6C1.6 8.2 3.6 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.2 0 5.2 3.2 3.8 6.4C19 15.6 12 20 12 20z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm9 3-4.3-4.3',
  close: 'M6 6l12 12M18 6 6 18',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5v-13zM13 4h5.5c.8 0 1.5.7 1.5 1.5v13c0 .8-.7 1.5-1.5 1.5H13V4z',
  menu: 'M5 7h14M5 12h14M5 17h14',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M5 15v4h14v-4',
  note: 'M5 4h14v11l-5 5H5V4zm9 16v-5h5',
  flower: 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-6c0-2.5 1-4 0-4s0 1.5 0 4zm0 6v8M12 10c-2-2-4.5-2.5-5.5-1.5S7 12 9.5 12M12 10c2-2 4.5-2.5 5.5-1.5S17 12 14.5 12',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  aa: 'M3 18l5-12 5 12M5 14h6M15 18l3-7 3 7M16 16h4',
  zoomIn: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm9 3-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm9 3-4.3-4.3M8 11h6',
  fitW: 'M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3M4 5v14M20 5v14',
  fitP: 'M7 3h10v18H7zM10 8h4M10 12h4M10 16h4',
  back: 'M10 6l-6 6 6 6M4 12h16',
  check: 'M5 12l5 5 9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  link: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1zM12 15v2.5',
  marker: 'M15 4l5 5-8.5 8.5H7v-4.5L15 4zM7 13l4 4M4 21h9',
  eraser: 'M8 20h12M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H9l-3.5-3.5zM9.5 11.5l5 5',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  soundOff: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9.5l5 5M21 9.5l-5 5',
}

export function Icon({ name, size = 20, title }: { name: IconName; size?: number; title?: string }) {
  const filled = name === 'heartFill'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={ICONS[name]} />
    </svg>
  )
}
