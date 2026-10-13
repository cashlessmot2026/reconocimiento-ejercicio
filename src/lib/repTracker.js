// Motor de conteo de repeticiones basado en ángulos articulares.
// Cada ejercicio (desde la BD) define el triángulo A-B-C de landmarks,
// el ángulo de reposo (rest_angle) y el de máxima contracción (peak_angle).

const TORSO_M = 0.5 // longitud aproximada hombro→cadera (m) para escalar velocidad

export function angleAt(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y
  const cbx = c.x - b.x, cby = c.y - b.y
  const dot = abx * cbx + aby * cby
  const m = Math.hypot(abx, aby) * Math.hypot(cbx, cby)
  if (!m) return null
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI
}

const vis = (p) => (p?.visibility ?? 1)
const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })

export function createTracker(exercise, { aspect = 1 } = {}) {
  const rest = Number(exercise.rest_angle)
  const peak = Number(exercise.peak_angle)
  const span = rest - peak

  const s = {
    reps: 0,
    phase: 'idle',
    angle: null,
    progress: 0,
    speed: 0,          // m/s del punto más móvil
    peakSpeedRep: 0,
    fatigue: 0,
    form: 100,
    tilt: 0,
    side: 'L',
    trace: [],         // historial de progreso (0..1) para el gráfico
    repLog: [],
    lastRep: null,
    visible: false,
  }

  let ema = null
  let lastT = null
  let lastPts = null
  let repStart = 0, peakAt = 0
  let peakReached = false
  let minA = Infinity, maxA = -Infinity, maxP = 0
  let swayMin = Infinity, swayMax = -Infinity
  let tiltSum = 0, tiltN = 0
  let bestSpeeds = []
  let restExtreme = null // ángulo más cercano al reposo antes de iniciar la rep

  function update(lm, t) {
    if (!lm) {
      s.visible = false
      if (s.phase !== 'idle') s.phase = 'lost'
      return s
    }
    const [la, lb, lc] = exercise.landmarks_l.map((i) => lm[i])
    const [ra, rb, rc] = exercise.landmarks_r.map((i) => lm[i])
    const vL = Math.min(vis(la), vis(lb), vis(lc))
    const vR = Math.min(vis(ra), vis(rb), vis(rc))
    if (Math.max(vL, vR) < 0.45) {
      s.visible = false
      if (s.phase !== 'idle') s.phase = 'lost'
      return s
    }
    s.visible = true

    // Escala con aspecto para que los ángulos sean reales en pantalla
    const sc = (p) => ({ x: p.x * aspect, y: p.y })
    const aL = angleAt(sc(la), sc(lb), sc(lc))
    const aR = angleAt(sc(ra), sc(rb), sc(rc))
    let raw
    if (vL > 0.6 && vR > 0.6 && aL != null && aR != null) { raw = (aL + aR) / 2; s.side = 'LR' }
    else if (vL >= vR) { raw = aL; s.side = 'L' }
    else { raw = aR; s.side = 'R' }
    if (raw == null) return s

    ema = ema == null ? raw : ema + (raw - ema) * 0.75 // los landmarks ya vienen filtrados (One-Euro)
    s.angle = ema
    const p = Math.max(0, Math.min(1, (rest - ema) / span))
    s.progress = p

    // Velocidad: el punto del triángulo que más se mueve
    const torso = Math.hypot((lm[11].x - lm[23].x) * aspect, lm[11].y - lm[23].y) || 0.3
    const pts = [la, lb, lc, ra, rb, rc]
    if (lastPts && lastT != null && t > lastT) {
      const dt = (t - lastT) / 1000
      let v = 0
      pts.forEach((q, i) => {
        const d = Math.hypot((q.x - lastPts[i].x) * aspect, q.y - lastPts[i].y)
        v = Math.max(v, d / dt)
      })
      const mps = (v / torso) * TORSO_M
      s.speed = s.speed + (Math.min(mps, 4) - s.speed) * 0.3
    }
    lastPts = pts.map((q) => ({ x: q.x, y: q.y }))
    lastT = t

    // Inclinación del torso respecto a la vertical
    const sh = mid(lm[11], lm[12]), hp = mid(lm[23], lm[24])
    const tilt = Math.abs((Math.atan2((sh.x - hp.x) * aspect, hp.y - sh.y) * 180) / Math.PI)
    s.tilt = tilt
    tiltSum += tilt; tiltN++

    // Balanceo (sway) horizontal de la cadera durante la rep
    swayMin = Math.min(swayMin, hp.x * aspect); swayMax = Math.max(swayMax, hp.x * aspect)

    minA = Math.min(minA, ema); maxA = Math.max(maxA, ema); maxP = Math.max(maxP, p)
    s.peakSpeedRep = Math.max(s.peakSpeedRep, s.speed)

    // Máquina de estados con histéresis
    switch (s.phase) {
      case 'idle':
      case 'lost':
      case 'rest':
        // Solo se arranca una rep desde la posición inicial (reposo)
        if (p < 0.25) {
          s.phase = 'rest'
          if (restExtreme == null || Math.abs(ema - peak) > Math.abs(restExtreme - peak)) restExtreme = ema
        }
        else if (s.phase === 'rest') startRep(t)
        break
      case 'concentric':
        if (p >= 0.85) { s.phase = 'hold'; peakReached = true; peakAt = t }
        else if (p < 0.12) s.phase = 'rest' // rep abortada
        break
      case 'hold':
        if (p < 0.75) s.phase = 'eccentric'
        break
      case 'eccentric':
        if (p >= 0.85) s.phase = 'hold'
        else if (p < 0.2) finishRep(t, torso)
        break
    }

    s.trace.push(p)
    if (s.trace.length > 240) s.trace.shift()
    return s
  }

  function startRep(t) {
    s.phase = 'concentric'
    repStart = t
    peakReached = false
    minA = Math.min(Infinity, restExtreme ?? Infinity); maxA = Math.max(-Infinity, restExtreme ?? -Infinity); maxP = 0
    restExtreme = null
    swayMin = Infinity; swayMax = -Infinity
    s.peakSpeedRep = 0
  }

  function finishRep(t, torso) {
    s.phase = 'rest'
    if (!peakReached) return
    s.reps++
    const up = (peakAt - repStart) / 1000
    const down = (t - peakAt) / 1000
    const rom = maxA - minA
    const sway = ((swayMax - swayMin) / torso) * TORSO_M * 100 // cm
    bestSpeeds.push(s.peakSpeedRep)
    const ref = Math.max(...bestSpeeds.slice(0, 2))
    const fatigue = ref > 0 ? Math.max(0, (1 - s.peakSpeedRep / ref) * 100) : 0
    s.fatigue = fatigue
    // Técnica: rango completo + control excéntrico + poco balanceo
    const romScore = Math.min(1, maxP) * 50
    const tempoScore = Math.min(1, down / Math.max(0.4, up)) * 25
    const swayScore = Math.max(0, 1 - sway / 25) * 25
    const form = Math.round(romScore + tempoScore + swayScore)
    const rep = {
      n: s.reps, up: +up.toFixed(2), down: +down.toFixed(2), rom: +rom.toFixed(1),
      min: +minA.toFixed(1), max: +maxA.toFixed(1), peak_speed: +s.peakSpeedRep.toFixed(2),
      sway_cm: +sway.toFixed(1), form, fatigue: +fatigue.toFixed(1), at: Date.now(),
    }
    s.repLog.push(rep)
    s.lastRep = rep
    s.form = Math.round(s.repLog.reduce((a, r) => a + r.form, 0) / s.repLog.length)
  }

  function summary() {
    const log = s.repLog
    const avg = (f) => (log.length ? log.reduce((a, r) => a + f(r), 0) / log.length : null)
    return {
      reps: s.reps,
      min_angle: log.length ? Math.min(...log.map((r) => r.min)) : null,
      max_angle: log.length ? Math.max(...log.map((r) => r.max)) : null,
      avg_rom: avg((r) => r.rom),
      avg_rep_sec: avg((r) => r.up + r.down),
      peak_speed: log.length ? Math.max(...log.map((r) => r.peak_speed)) : null,
      fatigue_pct: s.fatigue,
      form_score: log.length ? s.form : null,
      torso_tilt: tiltN ? tiltSum / tiltN : null,
      rep_log: log,
    }
  }

  function setAspect(a) { aspect = a }

  return { state: s, update, summary, setAspect }
}
