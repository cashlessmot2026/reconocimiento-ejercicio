// Filtro One-Euro (Casiez et al.): suaviza el temblor en reposo sin añadir retraso
// en movimientos rápidos. Se aplica a cada coordenada de los 33 landmarks.

const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff
    this.x = null; this.dx = 0
  }
  filter(v, dt) {
    if (this.x == null || !(dt > 0)) { this.x = v; this.dx = 0; return v }
    const dv = (v - this.x) / dt
    this.dx += alpha(this.dCutoff, dt) * (dv - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += alpha(cutoff, dt) * (v - this.x)
    return this.x
  }
}

/** Filtro para un conjunto de landmarks {x,y,z,visibility}. */
export function createLandmarkFilter({ minCutoff = 1.0, beta = 6, keys = ['x', 'y', 'z'] } = {}) {
  let filters = null
  let lastT = null
  return {
    apply(points, tMs) {
      if (!points) { lastT = null; filters = null; return null }
      const dt = lastT == null ? 0 : (tMs - lastT) / 1000
      lastT = tMs
      if (!filters || dt > 0.5) filters = points.map(() => keys.map(() => new OneEuro(minCutoff, beta)))
      return points.map((p, i) => {
        const o = { visibility: p.visibility }
        keys.forEach((k, j) => { o[k] = filters[i][j].filter(p[k], dt) })
        return o
      })
    },
    reset() { filters = null; lastT = null },
  }
}
