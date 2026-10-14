import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { PUNCH_COLORS, createBoxer } from '../lib/boxing'
import { drawSkeleton, drawThermal, drawVideo, frameRect, projector } from '../lib/render'
import { usePoseCamera } from '../lib/usePoseCamera'
import { GlowButton } from './ui'
import BodyMap from './BodyMap'
import { BigCount, CamOverlays, Metric, PerfBadge, TopControls, round, speak, useCountdown } from './StageParts'

const MODE_LABEL = { shadow: 'Sombra libre', combos: 'Combos guiados', targets: 'Dianas', speed: 'Velocidad' }

export default function Boxing({ boot, client, item, autoStart, isLast, nextName, onFinish, onExit, notify }) {
  const { groups } = boot
  const ex = item.exercise
  const mode = ex.box_mode || 'shadow'
  const cfg = ex.box_config || {}
  const P_NAMES = boot.punches || {}
  const stance = item.stance || 'orthodox'
  const bodyKg = Number(client.body_weight_kg) || 70
  const roundSec = item.reps

  const [sens, setSens] = useState(1)
  const boxerRef = useRef(createBoxer({ stance, sensitivity: sens }))
  const statusRef = useRef('ready')
  const drill = useRef(null)
  const trails = useRef({ L: [], R: [] })
  const optsRef = useRef({})
  const hudT = useRef(0)
  const roundStart = useRef(0)
  const savingRef = useRef(false)

  const [roundN, setRoundN] = useState(1)
  const [status, setStatus] = useState('ready')
  const [count, setCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(roundSec)
  const [sound, setSound] = useState(true)
  const [hud, setHud] = useState(null)
  const [flash, setFlash] = useState(null)
  const [callout, setCallout] = useState(null)
  const [log, setLog] = useState([])
  statusRef.current = status

  // ---------- Ejercicios guiados ----------
  const nextCombo = (now) => {
    const list = cfg.combos?.length ? cfg.combos : [[1, 2]]
    const combo = list[Math.floor(Math.random() * list.length)]
    const d = drill.current
    d.combo = combo; d.idx = 0; d.marks = []
    d.deadline = now + 1300 + combo.length * 650
    setCallout({ combo, marks: [], key: now })
    speak(combo.map((n) => P_NAMES[n]?.name || n).join(', '), optsRef.current.sound)
  }
  const spawnTarget = (now) => {
    const slots = ['lead_high', 'rear_high', 'lead_body', 'rear_body', 'lead_high', 'rear_high']
    drill.current.target = { slot: slots[Math.floor(Math.random() * slots.length)], born: now, expires: now + (cfg.window_ms || 1600) }
  }
  const targetPos = (lm, slot) => {
    const leadSh = stance === 'southpaw' ? lm[12] : lm[11]
    const rearSh = stance === 'southpaw' ? lm[11] : lm[12]
    const sh = slot.startsWith('lead') ? leadSh : rearSh
    const nose = lm[0], shY = (lm[11].y + lm[12].y) / 2, hipY = (lm[23].y + lm[24].y) / 2
    const midX = (lm[11].x + lm[12].x) / 2
    const high = slot.endsWith('high')
    return {
      x: sh.x * 0.6 + (high ? nose.x : midX) * 0.4,
      y: high ? nose.y + (shY - nose.y) * 0.25 : shY + (hipY - shY) * 0.35,
      r: Math.abs(lm[11].x - lm[12].x) * 0.45,
    }
  }

  const onPunch = (p) => {
    const d = drill.current
    if (!d || statusRef.current !== 'active') return
    const now = performance.now()
    setFlash({ ...p, key: p.n })
    if (mode === 'combos' && d.combo && d.idx < d.combo.length && now >= (d.pauseUntil || 0)) {
      const ok = p.num === d.combo[d.idx]
      d.attempts++; if (ok) d.hits++
      d.marks.push(ok); d.idx++
      setCallout({ combo: d.combo, marks: [...d.marks], key: d.deadline })
      if (d.idx >= d.combo.length) { d.combo = null; d.pauseUntil = now + 900 }
    }
    if (mode === 'targets' && d.target && d.lastLm) {
      const t = targetPos(d.lastLm, d.target.slot)
      const asp = optsRef.current.aspect || 1
      const dist = Math.hypot((p.img.x - t.x) * asp, p.img.y - t.y)
      if (dist <= t.r * asp * 1.15) {
        d.attempts++; d.hits++
        d.burst = { x: t.x, y: t.y, t: now }
        d.target = null; d.nextAt = now + 450
        speak('¡Bien!', false)
      }
    }
  }

  const cam = usePoseCamera({
    smoothing: { minCutoff: 1.4, beta: 12 }, // menos suavizado: los golpes son muy rápidos
    onFrame: ({ lm, world, now, ctx, W, H, video }) => {
      const bx = boxerRef.current
      const active = statusRef.current === 'active'
      if (active) bx.update(lm, world, now, onPunch)
      const d = drill.current
      const o = optsRef.current
      o.aspect = video.videoWidth / video.videoHeight
      if (active && d && lm) {
        d.lastLm = lm
        if (mode === 'combos') {
          if (!d.combo && now >= (d.pauseUntil || 0)) nextCombo(now)
          else if (d.combo && now > d.deadline) {
            const missing = d.combo.length - d.idx
            d.attempts += missing
            d.marks.push(...Array(missing).fill(false))
            setCallout({ combo: d.combo, marks: [...d.marks], key: d.deadline })
            d.combo = null; d.pauseUntil = now + 900
          }
        }
        if (mode === 'targets') {
          if (!d.target && now >= (d.nextAt || 0)) spawnTarget(now)
          else if (d.target && now > d.target.expires) { d.attempts++; d.target = null; d.nextAt = now + 350 }
        }
      }

      const r = frameRect(video.videoWidth, video.videoHeight, W, H, 'cover')
      const mirror = o.facing === 'user'
      const Pj = projector(r, mirror)
      const unit = Math.max(2, Math.min(W, H) / 240)
      drawVideo(ctx, video, r, W, H, mirror)
      if (lm) {
        const hs = (a, b) => {
          const arm = (i) => (i === 11 || i === 13 || i === 15 ? 'L' : i === 12 || i === 14 || i === 16 ? 'R' : null)
          const side = arm(a) && arm(a) === arm(b) ? arm(a) : null
          return side ? 0.15 + bx.state.heat[side] * 0.85 : 0.15 + (bx.state.heat.L + bx.state.heat.R) * 0.3
        }
        drawThermal(ctx, lm, Pj, hs, 0.2 + (bx.state.heat.L + bx.state.heat.R) * 0.35)
        // Estelas de las muñecas (color según velocidad)
        for (const [side, i] of [['L', 15], ['R', 16]]) {
          const tr = trails.current[side]
          tr.push({ ...Pj(lm[i]), v: bx.state.armSpeed[side] })
          if (tr.length > 12) tr.shift()
          for (let k = 1; k < tr.length; k++) {
            const sp = Math.min(1, tr[k].v / 6)
            ctx.strokeStyle = `hsla(${190 - sp * 190}, 95%, 60%, ${(k / tr.length) * 0.9})`
            ctx.lineWidth = unit * (1 + sp * 4) * (k / tr.length)
            ctx.lineCap = 'round'
            ctx.beginPath(); ctx.moveTo(tr[k - 1].x, tr[k - 1].y); ctx.lineTo(tr[k].x, tr[k].y); ctx.stroke()
          }
        }
        drawSkeleton(ctx, lm, Pj, unit)
        if (mode === 'targets' && d?.target) drawTarget(ctx, Pj, targetPos(lm, d.target.slot), d.target, now, r, unit)
      }
      if (d?.burst && now - d.burst.t < 450) drawBurst(ctx, Pj(d.burst), (now - d.burst.t) / 450, unit)
      if (now - hudT.current > 110) {
        hudT.current = now
        const st = bx.state
        setHud({ total: st.total, counts: { ...st.counts }, last: st.last, clean: st.clean, peak: st.peak,
          avg: st.speeds.length ? st.speeds.reduce((a, b) => a + b, 0) / st.speeds.length : 0,
          guard: st.trackedMs ? (st.guardMs / st.trackedMs) * 100 : 0, inGuard: st.inGuard, visible: st.visible,
          attempts: d?.attempts || 0, hits: d?.hits || 0 })
      }
    },
  })
  optsRef.current = { ...optsRef.current, facing: cam.facing, sound }

  // ---------- Rounds ----------
  const startRound = () => {
    boxerRef.current = createBoxer({ stance, sensitivity: sens })
    drill.current = { attempts: 0, hits: 0, combo: null, target: null, pauseUntil: performance.now() + 600, nextAt: performance.now() + 600 }
    roundStart.current = Date.now()
    setTimeLeft(roundSec); setCallout(null); setFlash(null)
    speak('¡Tiempo!', sound)
    setStatus('active')
  }

  async function endRound() {
    if (savingRef.current || statusRef.current !== 'active') return
    savingRef.current = true
    statusRef.current = 'saving'
    const sum = boxerRef.current.summary()
    const d = drill.current
    const attempts = mode === 'combos' || mode === 'targets' ? d.attempts : sum.total
    const hits = mode === 'combos' || mode === 'targets' ? d.hits : sum.clean
    const secs = (Date.now() - roundStart.current) / 1000
    const met = mode === 'speed' ? 11 : 8
    const row = {
      client_code: client.code, exercise_id: ex.id, routine_id: item.routine_id || null,
      set_number: roundN, reps: sum.total, target_reps: null, incline_deg: 0,
      punches: { ...sum.counts, stance, mode }, attempts, hits,
      accuracy: attempts ? round((hits / attempts) * 100) : null,
      avg_punch_speed: round(sum.avg_speed, 2), peak_punch_speed: round(sum.peak_speed, 2),
      guard_pct: round(sum.guard_pct), punch_rate: round(sum.total / Math.max(secs / 60, 0.1)),
      form_score: sum.total ? Math.round((sum.clean / sum.total) * 100) : null,
      kcal: round(((met * 3.5 * bodyKg) / 200) * (secs / 60), 2), duration_sec: round(secs),
      body_weight_kg: client.body_weight_kg ? bodyKg : null, rep_log: sum.log,
    }
    try {
      await api.saveSet(row)
      notify(`✓ Round ${roundN} guardado · ${sum.total} golpes${row.accuracy != null ? ` · ${row.accuracy}% precisión` : ''}`)
    } catch (e) { notify('Error guardando: ' + e.message) }
    const newLog = [...log, row]
    setLog(newLog)
    savingRef.current = false
    setCallout(null)
    if (roundN < item.sets) {
      speak('Fin del round. Descansa.', sound)
      setStatus('rest'); setCount(item.rest_sec)
    } else {
      speak(isLast ? 'Entrenamiento completado' : 'Ejercicio completado', sound)
      onFinish(newLog)
    }
  }

  useCountdown(status === 'countdown', count, setCount, startRound, (c) => speak(String(c), sound))
  useCountdown(status === 'rest', count, setCount, () => { setRoundN((n) => n + 1); setStatus('countdown'); setCount(3) })
  useCountdown(status === 'active', timeLeft, setTimeLeft, endRound, (c) => c <= 3 && speak(String(c), sound))

  const autoRef = useRef(false)
  if (autoStart && !autoRef.current && cam.status === 'ready' && status === 'ready') {
    autoRef.current = true
    setTimeout(() => { setStatus('countdown'); setCount(3) }, 0)
  }

  const exit = async () => {
    if (statusRef.current === 'active' && boxerRef.current.state.total > 0) await endRound()
    cam.stop()
    onExit()
  }

  const h = hud
  const acc = h ? (mode === 'combos' || mode === 'targets' ? (h.attempts ? (h.hits / h.attempts) * 100 : null) : h.total ? (h.clean / h.total) * 100 : null) : null
  const elapsed = roundSec - timeLeft
  const rate = h && elapsed > 2 ? (h.total / elapsed) * 60 : 0
  const loads = useMemo(() => {
    const l = {}
    ex.muscles.forEach((m) => { l[m.group] = Math.min(1, (m.pct / 100) * 1.4 + (h?.total || 0) / 300) })
    return l
  }, [ex, h?.total]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div className="stage with-side" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.3 }}>
      <div className="viewport" ref={cam.vpRef}>
        <video ref={cam.videoRef} playsInline muted autoPlay />
        <canvas ref={cam.canvasRef} />

        <div className="hud-tl">
          <div className="rep-count">
            <AnimatePresence mode="popLayout">
              <motion.span key={h?.total || 0} initial={{ y: -30, opacity: 0, scale: 1.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}>
                {h?.total || 0}
              </motion.span>
            </AnimatePresence>
            <small>GOLPES · ROUND {roundN}/{item.sets} · {MODE_LABEL[mode]}</small>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div className="phase" style={{ background: h?.inGuard ? '#34d399' : '#fbbf24' }}>{h?.inGuard ? 'GUARDIA ✓' : 'SUBE LA GUARDIA'}</div>
            <div className="phase" style={{ background: '#cbd5e1' }}>{stance === 'southpaw' ? 'ZURDO' : 'ORTODOXO'}</div>
          </div>
          <div className="card metrics">
            <Metric label="Vel. media" value={`${(h?.avg || 0).toFixed(1)} m/s`} />
            <Metric label="Vel. pico" value={`${(h?.peak || 0).toFixed(1)} m/s`} />
            <Metric label={mode === 'combos' || mode === 'targets' ? 'Aciertos' : 'Golpes limpios'} value={acc != null ? `${Math.round(acc)} %` : '—'} color={acc == null ? undefined : acc >= 75 ? '#34d399' : acc >= 50 ? '#fbbf24' : '#fb7185'} />
            <Metric label="Guardia" value={`${Math.round(h?.guard || 0)} %`} />
            <Metric label="Ritmo" value={`${Math.round(rate)} /min`} />
            <Metric label={mode === 'combos' || mode === 'targets' ? 'Aciertos' : 'Limpios'} value={mode === 'combos' || mode === 'targets' ? `${h?.hits || 0}/${h?.attempts || 0}` : `${h?.clean || 0}/${h?.total || 0}`} />
          </div>
        </div>

        <TopControls cam={cam} sound={sound} setSound={setSound} onExit={exit} extra={
          <GlowButton variant="icon ghost" title={`Sensibilidad ${sens === 1 ? 'normal' : sens > 1 ? 'alta' : 'baja'}`}
            onClick={() => { const n = sens === 1 ? 1.25 : sens > 1 ? 0.8 : 1; setSens(n); notify(`Sensibilidad ${n === 1 ? 'normal' : n > 1 ? 'alta' : 'baja'}`) }}>
            {sens === 1 ? '◐' : sens > 1 ? '●' : '○'}
          </GlowButton>
        } />

        {/* Temporizador del round */}
        <div className="hud-r">
          <RoundRing total={roundSec} left={status === 'active' ? timeLeft : roundSec} />
        </div>

        {/* Último golpe */}
        <AnimatePresence>
          {flash && status === 'active' && (
            <motion.div key={flash.key} className="punch-flash" initial={{ scale: 0.5, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 1.2 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              style={{ '--pc': PUNCH_COLORS[flash.num] }}>
              <span className="pnum">{flash.num}</span>
              <div>
                <b>{P_NAMES[flash.num]?.name || flash.id}</b>
                <div className="mono">{flash.speed} m/s · codo {flash.elbow}°{flash.clean === false ? ' · ✗' : ''}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Combo cantado */}
        <AnimatePresence>
          {mode === 'combos' && callout && status === 'active' && (
            <motion.div key={callout.key} className="combo-call" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
              {callout.combo.map((n, i) => {
                const m = callout.marks[i]
                return (
                  <motion.div key={i} className={`combo-step ${m === true ? 'ok' : m === false ? 'bad' : ''}`} style={{ '--pc': PUNCH_COLORS[n] }}
                    animate={m === undefined && i === callout.marks.length ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ repeat: Infinity, duration: 0.8 }}>
                    <span>{n}</span><small>{P_NAMES[n]?.name}</small>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hud-bottom">
          <div className="card trace">
            <div className="trace-head"><span>Golpes por tipo</span><PerfBadge cam={cam} /></div>
            <div className="punch-bars">
              {[1, 2, 3, 4, 5, 6].map((n) => {
                const c = h?.counts?.[n] || 0
                const max = Math.max(1, ...Object.values(h?.counts || { a: 1 }))
                return (
                  <div key={n} className="pbar" style={{ '--pc': PUNCH_COLORS[n] }}>
                    <div className="pbar-track"><i style={{ height: `${(c / max) * 100}%` }} /></div>
                    <b className="mono">{c}</b>
                    <small>{n} · {P_NAMES[n]?.name || ''}</small>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="controls">
            {status === 'ready' && cam.status === 'ready' && <GlowButton variant="solid ok" onClick={() => { setStatus('countdown'); setCount(3) }}>🥊 Comenzar round {roundN}</GlowButton>}
            {status === 'active' && <GlowButton variant="solid" onClick={endRound}>⏹ Terminar round</GlowButton>}
            {status === 'rest' && <GlowButton variant="ghost" onClick={() => setCount(0)}>⏭ Saltar descanso</GlowButton>}
          </div>
        </div>

        <CamOverlays cam={cam} onBack={onExit} hint={ex.camera_hint} />
        <AnimatePresence>
          {status === 'ready' && cam.status === 'ready' && (
            <motion.div className="center-msg" style={{ pointerEvents: 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="card" style={{ padding: '16px 20px', maxWidth: 400, background: 'rgba(5,8,18,.75)' }}>
                <div style={{ fontSize: 34 }}>{ex.icon}</div>
                <b style={{ fontSize: 20 }}>{ex.name}</b>
                <p className="muted" style={{ margin: '6px 0 0' }}>{ex.camera_hint}</p>
                <p style={{ margin: '6px 0 0', color: '#22d3ee' }}>{ex.cue}</p>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>{item.sets} rounds × {roundSec}s · guardia {stance === 'southpaw' ? 'zurda' : 'ortodoxa'}</p>
              </div>
            </motion.div>
          )}
          {status === 'countdown' && <BigCount key="cd" label="GUARDIA ARRIBA" count={count} />}
          {status === 'rest' && <BigCount key="rest" dim label="DESCANSO" count={count} sub={`Siguiente: round ${roundN + 1} de ${item.sets}`} />}
        </AnimatePresence>
      </div>

      <aside className="side">
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em' }}>{nextName ? `SIGUIENTE: ${nextName.toUpperCase()}` : 'ÚLTIMO EJERCICIO'}</div>
          <h2 style={{ margin: '4px 0' }}>{ex.icon} {ex.name}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{ex.cue}</div>
        </div>
        <div className="card" style={{ padding: 14, display: 'grid', placeItems: 'center' }}>
          <BodyMap groups={groups} loads={loads} size={170} />
        </div>
        <div className="card" style={{ padding: 12, fontSize: 13, lineHeight: 1.7 }}>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em' }}>NUMERACIÓN</div>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n}><b className="mono" style={{ color: PUNCH_COLORS[n] }}>{n}</b> {P_NAMES[n]?.name}</div>
          ))}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.14em', marginBottom: 8 }}>ROUNDS</div>
          {log.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Aún no hay rounds.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {log.map((r, i) => (
              <motion.div key={i} className="card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                <span>R{r.set_number} · {r.reps} golpes</span>
                <span className="mono">{r.accuracy ?? '—'}% · {r.avg_punch_speed ?? '—'}m/s</span>
              </motion.div>
            ))}
          </div>
        </div>
      </aside>
    </motion.div>
  )
}

function RoundRing({ total, left }) {
  const R = 34, C = 2 * Math.PI * R
  const f = total ? left / total : 0
  const col = left <= 10 ? '#fb7185' : '#22d3ee'
  return (
    <div className="round-ring">
      <svg viewBox="0 0 80 80" width="84" height="84">
        <circle cx="40" cy="40" r={R} stroke="rgba(255,255,255,.12)" strokeWidth="6" fill="rgba(5,8,18,.6)" />
        <circle cx="40" cy="40" r={R} stroke={col} strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset .9s linear', filter: `drop-shadow(0 0 6px ${col})` }} />
      </svg>
      <b className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>
    </div>
  )
}

function drawTarget(ctx, P, t, target, now, r, unit) {
  const c = P(t)
  const rad = t.r * r.w
  const life = 1 - (now - target.born) / (target.expires - target.born)
  ctx.save()
  ctx.strokeStyle = '#fb7185'; ctx.shadowColor = '#fb7185'; ctx.shadowBlur = unit * 8
  ctx.lineWidth = unit * 1.6
  for (const k of [1, 0.62, 0.28]) { ctx.beginPath(); ctx.arc(c.x, c.y, rad * k, 0, Math.PI * 2); ctx.stroke() }
  ctx.fillStyle = 'rgba(251,113,133,0.18)'
  ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = unit * 2.4
  ctx.beginPath(); ctx.arc(c.x, c.y, rad * 1.15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, life)); ctx.stroke()
  ctx.restore()
}

function drawBurst(ctx, c, k, unit) {
  ctx.save()
  ctx.strokeStyle = `rgba(52,211,153,${1 - k})`
  ctx.lineWidth = unit * 2
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const r1 = unit * (6 + k * 30), r2 = unit * (10 + k * 46)
    ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1); ctx.lineTo(c.x + Math.cos(a) * r2, c.y + Math.sin(a) * r2); ctx.stroke()
  }
  ctx.restore()
}
