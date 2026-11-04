/**
 * The paper page-curl for EPUBs (the same look as the PDF curl in pageCurl.ts, but built from
 * DOM pieces, since an EPUB page is live text in an iframe rather than a picture).
 *
 * 1. freeze(): lay a still copy of the page being read over the paper.
 * 2. The book moves on underneath it.
 * 3. curl(): the copy folds at a line that sweeps across; the part past the fold turns over as
 *    the back of the paper, with a soft shadow on the new page beneath.
 */

export interface Frozen {
  el: HTMLDivElement
  flat: HTMLDivElement
  flap: HTMLDivElement
  shade: HTMLDivElement
  cast: HTMLDivElement
}

/** A still copy of what's on the paper right now, or undefined if there's nothing to copy. */
export async function freeze(paper: HTMLElement): Promise<Frozen | undefined> {
  const frame = paper.querySelector('.epub-host iframe') as HTMLIFrameElement | null
  const doc = frame?.contentDocument
  if (!frame || !doc?.documentElement) return undefined
  const pr = paper.getBoundingClientRect()
  const fr = frame.getBoundingClientRect()

  const el = document.createElement('div')
  el.className = 'epub-curl'
  el.setAttribute('aria-hidden', 'true')
  const flat = document.createElement('div')
  flat.className = 'epub-curl-flat paper'
  const clone = document.createElement('iframe')
  clone.setAttribute('sandbox', 'allow-same-origin')
  clone.tabIndex = -1
  Object.assign(clone.style, {
    position: 'absolute',
    border: '0',
    left: `${fr.left - pr.left}px`,
    top: `${fr.top - pr.top}px`,
    width: `${fr.width}px`,
    height: `${fr.height}px`,
    pointerEvents: 'none',
  })
  // epub.js adds its theme (font, size, transparent page) with insertRule, which outerHTML
  // doesn't carry, so copy every readable rule across as plain CSS.
  let css = ''
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      css += Array.from(sheet.cssRules, (r) => r.cssText).join('\n') + '\n'
    } catch {
      /* a cross-origin sheet (the web font): its <link> is copied with the page anyway */
    }
  }
  const html = doc.documentElement.outerHTML.replace(/<\/head>/i, `<style>${css.replace(/<\/style/gi, '<\\/style')}</style></head>`)
  clone.srcdoc = '<!doctype html>' + html
  flat.appendChild(clone)
  const shade = document.createElement('div')
  shade.className = 'epub-curl-shade'
  const cast = document.createElement('div')
  cast.className = 'epub-curl-cast'
  const flap = document.createElement('div')
  flap.className = 'epub-curl-flap'
  el.append(flat, shade, cast, flap)
  paper.appendChild(el)

  // Wait for the copy to draw (its fonts and styles are already cached), but never long.
  await new Promise<void>((res) => {
    clone.onload = () => res()
    window.setTimeout(res, 300)
  })
  // one more frame so the copy is painted before the real page changes underneath
  await new Promise((res) => requestAnimationFrame(() => res(undefined)))
  return { el, flat, flap, shade, cast }
}

/** Draw the curl at progress p (0 = flat, 1 = turned away). dir 1 = forward, -1 = back. */
export function drawCurl(f: Frozen, p: number, dir: 1 | -1) {
  const W = f.el.clientWidth
  const t = Math.max(0, Math.min(1, p))
  const fold = dir === 1 ? W * (1 - t) : W * t
  const outer = dir === 1 ? 2 * fold - W : 2 * fold
  const flapL = dir === 1 ? Math.max(0, outer) : fold
  const flapR = dir === 1 ? fold : Math.min(W, outer)

  // the part of the old page that hasn't lifted yet
  f.flat.style.clipPath = dir === 1 ? `inset(0 ${W - fold}px 0 0)` : `inset(0 0 0 ${fold}px)`

  // a soft shadow on the new page just past the fold
  const shadowW = Math.min(80, dir === 1 ? W - fold : fold)
  const depth = 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.2)) + 0.05
  Object.assign(f.shade.style, {
    left: `${dir === 1 ? fold : fold - shadowW}px`,
    width: `${Math.max(0, shadowW)}px`,
    background: `linear-gradient(${dir === 1 ? 'to right' : 'to left'}, rgba(40,20,50,${depth}), rgba(40,20,50,0))`,
  })

  // the turned-over flap: the back of the paper, curved and lit
  const flapW = Math.max(0, flapR - flapL)
  Object.assign(f.flap.style, {
    left: `${flapL}px`,
    width: `${flapW}px`,
    display: flapW > 0.5 ? 'block' : 'none',
    background: `linear-gradient(${dir === 1 ? 'to right' : 'to left'},
      rgba(60,40,70,0.10) 0%, rgba(255,255,255,0.38) 55%, rgba(60,40,70,0.06) 85%, rgba(60,40,70,0.26) 100%), #f5efe5`,
  })

  // the flap's own shadow falling on the page beneath its outer edge
  const edge = dir === 1 ? flapL : flapR
  const castW = Math.min(24, dir === 1 ? edge : W - edge)
  Object.assign(f.cast.style, {
    left: `${dir === 1 ? edge - castW : edge}px`,
    width: `${Math.max(0, castW)}px`,
    display: flapW > 0.5 && castW > 0 ? 'block' : 'none',
    background: `linear-gradient(${dir === 1 ? 'to left' : 'to right'}, rgba(40,20,50,0.2), rgba(40,20,50,0))`,
  })
}

/** Run the curl from flat to turned; resolves when the page has gone. */
export function playCurl(f: Frozen, dir: 1 | -1, ms = 620) {
  return new Promise<void>((resolve) => {
    const start = performance.now()
    // lifts gently, sweeps across, settles
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      drawCurl(f, ease(k), dir)
      if (k < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}
