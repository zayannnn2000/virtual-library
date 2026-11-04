/**
 * Ornaments for the cloth spines, in the spirit of Victorian decorated
 * bindings: gilt daisies, poppies, climbing vines, lattices and fleurons.
 * Each ornament is drawn at width 40 and scales to the spine's width.
 */

export type SpineVariant = 0 | 1 | 2 | 3 | 4
export const SPINE_VARIANTS = 5

interface Inks {
  gilt: string
  ink: string
  accent: string
  leaf: string
}

function Daisy({ x, y, r, fill, center }: { x: number; y: number; r: number; fill: string; center: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <ellipse key={a} cx="0" cy={-r * 0.62} rx={r * 0.26} ry={r * 0.5} fill={fill} transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.32} fill={center} />
    </g>
  )
}

const Leaf = ({ x, y, s, rot, fill }: { x: number; y: number; s: number; rot: number; fill: string }) => (
  <path d="M0 0 C3 -5 9 -5 12 0 C9 5 3 5 0 0z" fill={fill} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} />
)

function Rules({ y, w = 40, c }: { y: number; w?: number; c: string }) {
  return (
    <g stroke={c} strokeWidth="1.2">
      <line x1="2" x2={w - 2} y1={y} y2={y} />
      <line x1="2" x2={w - 2} y1={y + 3} y2={y + 3} strokeWidth="0.6" />
    </g>
  )
}

