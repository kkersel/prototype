// Compact heatmap renderer (same idea as simpleheat): accumulate alpha from
// blurred point stamps, then colorize through a gradient LUT. Points are in
// canvas pixel coordinates.
export interface HeatPoint {
  x: number
  y: number
  value?: number
}

const DEFAULT_GRADIENT: Record<number, string> = {
  0.0: 'rgba(0,0,255,0)',
  0.2: 'rgba(0,0,255,0.7)',
  0.4: 'rgba(0,255,255,0.8)',
  0.6: 'rgba(0,255,0,0.85)',
  0.8: 'rgba(255,255,0,0.9)',
  1.0: 'rgba(255,0,0,1)',
}

function buildGradient(stops: Record<number, string>): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  for (const k of Object.keys(stops)) grad.addColorStop(Number(k), stops[Number(k)])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1, 256)
  return ctx.getImageData(0, 0, 1, 256).data as unknown as Uint8ClampedArray
}

function buildStamp(radius: number, blur: number): HTMLCanvasElement {
  const r2 = radius + blur
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = r2 * 2
  const ctx = canvas.getContext('2d')!
  ctx.shadowOffsetX = ctx.shadowOffsetY = r2 * 2
  ctx.shadowBlur = blur
  ctx.shadowColor = 'black'
  ctx.beginPath()
  ctx.arc(-r2, -r2, radius, 0, Math.PI * 2, true)
  ctx.closePath()
  ctx.fill()
  return canvas
}

export interface HeatOptions {
  radius?: number
  blur?: number
  max?: number
  minOpacity?: number
  gradient?: Record<number, string>
}

let gradientCache: { key: string; lut: Uint8ClampedArray } | null = null

export function drawHeatmap(
  canvas: HTMLCanvasElement,
  points: HeatPoint[],
  opts: HeatOptions = {}
): void {
  const ctx = canvas.getContext('2d')!
  const radius = opts.radius ?? 26
  const blur = opts.blur ?? 22
  const minOpacity = opts.minOpacity ?? 0.05
  const gradStops = opts.gradient ?? DEFAULT_GRADIENT

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!points.length) return

  const max = opts.max ?? Math.max(1, ...accumulateMax(points))
  const stamp = buildStamp(radius, blur)

  for (const p of points) {
    ctx.globalAlpha = Math.max(minOpacity, Math.min((p.value ?? 1) / max, 1))
    ctx.drawImage(stamp, p.x - (radius + blur), p.y - (radius + blur))
  }

  const key = JSON.stringify(gradStops)
  if (!gradientCache || gradientCache.key !== key) {
    gradientCache = { key, lut: buildGradient(gradStops) }
  }
  const lut = gradientCache.lut

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha) {
      const j = alpha * 4
      data[i] = lut[j]
      data[i + 1] = lut[j + 1]
      data[i + 2] = lut[j + 2]
    }
  }
  ctx.putImageData(img, 0, 0)
}

// If multiple points coincide we want their combined weight to inform `max`.
function accumulateMax(points: HeatPoint[]): number[] {
  return points.map((p) => p.value ?? 1)
}
