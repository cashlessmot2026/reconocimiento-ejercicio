// Motor de boxeo: detecta, clasifica y mide golpes con los landmarks 3D (metros)
// de MediaPipe (worldLandmarks, origen en la cadera; x, y hacia abajo, z hacia la cámara negativo).
//
// Numeración estándar:  1 Jab · 2 Directo · 3 Gancho adelante · 4 Gancho atrás
//                       5 Uppercut adelante · 6 Uppercut atrás

export const PUNCH_IDS = { 1: 'jab', 2: 'cross', 3: 'lead_hook', 4: 'rear_hook', 5: 'lead_upper', 6: 'rear_upper' }
export const PUNCH_COLORS = { 1: '#22d3ee', 2: '#a78bfa', 3: '#f59e0b', 4: '#fb7185', 5: '#34d399', 6: '#60a5fa' }

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const len = (v) => Math.hypot(v.x, v.y, v.z)
const angle3 = (a, b, c) => {
  const u = sub(a, b), w = sub(c, b)
  const m = len(u) * len(w)
  return m ? (Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y + u.z * w.z) / m))) * 180) / Math.PI : 180
}
const ARMS = { L: { sh: 11, el: 13, wr: 15 }, R: { sh: 12, el: 14, wr: 16 } }

export function createBoxer({ stance = 'orthodox', sensitivity = 1 } = {}) {
  const lead = stance === 'southpaw' ? 'R' : 'L'
  const V_START = 1.2 / sensitivity   // m/s para iniciar un golpe
  const V_MIN = 1.8 / sensitivity     // velocidad pico mínima para validarlo
  const V_END = 0.8
  const MIN_DISP = 0.14 / sensitivity // desplazamiento mínimo (m)

  const arms = {
    L: { phase: 'guard', armLen: 0.55, prev: null, prevT: 0, speed: 0 },
    R: { phase: 'guard', armLen: 0.55, prev: null, prevT: 0, speed: 0 },
  }
  const s = {
    total: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    clean: 0, speeds: [], peak: 0, last: null, log: [],
    guardMs: 0, trackedMs: 0, inGuard: false, visible: false,
    armSpeed: { L: 0, R: 0 }, heat: { L: 0, R: 0 },
  }
  let lastT = null
  const pending = [] // golpes esperando volver a la guardia para evaluar limpieza

  function update(lm, world, t, onPunch) {
    const dtAll = lastT == null ? 0 : (t - lastT) / 1000
    lastT = t
    s.heat.L = Math.max(0, s.heat.L - dtAll * 0.08)
    s.heat.R = Math.max(0, s.heat.R - dtAll * 0.08)
    if (!lm || !world) { s.visible = false; return s }
    const need = [11, 12, 13, 14, 15, 16]
    if (need.some((i) => (lm[i].visibility ?? 1) < 0.35)) { s.visible = false; return s }
    s.visible = true

    const shMid = { x: (world[11].x + world[12].x) / 2, y: (world[11].y + world[12].y) / 2, z: (world[11].z + world[12].z) / 2 }

    for (const side of ['L', 'R']) {
      const A = arms[side], ix = ARMS[side]
      const sh = world[ix.sh], el = world[ix.el], wr = world[ix.wr]
      const r = sub(wr, sh)
      const L = len(sub(sh, el)) + len(sub(el, wr))
      A.armLen = Math.max(0.35, A.armLen * 0.98 + Math.max(A.armLen, L) * 0.02)
      const ext = Math.min(1.1, len(r) / A.armLen)
      const dt = A.prev ? (t - A.prevT) / 1000 : 0
      let v = { x: 0, y: 0, z: 0 }, speed = 0
      if (A.prev && dt > 0 && dt < 0.25) {
        v = { x: (r.x - A.prev.x) / dt, y: (r.y - A.prev.y) / dt, z: (r.z - A.prev.z) / dt }
        speed = len(v)
      }
      A.prev = r; A.prevT = t
      A.speed = speed
      s.armSpeed[side] = speed
      const inSign = Math.sign(shMid.x - sh.x) || 1

      if (A.phase === 'guard') {
        if (speed > V_START && t - (A.endT || 0) > 120) {
          A.phase = 'out'
          A.t0 = t; A.start = r; A.peakSpeed = speed
          A.maxFwd = 0; A.maxUp = 0; A.maxIn = 0; A.maxDisp = 0
          A.peakExt = ext; A.elbowAtPeak = angle3(sh, el, wr)
          A.peakImg = { x: lm[ix.wr].x, y: lm[ix.wr].y }
        }
      } else {
        const D = sub(r, A.start)
        A.peakSpeed = Math.max(A.peakSpeed, speed)
        A.maxFwd = Math.max(A.maxFwd, -D.z)
        A.maxUp = Math.max(A.maxUp, -D.y)
        A.maxIn = Math.max(A.maxIn, D.x * inSign)
        A.maxDisp = Math.max(A.maxDisp, len(D))
        if (ext >= A.peakExt) {
          A.peakExt = ext
          A.elbowAtPeak = angle3(sh, el, wr)
          A.peakImg = { x: lm[ix.wr].x, y: lm[ix.wr].y }
        }
        const elapsed = t - A.t0
        if ((speed < V_END && elapsed > 90) || elapsed > 900) {
          A.phase = 'guard'; A.endT = t
          if (A.peakSpeed >= V_MIN && A.maxDisp >= MIN_DISP) emit(side, A, t, onPunch)
        }
      }
    }

    // Guardia: muñecas a la altura de la cara, cerca del centro, sin golpe en curso
    const nose = lm[0], shY = (lm[11].y + lm[12].y) / 2
    const span = Math.abs(lm[11].x - lm[12].x) || 0.2
    const handUp = (w) => w.y < shY + span * 0.25 && Math.abs(w.x - nose.x) < span * 1.15
    const guard = handUp(lm[15]) && handUp(lm[16])
    s.inGuard = guard
    if (dtAll > 0 && dtAll < 0.25 && arms.L.phase === 'guard' && arms.R.phase === 'guard') {
      s.trackedMs += dtAll * 1000
      if (guard) s.guardMs += dtAll * 1000
    }

    // Limpieza: el puño debe volver a la guardia antes de 700 ms
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]
      const A = arms[p.side]
      const ix = ARMS[p.side]
      const ext = len(sub(world[ix.wr], world[ix.sh])) / A.armLen
      if (ext < 0.62 || handUp(lm[ix.wr])) {
        p.punch.retract_ms = Math.round(t - p.t)
        p.punch.clean = p.techOk && p.punch.retract_ms <= 700
        if (p.punch.clean) s.clean++
        pending.splice(i, 1)
      } else if (t - p.t > 1000) {
        p.punch.clean = false
        pending.splice(i, 1)
      }
    }
    return s
  }

  function emit(side, A, t, onPunch) {
    const isLead = side === lead
    const fwd = A.maxFwd, up = A.maxUp, lat = A.maxIn, elbow = A.elbowAtPeak
    let kind
    if (up > 0.09 && up > 0.75 * Math.max(fwd, lat) && elbow < 140) kind = 'upper'
    else if (lat > 0.09 && lat > 0.85 * fwd && elbow < 145) kind = 'hook'
    else kind = 'straight'
    const num = kind === 'straight' ? (isLead ? 1 : 2) : kind === 'hook' ? (isLead ? 3 : 4) : isLead ? 5 : 6
    const techOk = kind === 'straight' ? A.peakExt >= 0.82 && elbow >= 140 : elbow >= 55 && elbow <= 140
    const punch = {
      n: ++s.total, num, id: PUNCH_IDS[num], side, kind,
      speed: +A.peakSpeed.toFixed(2), ext: +A.peakExt.toFixed(2), elbow: Math.round(elbow),
      dur_ms: Math.round(t - A.t0), at: t, img: A.peakImg, clean: null,
    }
    s.counts[num]++
    s.speeds.push(punch.speed)
    s.peak = Math.max(s.peak, punch.speed)
    s.last = punch
    s.log.push(punch)
    if (s.log.length > 400) s.log.shift()
    s.heat[side] = Math.min(1, s.heat[side] + 0.12)
    pending.push({ side, t, punch, techOk })
    onPunch?.(punch)
  }

  function summary() {
    const n = s.total
    const avg = n ? s.speeds.reduce((a, b) => a + b, 0) / n : null
    return {
      total: n,
      counts: Object.fromEntries(Object.entries(s.counts).map(([k, v]) => [PUNCH_IDS[k], v])),
      clean: s.clean,
      avg_speed: avg,
      peak_speed: n ? s.peak : null,
      guard_pct: s.trackedMs > 0 ? (s.guardMs / s.trackedMs) * 100 : null,
      log: s.log.map(({ img, at, ...p }) => p),
    }
  }

  return { state: s, update, summary, lead }
}
