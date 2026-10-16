import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { JOINTS, analyzeDemo, packFrame } from '../lib/learn'
import { drawSkeleton, drawVideo, frameRect, projector } from '../lib/render'
import { usePoseCamera } from '../lib/usePoseCamera'
import { useWakeLock } from '../lib/display'
import GhostFigure from './GhostFigure'
import { GlowButton } from './ui'

const ICONS = ['🥊', '🥋', '🦶', '💥', '⚡', '🔥', '🏃', '🤸', '🛡️', '🎯', '💪', '🦵']
const EFFORT = [['Suave', 0.2], ['Moderado', 0.4], ['Intenso', 0.7]]
const MIN_SECS = 3, MAX_SECS = 10 // la demostración dura como máximo 10 s
const AUTO_QUALITY = 70 // calidad mínima para guardar sin confirmar
const AX = { stroke: '#8b97b5', fontSize: 11, tickLine: false, axisLine: false }
const TT = { contentStyle: { background: '#0f1528', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10 }, labelStyle: { color: '#e8eefc' } }

/**
 * Asistente para enseñar un ejercicio al sistema:
 *   1. Datos (solo ejercicio nuevo)  2. Grabar la demostración  3. Revisar lo aprendido  4. Guardar
 * `existing`: grabar solo la demostración de un ejercicio que ya existe.
 */
