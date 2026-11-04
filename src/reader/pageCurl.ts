/**
 * A paper page-curl, drawn on a canvas laid over the page.
 *
 * `snap` is a picture of the page being turned. At progress `p` (0 = lying flat,
 * 1 = fully turned) the page is folded at a vertical line: the part before the
 * fold stays put, the part past it flips over and lies on top as the paper's
 * back (pale, with the ink faintly showing through), and a soft shadow falls
 * on the next page, which is already drawn underneath.
 *
 * dir  1 = turning forward  (the right edge lifts and travels left)
 * dir -1 = turning back     (the left edge lifts and travels right)
 */
export function drawCurl(sheet: HTMLCanvasElement, snap: HTMLCanvasElement, p: number, dir: 1 | -1) {
  const ctx = sheet.getContext('2d')!
  const dpr = sheet.width / (parseFloat(sheet.style.width) || sheet.width)
  const W = sheet.width / dpr
  const H = sheet.height / dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, sheet.width, sheet.height)
  if (p >= 1) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Ease the fold so the page lifts gently and then sweeps across.
  const t = Math.max(0, Math.min(1, p))
  const f = dir === 1 ? W * (1 - t) : W * t // the fold line
  const outer = dir === 1 ? 2 * f - W : 2 * f // where the folded-over edge reaches
  const flapL = dir === 1 ? Math.max(0, outer) : f
  const flapR = dir === 1 ? f : Math.min(W, outer)

  // 1. The part of the page that hasn't lifted yet.
  if (dir === 1) {
    if (f > 0) ctx.drawImage(snap, 0, 0, f * dpr, H * dpr, 0, 0, f, H)
  } else if (f < W) {
    ctx.drawImage(snap, f * dpr, 0, (W - f) * dpr, H * dpr, f, 0, W - f, H)
  }

  // 2. A soft shadow on the next page, just past the fold.
  const shadowW = Math.min(70, dir === 1 ? W - f : f)
  if (shadowW > 0) {
    const sx0 = dir === 1 ? f : f - shadowW
    const g = ctx.createLinearGradient(dir === 1 ? f : f, 0, dir === 1 ? f + shadowW : f - shadowW, 0)
    const depth = 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.2)) + 0.06
    g.addColorStop(0, `rgba(40, 20, 50, ${depth})`)
    g.addColorStop(1, 'rgba(40, 20, 50, 0)')
    ctx.fillStyle = g
    ctx.fillRect(sx0, 0, shadowW, H)
  }

  // 3. The folded-over flap: the back of the paper.
  const flapW = flapR - flapL
  if (flapW > 0.5) {
    // the flap's own shadow falling on the page beneath it
    const edge = dir === 1 ? flapL : flapR
    const cast = Math.min(22, dir === 1 ? edge : W - edge)
    if (cast > 0 && ((dir === 1 && outer > 0) || (dir === -1 && outer < W))) {
      const cg = ctx.createLinearGradient(edge, 0, dir === 1 ? edge - cast : edge + cast, 0)
      cg.addColorStop(0, 'rgba(40, 20, 50, 0.18)')
      cg.addColorStop(1, 'rgba(40, 20, 50, 0)')
      ctx.fillStyle = cg
      ctx.fillRect(dir === 1 ? edge - cast : edge, 0, cast, H)
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(flapL, 0, flapW, H)
    ctx.clip()
    ctx.fillStyle = '#f5efe5'
    ctx.fillRect(flapL, 0, flapW, H)
    // the ink showing faintly through the paper, mirrored
    ctx.globalAlpha = 0.08
    ctx.translate(2 * f, 0)
    ctx.scale(-1, 1)
    if (dir === 1) ctx.drawImage(snap, f * dpr, 0, (W - f) * dpr, H * dpr, f, 0, W - f, H)
    else ctx.drawImage(snap, 0, 0, f * dpr, H * dpr, 0, 0, f, H)
    ctx.restore()

    // curvature: darker right at the fold, a highlight across the middle
    const sg = ctx.createLinearGradient(dir === 1 ? flapL : flapR, 0, f, 0)
    sg.addColorStop(0, 'rgba(60, 40, 70, 0.10)')
    sg.addColorStop(0.55, 'rgba(255, 255, 255, 0.35)')
    sg.addColorStop(0.85, 'rgba(60, 40, 70, 0.06)')
    sg.addColorStop(1, 'rgba(60, 40, 70, 0.26)')
    ctx.fillStyle = sg
    ctx.fillRect(flapL, 0, flapW, H)
  }
}

/** Animate the curl from `from` to `to`; resolves when done. */
export function animateCurl(draw: (p: number) => void, from: number, to: number, ms: number) {
  return new Promise<void>((resolve) => {
    const start = performance.now()
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      draw(from + (to - from) * ease(k))
      if (k < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}
