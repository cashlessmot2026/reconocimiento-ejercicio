// Utilidades para comparar curvas de movimiento (progreso 0..1 en el tiempo).

export const CURVE_N = 40

/** Remuestrea (ts, vs) a n puntos equiespaciados en el tiempo normalizado de la repetición. */
export function resample(ts, vs, n = CURVE_N) {
  const out = new Array(n)
  const m = ts.length
  if (m === 0) return out.fill(0)
  if (m === 1) return out.fill(vs[0])
  const t0 = ts[0], t1 = ts[m - 1]
  const span = t1 - t0 || 1
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = t0 + (span * k) / (n - 1)
    while (j < m - 2 && ts[j + 1] < t) j++
    const a = ts[j], b = ts[j + 1]
    const f = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0
    out[k] = vs[j] + (vs[j + 1] - vs[j]) * f
  }
  return out
}

export function rmse(a, b) {
  const n = Math.min(a.length, b.length)
  if (!n) return 1
  let s = 0
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s / n)
}

/** Similitud 0..100 entre una repetición (muestras {t,p}) y la curva modelo. */
export function curveMatch(template, samples) {
  if (!template?.length || !samples || samples.length < 3) return null
  const ts = samples.map((s) => s.t)
  const ps = samples.map((s) => Math.max(0, Math.min(1, s.p)))
  const r = rmse(resample(ts, ps, template.length), template)
  return Math.round(Math.max(0, Math.min(1, 1 - r / 0.35)) * 100)
}
