import { BONES, LEFT } from './pose'

// LUT térmico azul → cian → verde → amarillo → rojo
const LUT = (() => {
  const stops = [[0, [30, 40, 220]], [0.3, [20, 200, 240]], [0.5, [40, 220, 120]], [0.7, [250, 220, 40]], [1, [255, 40, 40]]]
  const out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1]
    const f = (t - t0) / (t1 - t0)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f
  }
  return out
})()

const heatCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
const heatCtx = heatCanvas?.getContext('2d', { willReadFrequently: false })

/** Transformación video → lienzo (cover/contain). */
export function frameRect(vw, vh, W, H, fit) {
  const s = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh)
  const w = vw * s, h = vh * s
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

function buildHeat(mask, lm, exercise, heat) {
  const mw = mask.width, mh = mask.height
  const stride = Math.max(1, Math.round(mw / 180))
  const w = Math.floor(mw / stride), h = Math.floor(mh / stride)
  if (heatCanvas.width !== w || heatCanvas.height !== h) { heatCanvas.width = w; heatCanvas.height = h }
  const data = mask.getAsFloat32Array()
  const img = heatCtx.createImageData(w, h)
  const px = img.data

  // Centros de esfuerzo: segmentos alrededor de la articulación trabajada
  const centers = []
  if (lm) {
    for (const tri of [exercise.landmarks_l, exercise.landmarks_r]) {
      const [a, b, c] = tri.map((i) => lm[i])
      if ((b.visibility ?? 1) < 0.3) continue
      centers.push([(a.x + b.x) / 2, (a.y + b.y) / 2], [b.x, b.y], [(b.x + c.x) / 2, (b.y + c.y) / 2])
    }
  }
  const torso = lm ? Math.hypot(lm[11].x - lm[23].x, lm[11].y - lm[23].y) || 0.25 : 0.25
  const inv = 1 / (torso * torso * 0.22)
  const base = 0.08 + heat * 0.32

  for (let y = 0; y < h; y++) {
    const ny = (y * stride) / mh
    for (let x = 0; x < w; x++) {
      const m = data[y * stride * mw + x * stride]
      const o = (y * w + x) * 4
      if (m < 0.35) { px[o + 3] = 0; continue }
      const nx = (x * stride) / mw
      let g = 0
      for (let k = 0; k < centers.length; k++) {
        const dx = nx - centers[k][0], dy = ny - centers[k][1]
        const e = Math.exp(-(dx * dx + dy * dy) * inv)
        if (e > g) g = e
      }
      const t = Math.min(1, base + g * (0.25 + heat * 0.75))
      const li = ((t * 255) | 0) * 3
      px[o] = LUT[li]; px[o + 1] = LUT[li + 1]; px[o + 2] = LUT[li + 2]
      px[o + 3] = Math.min(1, (m - 0.35) * 2.2) * 165
    }
  }
  heatCtx.putImageData(img, 0, 0)
  return heatCanvas
}

export function drawFrame(ctx, o) {
  const { video, W, H, fit, mirror, lm, mask, heat, exercise, angle, showHeat, accent } = o
  const vw = video.videoWidth, vh = video.videoHeight
  ctx.clearRect(0, 0, W, H)
  if (!vw) return null
  const r = frameRect(vw, vh, W, H, fit)
  const P = (p) => ({ x: r.x + (mirror ? 1 - p.x : p.x) * r.w, y: r.y + p.y * r.h })

  ctx.save()
  if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1) }
  const rx = mirror ? W - r.x - r.w : r.x
  ctx.drawImage(video, rx, r.y, r.w, r.h)
  if (showHeat && mask && exercise) {
    const hc = buildHeat(mask, lm, exercise, heat)
    ctx.globalCompositeOperation = 'source-over'
    ctx.imageSmoothingEnabled = true
    ctx.filter = 'blur(6px) saturate(1.2)'
    ctx.drawImage(hc, rx, r.y, r.w, r.h)
    ctx.filter = 'none'
  }
  ctx.restore()

  // Viñeta inferior/superior para legibilidad del HUD
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(4,6,14,0.55)'); g.addColorStop(0.22, 'rgba(4,6,14,0)')
  g.addColorStop(0.72, 'rgba(4,6,14,0)'); g.addColorStop(1, 'rgba(4,6,14,0.7)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  if (!lm) return r
  const unit = Math.max(2, Math.min(W, H) / 240)

  // Huesos con brillo
  ctx.lineCap = 'round'
  for (const [a, b] of BONES) {
    const pa = lm[a], pb = lm[b]
    if ((pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue
    const A = P(pa), B = P(pb)
    const side = LEFT.has(a) && LEFT.has(b) ? '#fb923c' : !LEFT.has(a) && !LEFT.has(b) && a > 12 ? '#60a5fa' : '#ffffff'
    ctx.strokeStyle = side
    ctx.shadowColor = side; ctx.shadowBlur = unit * 4
    ctx.lineWidth = unit * 1.4
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
  }
  ctx.shadowBlur = 0

  // Articulaciones
  for (let i = 11; i <= 28; i++) {
    const p = lm[i]
    if ((p.visibility ?? 1) < 0.4) continue
    const q = P(p)
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(q.x, q.y, unit * 1.5, 0, Math.PI * 2); ctx.fill()
  }

  // Arco del ángulo en la articulación de trabajo
  if (exercise && angle != null) {
    const tri = exercise.landmarks_l.map((i) => lm[i])
    const triR = exercise.landmarks_r.map((i) => lm[i])
    const use = Math.min(...tri.map((p) => p.visibility ?? 1)) >= Math.min(...triR.map((p) => p.visibility ?? 1)) ? tri : triR
    const [A, B, C] = use.map(P)
    const a1 = Math.atan2(A.y - B.y, A.x - B.x), a2 = Math.atan2(C.y - B.y, C.x - B.x)
    let d = a2 - a1
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const rad = unit * 12
    ctx.fillStyle = hexA(accent, 0.22)
    ctx.strokeStyle = accent
    ctx.lineWidth = unit
    ctx.shadowColor = accent; ctx.shadowBlur = unit * 6
    ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.arc(B.x, B.y, rad, a1, a1 + d, d < 0); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.shadowBlur = 0
    ctx.beginPath(); ctx.arc(B.x, B.y, unit * 3, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill()

    const label = `${Math.round(angle)}°`
    ctx.font = `700 ${Math.round(unit * 8)}px "JetBrains Mono", monospace`
    const tw = ctx.measureText(label).width
    const lx = B.x + rad * 0.9, ly = B.y - rad * 0.9
    ctx.fillStyle = 'rgba(5,8,18,0.72)'
    roundRect(ctx, lx - unit * 3, ly - unit * 9, tw + unit * 6, unit * 12, unit * 3); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly)
    ctx.font = `600 ${Math.round(unit * 4)}px "Space Grotesk", sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(exercise.joint_label.toUpperCase(), lx, ly + unit * 6)
  }
  return r
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