export function SpineTop({ variant, inks }: { variant: SpineVariant; inks: Inks }) {
  const { gilt, accent, leaf } = inks
  const svg = (h: number, children: React.ReactNode) => (
    <svg className="spine-orn top" viewBox={`0 0 40 ${h}`} preserveAspectRatio="xMidYMin meet" aria-hidden>
      {children}
    </svg>
  )
  switch (variant) {
    case 0:
      return svg(40, <>
        <Rules y={4} c={gilt} />
        <Daisy x={10} y={20} r={6} fill={gilt} center={accent} />
        <Daisy x={30} y={20} r={6} fill={gilt} center={accent} />
        <Daisy x={20} y={27} r={4.5} fill={gilt} center={accent} />
        <Rules y={34} c={gilt} />
      </>)
    case 1:
      return svg(34, <>
        <Rules y={4} c={gilt} />
        <path d="M20 30 C20 24 20 18 20 14" stroke={leaf} strokeWidth="1.4" fill="none" />
        <ellipse cx="20" cy="12" rx="4" ry="5.5" fill={accent} />
        <Leaf x={20} y={24} s={0.7} rot={-30} fill={leaf} />
      </>)
    case 2:
      return svg(30, <>
        <path d="M4 22 C8 8 16 8 20 16 C24 8 32 8 36 22" stroke={gilt} strokeWidth="1.6" fill="none" />
        <circle cx="20" cy="16" r="2.4" fill={gilt} />
        <Rules y={25} c={gilt} />
      </>)
    case 3:
      return svg(36, <>
        <Rules y={3} c={gilt} />
        <g stroke={gilt} strokeWidth="1" fill="none">
          <path d="M2 10 L20 30 L38 10 M2 30 L20 10 L38 30" />
        </g>
        {[[11, 20], [29, 20], [20, 10], [20, 30]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.8" fill={gilt} />)}
        <Rules y={32} c={gilt} />
      </>)
    default:
      return svg(28, <>
        <Rules y={4} c={gilt} />
        <path d="M20 12 C14 8 10 14 14 18 C16 20 20 18 20 15 C20 18 24 20 26 18 C30 14 26 8 20 12z" fill={gilt} />
        <Rules y={22} c={gilt} />
      </>)
  }
}

export function SpineBottom({ variant, inks }: { variant: SpineVariant; inks: Inks }) {
  const { gilt, accent, leaf, ink } = inks
  const svg = (h: number, children: React.ReactNode) => (
    <svg className="spine-orn bottom" viewBox={`0 0 40 ${h}`} preserveAspectRatio="xMidYMax meet" aria-hidden>
      {children}
    </svg>
  )
  switch (variant) {
    case 0:
      // gilt daisy panel
      return svg(96, <>
        <rect x="4" y="6" width="32" height="80" rx="3" fill="none" stroke={gilt} strokeWidth="1" />
        <path d="M20 82 C19 66 21 50 20 34" stroke={gilt} strokeWidth="1.2" fill="none" />
        <Leaf x={20} y={70} s={0.9} rot={-140} fill={gilt} />
        <Leaf x={20} y={58} s={0.9} rot={-40} fill={gilt} />
        <Daisy x={20} y={28} r={9} fill={gilt} center={accent} />
        <Daisy x={11} y={46} r={5} fill={gilt} center={accent} />
        <Daisy x={29} y={52} r={5} fill={gilt} center={accent} />
        <Rules y={90} c={gilt} />
      </>)
    case 1:
      // art-nouveau poppy
      return svg(118, <>
        <path d="M20 114 C18 96 24 80 20 52" stroke={leaf} strokeWidth="1.8" fill="none" />
        <path d="M20 100 C10 96 6 86 8 78 C14 82 18 90 20 100z" fill={leaf} />
        <path d="M21 88 C30 84 34 74 32 66 C26 70 22 78 21 88z" fill={leaf} opacity="0.85" />
        <g transform="translate(20 38)">
          <circle cx="-7" cy="0" r="9" fill={accent} />
          <circle cx="7" cy="0" r="9" fill={accent} />
          <circle cx="0" cy="-7" r="9" fill={accent} opacity="0.92" />
          <circle cx="0" cy="5" r="8" fill={accent} opacity="0.85" />
          <circle r="4" fill={ink} opacity="0.75" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <line key={a} x1="0" y1="0" x2="0" y2="-7" stroke={ink} strokeWidth="0.8" transform={`rotate(${a})`} opacity="0.7" />
          ))}
        </g>
      </>)
    case 2:
      // climbing honeysuckle vine
      return svg(130, <>
        <path d="M20 128 C8 116 32 104 20 92 C8 80 32 68 20 56 C10 46 26 34 20 22" stroke={gilt} strokeWidth="1.4" fill="none" />
        <Leaf x={20} y={110} s={0.9} rot={-20} fill={leaf} />
        <Leaf x={20} y={86} s={0.9} rot={200} fill={leaf} />
        <Leaf x={20} y={62} s={0.8} rot={-25} fill={leaf} />
        {[[27, 98], [13, 74], [26, 46]].map(([x, y]) => (
          <g key={`${x}${y}`} transform={`translate(${x} ${y})`}>
            <path d="M0 0 C-3 -6 -2 -11 0 -13 C2 -11 3 -6 0 0z" fill={accent} />
            <path d="M0 0 C-6 -3 -10 -2 -12 0 C-10 2 -6 3 0 0z" fill={accent} opacity="0.8" />
          </g>
        ))}
        <circle cx="20" cy="18" r="3" fill={gilt} />
      </>)
    case 3:
      // antique lattice panel
      return svg(80, <>
        <Rules y={4} c={gilt} />
        <rect x="5" y="12" width="30" height="54" fill="none" stroke={gilt} strokeWidth="1" />
        <g stroke={gilt} strokeWidth="0.8" fill="none">
          <path d="M5 12 L35 42 M5 27 L35 57 M5 42 L29 66 M11 12 L35 36 M20 12 L35 27 M35 12 L5 42 M35 27 L5 57 M35 42 L11 66 M29 12 L5 36 M20 12 L5 27" />
        </g>
        <Daisy x={20} y={39} r={6} fill={gilt} center={accent} />
        <Rules y={72} c={gilt} />
      </>)
    default:
      // fleurons
      return svg(56, <>
        <path d="M20 10 C12 4 6 14 13 20 C16 22 20 20 20 16 C20 20 24 22 27 20 C34 14 28 4 20 10z" fill={gilt} />
        <path d="M20 20 L20 34" stroke={gilt} strokeWidth="1.2" />
        <circle cx="20" cy="38" r="2.2" fill={gilt} />
        <Rules y={46} c={gilt} />
      </>)
  }
}
