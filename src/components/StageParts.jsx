import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GlowButton } from './ui'
import { TvSheet } from './DisplayControls'
import { useFullscreen } from '../lib/display'

export function speak(text, on) {
  if (!on || !('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-ES'; u.rate = 1.2
    speechSynthesis.cancel(); speechSynthesis.speak(u)
  } catch { /* sin voz */ }
}

export function TopControls({ cam, sound, setSound, onExit, extra, notify }) {
  const [menu, setMenu] = useState(false)
  const [tv, setTv] = useState(false)
  const fs = useFullscreen()
  const rear = cam.facing === 'environment'

  const run = async (fn) => { const r = await fn(); if (r?.message) notify?.(r.message) }
  const toggleFs = async () => { if (!(await fs.toggle())) notify?.('El navegador no permitió la pantalla completa') }

  return (
    <div className="hud-tr">
      <GlowButton variant="icon ghost" title={rear ? 'Cámara trasera · toca para usar la frontal' : 'Cámara frontal · toca para usar la trasera'} onClick={() => run(cam.flip)}>
        {rear ? '📷' : '🤳'}
      </GlowButton>
      {fs.supported && (
        <GlowButton variant="icon ghost" title={fs.on ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={toggleFs}>{fs.on ? '⤓' : '⛶'}</GlowButton>
      )}
      <GlowButton variant="icon ghost" title="Más opciones" onClick={() => setMenu((m) => !m)} style={{ opacity: menu ? 1 : 0.9 }}>⋯</GlowButton>
      <GlowButton variant="icon hot" title="Salir" onClick={onExit}>✕</GlowButton>

      <AnimatePresence>
        {menu && (
          <motion.div className="hud-menu card" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            {extra && <div className="menu-row">{extra}</div>}
            <button className="menu-item" onClick={() => run(cam.switchModel)}>
              <span>{cam.model === 'lite' ? '⚡' : '🎯'}</span> Análisis: {cam.model === 'lite' ? 'rápido' : 'preciso'}
            </button>
            <button className="menu-item" onClick={() => setSound((v) => !v)}>
              <span>{sound ? '🔊' : '🔇'}</span> Voz: {sound ? 'activada' : 'desactivada'}
            </button>
            <button className="menu-item" onClick={() => { setTv(true); setMenu(false) }}>
              <span>📺</span> Pantalla y TV
            </button>
            {cam.cameras?.length > 1 && (
              <div className="menu-cams">
                <div className="muted" style={{ fontSize: 11, letterSpacing: '.1em', padding: '6px 12px 2px' }}>CÁMARAS</div>
                {cam.cameras.map((c) => (
                  <button key={c.id} className={`menu-item ${c.id === cam.activeId ? 'on' : ''}`} onClick={() => { run(() => cam.selectCamera(c.id)); setMenu(false) }}>
                    <span>{c.facing === 'environment' ? '📷' : c.facing === 'user' ? '🤳' : '🎥'}</span>
                    <span className="menu-cam-label">{c.label}</span>
                    {c.id === cam.activeId && <b>✓</b>}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <TvSheet open={tv} onClose={() => setTv(false)} notify={notify} />
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
            <div>
              <div className="loader" />
              <b>{cam.stage === 'model' ? 'Cargando el modelo de visión…' : 'Abriendo la cámara…'}</b>
              <p className="muted">{cam.stage === 'model' ? 'La primera vez descarga unos MB; las siguientes es inmediato.' : 'Si el navegador pide permiso de cámara, acéptalo.'}</p>
              {hint && <p className="muted">{hint}</p>}
              <GlowButton variant="sm ghost" onClick={onBack}>Cancelar</GlowButton>
            </div>
          ) : (
            <div className="card" style={{ padding: 24, maxWidth: 420 }}>
              <h3 style={{ marginTop: 0 }}>No se pudo iniciar la cámara</h3>
              <p className="muted">{cam.error}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {cam.retry && <GlowButton variant="solid" onClick={cam.retry}>↻ Reintentar</GlowButton>}
                <GlowButton variant="ghost" onClick={onBack}>Volver</GlowButton>
              </div>
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
