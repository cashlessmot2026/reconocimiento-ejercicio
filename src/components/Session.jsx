import { useState } from 'react'
import { motion } from 'framer-motion'
import { GlowButton } from './ui'
import Workout from './Workout'
import Boxing from './Boxing'

/** Ejecuta la cola de ejercicios (fuerza y boxeo) y muestra el resumen final. */
export default function Session({ boot, client, plan, onExit, notify }) {
  const [qi, setQi] = useState(0)
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
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
            <GlowButton variant="solid" onClick={onExit}>Volver al inicio</GlowButton>
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
