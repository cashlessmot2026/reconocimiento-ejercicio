import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { createTracker } from '../lib/repTracker'
import { drawAngle, drawSkeleton, drawThermal, drawVideo, frameRect, projector } from '../lib/render'
import { usePoseCamera } from '../lib/usePoseCamera'
import { GlowButton } from './ui'
import BodyMap from './BodyMap'
import { BigCount, CamOverlays, Metric, PerfBadge, TopControls, round, speak, useCountdown } from './StageParts'

const PHASE_COLOR = {
  idle: '#cbd5e1', rest: '#cbd5e1', concentric: '#34d399', hold: '#fbbf24', eccentric: '#60a5fa', lost: '#fb7185',
}

/** Calcula la carga efectiva, volumen, 1RM (Epley) y potencia estimada de una serie. */
export function strengthMetrics(ex, reps, loadKg, bodyKg, avgPeakSpeed) {
  const effective = bodyKg * Number(ex.bw_factor || 0) + Number(loadKg || 0)
  if (!effective) return { effective_kg: null, volume_kg: null, est_1rm: null, avg_power_w: null }
  return {
    effective_kg: round(effective, 1),
    volume_kg: round(effective * reps, 1),
    est_1rm: reps > 0 ? round(effective * (1 + reps / 30), 1) : null,
    avg_power_w: avgPeakSpeed ? round(effective * 9.81 * avgPeakSpeed * 0.55, 0) : null,
  }
}

