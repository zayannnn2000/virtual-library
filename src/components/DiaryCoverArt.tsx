/**
 * An ornate gilt-tooled leather cover: orchid leather, scrolling gold frame,
 * enamel side panels, a leaf-stamped field and a central oval cartouche.
 * Original artwork inspired by vintage decorated journals.
 */
export function DiaryCoverArt() {
  const gilt = 'url(#gilt)'
  return (
    <svg className="diary-art" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="leather" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d3a6ea" />
          <stop offset="0.5" stopColor="#bf8ddd" />
          <stop offset="1" stopColor="#a874cc" />
        </linearGradient>
        <linearGradient id="gilt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8e6ab" />
          <stop offset="0.45" stopColor="#e2b85f" />
          <stop offset="0.7" stopColor="#f3d68c" />
          <stop offset="1" stopColor="#c4943f" />
        </linearGradient>
        <pattern id="leaves" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
          <path d="M7 2 C9.5 5 9.5 8 7 11 C4.5 8 4.5 5 7 2z" fill="#9a8fd0" opacity="0.55" />
          <circle cx="0" cy="0" r="0.9" fill="#f3d68c" opacity="0.8" />
        </pattern>
        <radialGradient id="sheen" cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* leather */}
      <rect width="300" height="400" fill="url(#leather)" />

      {/* outer frame */}
      <rect x="12" y="12" width="276" height="376" rx="10" fill="none" stroke={gilt} strokeWidth="2.5" />
      <rect x="18" y="18" width="264" height="364" rx="8" fill="none" stroke={gilt} strokeWidth="0.9" />

      {/* arched inner field with stamped leaves */}
      <path d="M58 92 Q150 30 242 92 V318 Q150 360 58 318 Z" fill="#c9a8ea" opacity="0.55" />
      <path d="M58 92 Q150 30 242 92 V318 Q150 360 58 318 Z" fill="url(#leaves)" />
      <path d="M58 92 Q150 30 242 92 V318 Q150 360 58 318 Z" fill="none" stroke={gilt} strokeWidth="2" />
      <path d="M64 96 Q150 40 236 96 V314 Q150 352 64 314 Z" fill="none" stroke={gilt} strokeWidth="0.8" />

      {/* side columns with enamel inlays */}
      {[30, 248].map((x) => (
        <g key={x}>
          <rect x={x} y="88" width="22" height="226" rx="3" fill="none" stroke={gilt} strokeWidth="1.4" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={x + 5} y={100 + i * 54} width="12" height="34" rx="2" fill={i % 2 ? '#f2b4c8' : '#a9d3df'} stroke={gilt} strokeWidth="1" />
              <circle cx={x + 11} cy={92 + i * 54} r="2.2" fill={gilt} />
            </g>
          ))}
        </g>
      ))}

      {/* top crest scrolls */}
      <path d="M100 40 C120 22 135 34 150 26 C165 34 180 22 200 40" fill="none" stroke={gilt} strokeWidth="2" strokeLinecap="round" />
      <path d="M150 26 C146 18 154 14 150 8" fill="none" stroke={gilt} strokeWidth="1.6" strokeLinecap="round" />
      {[118, 182].map((x) => (
        <path key={x} d={`M${x} 46 c-6 -8 6 -14 10 -6 c3 6 -6 8 -6 2`} fill="none" stroke={gilt} strokeWidth="1.4" />
      ))}
      <path d="M140 50 L150 40 L160 50 L150 60 Z" fill="#f2b4c8" stroke={gilt} strokeWidth="1.2" />

      {/* corner fleurons */}
      {[
        [26, 26, 0],
        [274, 26, 90],
        [274, 374, 180],
        [26, 374, 270],
      ].map(([x, y, r]) => (
        <g key={`${x}${y}`} transform={`translate(${x} ${y}) rotate(${r})`}>
          <path d="M0 0 C14 2 22 10 24 24 M0 0 C2 14 10 22 24 24" fill="none" stroke={gilt} strokeWidth="1.6" />
          <path d="M6 6 c8 -2 12 4 8 8 c-4 4 -10 0 -8 -8z" fill={gilt} />
          <circle cx="24" cy="24" r="2.4" fill={gilt} />
        </g>
      ))}

      {/* central oval cartouche */}
      <ellipse cx="150" cy="200" rx="66" ry="84" fill="#cfa2ea" stroke={gilt} strokeWidth="3" />
      <ellipse cx="150" cy="200" rx="58" ry="76" fill="none" stroke={gilt} strokeWidth="1" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <circle key={a} cx={150 + 70 * Math.sin((a * Math.PI) / 180)} cy={200 - 88 * Math.cos((a * Math.PI) / 180)} r="2.6" fill={gilt} />
      ))}

      {/* bottom scrollwork with rosettes */}
      <path d="M86 344 C110 326 130 352 150 336 C170 352 190 326 214 344" fill="none" stroke={gilt} strokeWidth="2" strokeLinecap="round" />
      {[104, 150, 196].map((x, i) => (
        <g key={x} transform={`translate(${x} ${i === 1 ? 352 : 334})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="0" cy="-4" rx="2.6" ry="4" fill={i === 1 ? '#f2b4c8' : '#a9d3df'} transform={`rotate(${a})`} />
          ))}
          <circle r="2" fill={gilt} />
        </g>
      ))}

      {/* soft light across the leather */}
      <rect width="300" height="400" fill="url(#sheen)" />
    </svg>
  )
}
