import { BONES, LEFT } from './pose'

// LUT térmico azul → cian → verde → amarillo → rojo
const LUT = (() => {
  const stops = [[0, [30, 40, 220]], [0.3, [20, 200, 240]], [0.5, [40, 220, 120]], [0.7, [250, 220, 40]], [1, [255, 40, 40]]]
  const out = []
  for (let i = 0; i < 64; i++) {
    const t = i / 63
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1]
    const f = (t - t0) / (t1 - t0)
    out.push(c0.map((c, j) => Math.round(c + (c1[j] - c) * f)))
  }
  return out
})()
export const heatColor = (t, a = 1) => {
  const [r, g, b] = LUT[Math.max(0, Math.min(63, Math.round(t * 63)))]
  return `rgba(${r},${g},${b},${a})`
}

/** Transformación video → lienzo (cover/contain). */
export function frameRect(vw, vh, W, H, fit) {
  const s = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh)
  const w = vw * s, h = vh * s
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

export function projector(r, mirror) {
  return (p) => ({ x: r.x + (mirror ? 1 - p.x : p.x) * r.w, y: r.y + p.y * r.h })
}

export function drawVideo(ctx, video, r, W, H, mirror) {
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1) }
  ctx.drawImage(video, mirror ? W - r.x - r.w : r.x, r.y, r.w, r.h)
  ctx.restore()
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(4,6,14,0.55)'); g.addColorStop(0.22, 'rgba(4,6,14,0)')
  g.addColorStop(0.72, 'rgba(4,6,14,0)'); g.addColorStop(1, 'rgba(4,6,14,0.7)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}

const vis = (p) => (p?.visibility ?? 1) >= 0.4

/** Mapa térmico sobre las extremidades. segHeat(a,b) → 0..1 por hueso. */
export function drawThermal(ctx, lm, P, segHeat, torsoHeat) {
  if (!lm) return
  const s1 = P(lm[11]), s2 = P(lm[12])
  const sw = Math.hypot(s1.x - s2.x, s1.y - s2.y) || 80
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  // torso
  if ([11, 12, 23, 24].every((i) => vis(lm[i]))) {
    const q = [11, 12, 24, 23].map((i) => P(lm[i]))
    ctx.fillStyle = heatColor(torsoHeat, 0.35)
    ctx.strokeStyle = heatColor(torsoHeat, 0.25)
    ctx.lineWidth = sw * 0.35
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath()
    ctx.fill(); ctx.stroke()
  }
  for (const [a, b] of BONES) {
    if (a === 11 && b === 12) continue
    if (!vis(lm[a]) || !vis(lm[b])) continue
    const A = P(lm[a]), B = P(lm[b])
    const h = segHeat(a, b)
    const leg = a >= 23
    const w = sw * (leg ? 0.42 : a >= 15 ? 0.2 : 0.3)
    ctx.strokeStyle = heatColor(h, 0.18)
    ctx.lineWidth = w * 1.5
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
    ctx.strokeStyle = heatColor(h, 0.42)
    ctx.lineWidth = w
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
  }
  ctx.restore()
}

export function drawSkeleton(ctx, lm, P, unit) {
  if (!lm) return
  ctx.save()
  ctx.lineCap = 'round'
  for (const [a, b] of BONES) {
    if (!vis(lm[a]) || !vis(lm[b])) continue
    const A = P(lm[a]), B = P(lm[b])
    const side = LEFT.has(a) && LEFT.has(b) ? '#fb923c' : !LEFT.has(a) && !LEFT.has(b) && a > 12 ? '#60a5fa' : '#ffffff'
    ctx.strokeStyle = side
    ctx.shadowColor = side; ctx.shadowBlur = unit * 3
    ctx.lineWidth = unit * 1.3
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.fillStyle = '#fff'
  for (let i = 11; i <= 28; i++) {
    if (!vis(lm[i])) continue
    const q = P(lm[i])
    ctx.beginPath(); ctx.arc(q.x, q.y, unit * 1.4, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

export function drawAngle(ctx, lm, P, exercise, angle, accent, unit) {
  if (!lm || !exercise || angle == null) return
  const tri = exercise.landmarks_l.map((i) => lm[i])
  const triR = exercise.landmarks_r.map((i) => lm[i])
  const vmin = (t) => Math.min(...t.map((p) => p.visibility ?? 1))
  const [A, B, C] = (vmin(tri) >= vmin(triR) ? tri : triR).map(P)
  const a1 = Math.atan2(A.y - B.y, A.x - B.x), a2 = Math.atan2(C.y - B.y, C.x - B.x)
  let d = a2 - a1
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  const rad = unit * 12
  ctx.save()
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
  ctx.restore()
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