export default function ExerciseTrainer({ boot, pin, existing, onClose, onSaved, notify }) {
  const { groups, exercises } = boot
  const [step, setStep] = useState(existing ? 'record' : 'info')
  const [info, setInfo] = useState({
    name: '', icon: '🥊', category: 'Boxeo', primary_group: '', secondary: [], effort: 0.4,
    supports_load: false, bw_factor: 0, cue: '', camera_hint: 'Cámara frontal o lateral, cuerpo completo visible', default_sets: 3, default_reps: 60,
  })
  const [rec, setRec] = useState(null) // { frames, aspect, mirrored }
  const [opts, setOpts] = useState({ invert: false, joint: null, adjust: false })
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [err, setErr] = useState('')

  const categories = useMemo(() => [...new Set(['Boxeo', 'Defensa', 'Footwork', 'Combinaciones', 'Acondicionamiento', ...exercises.map((e) => e.category)])], [exercises])
  const setI = (k, v) => setInfo((s) => ({ ...s, [k]: v }))

  // Ejercicio existente: la articulación y los ángulos ya están definidos
  const existingJoint = useMemo(() => {
    if (!existing) return null
    return JOINTS.find((j) => j.l.join() === existing.landmarks_l.join()) || null
  }, [existing])

  const analysis = useMemo(() => {
    if (!rec) return null
    const o = { invert: opts.invert, joint: existing ? existingJoint?.key : opts.joint || undefined }
    if (existing && !opts.adjust) { o.fixedRest = Number(existing.rest_angle); o.fixedPeak = Number(existing.peak_angle) }
    return analyzeDemo(rec.frames, rec.aspect, o)
  }, [rec, opts, existing, existingJoint])

  const infoOk = info.name.trim().length >= 2 && info.primary_group
  const autoRef = useRef(null)
  const [auto, setAuto] = useState('') // '' | 'saving' | 'low'

  const save = async () => {
    if (!analysis || analysis.error) return
    setBusy(true); setErr('')
    const A = analysis
    const ghost = { ...A.ghost, mirror: !!rec.mirrored }
    const learned = {
      joint: A.joint.key, reps: A.reps, quality: A.quality, consistency: A.consistency, rom: A.rom,
      extreme: A.extreme, duration: A.duration, learned_rest: A.learnedRest, learned_peak: A.learnedPeak,
      recorded_at: new Date().toISOString(),
    }
    try {
      let body
      if (existing) {
        body = { id: existing.id, template: A.template, ghost, tempo: A.tempo, learned, ...(opts.adjust ? { rest_angle: A.rest, peak_angle: A.peak } : {}) }
      } else {
        const sec = info.secondary.filter((g) => g !== info.primary_group)
        const muscles = sec.length
          ? [{ group: info.primary_group, pct: 60 }, ...sec.map((g) => ({ group: g, pct: Math.round(40 / sec.length) }))]
          : [{ group: info.primary_group, pct: 100 }]
        body = {
          name: info.name.trim(), icon: info.icon, category: info.category.trim() || 'Personalizado',
          primary_group: info.primary_group, muscles, joint_label: A.joint.label,
          landmarks_l: A.joint.l, landmarks_r: A.joint.r, rest_angle: A.rest, peak_angle: A.peak,
          kcal_per_rep: info.effort, camera_hint: info.camera_hint, cue: info.cue,
          default_sets: info.default_sets, default_reps: info.default_reps,
          supports_load: info.supports_load, bw_factor: info.supports_load ? info.bw_factor : 0,
          template: A.template, ghost, tempo: A.tempo, learned,
        }
      }
      await api.adminSaveExercise(pin, body)
      notify(existing ? `✓ Demostración de «${existing.name}» guardada` : `✓ Ejercicio «${info.name}» creado y aprendido`)
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // Guarda solo, sin pedir confirmación, cuando el movimiento quedó bien registrado
  useEffect(() => {
    if (step !== 'review' || !analysis || analysis.error) { setAuto(''); return }
    const good = analysis.quality >= AUTO_QUALITY && analysis.reps >= 3
    if (!good) { setAuto('low'); return }
    if (autoRef.current === rec) return
    autoRef.current = rec
    setAuto('saving')
    save()
  }, [step, analysis]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="trainer">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{existing ? `🎬 Grabar demostración · ${existing.name}` : '🎓 Entrenar un ejercicio nuevo'}</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            El sistema aprende de tu movimiento: articulación, ángulos, ritmo y forma correcta. No se guarda video, solo el esqueleto.
          </div>
        </div>
        <GlowButton variant="sm icon hot ghost" onClick={onClose} type="button">✕</GlowButton>
      </div>

      <Steps current={step} existing={!!existing} />

      {step === 'info' && (
        <div className="trainer-body">
          <div className="form-grid">
            <label className="fld" style={{ gridColumn: '1 / -1' }}>
              <span>Nombre del ejercicio <b className="req">*</b></span>
              <input className="text-input" maxLength={40} value={info.name} onChange={(e) => setI('name', e.target.value)} placeholder="Ej.: Jab-cross con pivote" />
            </label>
            <div className="fld">
              <span>Icono</span>
              <div className="emoji-row">
                {ICONS.map((ic) => <button key={ic} type="button" className={info.icon === ic ? 'on' : ''} onClick={() => setI('icon', ic)}>{ic}</button>)}
              </div>
            </div>
            <label className="fld">
              <span>Categoría</span>
              <input className="text-input" list="cats" value={info.category} onChange={(e) => setI('category', e.target.value)} />
              <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="fld">
              <span>Músculo principal <b className="req">*</b></span>
              <select className="text-input" value={info.primary_group} onChange={(e) => setI('primary_group', e.target.value)}>
                <option value="">— Elige —</option>
                {Object.values(groups).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <div className="fld" style={{ gridColumn: '1 / -1' }}>
              <span>Músculos secundarios</span>
              <div className="chips-row">
                {Object.values(groups).filter((g) => g.id !== info.primary_group).map((g) => {
                  const on = info.secondary.includes(g.id)
                  return (
                    <button key={g.id} type="button" className={`chip-btn ${on ? 'on' : ''}`}
                      onClick={() => setI('secondary', on ? info.secondary.filter((x) => x !== g.id) : [...info.secondary, g.id])}>
                      <span className="dot" style={{ background: g.color, marginRight: 6 }} />{g.name}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="fld">
              <span>Intensidad (gasto de energía)</span>
              <div className="seg">
                {EFFORT.map(([l, v]) => <button key={l} type="button" className={info.effort === v ? 'on' : ''} onClick={() => setI('effort', v)}>{l}</button>)}
              </div>
            </div>
            <div className="fld">
              <span>Series × repeticiones sugeridas</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="text-input mono" inputMode="numeric" value={info.default_sets} onChange={(e) => setI('default_sets', +e.target.value.replace(/\D/g, '') || 1)} />
                <input className="text-input mono" inputMode="numeric" value={info.default_reps} onChange={(e) => setI('default_reps', +e.target.value.replace(/\D/g, '') || 1)} />
              </div>
            </div>
            <div className="fld">
              <span>¿Se hace con peso adicional?</span>
              <div className="seg">
                <button type="button" className={!info.supports_load ? 'on' : ''} onClick={() => setI('supports_load', false)}>No</button>
                <button type="button" className={info.supports_load ? 'on' : ''} onClick={() => setI('supports_load', true)}>Sí</button>
              </div>
            </div>
            {info.supports_load && (
              <label className="fld">
                <span>Parte del peso corporal que mueve</span>
                <select className="text-input" value={info.bw_factor} onChange={(e) => setI('bw_factor', +e.target.value)}>
                  <option value={0}>Ninguna (solo la carga)</option>
                  <option value={0.65}>Parte (como flexiones)</option>
                  <option value={0.75}>Mayor parte (como sentadilla)</option>
                  <option value={1}>Todo (como dominadas)</option>
                </select>
              </label>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <GlowButton variant="sm ghost" type="button" disabled={aiBusy || info.name.trim().length < 2} onClick={async () => {
                setAiBusy(true)
                try {
                  const r = await api.adminAiCue(pin, info.name.trim(), info.category, null)
                  setInfo((s2) => ({ ...s2, cue: r.cue || s2.cue, camera_hint: r.camera_hint || s2.camera_hint }))
                } catch (e) { notify(e.message) } finally { setAiBusy(false) }
              }}>{aiBusy ? 'Generando…' : '✨ Redactar indicación y cámara con IA'}</GlowButton>
            </div>
            <label className="fld" style={{ gridColumn: '1 / -1' }}>
              <span>Indicación técnica para el cliente</span>
              <input className="text-input" maxLength={120} value={info.cue} onChange={(e) => setI('cue', e.target.value)} placeholder="Ej.: Guardia arriba, gira la cadera al lanzar el golpe" />
            </label>
            <label className="fld" style={{ gridColumn: '1 / -1' }}>
              <span>Cómo colocar la cámara</span>
              <input className="text-input" maxLength={120} value={info.camera_hint} onChange={(e) => setI('camera_hint', e.target.value)} placeholder="Ej.: Cámara lateral, cuerpo completo visible" />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            <GlowButton variant="ghost" onClick={onClose}>Cancelar</GlowButton>
            <GlowButton variant="solid" disabled={!infoOk} onClick={() => setStep('record')}>Siguiente · grabar demostración →</GlowButton>
          </div>
        </div>
      )}

      {step === 'record' && (
        <div className="trainer-body">
          {existing && !existingJoint && (
            <div className="form-err">Este ejercicio usa una articulación que el aprendizaje no admite todavía.</div>
          )}
          <RecorderStage
            onCancel={() => (existing ? onClose() : setStep('info'))}
            onDone={(r) => { setRec(r); setOpts((o) => ({ ...o, invert: false, joint: null })); setStep('review') }}
          />
        </div>
      )}

      {step === 'review' && analysis && (
        <div className="trainer-body">
          {analysis.error ? (
            <>
              <div className="form-err">{analysis.error}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                <GlowButton variant="ghost" onClick={onClose}>Cancelar</GlowButton>
                <GlowButton variant="solid" onClick={() => { setRec(null); setStep('record') }}>🔁 Grabar de nuevo</GlowButton>
              </div>
            </>
          ) : (
            <Review A={analysis} existing={existing} opts={opts} setOpts={setOpts}
              onAgain={() => { setRec(null); autoRef.current = null; setAuto(''); setStep('record') }} onSave={save} busy={busy} err={err} auto={auto} />
          )}
        </div>
      )}
    </div>
  )
}

function Steps({ current, existing }) {
  const all = existing ? [['record', 'Grabar'], ['review', 'Revisar y guardar']] : [['info', 'Datos'], ['record', 'Grabar'], ['review', 'Revisar y guardar']]
  const idx = all.findIndex(([k]) => k === current)
  return (
    <div className="steps">
      {all.map(([k, l], i) => (
        <div key={k} className={`step ${i === idx ? 'on' : i < idx ? 'done' : ''}`}><b>{i < idx ? '✓' : i + 1}</b><span>{l}</span></div>
      ))}
    </div>
  )
}

/** Cámara en vivo con esqueleto; graba landmarks (no video) mientras el coach hace el ejercicio. */
function RecorderStage({ onDone, onCancel }) {
  const recRef = useRef({ on: false, frames: [], aspect: 1 })
  const facingRef = useRef('user')
  const seenRef = useRef(0)
  const [phase, setPhase] = useState('idle') // idle | count | rec
  const [count, setCount] = useState(5)
  const [secs, setSecs] = useState(0)
  const [seen, setSeen] = useState(false)
  const [note, setNote] = useState('')
  useWakeLock(true)

  const cam = usePoseCamera({
    smoothing: { minCutoff: 1.2, beta: 8 },
    onFrame: ({ lm, now, ctx, W, H, video }) => {
      recRef.current.aspect = video.videoWidth / video.videoHeight
      const r = frameRect(video.videoWidth, video.videoHeight, W, H, 'contain')
      const mirror = facingRef.current === 'user'
      drawVideo(ctx, video, r, W, H, mirror)
      drawSkeleton(ctx, lm, projector(r, mirror), Math.max(2, Math.min(W, H) / 240))
      if (lm) {
        seenRef.current = [11, 12, 23, 24].every((i) => (lm[i].visibility ?? 0) > 0.5) ? 1 : 0
        if (recRef.current.on) recRef.current.frames.push(packFrame(lm, now))
      } else seenRef.current = 0
    },
  })
  facingRef.current = cam.facing

  useEffect(() => {
    const t = setInterval(() => {
      setSeen(!!seenRef.current)
      if (recRef.current.on && recRef.current.frames.length) {
        const f = recRef.current.frames
        setSecs((f[f.length - 1].t - f[0].t) / 1000)
      }
    }, 200)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (phase !== 'count') return
    if (count <= 0) { recRef.current = { ...recRef.current, on: true, frames: [] }; setSecs(0); setPhase('rec'); return }
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, count])

  const stop = () => {
    recRef.current.on = false
    const frames = recRef.current.frames
    setPhase('idle')
    onDone({ frames, aspect: recRef.current.aspect, mirrored: facingRef.current === 'user' })
  }
  useEffect(() => { if (phase === 'rec' && secs >= MAX_SECS) stop() }) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="rec-stage viewport" ref={cam.vpRef}>
        <video ref={cam.videoRef} playsInline muted autoPlay />
        <canvas ref={cam.canvasRef} />
        <div className="rec-top">
          <span className={`chip ${seen ? 'ok' : ''}`}>{seen ? '✓ Cuerpo visible' : '⚠ Colócate de cuerpo completo'}</span>
          {note && phase !== 'rec' && <span className="chip">{note}</span>}
          {phase === 'rec' && <span className="chip rec"><i className="rec-dot" /> {secs.toFixed(0)} / {MAX_SECS} s</span>}
        </div>
        {phase === 'count' && <div className="rec-count mono">{count}</div>}
        {cam.status === 'loading' && <div className="center-msg"><div><div className="loader" /><span className="muted">Cargando cámara…</span></div></div>}
        {cam.status === 'error' && <div className="center-msg"><div className="form-err">{cam.error}</div></div>}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '10px 0' }}>
        Colócate en la <b>posición inicial</b>, pulsa Grabar y haz <b>3 o más repeticiones</b> del movimiento de boxeo con la técnica ideal. La grabación dura <b>10 segundos</b> y se detiene sola; si queda bien registrada se guarda automáticamente.
        {' '}<span className="mono">{cam.fps} fps</span>
      </p>
      <div className="rec-actions">
        <GlowButton variant="ghost" onClick={onCancel} disabled={phase !== 'idle'}>← Atrás</GlowButton>
        <GlowButton variant="icon ghost" onClick={async () => { const r = await cam.flip(); setNote(r?.message || '') }} disabled={phase !== 'idle'} title="Cambiar cámara">{cam.facing === 'environment' ? '📷' : '🤳'}</GlowButton>
        {phase === 'idle' && <GlowButton variant="solid hot" disabled={cam.status !== 'ready' || !seen} onClick={() => { setCount(5); setPhase('count') }}>● Grabar 10 s (5 s de preparación)</GlowButton>}
        {phase === 'count' && <GlowButton variant="ghost" onClick={() => setPhase('idle')}>Cancelar</GlowButton>}
        {phase === 'rec' && <GlowButton variant="solid" disabled={secs < MIN_SECS} onClick={stop}>■ Detener ya</GlowButton>}
      </div>
    </div>
  )
}

function Review({ A, existing, opts, setOpts, onAgain, onSave, busy, err, auto }) {
  const q = A.quality
  const qColor = q >= 80 ? 'var(--ok)' : q >= 55 ? 'var(--warn)' : 'var(--hot)'
  const tpl = A.template.map((p, i) => ({ i, p, pct: Math.round((i / (A.template.length - 1)) * 100) }))
  return (
    <div>
      <div className="learn-grid">
        <div className="card" style={{ padding: 14, display: 'grid', placeItems: 'center', gap: 6 }}>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '.12em' }}>ASÍ LO APRENDIÓ</div>
          <GhostFigure ghost={{ ...A.ghost, mirror: false }} size={190} highlight={A.joint.l} />
          <div className="muted" style={{ fontSize: 12 }}>La articulación resaltada es la que mide</div>
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className="card kpi"><small>Articulación</small><b style={{ fontSize: 20 }}>{A.joint.label}</b></div>
            <div className="card kpi"><small>Calidad del aprendizaje</small><b style={{ color: qColor }}>{q}%</b></div>
            <div className="card kpi"><small>Repeticiones vistas</small><b>{A.reps}</b></div>
            <div className="card kpi"><small>Recorrido</small><b>{Math.round(A.rom)}°</b></div>
            <div className="card kpi"><small>Reposo → contracción</small><b style={{ fontSize: 18 }}>{Math.round(A.rest)}° → {Math.round(A.peak)}°</b></div>
            <div className="card kpi"><small>Ritmo (sube / baja)</small><b style={{ fontSize: 18 }}>{A.tempo.up}s / {A.tempo.down}s</b></div>
          </div>
          {A.warnings.map((w) => <div key={w} className="form-err" style={{ margin: 0 }}>⚠ {w}</div>)}
        </div>
      </div>

      <div className="charts" style={{ marginTop: 14 }}>
        <div className="card chart-card" style={{ minHeight: 220 }}>
          <h3>Ángulo de la {A.joint.label.toLowerCase()} en la grabación</h3>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={A.chart}>
              <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />
              <XAxis dataKey="t" {...AX} unit="s" /><YAxis {...AX} domain={['auto', 'auto']} />
              <Tooltip {...TT} />
              <ReferenceLine y={A.rest} stroke="#34d399" strokeDasharray="5 4" label={{ value: 'reposo', fill: '#34d399', fontSize: 10 }} />
              <ReferenceLine y={A.peak} stroke="#fbbf24" strokeDasharray="5 4" label={{ value: 'contracción', fill: '#fbbf24', fontSize: 10 }} />
              {A.repsAt.map((r, i) => <ReferenceLine key={i} x={Math.round(r.pk * 100) / 100} stroke="rgba(255,255,255,.18)" />)}
              <Line dataKey="angle" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card" style={{ minHeight: 220 }}>
          <h3>Curva modelo de una repetición</h3>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={tpl}>
              <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a78bfa" stopOpacity={0.6} /><stop offset="1" stopColor="#a78bfa" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />
              <XAxis dataKey="pct" {...AX} unit="%" /><YAxis {...AX} domain={[0, 1]} />
              <Area dataKey="p" stroke="#a78bfa" fill="url(#tg)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="learn-opts">
        {!existing && A.alternatives.length > 1 && (
          <label className="fld">
            <span>Articulación detectada</span>
            <select className="text-input" value={opts.joint || A.joint.key} onChange={(e) => setOpts((o) => ({ ...o, joint: e.target.value }))}>
              {A.alternatives.map((j) => <option key={j.key} value={j.key}>{j.label} (recorrido {j.range}°)</option>)}
            </select>
          </label>
        )}
        {!existing && (
          <GlowButton variant="sm ghost" onClick={() => setOpts((o) => ({ ...o, invert: !o.invert }))}>
            ↕ Invertir posición inicial {opts.invert ? '(activo)' : ''}
          </GlowButton>
        )}
        {existing && (
          <label className="chk">
            <input type="checkbox" checked={opts.adjust} onChange={(e) => setOpts((o) => ({ ...o, adjust: e.target.checked }))} />
            <span>Ajustar también los ángulos de reposo y contracción con mi demostración
              <small className="muted"> (actualmente {existing.rest_angle}° → {existing.peak_angle}°; aprendido {A.learnedRest}° → {A.learnedPeak}°)</small></span>
          </label>
        )}
      </div>

      {auto === 'saving' && !err && <div className="chip ok" style={{ marginTop: 12 }}>✓ Movimiento bien registrado · guardando automáticamente…</div>}
      {auto === 'low' && <div className="form-err">Calidad {q}% (mínimo {AUTO_QUALITY}% con 3 repeticiones): no se guardó solo. Graba de nuevo o guárdalo manualmente.</div>}
      {err && <div className="form-err">{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <GlowButton variant="ghost" onClick={onAgain}>🔁 Grabar de nuevo</GlowButton>
        <GlowButton variant="solid ok" disabled={busy} onClick={onSave}>{busy ? 'Guardando…' : existing ? '✓ Guardar demostración' : '✓ Crear ejercicio'}</GlowButton>
      </div>
    </div>
  )
}
