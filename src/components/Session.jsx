import { useState } from 'react'
import { motion } from 'framer-motion'
import { GlowButton } from './ui'
import { AiTextModal } from './AiParts'
import { api } from '../lib/api'
import Workout from './Workout'
import Boxing from './Boxing'

const r1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10)

/** Resumen compacto y anónimo de la sesión para la IA. */
function sessionStats(rows, boot) {
  const by = {}
  rows.forEach((r) => {
    const ex = boot.exercises.find((e) => e.id === r.exercise_id)
    const k = r.exercise_id
    by[k] = by[k] || { ejercicio: ex?.name || k, tipo: ex?.kind, series: [] }
    const sims = (r.rep_log || []).map((x) => x.similarity).filter((v) => v != null)
    by[k].series.push({
      reps: r.reps, objetivo: r.target_reps, forma: r1(r.form_score), rom_grados: r1(r.avg_rom),
      seg_por_rep: r1(r.avg_rep_sec), fatiga_pct: r1(r.fatigue_pct), carga_kg: r.load_kg || 0, inclinacion: r.incline_deg,
      similitud_demo: sims.length ? r1(sims.reduce((a, b) => a + b, 0) / sims.length) : null,
      velocidad_golpe: r1(r.avg_punch_speed), precision_pct: r1(r.accuracy), guardia_pct: r1(r.guard_pct),
    })
  })
  return { ejercicios: Object.values(by).slice(0, 6).map((e) => ({ ...e, series: e.series.slice(0, 6) })) }
}

/** Ejecuta la cola de ejercicios (fuerza y boxeo) y muestra el resumen final. */
export default function Session({ boot, client, plan, onExit, notify }) {
  const [qi, setQi] = useState(0)
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const item = plan.queue[qi]
  const isLast = qi === plan.queue.length - 1

  const onFinish = (log) => {
    setRows((r) => [...r, ...log])
    if (isLast) setDone(true)
    else setQi((q) => q + 1)
  }

  if (done) {
    const reps = rows.filter((r) => !r.punches).reduce((a, r) => a + r.reps, 0)
    const punches = rows.filter((r) => r.punches).reduce((a, r) => a + r.reps, 0)
    const vol = rows.reduce((a, r) => a + (r.volume_kg || 0), 0)
    return (
      <motion.div className="stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="center-msg" style={{ background: 'radial-gradient(60% 50% at 50% 40%, rgba(34,211,238,.14), #05070f)' }}>
          <motion.div className="card" style={{ padding: 28, maxWidth: 480, width: '100%' }} initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }}>
            <div style={{ fontSize: 46 }}>🏆</div>
            <h2 style={{ margin: '6px 0' }}>¡Entrenamiento completado!</h2>
            <div className="stats-row" style={{ margin: '16px 0', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' }}>
              <div className="stat"><b>{rows.length}</b><span>Series</span></div>
              {reps > 0 && <div className="stat"><b>{reps}</b><span>Reps</span></div>}
              {punches > 0 && <div className="stat"><b>{punches}</b><span>Golpes</span></div>}
              {vol > 0 && <div className="stat"><b>{Math.round(vol)}</b><span>kg volumen</span></div>}
              <div className="stat"><b>{rows.reduce((a, r) => a + (r.kcal || 0), 0).toFixed(1)}</b><span>kcal</span></div>
            </div>
            <p className="muted">Registrado en el cliente <b className="mono">{client.code}</b></p>
            <div style={{ display: 'grid', gap: 10 }}>
              <GlowButton variant="ghost" onClick={() => setTipOpen(true)}>✨ Comentario de técnica con IA</GlowButton>
              <GlowButton variant="solid" onClick={onExit}>Volver al inicio</GlowButton>
            </div>
            <AiTextModal open={tipOpen} onClose={() => setTipOpen(false)} title="Comentario de tu entrenador"
              hint="Basado en los números de tu sesión (sin datos personales)." run={() => api.aiTip(client.code, sessionStats(rows, boot))} />
          </motion.div>
        </div>
      </motion.div>
    )
  }

  const Comp = item.exercise.kind === 'boxing' ? Boxing : Workout
  return (
    <Comp
      key={qi}
      boot={boot}
      client={client}
      item={item}
      autoStart={qi > 0}
      isLast={isLast}
      nextName={plan.queue[qi + 1]?.exercise.name}
      onFinish={onFinish}
      onExit={onExit}
      notify={notify}
    />
  )
}
