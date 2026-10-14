// Aprendizaje de un ejercicio a partir de una demostración grabada con la cámara.
//
// Entrada: fotogramas con 17 puntos del cuerpo (x, y, visibilidad).
// Salida: la articulación que define el movimiento, sus ángulos de reposo y de máxima contracción,
//         la curva modelo de una repetición, el tempo y un esqueleto animado para mostrar al cliente.
// Todo se calcula en el navegador: no se envía ninguna imagen a ningún servidor.

import { CURVE_N, resample, rmse } from './curve'

/** Puntos que se conservan (cara + tronco + extremidades). */
export const GHOST_IDX = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 31, 32]
const POS = Object.fromEntries(GHOST_IDX.map((id, i) => [id, i]))
export const GHOST_FRAMES = 32

export const JOINTS = [
  { key: 'knee', label: 'Rodilla', l: [23, 25, 27], r: [24, 26, 28], w: 1.25 },
  { key: 'elbow', label: 'Codo', l: [11, 13, 15], r: [12, 14, 16], w: 1.25 },
  { key: 'hip', label: 'Cadera', l: [11, 23, 25], r: [12, 24, 26], w: 1.0 },
  { key: 'shoulder', label: 'Hombro', l: [23, 11, 13], r: [24, 12, 14], w: 0.9 },
]

/** Convierte los 33 landmarks de MediaPipe en un fotograma compacto de la demostración. */
export function packFrame(lm, t) {
  const x = new Array(GHOST_IDX.length), y = new Array(GHOST_IDX.length), v = new Array(GHOST_IDX.length)
  GHOST_IDX.forEach((id, i) => { x[i] = lm[id].x; y[i] = lm[id].y; v[i] = lm[id].visibility ?? 1 })
  return { t, x, y, v }
}

const median = (a) => {
  const s = [...a].sort((p, q) => p - q)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null
}
const percentile = (a, q) => {
  const s = [...a].sort((p, r) => p - r)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

function angle(fr, tri, aspect) {
  const [ia, ib, ic] = tri.map((id) => POS[id])
  if (Math.min(fr.v[ia], fr.v[ib], fr.v[ic]) < 0.5) return null
  const ax = fr.x[ia] * aspect - fr.x[ib] * aspect, ay = fr.y[ia] - fr.y[ib]
  const cx = fr.x[ic] * aspect - fr.x[ib] * aspect, cy = fr.y[ic] - fr.y[ib]
  const m = Math.hypot(ax, ay) * Math.hypot(cx, cy)
  if (!m) return null
  return (Math.acos(Math.max(-1, Math.min(1, (ax * cx + ay * cy) / m))) * 180) / Math.PI
}

function fillGaps(a) {
  const n = a.length
  let valid = 0
  for (const v of a) if (v != null) valid++
  if (valid < n * 0.6 || valid < 8) return null
  const out = [...a]
  let last = -1
  for (let i = 0; i < n; i++) {
    if (out[i] == null) continue
    if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) out[k] = out[last] + ((out[i] - out[last]) * (k - last)) / (i - last)
    else if (last < 0) for (let k = 0; k < i; k++) out[k] = out[i]
    last = i
  }
  for (let k = last + 1; k < n; k++) out[k] = out[last]
  return out
}

const smooth = (a, w = 5) => a.map((_, i) => {
  let s = 0, c = 0
  for (let k = Math.max(0, i - (w >> 1)); k <= Math.min(a.length - 1, i + (w >> 1)); k++) { s += a[k]; c++ }
  return s / c
})

/** Segmenta repeticiones con la misma lógica de histéresis que el contador en vivo. */
function segment(a, rest, peak) {
  const span = rest - peak
  const p = a.map((v) => (rest - v) / span)
  const reps = []
  let state = 1, s = 0, pk = 0, lastLow = 0
  for (let i = 0; i < p.length; i++) {
    const v = p[i]
    if (state === 1) {
      if (v < 0.2) lastLow = i
      else if (v >= 0.25) { state = 2; s = i }
    } else if (state === 2) {
      if (v >= 0.85) { state = 3; pk = i }
      else if (v < 0.2) { state = 1; lastLow = i }
    } else if (state === 3) {
      if (v > p[pk]) pk = i
      if (v < 0.2) { reps.push({ s, e: i, pk }); state = 1; lastLow = i }
    }
  }
  return { reps, p }
}