export default function Workout({ boot, client, item, autoStart, isLast, nextName, onFinish, onExit, notify }) {
  const { groups, phases } = boot
  const ex = item.exercise
  const accent = groups[ex.primary_group]?.color || '#22d3ee'
  const bodyKg = Number(client.body_weight_kg) || 70
  const load = Number(item.load_kg) || 0

  const trackerRef = useRef(createTracker(ex))
  const statusRef = useRef('ready')
  const savingRef = useRef(false)
  const optsRef = useRef({})
  const hudT = useRef(0)

  const [setNum, setSetNum] = useState(1)
  const [status, setStatus] = useState('ready') // ready | countdown | active | rest
  const [count, setCount] = useState(0)
  const [fit, setFit] = useState('cover')
  const [showHeat, setShowHeat] = useState(true)
  const [sound, setSound] = useState(true)
  const [hud, setHud] = useState(null)
  const [log, setLog] = useState([])
  const [repFlash, setRepFlash] = useState(null)
  statusRef.current = status

  const doneReps = log.reduce((a, r) => a + r.reps, 0) + (hud?.reps || 0)
  const heat = Math.min(1, 0.12 + (doneReps / (item.sets * item.reps)) * 0.75 + (hud?.fatigue || 0) / 400 + load / 200)

  const cam = usePoseCamera({
    smoothing: { minCutoff: 1.0, beta: 6 },
    onFrame: ({ lm, now, ctx, W, H, video }) => {
      const tr = trackerRef.current
      if (statusRef.current === 'active') {
        tr.setAspect(video.videoWidth / video.videoHeight)
        const before = tr.state.reps
        tr.update(lm, now)
        if (tr.state.reps > before) onRepRef.current(tr.state)
      }
      const o = optsRef.current
      const r = frameRect(video.videoWidth, video.videoHeight, W, H, o.fit)
      const mirror = o.facing === 'user'
      const P = projector(r, mirror)
      const unit = Math.max(2, Math.min(W, H) / 240)
      drawVideo(ctx, video, r, W, H, mirror)
      if (lm && o.showHeat) {
        const work = new Set([...ex.landmarks_l, ...ex.landmarks_r])
        const hs = (a, b) => (work.has(a) && work.has(b) ? o.heat : work.has(a) || work.has(b) ? o.heat * 0.6 : o.heat * 0.25)
        drawThermal(ctx, lm, P, hs, ['pecho', 'espalda', 'core'].includes(ex.primary_group) ? o.heat : o.heat * 0.45)
      }
      drawSkeleton(ctx, lm, P, unit)
      drawAngle(ctx, lm, P, ex, tr.state.angle, o.accent, unit)
      if (now - hudT.current > 70) {
        hudT.current = now
        const s = tr.state
        setHud({ ...s, trace: s.trace.slice(-160), repLog: s.repLog })
      }
    },
  })
  optsRef.current = { fit, showHeat, facing: cam.facing, heat, accent }

  // ---------- Reps y series ----------
  const onRepRef = useRef()
  onRepRef.current = (s) => {
    setRepFlash(s.reps)
    speak(String(s.reps), sound)
    if (s.reps >= item.reps) setTimeout(() => completeSet(), 650)
  }

  async function completeSet() {
    if (savingRef.current || statusRef.current !== 'active') return
    savingRef.current = true
    statusRef.current = 'saving'
    const tr = trackerRef.current
    const sum = tr.summary()
    const avgPeak = sum.rep_log.length ? sum.rep_log.reduce((a, r) => a + r.peak_speed, 0) / sum.rep_log.length : null
    let row = null
    if (sum.reps > 0) {
      row = {
        client_code: client.code, exercise_id: ex.id, routine_id: item.routine_id || null,
        set_number: setNum, reps: sum.reps, target_reps: item.reps, incline_deg: item.incline_deg || 0,
        torso_tilt: round(sum.torso_tilt), min_angle: round(sum.min_angle), max_angle: round(sum.max_angle),
        avg_rom: round(sum.avg_rom), avg_rep_sec: round(sum.avg_rep_sec, 2), peak_speed: round(sum.peak_speed, 2),
        fatigue_pct: round(sum.fatigue_pct), form_score: sum.form_score,
        kcal: round(sum.reps * Number(ex.kcal_per_rep) * (1 + Math.max(0, item.incline_deg || 0) / 180) * (1 + load / 100), 2),
        duration_sec: round((Date.now() - (tr.startedAt || Date.now())) / 1000), rep_log: sum.rep_log,
        load_kg: load, body_weight_kg: client.body_weight_kg ? bodyKg : null,
        ...strengthMetrics(ex, sum.reps, load, bodyKg, avgPeak),
      }
      try {
        await api.saveSet(row)
        notify(`✓ Serie ${setNum} guardada · ${sum.reps} reps${load ? ` · +${load} kg` : ''}`)
      } catch (e) { notify('Error guardando: ' + e.message) }
    }
    const newLog = row ? [...log, row] : log
    setLog(newLog)
    savingRef.current = false
    if (setNum < item.sets) {
      speak('Serie completada. Descansa.', sound)
      setStatus('rest'); setCount(item.rest_sec)
    } else {
      speak(isLast ? 'Entrenamiento completado' : 'Ejercicio completado', sound)
      onFinish(newLog)
    }
  }

  const startSet = () => {
    trackerRef.current = createTracker(ex)
    trackerRef.current.startedAt = Date.now()
    setHud(null); setRepFlash(null)
    speak('Adelante', sound)
    setStatus('active')
  }

  // Inicio automático cuando viene de un ejercicio anterior
  const autoRef = useRef(false)
  if (autoStart && !autoRef.current && cam.status === 'ready' && status === 'ready') {
    autoRef.current = true
    setTimeout(() => { setStatus('countdown'); setCount(3) }, 0)
  }

  useCountdown(status === 'countdown', count, setCount, startSet, (c) => speak(String(c), sound))
  useCountdown(status === 'rest', count, setCount, () => { setSetNum((n) => n + 1); setStatus('countdown'); setCount(3) })

  const exit = async () => {
    if (statusRef.current === 'active' && trackerRef.current.state.reps > 0) await completeSet()
    cam.stop()
    onExit()
  }

  const s = hud
  const kcalNow = log.reduce((a, r) => a + r.kcal, 0) + (s?.reps || 0) * Number(ex.kcal_per_rep)
  const groupLoads = useMemo(() => {
    const l = {}
    ex.muscles.forEach((m) => { l[m.group] = heat * (m.pct / 100) * 1.6 })
    return l
  }, [ex, heat])
  const live = strengthMetrics(ex, s?.reps || 0, load, bodyKg)

  return (
    <motion.div className="stage with-side" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.3 }}>
      <div className="viewport" ref={cam.vpRef}>
        <video ref={cam.videoRef} playsInline muted autoPlay />
        <canvas ref={cam.canvasRef} />

        <div className="hud-tl">
          <div className="rep-count">
            <AnimatePresence mode="popLayout">
              <motion.span key={s?.reps || 0} initial={{ y: -30, opacity: 0, scale: 1.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}>
                {s?.reps || 0}
              </motion.span>
            </AnimatePresence>
            <span className="of">/{item.reps}</span>
            <small>REPS · SERIE {setNum}/{item.sets}</small>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {status === 'active' && s && (
              <motion.div key={s.phase} className="phase" style={{ background: PHASE_COLOR[s.phase] || '#cbd5e1' }} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                {phases[s.phase] || s.phase.toUpperCase()}
              </motion.div>
            )}
            {load > 0 && <div className="phase load-badge">🏋️ +{load} kg</div>}
          </div>
          <div className="card metrics">
            <Metric label={ex.joint_label} value={s?.angle != null ? `${Math.round(s.angle)}°` : '—'} />
            <Metric label="Velocidad" value={`${(s?.speed || 0).toFixed(2)} m/s`} />
            <Metric label="Energía" value={`${kcalNow.toFixed(1)} kcal`} />
            <Metric label="Fatiga" value={`${Math.round(s?.fatigue || 0)} %`} />
            {live.effective_kg ? <Metric label="Carga total" value={`${live.effective_kg} kg`} /> : <Metric label="Técnica" value={s?.repLog?.length ? `${s.form}/100` : '—'} />}
            {live.effective_kg ? <Metric label="1RM estimado" value={live.est_1rm ? `${live.est_1rm} kg` : '—'} /> : <Metric label="Inclinación" value={`${Math.round(s?.tilt || 0)}° · ${item.incline_deg || 0}°`} />}
          </div>
        </div>

        <TopControls cam={cam} sound={sound} setSound={setSound} onExit={exit} extra={<>
          <GlowButton variant="icon ghost" title="Mapa de calor" onClick={() => setShowHeat((v) => !v)} style={{ opacity: showHeat ? 1 : 0.5 }}>🔥</GlowButton>
          <GlowButton variant="icon ghost" title="Encuadre" onClick={() => setFit((f) => (f === 'cover' ? 'contain' : 'cover'))}>{fit === 'cover' ? '⤢' : '⤡'}</GlowButton>
        </>} />

        <div className="hud-r">
          <div className="vbar"><i style={{ height: `${Math.round((s?.progress || 0) * 100)}%` }} /></div>
          <div className="vbar-label">RANGO</div>
        </div>

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

        <div className="hud-bottom">
          <div className="card trace">
            <div className="trace-head"><span>Recorrido · {ex.name}</span><PerfBadge cam={cam} /></div>
            <Trace data={s?.trace || []} color={accent} />
            <div className="slots">
              {Array.from({ length: item.reps }, (_, i) => {
                const r = s?.repLog?.[i]
                return <span key={i} className={r ? (r.form >= 70 ? 'done' : 'warn') : ''}>{r ? '✓' : i + 1}</span>
              })}
            </div>
          </div>
          <div className="controls">
            {status === 'ready' && cam.status === 'ready' && <GlowButton variant="solid ok" onClick={() => { setStatus('countdown'); setCount(3) }}>▶ Comenzar serie {setNum}</GlowButton>}
            {status === 'active' && <GlowButton variant="solid" onClick={completeSet}>✓ Terminar serie</GlowButton>}
            {status === 'rest' && <GlowButton variant="ghost" onClick={() => setCount(0)}>⏭ Saltar descanso</GlowButton>}
          </div>
        </div>

        <CamOverlays cam={cam} onBack={onExit} hint={ex.camera_hint} />
        <AnimatePresence>
          {status === 'ready' && cam.status === 'ready' && (
            <motion.div className="center-msg" style={{ pointerEvents: 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="card" style={{ padding: '16px 20px', maxWidth: 380, background: 'rgba(5,8,18,.7)' }}>
                <div style={{ fontSize: 34 }}>{ex.icon}</div>
                <b style={{ fontSize: 20 }}>{ex.name}{load ? ` · +${load} kg` : ''}</b>
                <p className="muted" style={{ margin: '6px 0 0' }}>{ex.camera_hint}</p>
                <p style={{ margin: '6px 0 0', color: accent }}>{ex.cue}</p>
              </div>
            </motion.div>
          )}
          {status === 'countdown' && <BigCount key="cd" label="PREPÁRATE" count={count} />}
          {status === 'rest' && <BigCount key="rest" dim label={phases.rest || 'DESCANSO'} count={count} sub={`Siguiente: serie ${setNum + 1} de ${item.sets}`} />}
          {repFlash && status === 'active' && (
            <motion.div key={'f' + repFlash} className="center-msg" style={{ pointerEvents: 'none' }} initial={{ opacity: 0.9, scale: 0.6 }} animate={{ opacity: 0, scale: 1.8 }} transition={{ duration: 0.7 }}>
              <div className="rest-ring" style={{ color: accent }}>+1</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <aside className="side">
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em' }}>{nextName ? `SIGUIENTE: ${nextName.toUpperCase()}` : 'ÚLTIMO EJERCICIO'}</div>
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
        {(load > 0 || Number(ex.bw_factor) > 0) && (
          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em' }}>CARGA</div>
            <div className="mono" style={{ fontSize: 13, lineHeight: 1.8 }}>
              Peso corporal {client.body_weight_kg ? `${bodyKg} kg` : `${bodyKg} kg (estimado)`} × {ex.bw_factor}<br />
              Lastre +{load} kg → <b>{live.effective_kg ?? load} kg por rep</b>
            </div>
          </div>
        )}
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em', marginBottom: 8 }}>SERIES REGISTRADAS</div>
          {log.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Aún no hay series.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {log.map((r, i) => (
              <motion.div key={i} className="card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                <span>S{r.set_number}{r.load_kg ? ` · +${r.load_kg}kg` : ''}</span>
                <span className="mono">{r.reps}/{r.target_reps} · {r.form_score ?? '—'}pt</span>
              </motion.div>
            ))}
          </div>
        </div>
      </aside>
    </motion.div>
  )
}

function Trace({ data, color }) {
  const w = 300, h = 54
  const pts = data.map((v, i) => `${(i / 159) * w},${h - 4 - v * (h - 8)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 54, display: 'block', marginTop: 4 }}>
      <line x1="0" x2={w} y1={h - 4 - 0.85 * (h - 8)} y2={h - 4 - 0.85 * (h - 8)} stroke="rgba(255,255,255,.25)" strokeDasharray="4 4" />
      <line x1="0" x2={w} y1={h - 4 - 0.2 * (h - 8)} y2={h - 4 - 0.2 * (h - 8)} stroke="rgba(255,255,255,.12)" strokeDasharray="2 6" />
      {data.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}
