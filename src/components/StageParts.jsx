import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GlowButton } from './ui'

export function speak(text, on) {
  if (!on || !('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-ES'; u.rate = 1.2
    speechSynthesis.cancel(); speechSynthesis.speak(u)
  } catch { /* sin voz */ }
}

export function TopControls({ cam, sound, setSound, onExit, extra }) {
  return (
    <div className="hud-tr">
      {extra}
      <GlowButton variant="icon ghost" title="Cambiar cámara" onClick={cam.flip}>🔄</GlowButton>
      <GlowButton variant="icon ghost" title={cam.model === 'lite' ? 'Modo rápido (toca para preciso)' : 'Modo preciso (toca para rápido)'} onClick={cam.switchModel}>
        {cam.model === 'lite' ? '⚡' : '🎯'}
      </GlowButton>
      <GlowButton variant="icon ghost" title="Voz" onClick={() => setSound((v) => !v)}>{sound ? '🔊' : '🔇'}</GlowButton>
      <GlowButton variant="icon hot" title="Salir" onClick={onExit}>✕</GlowButton>
    </div>
  )
}

export function PerfBadge({ cam }) {
  return (
    <span className="mono" title="Fotogramas analizados por segundo · ms de inferencia">
      {cam.fps} fps · {cam.latency} ms · {cam.model === 'lite' ? 'rápido' : 'preciso'}{cam.delegate ? ` · ${cam.delegate}` : ''}
    </span>
  )
}

/** Cuenta regresiva genérica: llama onZero cuando llega a 0. */
export function useCountdown(active, count, setCount, onZero, tickSound) {
  useEffect(() => {
    if (!active) return
    if (count <= 0) { onZero(); return }
    tickSound?.(count)
    const t = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [active, count]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function CamOverlays({ cam, onBack, hint }) {
  return (
    <AnimatePresence>
      {(cam.status === 'loading' || cam.status === 'error') && (
        <motion.div className="center-msg" style={{ background: 'rgba(4,6,14,.85)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {cam.status === 'loading' ? (
            <div><div className="loader" /><b>Cargando visión artificial…</b><p className="muted">{hint}</p></div>
          ) : (
            <div className="card" style={{ padding: 24, maxWidth: 420 }}>
              <h3 style={{ marginTop: 0 }}>No se pudo iniciar la cámara</h3>
              <p className="muted">{cam.error}</p>
              <GlowButton variant="solid" onClick={onBack}>Volver</GlowButton>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function BigCount({ label, count, sub, dim }) {
  return (
    <motion.div className="center-msg" style={{ background: dim ? 'rgba(4,6,14,.6)' : 'transparent', pointerEvents: 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div>
        <div className="muted" style={{ letterSpacing: '0.2em' }}>{label}</div>
        <AnimatePresence mode="popLayout">
          <motion.div key={count} className="rest-ring" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
            {count}
          </motion.div>
        </AnimatePresence>
        {sub && <div className="muted">{sub}</div>}
      </div>
    </motion.div>
  )
}

export function Metric({ label, value, color }) {
  return <div className="metric"><small>{label}</small><b style={color ? { color } : undefined}>{value}</b></div>
}

export const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : +Number(v).toFixed(d))