/**
 * @param frames  [{t(ms), x[], y[], v[]}]
 * @param aspect  ancho/alto del video
 * @param opts    { invert: boolean, joint: 'knee'|'elbow'|'hip'|'shoulder' }
 */
export function analyzeDemo(frames, aspect = 1, opts = {}) {
  const warnings = []
  if (!frames || frames.length < 20) return { error: 'La grabación es demasiado corta. Graba al menos 3 repeticiones completas.' }
  const t0 = frames[0].t
  const ts = frames.map((f) => (f.t - t0) / 1000)
  const dur = ts[ts.length - 1]
  if (dur < 3) return { error: 'La grabación es demasiado corta. Graba al menos 3 repeticiones completas.' }

  // 1) Señal angular de cada articulación (promedio de ambos lados cuando se ven)
  const cands = []
  for (const j of JOINTS) {
    const raw = frames.map((fr) => {
      const L = angle(fr, j.l, aspect), R = angle(fr, j.r, aspect)
      if (L != null && R != null) return (L + R) / 2
      return L ?? R
    })
    const filled = fillGaps(raw)
    if (!filled) continue
    const a = smooth(filled)
    const lo = percentile(a, 0.05), hi = percentile(a, 0.95)
    cands.push({ ...j, a, lo, hi, range: hi - lo, score: (hi - lo) * j.w, visible: raw.filter((v) => v != null).length / raw.length })
  }
  if (!cands.length) return { error: 'No se ven las articulaciones con claridad. Colócate con el cuerpo completo en el encuadre y buena luz.' }

  const usable = cands.filter((c) => c.range >= 25)
  if (!usable.length) return { error: 'No detecté un movimiento amplio. Realiza el ejercicio con el recorrido completo, de forma clara.' }
  let best = [...usable].sort((p, q) => q.score - p.score)[0]
  if (opts.joint) best = usable.find((c) => c.key === opts.joint) || best
  const a = best.a

  // 2) Posición inicial (reposo): el extremo más cercano a donde empezó el coach
  const headN = Math.max(6, Math.round(frames.length * 0.08))
  const start = median(a.slice(0, headN))
  const fixed = opts.fixedRest != null && opts.fixedPeak != null
  let rest, peak
  if (fixed) {
    // Ejercicio que ya tiene sus ángulos: la orientación sale de ellos, no de dónde empezó el coach
    const restHigh = opts.fixedRest > opts.fixedPeak
    rest = restHigh ? best.hi : best.lo
    peak = restHigh ? best.lo : best.hi
  } else {
    rest = Math.abs(start - best.lo) <= Math.abs(start - best.hi) ? best.lo : best.hi
    peak = rest === best.lo ? best.hi : best.lo
    if (opts.invert) [rest, peak] = [peak, rest]
  }

  // 3) Repeticiones
  let { reps } = segment(a, rest, peak)
  if (reps.length < 2) {
    return { error: `Solo detecté ${reps.length} repetición${reps.length === 1 ? '' : 'es'}. Haz al menos 3 repeticiones completas y seguidas, sin pausas largas.`, joint: best.label }
  }
  if (reps.length < 3) warnings.push('Solo se detectaron 2 repeticiones: con 3 o más el modelo es más fiable.')

  // 4) Ángulos aprendidos (robustos: mediana entre repeticiones)
  // Reposo real: el extremo de reposo alrededor de cada repetición (no el punto donde ya empezó a moverse)
  const fps = frames.length / dur
  const W = Math.max(3, Math.round(fps * 0.6))
  const restIsHigh = rest > peak
  const restAngle = median(reps.map((r) => {
    const w = a.slice(Math.max(0, r.s - W), Math.min(a.length, r.e + W + 1))
    return restIsHigh ? Math.max(...w) : Math.min(...w)
  }))
  const extreme = median(reps.map((r) => a[r.pk]))
  const rom = Math.abs(restAngle - extreme)
  if (rom < 20) warnings.push('El recorrido del movimiento es corto (menos de 20°).')
  // El umbral de máxima contracción se fija al 90 % del recorrido del coach: tolera pequeñas diferencias
  const peakAngle = restAngle + 0.9 * (extreme - restAngle)

  // 5) Curva modelo en las mismas unidades de progreso que usa el contador en vivo
  const restUse = fixed ? opts.fixedRest : restAngle
  const peakUse = fixed ? opts.fixedPeak : peakAngle
  const span = restUse - peakUse
  const prog = (v) => Math.max(0, Math.min(1, (restUse - v) / span))
  const curves = reps.map((r) => resample(ts.slice(r.s, r.e + 1), a.slice(r.s, r.e + 1).map(prog), CURVE_N))
  const template = curves[0].map((_, i) => curves.reduce((s, c) => s + c[i], 0) / curves.length)
  const dists = curves.map((c) => rmse(c, template))
  const meanDist = dists.reduce((s, d) => s + d, 0) / dists.length
  if (meanDist > 0.2) warnings.push('Las repeticiones son poco consistentes entre sí. Graba de nuevo con un ritmo parejo.')

  // 6) Tempo
  const ups = reps.map((r) => ts[r.pk] - ts[r.s])
  const downs = reps.map((r) => ts[r.e] - ts[r.pk])
  const tempo = { up: +median(ups).toFixed(2), down: +median(downs).toFixed(2) }
  tempo.total = +(tempo.up + tempo.down).toFixed(2)

  // 7) Esqueleto animado a partir de la repetición más representativa
  const bestIdx = dists.indexOf(Math.min(...dists))
  const model = reps[bestIdx]
  const ghost = buildGhost(frames, ts, Math.max(0, model.s - 2), Math.min(frames.length - 1, model.e + 2), aspect)

  // 8) Calidad global del aprendizaje
  const consistency = Math.max(0, 1 - meanDist / 0.25)
  const quality = Math.round(100 * (0.5 * consistency + 0.3 * Math.min(1, reps.length / 4) + 0.2 * best.visible))

  // serie para la gráfica de vista previa
  const step = Math.max(1, Math.floor(a.length / 160))
  const chart = a.filter((_, i) => i % step === 0).map((v, i) => ({ t: +ts[i * step].toFixed(2), angle: +v.toFixed(1) }))

  return {
    joint: { key: best.key, label: best.label, l: best.l, r: best.r },
    rest: +restUse.toFixed(1), peak: +peakUse.toFixed(1), learnedRest: +restAngle.toFixed(1), learnedPeak: +peakAngle.toFixed(1), extreme: +extreme.toFixed(1), rom: +rom.toFixed(1),
    reps: reps.length, repsAt: reps.map((r) => ({ s: +ts[r.s].toFixed(2), pk: +ts[r.pk].toFixed(2), e: +ts[r.e].toFixed(2) })),
    template: template.map((v) => +v.toFixed(3)),
    tempo, ghost, quality, warnings, chart, duration: +dur.toFixed(1),
    alternatives: usable.map((c) => ({ key: c.key, label: c.label, range: +c.range.toFixed(0) })),
    consistency: +meanDist.toFixed(3),
  }
}

