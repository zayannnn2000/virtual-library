/** Cloth-spine colours drawn from a cover, softened so the shelf stays cohesive. */

const FALLBACKS = ['#6e4f8f', '#9a4d70', '#5b4a7a', '#8c5f80', '#55657a', '#7d5260', '#76619c', '#4f3e66']

export function fallbackSpine(seed: string) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FALLBACKS[h % FALLBACKS.length]
}

/**
 * Each book's cloth colour comes from its own cover's main colour, softened into
 * a cloth tone. A tiny per-book shift means two similar covers never match exactly.
 */
export interface Cloth {
  bg: string
  ink: string
  gilt: string
  accent: string
  leaf: string
  hue: number
  light: boolean
}

/** Cover colours are stored as "v2:hsl(...)"; older values get re-measured. */
export const SPINE_COLOR_VERSION = 'v2:'

function parseColor(c?: string): [number, number, number] | undefined {
  if (!c) return undefined
  const hsl = c.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/)
  if (hsl) return [+hsl[1], +hsl[2] / 100, +hsl[3] / 100]
  const hex = c.match(/#([0-9a-f]{6})/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  return undefined
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

export function clothFor(spineColor: string | undefined, seed: string): Cloth {
  const parsed = parseColor(spineColor) ?? parseColor(fallbackSpine(seed))!
  let [h, s, l] = parsed
  h += hashNumber(seed, -9, 9)
  const lj = hashNumber(seed + 'l', -0.05, 0.05)
  if (s < 0.1) {
    // A black, white or grey cover: ivory, dove-lavender or deep plum cloth, never dull grey.
    if (l > 0.62) [h, s, l] = [40 + h * 0, 0.38, 0.82]
    else if (l < 0.3) [h, s, l] = [275, 0.24, 0.27]
    else [h, s, l] = [265, 0.16, 0.62]
  } else {
    s = clamp(s * 0.8, 0.22, 0.58)
    l = clamp(l, 0.3, 0.78)
  }
  l = clamp(l + lj, 0.24, 0.84)
  const light = l > 0.52
  return {
    bg: hsl(h, s, l),
    ink: light ? hsl(h, 0.45, 0.16) : '#f3dc9f',
    gilt: light ? '#a87d2f' : '#e6c47c',
    accent: light ? hsl(h + 35, 0.45, 0.4) : hsl(h + 35, 0.5, 0.74),
    leaf: light ? '#5f7a52' : '#b6c79a',
    hue: h,
    light,
  }
}

export function hashNumber(seed: string, min: number, max: number) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return min + (h % 1000) / 1000 * (max - min)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function spineColorFromImage(src: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        // Find the cover's *main* colour: group colourful pixels by hue and take the
        // biggest group (an average would turn most covers into the same muddy tone).
        const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
        let total = 0
        let lightSum = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
          lightSum += l
          n++
          if (s < 0.15 || l < 0.12 || l > 0.92) continue
          const w = s * (1 - Math.abs(l - 0.5))
          const bk = buckets[Math.floor(h / 20) % 18]
          bk.w += w
          bk.r += data[i] * w
          bk.g += data[i + 1] * w
          bk.b += data[i + 2] * w
          total += w
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a))
        if (total < 6 || best.w === 0) {
          // A mostly black / white / grey cover.
          return resolve(`${SPINE_COLOR_VERSION}hsl(0 0% ${Math.round((lightSum / n) * 100)}%)`)
        }
        const [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w)
        resolve(`${SPINE_COLOR_VERSION}hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`)
      } catch {
        resolve(undefined)
      }
    }
    img.onerror = () => resolve(undefined)
    img.src = src
  })
}
