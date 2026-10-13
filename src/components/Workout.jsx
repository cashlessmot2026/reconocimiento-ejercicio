import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { loadPoseLandmarker } from '../lib/pose'
import { createTracker } from '../lib/repTracker'
import { drawFrame } from '../lib/render'
import { GlowButton } from './ui'
import BodyMap from './BodyMap'

const PHASE_COLOR = {
  idle: '#cbd5e1', rest: '#cbd5e1', loading: '#fbbf24', concentric: '#34d399',
  hold: '#fbbf24', eccentric: '#60a5fa', lost: '#fb7185',
}

function speak(text, on) {
  if (!on || !('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-ES'; u.rate = 1.15
    speechSynthesis.cancel(); speechSynthesis.speak(u)
  } catch { /* sin voz */ }
}

export default function Workout({ boot, client, plan, onExit, notify }) {
  const { groups, phases } = boot
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const vpRef = useRef(null)
  const streamRef = useRef(null)
  const lmRef = useRef(null)
  const trackerRef = useRef(null)
  const rafRef = useRef(0)
  const statusRef = useRef('loading')
  const optsRef = useRef({})
  const savingRef = useRef(false)

  const [qi, setQi] = useState(0)
  const [setNum, setSetNum] = useState(1)
  const [status, setStatus] = useState('loading') // loading | ready | countdown | active | rest | done | error
  const [err, setErr] = useState('')
  const [facing, setFacing] = useState('user')
  const [fit, setFit] = useState('cover')
  const [showHeat, setShowHeat] = useState(true)
  const [sound, setSound] = useState(true)
  const [count, setCount] = useState(0)
  const [hud, setHud] = useState(null)
  const [log, setLog] = useState([])
  const [repFlash, setRepFlash] = useState(null)
  const [fps, setFps] = useState(0)

  const item = plan.queue[qi]
  const ex = item.exercise
  const accent = groups[ex.primary_group]?.color || '#22d3ee'
  const totalTarget = item.sets * item.reps

  statusRef.current = status
  const doneBefore = log.filter((l) => l.exercise_id === ex.id).reduce((a, l) => a + l.reps, 0)
  const heat = Math.min(1, 0.12 + ((doneBefore + (hud?.reps || 0)) / totalTarget) * 0.75 + (hud?.fatigue || 0) / 400)
  optsRef.current = { fit, showHeat, mirror: facing === 'user', heat, ex, accent }

  // ---------- Cámara ----------
  const startCamera = useCallback(async (mode) => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    streamRef.current = stream
    const v = videoRef.current
    v.srcObject = stream
    await v.play()
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se requiere HTTPS).')
        const [lm] = await Promise.all([loadPoseLandmarker(), startCamera(facing)])
        if (!alive) return
        lmRef.current = lm
        setStatus('ready')
      } catch (e) {
        if (!alive) return
        setErr(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en la configuración del navegador.' : e.message)
        setStatus('error')
      }
    })()
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flip = async () => {
    const next = facing === 'user' ? 'environment' : 'user'
    try { await startCamera(next); setFacing(next) } catch (e) { notify(e.message) }
  }

  // ---------- Tracker por serie ----------
  const newTracker = useCallback(() => { trackerRef.current = createTracker(ex) }, [ex])
  useEffect(() => { newTracker() }, [newTracker])

  // ---------- Bucle de visión ----------
  useEffect(() => {
    let lastVideoT = -1, lastHud = 0, frames = 0, fpsT = performance.now()
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const v = videoRef.current, c = canvasRef.current, lm = lmRef.current
      if (!v || !c || !lm || v.readyState < 2 || v.currentTime === lastVideoT) return
      lastVideoT = v.currentTime
      const now = performance.now()
      const W = c.width, H = c.height
      const ctx = c.getContext('2d')
      const o = optsRef.current
      lm.detectForVideo(v, now, (res) => {
        const pts = res.landmarks?.[0] || null
        const mask = res.segmentationMasks?.[0] || null
        const tr = trackerRef.current
        if (tr && statusRef.current === 'active') {
          tr.setAspect(v.videoWidth / v.videoHeight)
          const before = tr.state.reps
          tr.update(pts, now)
          if (tr.state.reps > before) onRep(tr.state)
        }
        drawFrame(ctx, {
          video: v, W, H, fit: o.fit, mirror: o.mirror, lm: pts, mask, heat: o.heat,
          exercise: o.ex, angle: tr?.state.angle ?? null, showHeat: o.showHeat, accent: o.accent,
        })
      })
      frames++
      if (now - fpsT > 1000) { setFps(frames); frames = 0; fpsT = now }
      if (now - lastHud > 80 && trackerRef.current) {
        lastHud = now
        const s = trackerRef.current.state
        setHud({ ...s, trace: s.trace.slice(-160) })
      }
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Lienzo nítido y adaptado al contenedor
  useEffect(() => {
    const el = vpRef.current
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const c = canvasRef.current
      c.width = Math.round(el.clientWidth * dpr)
      c.height = Math.round(el.clientHeight * dpr)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---------- Eventos de rep / serie ----------
  const onRepRef = useRef()
  onRepRef.current = (s) => {
    setRepFlash(s.reps)
    speak(String(s.reps), sound)
    if (s.reps >= item.reps) setTimeout(() => completeSetRef.current(), 650)
  }
  const onRep = (s) => onRepRef.current(s)

  const completeSetRef = useRef()
  completeSetRef.current = async () => {
    if (savingRef.current || statusRef.current !== 'active') return
    savingRef.current = true
    const tr = trackerRef.current
    const sum = tr.summary()
    const started = tr.startedAt || Date.now()
    if (sum.reps > 0) {
      const row = {
        client_code: client.code, exercise_id: ex.id, routine_id: item.routine_id || null,
        set_number: setNum, reps: sum.reps, target_reps: item.reps, incline_deg: item.incline_deg,
        torso_tilt: round(sum.torso_tilt), min_angle: round(sum.min_angle), max_angle: round(sum.max_angle),
        avg_rom: round(sum.avg_rom), avg_rep_sec: round(sum.avg_rep_sec, 2), peak_speed: round(sum.peak_speed, 2),
        fatigue_pct: round(sum.fatigue_pct), form_score: sum.form_score,
        kcal: round(sum.reps * Number(ex.kcal_per_rep) * (1 + Math.max(0, item.incline_deg) / 180), 2),
        duration_sec: round((Date.now() - started) / 1000), rep_log: sum.rep_log,
      }
      try {
        await api.saveSet(row)
        setLog((l) => [...l, row])
        notify(`✓ Serie ${setNum} guardada · ${sum.reps} reps`)
      } catch (e) { notify('Error guardando: ' + e.message) }
    }
    savingRef.current = false
    if (setNum < item.sets) {
      speak('Serie completada. Descansa.', sound)
      setStatus('rest')
      setCount(item.rest_sec)
    } else if (qi < plan.queue.length - 1) {
      speak('Ejercicio completado', sound)
      setStatus('rest')
      setCount(item.rest_sec)
      setSetNum(-1) // marca: pasar al siguiente ejercicio tras el descanso
    } else {
      speak('Entrenamiento completado. ¡Excelente!', sound)
      setStatus('done')
    }
  }

  // Cuenta regresiva (inicio y descanso)
  useEffect(() => {
    if (status !== 'countdown' && status !== 'rest') return
    if (count <= 0) {
      if (status === 'rest') {
        if (setNum === -1) { setQi((q) => q + 1); setSetNum(1) } else setSetNum((n) => n + 1)
        setStatus('countdown'); setCount(3)
      } else {
        trackerRef.current = createTracker(plan.queue[qi].exercise)
        trackerRef.current.startedAt = Date.now()
        setHud(null); setRepFlash(null)
        speak('Adelante', sound)
        setStatus('active')
      }
      return
    }
    if (status === 'countdown') speak(String(count), sound)
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [status, count]) // eslint-disable-line react-hooks/exhaustive-deps

  const exit = async () => {
    if (statusRef.current === 'active' && trackerRef.current?.state.reps > 0) await completeSetRef.current()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onExit()
  }

  const s = hud
  const kcalNow = log.reduce((a, r) => a + r.kcal, 0) + (s?.reps || 0) * Number(ex.kcal_per_rep)
  const groupLoads = useMemo(() => {
    const l = {}
    ex.muscles.forEach((m) => { l[m.group] = heat * (m.pct / 100) * 1.6 })
    return l
  }, [ex, heat])

  return (
    <motion.div
      className="stage with-side"
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3 }}
    >
      <div className="viewport" ref={vpRef}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />

        {/* Contador + fase + métricas */}
        <div className="hud-tl">
          <div className="rep-count">
            <AnimatePresence mode="popLayout">
              <motion.span key={s?.reps || 0} initial={{ y: -30, opacity: 0, scale: 1.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}>
                {s?.reps || 0}
              </motion.span>
            </AnimatePresence>
            <span className="of">/{item.reps}</span>
            <small>REPS · SERIE {Math.max(1, setNum)}/{item.sets}</small>
          </div>
          {status === 'active' && s && (
            <motion.div
              key={s.phase}
              className="phase"
              style={{ background: PHASE_COLOR[s.phase] || '#cbd5e1', color: '#041018' }}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {phases[s.phase] || s.phase.toUpperCase()}
            </motion.div>
          )}
          <div className="card metrics">
            <Metric label={ex.joint_label} value={s?.angle != null ? `${Math.round(s.angle)}°` : '—'} />
            <Metric label="Velocidad" value={`${(s?.speed || 0).toFixed(2)} m/s`} />
            <Metric label="Energía" value={`${kcalNow.toFixed(1)} kcal`} />
            <Metric label="Fatiga" value={`${Math.round(s?.fatigue || 0)} %`} />
            <Metric label="Técnica" value={s?.repLog?.length ? `${s.form}/100` : '—'} />
            <Metric label="Inclinación" value={`${Math.round(s?.tilt || 0)}° · ${item.incline_deg}°`} />
          </div>
        </div>

        {/* Controles superiores */}
        <div className="hud-tr">
          <GlowButton variant="icon ghost" title="Cambiar cámara" onClick={flip}>🔄</GlowButton>
          <GlowButton variant="icon ghost" title="Mapa de calor" onClick={() => setShowHeat((v) => !v)} style={{ opacity: showHeat ? 1 : 0.5 }}>🔥</GlowButton>
          <GlowButton variant="icon ghost" title="Encuadre" onClick={() => setFit((f) => (f === 'cover' ? 'contain' : 'cover'))}>{fit === 'cover' ? '⤢' : '⤡'}</GlowButton>
          <GlowButton variant="icon ghost" title="Voz" onClick={() => setSound((v) => !v)}>{sound ? '🔊' : '🔇'}</GlowButton>
          <GlowButton variant="icon hot" title="Salir" onClick={exit}>✕</GlowButton>
        </div>

        {/* Barra de esfuerzo muscular */}
        <div className="hud-r">
          <div className="vbar"><motion.i animate={{ height: `${Math.round((s?.progress || 0) * 100)}%` }} transition={{ duration: 0.08 }} /></div>
          <div className="vbar-label">RANGO</div>
        </div>

        {/* Tarjeta de la última rep */}
        <AnimatePresence>
          {s?.lastRep && status === 'active' && (
            <motion.div key={s.lastRep.n} className="card rep-card" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              <h4>REP {s.lastRep.n} <span className="chip" style={{ marginLeft: 6, background: s.lastRep.form >= 70 ? 'rgba(52,211,153,.2)' : 'rgba(251,191,36,.2)' }}>{s.lastRep.form >= 70 ? 'RANGO COMPLETO' : 'MEJORAR'}</span></h4>
              <div className="muted mono" style={{ fontSize: 12, lineHeight: 1.6 }}>
                subida {s.lastRep.up}s · bajada {s.lastRep.down}s<br />
                pico {s.lastRep.peak_speed} m/s · ROM {s.lastRep.rom}°<br />
                balanceo {s.lastRep.sway_cm} cm · técnica {s.lastRep.form}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gráfico de rango + slots de reps + acciones */}
        <div className="hud-bottom">
          <div className="card trace">
            <div className="trace-head"><span>Recorrido del movimiento · {ex.name}</span><span className="mono">{fps} fps</span></div>
            <Trace data={s?.trace || []} color={accent} />
            <div className="slots">
              {Array.from({ length: item.reps }, (_, i) => {
                const r = s?.repLog?.[i]
                return <span key={i} className={r ? (r.form >= 70 ? 'done' : 'warn') : ''}>{r ? '✓' : i + 1}</span>
              })}
            </div>
          </div>
          <div className="controls">
            {status === 'ready' && <GlowButton variant="solid ok" onClick={() => { setStatus('countdown'); setCount(3) }}>▶ Comenzar serie {setNum}</GlowButton>}
            {status === 'active' && <GlowButton variant="solid" onClick={() => completeSetRef.current()}>✓ Terminar serie</GlowButton>}
            {status === 'rest' && <GlowButton variant="ghost" onClick={() => setCount(0)}>⏭ Saltar descanso</GlowButton>}
          </div>
        </div>

        {/* Overlays de estado */}
        <AnimatePresence>
          {(status === 'loading' || status === 'error') && (
            <motion.div className="center-msg" style={{ background: 'rgba(4,6,14,.85)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {status === 'loading' ? (
                <div><div className="loader" /><b>Cargando visión artificial…</b><p className="muted">{ex.camera_hint}</p></div>
              ) : (
                <div className="card" style={{ padding: 24, maxWidth: 420 }}>
                  <h3 style={{ marginTop: 0 }}>No se pudo iniciar la cámara</h3>
                  <p className="muted">{err}</p>
                  <GlowButton variant="solid" onClick={onExit}>Volver</GlowButton>
                </div>
              )}
            </motion.div>
          )}
          {status === 'ready' && (
            <motion.div className="center-msg" style={{ pointerEvents: 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="card" style={{ padding: '16px 20px', maxWidth: 380, background: 'rgba(5,8,18,.7)' }}>
                <div style={{ fontSize: 34 }}>{ex.icon}</div>
                <b style={{ fontSize: 20 }}>{ex.name}</b>
                <p className="muted" style={{ margin: '6px 0 0' }}>{ex.camera_hint}</p>
                <p style={{ margin: '6px 0 0', color: accent }}>{ex.cue}</p>
              </div>
            </motion.div>
          )}
          {(status === 'countdown' || status === 'rest') && (
            <motion.div className="center-msg" style={{ background: status === 'rest' ? 'rgba(4,6,14,.6)' : 'transparent', pointerEvents: 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div>
                <div className="muted" style={{ letterSpacing: '0.2em' }}>{status === 'rest' ? (phases.rest || 'DESCANSO') : 'PREPÁRATE'}</div>
                <AnimatePresence mode="popLayout">
                  <motion.div key={count} className="rest-ring" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                    {count}
                  </motion.div>
                </AnimatePresence>
                {status === 'rest' && (
                  <div className="muted">
                    Siguiente: {setNum === -1 ? plan.queue[qi + 1]?.exercise.name : `serie ${setNum + 1} de ${item.sets}`}
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {repFlash && status === 'active' && (
            <motion.div
              key={'f' + repFlash}
              className="center-msg"
              style={{ pointerEvents: 'none' }}
              initial={{ opacity: 0.9, scale: 0.6 }}
              animate={{ opacity: 0, scale: 1.8 }}
              transition={{ duration: 0.7 }}
            >
              <div className="rest-ring" style={{ color: accent }}>+1</div>
            </motion.div>
          )}
          {status === 'done' && (
            <motion.div className="center-msg" style={{ background: 'rgba(4,6,14,.85)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.div className="card" style={{ padding: 28, maxWidth: 460, width: '100%' }} initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }}>
                <div style={{ fontSize: 46 }}>🏆</div>
                <h2 style={{ margin: '6px 0' }}>¡Entrenamiento completado!</h2>
                <div className="stats-row" style={{ margin: '16px 0' }}>
                  <div className="stat"><b>{log.length}</b><span>Series</span></div>
                  <div className="stat"><b>{log.reduce((a, r) => a + r.reps, 0)}</b><span>Reps</span></div>
                  <div className="stat"><b>{log.reduce((a, r) => a + r.kcal, 0).toFixed(1)}</b><span>kcal</span></div>
                </div>
                <p className="muted">Registrado en el cliente <b className="mono">{client.code}</b></p>
                <GlowButton variant="solid" onClick={exit}>Volver al inicio</GlowButton>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Panel lateral (escritorio) */}
      <aside className="side">
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em' }}>EJERCICIO {qi + 1}/{plan.queue.length}</div>
          <h2 style={{ margin: '4px 0' }}>{ex.icon} {ex.name}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{ex.cue}</div>
        </div>
        <div className="card" style={{ padding: 14, display: 'grid', placeItems: 'center' }}>
          <BodyMap groups={groups} loads={groupLoads} size={180} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
            {ex.muscles.map((m) => (
              <span key={m.group} className="chip"><span className="dot" style={{ background: groups[m.group]?.color }} />{groups[m.group]?.name} {m.pct}%</span>
            ))}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em', marginBottom: 8 }}>SERIES REGISTRADAS</div>
          {log.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Aún no hay series.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {log.map((r, i) => (
              <motion.div key={i} className="card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                <span>{boot.exercises.find((e) => e.id === r.exercise_id)?.name} · S{r.set_number}</span>
                <span className="mono">{r.reps}/{r.target_reps} · {r.form_score ?? '—'}pt</span>
              </motion.div>
            ))}
          </div>
        </div>
        {plan.queue.length > 1 && (
          <div>
            <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em', marginBottom: 8 }}>RUTINA</div>
            {plan.queue.map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', opacity: i < qi ? 0.45 : 1, fontWeight: i === qi ? 700 : 400 }}>
                <span>{i < qi ? '✓' : q.exercise.icon}</span><span>{q.exercise.name}</span><span className="muted mono" style={{ marginLeft: 'auto' }}>{q.sets}×{q.reps}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </motion.div>
  )
}

function Metric({ label, value }) {
  return <div className="metric"><small>{label}</small><b>{value}</b></div>
}

function Trace({ data, color }) {
  const w = 300, h = 54
  const pts = data.map((v, i) => `${(i / Math.max(1, 159)) * w},${h - 4 - v * (h - 8)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 54, display: 'block', marginTop: 4 }}>
      <line x1="0" x2={w} y1={h - 4 - 0.85 * (h - 8)} y2={h - 4 - 0.85 * (h - 8)} stroke="rgba(255,255,255,.25)" strokeDasharray="4 4" />
      <line x1="0" x2={w} y1={h - 4 - 0.2 * (h - 8)} y2={h - 4 - 0.2 * (h - 8)} stroke="rgba(255,255,255,.12)" strokeDasharray="2 6" />
      {data.length > 1 && (
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      )}
    </svg>
  )
}

const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : +Number(v).toFixed(d))