function buildGhost(frames, ts, s, e, aspect) {
  const seg = frames.slice(s, e + 1)
  const tt = ts.slice(s, e + 1)
  const n = GHOST_FRAMES
  const P = GHOST_IDX.length
  // posición media de cadera y largo medio de tronco (en unidades con proporción real)
  let cx = 0, cy = 0, torso = 0
  for (const f of seg) {
    const sx = (f.x[POS[11]] + f.x[POS[12]]) / 2 * aspect, sy = (f.y[POS[11]] + f.y[POS[12]]) / 2
    const hx = (f.x[POS[23]] + f.x[POS[24]]) / 2 * aspect, hy = (f.y[POS[23]] + f.y[POS[24]]) / 2
    cx += hx; cy += hy; torso += Math.hypot(sx - hx, sy - hy)
  }
  cx /= seg.length; cy /= seg.length; torso = torso / seg.length || 0.25
  const frames_out = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = tt[0] + ((tt[tt.length - 1] - tt[0]) * k) / (n - 1)
    while (j < seg.length - 2 && tt[j + 1] < t) j++
    const a = seg[j], b = seg[Math.min(seg.length - 1, j + 1)]
    const f = tt[j + 1] > tt[j] ? Math.min(1, Math.max(0, (t - tt[j]) / (tt[j + 1] - tt[j]))) : 0
    const row = new Array(P * 2)
    for (let i = 0; i < P; i++) {
      const x = (a.x[i] + (b.x[i] - a.x[i]) * f) * aspect
      const y = a.y[i] + (b.y[i] - a.y[i]) * f
      row[i * 2] = +((x - cx) / torso).toFixed(3)
      row[i * 2 + 1] = +((y - cy) / torso).toFixed(3)
    }
    frames_out.push(row)
  }
  return { idx: GHOST_IDX, n, seconds: +(tt[tt.length - 1] - tt[0]).toFixed(2), frames: frames_out }
}
