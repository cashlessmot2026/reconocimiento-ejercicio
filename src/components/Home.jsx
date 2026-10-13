import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { GlowButton, Modal, Stepper } from './ui'
import BodyMap from './BodyMap'
import FaceId from './FaceId'

const toItem = (ex, r) => ({
  exercise: ex, sets: r.sets, reps: r.reps, incline_deg: r.incline_deg, rest_sec: r.rest_sec,
  load_kg: Number(r.load_kg) || 0, stance: r.stance || 'orthodox', routine_id: r.id || null,
})

export default function Home({ boot, client, onEnter, onLogin, onLogout, onStart, notify }) {
  const { copy, exercises, groups } = boot
  const exById = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises])
  const [cat, setCat] = useState('Todos')
  const [config, setConfig] = useState(null)
  const cats = useMemo(() => ['Todos', ...new Set(exercises.map((e) => e.category))], [exercises])
  const shown = cat === 'Todos' ? exercises : exercises.filter((e) => e.category === cat)

  const routine = (client?.routine || []).filter((r) => exById[r.exercise_id])
  const routineLoads = useMemo(() => {
    const l = {}
    routine.forEach((r) => exById[r.exercise_id].muscles.forEach((m) => {
      l[m.group] = Math.min(1, (l[m.group] || 0) + (m.pct / 100) * 0.6)
    }))
    return l
  }, [routine, exById])

  const startRoutine = () =>
    onStart({
      queue: routine.map((r) => toItem(exById[r.exercise_id], r)),
    })

  const removeItem = async (r) => {
    try { await api.removeRoutine(client.code, r.id); await onEnter(client.code); notify('Ejercicio quitado de tu rutina') }
    catch (e) { notify(e.message) }
  }

  return (
    <>
      <section className="hero">
        <motion.div className="card hero-copy" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="chip" style={{ marginBottom: 16 }}>
            <span className="dot" style={{ background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
            Pose 33 puntos · ángulos · mapa muscular
          </span>
          <h2>Cada repetición, <span>medida en tiempo real.</span></h2>
          <p className="muted" style={{ maxWidth: 520, fontSize: 16, lineHeight: 1.55 }}>{copy.camera_tip}</p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <BodyMap groups={groups} loads={client ? routineLoads : { espalda: 0.9, biceps: 0.6, cuadriceps: 0.4, pecho: 0.5 }} size={150} />
            <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 180 }}>
              {Object.values(groups).slice(0, 6).map((g) => (
                <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span className="dot" style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} /> {g.name}
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div className="card code-box" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <CodeGate copy={copy} client={client} onEnter={onEnter} onLogin={onLogin} onLogout={onLogout} notify={notify} />
        </motion.div>
      </section>

      <AnimatePresence>
        {client && (
          <motion.section key="routine" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="section-title">
              <h2>{copy.my_routine}</h2>
              {routine.length > 0 && <GlowButton variant="solid ok" onClick={startRoutine}>▶ Iniciar rutina completa</GlowButton>}
            </div>
            {routine.length === 0 ? (
              <div className="card" style={{ padding: 20 }}>
                <p className="muted" style={{ margin: 0 }}>Aún no tienes rutina. Tu coach puede asignarla o elige ejercicios del catálogo y pulsa «Añadir a mi rutina».</p>
              </div>
            ) : (
              <div className="routine-list">
                {routine.map((r, i) => {
                  const ex = exById[r.exercise_id]
                  const g = groups[ex.primary_group]
                  return (
                    <motion.div key={r.id} className="card routine-item" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <div className="emoji">{ex.icon}</div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{ex.name}</div>
                        <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                          <span className="mono">{ex.kind === 'boxing' ? `${r.sets} rounds × ${r.reps}s` : `${r.sets}×${r.reps}`}</span>
                          {Number(r.load_kg) > 0 && <span style={{ color: 'var(--warn)' }}>🏋️ +{Number(r.load_kg)} kg</span>}
                          {ex.kind === 'boxing' ? <span>🥊 {r.stance === 'southpaw' ? 'Zurdo' : 'Ortodoxo'}</span> : <span>∠ {r.incline_deg}°</span>}
                          <span>⏱ {r.rest_sec}s</span>
                          <span style={{ color: g?.color }}>{g?.name}</span>
                          <span className="chip" style={{ padding: '1px 8px', fontSize: 11 }}>{r.assigned_by === 'coach' ? '🧑‍🏫 Coach' : '🙋 Tú'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <GlowButton variant="sm" onClick={() => onStart({ queue: [toItem(ex, r)] })}>▶</GlowButton>
                        {r.assigned_by === 'cliente' && <GlowButton variant="sm hot ghost" onClick={() => removeItem(r)}>✕</GlowButton>}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <div className="section-title">
        <h2>{copy.choose}</h2>
        <div className="tabs">
          {cats.map((c) => (
            <button key={c} className={`tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              {cat === c && <motion.i layoutId="tabpill" className="pill" />}
              <span>{c}</span>
            </button>
          ))}
        </div>
      </div>

      <motion.div className="ex-grid" layout>
        <AnimatePresence mode="popLayout">
          {shown.map((ex, i) => {
            const g = groups[ex.primary_group]
            return (
              <motion.button
                layout
                key={ex.id}
                className="ex-card"
                style={{ '--gc': g?.color }}
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.03, type: 'spring', stiffness: 260, damping: 24 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  if (!client) { notify('Primero ingresa tu número de cliente'); return }
                  setConfig(ex)
                }}
              >
                <div className="emoji">{ex.icon}</div>
                <h3>{ex.name}</h3>
                <div className="muted" style={{ fontSize: 13 }}>{ex.cue}</div>
                <div className="meta">
                  {ex.muscles.slice(0, 3).map((m) => (
                    <span key={m.group} className="chip" style={{ borderColor: groups[m.group]?.color + '55' }}>
                      <span className="dot" style={{ background: groups[m.group]?.color }} />
                      {groups[m.group]?.name} <span className="muted">{m.pct}%</span>
                    </span>
                  ))}
                </div>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </motion.div>

      <ExerciseConfig
        exercise={config}
        groups={groups}
        bodyKg={client?.body_weight_kg}
        onClose={() => setConfig(null)}
        onStart={(p) => { setConfig(null); onStart({ queue: [p] }) }}
        onSave={async (p) => {
          try {
            await api.addRoutine(client.code, { exercise_id: p.exercise.id, sets: p.sets, reps: p.reps, incline_deg: p.incline_deg, rest_sec: p.rest_sec, load_kg: p.load_kg, stance: p.stance })
            await onEnter(client.code)
            setConfig(null)
            notify(`${p.exercise.name} añadido a tu rutina`)
          } catch (e) { notify(e.message) }
        }}
      />
    </>
  )
}

function CodeGate({ copy, client, onEnter, onLogin, onLogout, notify }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [busy, setBusy] = useState(false)
  const [faceMode, setFaceMode] = useState(null)
  const [weight, setWeight] = useState('')
  const refs = [useRef(), useRef(), useRef(), useRef()]

  const submit = async (code) => {
    setBusy(true)
    try { await onLogin(code, 'code') } catch (e) { notify(e.message) } finally { setBusy(false); setDigits(['', '', '', '']) }
  }

  const setAt = (i, v) => {
    const d = v.replace(/\D/g, '')
    if (d.length > 1) { // pegado
      const arr = d.slice(0, 4).split('')
      const next = [0, 1, 2, 3].map((k) => arr[k] || '')
      setDigits(next)
      if (next.every(Boolean)) submit(next.join(''))
      else refs[Math.min(arr.length, 3)].current?.focus()
      return
    }
    const next = [...digits]; next[i] = d
    setDigits(next)
    if (d && i < 3) refs[i + 1].current?.focus()
    if (next.every(Boolean)) submit(next.join(''))
  }

  if (client) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12, letterSpacing: '0.12em' }}>CLIENTE ACTIVO</div>
            <div className="mono" style={{ fontSize: 40, fontWeight: 700, textShadow: '0 0 24px var(--accent)' }}>{client.code}</div>
            {client.name && <div>{client.name}</div>}
          </div>
          <GlowButton variant="sm ghost" onClick={() => { setDigits(['', '', '', '']); onLogout() }}>Cambiar</GlowButton>
        </div>
        <div className="stats-row">
          <div className="stat"><b>{client.today?.sets ?? 0}</b><span>Series hoy</span></div>
          <div className="stat"><b>{client.today?.reps ?? 0}</b><span>Reps hoy</span></div>
          <div className="stat"><b>{client.today?.kcal ?? 0}</b><span>kcal</span></div>
        </div>
        <div className="profile-row">
          <label className="muted" style={{ fontSize: 12 }}>Peso corporal (kg)</label>
          <input className="text-input mono" inputMode="decimal" style={{ maxWidth: 110 }} placeholder={client.body_weight_kg ? String(client.body_weight_kg) : '—'}
            value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))} />
          <GlowButton variant="sm" disabled={!weight} onClick={async () => {
            try { await api.setWeight(client.code, Number(weight)); await onEnter(client.code); setWeight(''); notify('Peso guardado') } catch (e) { notify(e.message) }
          }}>Guardar</GlowButton>
        </div>
        <span className="chip" style={{ alignSelf: 'flex-start', borderColor: 'rgba(52,211,153,.5)' }}>
          <span className="dot" style={{ background: 'var(--ok)', boxShadow: '0 0 8px var(--ok)' }} />
          Identidad verificada · rostro registrado ({client.face_samples} muestras)
        </span>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Todo lo que entrenes se registrará en este código.</p>
      </>
    )
  }

  return (
    <>
      <div>
        <h3 style={{ margin: 0, fontSize: 22 }}>{copy.enter_code}</h3>
        <p className="muted" style={{ margin: '6px 0 0' }}>{copy.enter_hint}</p>
      </div>
      <div className={`code-inputs ${digits.every(Boolean) ? 'done' : ''}`}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            value={d}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={i === 0 ? 4 : 1}
            disabled={busy}
            aria-label={`Dígito ${i + 1}`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) refs[i - 1].current?.focus() }}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
      <GlowButton variant="solid" disabled={!digits.every(Boolean) || busy} onClick={() => submit(digits.join(''))}>
        {busy ? 'Verificando…' : copy.start}
      </GlowButton>
      <div className="or-sep"><span>o</span></div>
      <GlowButton variant="ghost" onClick={() => setFaceMode('identify')}>🙂 Entrar con reconocimiento facial</GlowButton>
      <FaceId open={faceMode === 'identify'} mode="identify" onClose={() => setFaceMode(null)}
        onIdentified={async (r) => {
          setFaceMode(null)
          try { await onLogin(r.code, 'face'); notify(`¡Hola! Cliente ${r.code} · confianza ${r.confidence}%`) } catch (e) { notify(e.message) }
        }} />
    </>
  )
}

function ExerciseConfig({ exercise, groups, bodyKg, onClose, onStart, onSave }) {
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(10)
  const [incline, setIncline] = useState(0)
  const [rest, setRest] = useState(60)
  const [load, setLoad] = useState(0)
  const [stance, setStance] = useState('orthodox')
  const [lastId, setLastId] = useState(null)
  if (exercise && exercise.id !== lastId) {
    setLastId(exercise.id); setSets(exercise.default_sets); setReps(exercise.default_reps); setIncline(0); setRest(60); setLoad(0)
  }
  const boxing = exercise?.kind === 'boxing'
  const p = exercise && { exercise, sets, reps, incline_deg: boxing ? 0 : incline, rest_sec: rest, load_kg: exercise.supports_load ? load : 0, stance, routine_id: null }
  const bw = Number(bodyKg) || 70
  const eff = exercise ? bw * Number(exercise.bw_factor || 0) + load : 0
  return (
    <Modal open={!!exercise} onClose={onClose}>
      {exercise && (
        <>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 44 }}>{exercise.icon}</div>
            <div>
              <h2 style={{ margin: 0 }}>{exercise.name}</h2>
              <div className="muted" style={{ fontSize: 13 }}>{exercise.camera_hint}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
            {exercise.muscles.map((m) => (
              <span key={m.group} className="chip"><span className="dot" style={{ background: groups[m.group]?.color }} />{groups[m.group]?.name} {m.pct}%</span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>{boxing ? 'Rounds' : 'Series'}</label><Stepper value={sets} onChange={setSets} max={boxing ? 12 : 20} /></div>
            {boxing
              ? <div className="field"><label>Segundos por round</label><Stepper value={reps} onChange={setReps} min={15} max={300} step={15} /></div>
              : <div className="field"><label>Repeticiones</label><Stepper value={reps} onChange={setReps} max={100} /></div>}
          </div>
          {boxing ? (
            <div className="field">
              <label>Guardia</label>
              <div className="tabs" style={{ width: 'fit-content' }}>
                {[['orthodox', 'Ortodoxo (izq. adelante)'], ['southpaw', 'Zurdo (der. adelante)']].map(([k, l]) => (
                  <button key={k} type="button" className={`tab ${stance === k ? 'active' : ''}`} onClick={() => setStance(k)}>
                    {stance === k && <motion.i layoutId="stancepill" className="pill" />}<span>{l}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="field">
              <label>Grados de inclinación (banco / superficie) <b>{incline}°</b></label>
              <input type="range" min={-45} max={90} step={5} value={incline} onChange={(e) => setIncline(+e.target.value)} />
            </div>
          )}
          {exercise.supports_load && (
            <div className="field">
              <label>Lastre / carga adicional <b>+{load} kg</b></label>
              <Stepper value={load} onChange={setLoad} min={0} max={200} step={2.5} />
              <span className="muted" style={{ fontSize: 12 }}>
                Carga por repetición: {Number(exercise.bw_factor) > 0 ? `${bw} kg × ${exercise.bw_factor} + ${load} kg = ` : ''}<b className="mono" style={{ color: 'var(--warn)' }}>{eff.toFixed(1)} kg</b>
                {!bodyKg && Number(exercise.bw_factor) > 0 ? ' (registra tu peso para mayor exactitud)' : ''}
              </span>
            </div>
          )}
          <div className="field">
            <label>Descanso entre series <b>{rest}s</b></label>
            <input type="range" min={15} max={240} step={15} value={rest} onChange={(e) => setRest(+e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
            <GlowButton variant="ghost" onClick={() => onSave(p)}>＋ Añadir a mi rutina</GlowButton>
            <GlowButton variant="solid" onClick={() => onStart(p)}>▶ Empezar</GlowButton>
          </div>
        </>
      )}
    </Modal>
  )
}
