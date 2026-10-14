import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { cameraError, describeFace, descDistance, loadFace, openCamera, trackFace } from '../lib/face'
import { GlowButton } from './ui'

/*
 * Modos:
 *  - enroll  (obligatorio la primera vez, una sola vez): anillo de 11 ángulos.
 *  - identify: 3 descriptores frontales + prueba de vida → búsqueda 1:N en Supabase.
 *  - verify:   igual, pero comparación 1:1 contra el código introducido.
 *
 * Rapidez: el seguimiento (pose, calidad, parpadeo) corre en cada fotograma con MediaPipe;
 * el descriptor de 128-d solo se calcula cuando la cabeza está quieta en un ángulo que falta.
 *
 * yaw > 0 = la persona gira hacia SU izquierda (en la vista espejo, a la izquierda de la pantalla).
 * pitch < 0 = mira hacia arriba (relativo a su línea base frontal).
 */
const CELLS = [
  { id: 'center', need: 3, label: 'Mira de frente a la cámara', a: null, test: (y, p) => Math.abs(y) < 0.06 && Math.abs(p) < 0.05 },
  { id: 'l1', need: 2, label: 'Gira un poco a tu izquierda', a: 180, r: 0.78, test: (y, p) => y > 0.07 && y <= 0.17 && Math.abs(p) < 0.08 },
  { id: 'l2', need: 1, label: 'Gira más a tu izquierda', a: 180, r: 1.0, test: (y, p) => y > 0.17 && y < 0.45 && Math.abs(p) < 0.1 },
  { id: 'r1', need: 2, label: 'Gira un poco a tu derecha', a: 0, r: 0.78, test: (y, p) => y < -0.07 && y >= -0.17 && Math.abs(p) < 0.08 },
  { id: 'r2', need: 1, label: 'Gira más a tu derecha', a: 0, r: 1.0, test: (y, p) => y < -0.17 && y > -0.45 && Math.abs(p) < 0.1 },
  { id: 'u', need: 1, label: 'Levanta un poco la barbilla', a: 270, r: 1.0, test: (y, p) => p < -0.045 && Math.abs(y) < 0.08 },
  { id: 'd', need: 1, label: 'Baja un poco la barbilla', a: 90, r: 1.0, test: (y, p) => p > 0.045 && Math.abs(y) < 0.08 },
  { id: 'ul', need: 1, label: 'Arriba y hacia tu izquierda', a: 225, r: 1.0, test: (y, p) => p < -0.03 && y > 0.06 && y < 0.4 },
  { id: 'ur', need: 1, label: 'Arriba y hacia tu derecha', a: 315, r: 1.0, test: (y, p) => p < -0.03 && y < -0.06 && y > -0.4 },
  { id: 'dl', need: 1, label: 'Abajo y hacia tu izquierda', a: 135, r: 1.0, test: (y, p) => p > 0.03 && y > 0.06 && y < 0.4 },
  { id: 'dr', need: 1, label: 'Abajo y hacia tu derecha', a: 45, r: 1.0, test: (y, p) => p > 0.03 && y < -0.06 && y > -0.4 },
]
const TOTAL = CELLS.reduce((a, c) => a + c.need, 0)

export default function FaceId({ open, mode, code, mandatory, consentText, onClose, onIdentified, onEnrolled, onVerified }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" style={{ zIndex: 70 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="card sheet face-sheet" initial={{ y: 40, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, opacity: 0 }}>
            <FaceInner key={mode + code} mode={mode} code={code} mandatory={mandatory} consentText={consentText}
              onClose={onClose} onIdentified={onIdentified} onEnrolled={onEnrolled} onVerified={onVerified} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FaceInner({ mode, code, mandatory, consentText, onClose, onIdentified, onEnrolled, onVerified }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const runRef = useRef(true)
  const uiT = useRef(0)
  const hist = useRef([])
  const blinkRef = useRef({ open: false, blinked: false })
  const [phase, setPhase] = useState(mode === 'enroll' ? 'consent' : 'loading')
  const [msg, setMsg] = useState('Cargando reconocimiento facial…')
  const [q, setQ] = useState(null)
  const [fps, setFps] = useState(0)
  const [progress, setProgress] = useState(0)
  const [cells, setCells] = useState({})
  const [nextCell, setNextCell] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [pinMode, setPinMode] = useState(false)

  useEffect(() => {
    if (phase === 'consent') return
    runRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        setMsg('Cargando reconocimiento facial…')
        const [, stream] = await Promise.all([
          loadFace(),
          openCamera({ facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } }),
        ])
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setPhase('scan')
        if (mode === 'enroll') await runEnroll()
        else await runMatch()
      } catch (e) {
        if (cancelled || e.message === 'cancel') return
        setError(cameraError(e))
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
      runRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt, phase === 'consent']) // eslint-disable-line react-hooks/exhaustive-deps

  // Siguiente fotograma con seguimiento rápido
  const fpsC = useRef({ n: 0, t: 0 })
  async function next() {
    const v = videoRef.current
    if (!runRef.current || !v) throw new Error('cancel')
    // Nuevo fotograma de la cámara; si el navegador no lo notifica (ventana oculta, ahorro de energía), respaldo por temporizador
    await new Promise((r) => {
      let done = false
      const fin = () => { if (!done) { done = true; r() } }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fin)
      else requestAnimationFrame(fin)
      setTimeout(fin, 90)
    })
    if (!runRef.current) throw new Error('cancel')
    const now = performance.now()
    const f = trackFace(v, now)
    draw(f)
    // historial para estabilidad y parpadeo
    if (f) {
      hist.current.push({ y: f.quality.yaw, p: f.quality.pitchRaw, t: now })
      if (hist.current.length > 8) hist.current.shift()
      const b = blinkRef.current
      if (f.quality.blink < 0.25) b.open = true
      if (b.open && f.quality.blink > 0.55) b.blinked = true
    } else hist.current = []
    const c = fpsC.current
    c.n++
    if (now - c.t > 1000) { setFps(c.n); c.n = 0; c.t = now }
    if (now - uiT.current > 120) { uiT.current = now; setQ(f?.quality || null) }
    return f
  }

  const stable = () => {
    const h = hist.current
    if (h.length < 4) return false
    const ys = h.slice(-4).map((s) => s.y), ps = h.slice(-4).map((s) => s.p)
    return Math.max(...ys) - Math.min(...ys) < 0.03 && Math.max(...ps) - Math.min(...ps) < 0.03
  }

  // ---------- Identificación / verificación ----------
  async function runMatch() {
    const front = []
    let lastT = 0
    blinkRef.current = { open: false, blinked: false }
    setMsg('Mira de frente a la cámara')
    while (front.length < 3) {
      const f = await next()
      if (!f || !f.quality.good || !f.quality.frontal || !stable()) continue
      if (performance.now() - lastT < 120) continue
      const d = await describeFace(videoRef.current)
      if (!d) continue
      if (front.length && descDistance(d.descriptor, front[front.length - 1]) > 0.42) { front.length = 0; continue }
      front.push(d.descriptor); lastT = performance.now()
      setProgress(front.length / 5)
    }
    // Prueba de vida: parpadeo (puede haber ocurrido ya) o giro de cabeza
    if (!blinkRef.current.blinked) {
      setMsg('Prueba de vida: parpadea o gira la cabeza a un lado')
      const t0 = performance.now()
      let live = false
      while (!live) {
        if (performance.now() - t0 > 12000) throw new Error('No se completó la prueba de vida. Inténtalo de nuevo.')
        const f = await next()
        if (!f) continue
        if (blinkRef.current.blinked || Math.abs(f.quality.yaw) > 0.15) live = true
      }
    }
    setProgress(0.85)
    setMsg(mode === 'verify' ? 'Verificando que eres el titular del código…' : 'Buscando tu perfil…')
    setPhase('check')
    const r = mode === 'verify' ? await api.faceVerify(code, front) : await api.faceIdentify(front)
    setProgress(1)
    setResult(r)
    setPhase(r.match ? 'ok' : 'fail')
    if (r.match) setTimeout(() => (mode === 'verify' ? onVerified(r) : onIdentified(r)), 900)
  }

  // ---------- Registro multi-ángulo ----------
  async function runEnroll() {
    const samples = []                      // { pose, d, pr }
    const count = Object.fromEntries(CELLS.map((c) => [c.id, 0]))
    let base = null                         // línea base de pitch (media de las frontales)
    let centerMean = null
    const lastByCell = {}
    const t0 = performance.now()
    const pending = () => CELLS.filter((c) => count[c.id] < c.need)
    const poses = () => CELLS.filter((c) => count[c.id] > 0).length
    const enough = () => samples.length >= 12 && poses() >= 8 && count.center >= 3
    const update = () => {
      setCells({ ...count })
      setProgress(samples.length / TOTAL)
      const nx = pending()[0]
      setNextCell(nx?.id || null)
      setMsg(nx ? nx.label : 'Completado')
    }
    update()
    while (pending().length) {
      const elapsed = performance.now() - t0
      if (elapsed > 45000 && enough()) break                 // ya hay cobertura suficiente
      if (elapsed > 150000) {
        if (samples.length >= 10 && poses() >= 7 && count.center >= 3) break
        throw new Error('No se completaron los ángulos. Busca buena luz de frente y vuelve a intentarlo.')
      }
      const f = await next()
      if (!f || !f.quality.good || !stable()) continue
      const y = f.quality.yaw
      const p = base == null ? 0 : f.quality.pitchRaw - base
      let cell
      if (base == null) {
        if (!(Math.abs(y) < 0.06 && Math.abs(f.quality.roll) < 10)) continue
        cell = CELLS[0]
      } else {
        cell = pending().find((c) => c.test(y, p))
        if (!cell) continue
      }
      const d = await describeFace(videoRef.current)
      if (!d) continue
      // misma persona que las capturas frontales
      if (centerMean && descDistance(centerMean, d.descriptor) > (cell.id === 'center' ? 0.42 : 0.62)) continue
      // variedad mínima dentro de la misma celda
      if (lastByCell[cell.id] && descDistance(lastByCell[cell.id], d.descriptor) < 0.03) continue
      samples.push({ pose: cell.id, d: d.descriptor, pr: f.quality.pitchRaw })
      lastByCell[cell.id] = d.descriptor
      count[cell.id]++
      if (cell.id === 'center') {
        const cs = samples.filter((s) => s.pose === 'center')
        centerMean = cs[0].d.map((_, i) => cs.reduce((a, s) => a + s.d[i], 0) / cs.length)
        if (cs.length >= 3) base = cs.reduce((a, s) => a + s.pr, 0) / cs.length
      }
      update()
      if (navigator.vibrate) navigator.vibrate(25)
    }
    setPhase('check'); setMsg('Guardando tu huella facial…')
    const r = await api.faceEnroll(code, samples.map(({ pose, d }) => ({ pose, d })))
    setResult(r)
    setProgress(1)
    setPhase('ok')
    setTimeout(() => onEnrolled(r), 1100)
  }

  function draw(f) {
    const v = videoRef.current, c = canvasRef.current
    if (!v || !c) return
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight }
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    if (!f) return
    const { x, y, width: w, height: h } = f.box
    const col = f.quality.good ? '#34d399' : '#fbbf24'
    const L = Math.min(w, h) * 0.22
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.lineCap = 'round'
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke()
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(34,211,238,0.75)'
    for (let i = 0; i < f.lm.length; i += 4) {
      const p = f.lm[i]
      ctx.fillRect(p.x * c.width - 1, p.y * c.height - 1, 2, 2)
    }
  }

  const retry = () => { setResult(null); setError(''); setProgress(0); setCells({}); setPinMode(false); setPhase('loading'); setAttempt((a) => a + 1) }

  if (phase === 'consent') {
    return <ConsentStep text={consentText} code={code} mandatory={mandatory} onCancel={onClose} onAccept={() => setPhase('loading')} />
  }

  const chips = q && [['Luz', q.okLight], ['Distancia', q.okSize && q.okFar], ['Nitidez', q.okSharp], ['Quieto', stable()]]
  const title = mode === 'enroll' ? 'Registro facial' : mode === 'verify' ? 'Verificación de identidad' : 'Reconocimiento facial'
  const hint = q && !q.okSize ? 'Acércate un poco a la cámara' : q && !q.okFar ? 'Aléjate un poco' : q && !q.okLight ? 'Necesitas más luz de frente' : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            {mode === 'enroll' ? `Cliente ${code} · solo se hace una vez` : mode === 'verify' ? `Confirma que eres el cliente ${code}` : 'Solo tu huella numérica se compara en el servidor'}
          </div>
        </div>
        {!mandatory && <GlowButton variant="sm icon hot ghost" onClick={onClose}>✕</GlowButton>}
      </div>

      <div className="face-stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="face-oval" />
        {mode === 'enroll' && (
          <div className="angle-ring">
            {CELLS.filter((c) => c.a != null).map((c) => {
              const rad = (c.a * Math.PI) / 180
              const R = 44 * c.r
              const done = (cells[c.id] || 0) >= c.need
              return (
                <motion.i key={c.id} className={`angle-dot ${done ? 'done' : ''} ${nextCell === c.id ? 'next' : ''}`}
                  style={{ left: `${50 + Math.cos(rad) * R * 0.78}%`, top: `${50 + Math.sin(rad) * R}%` }}
                  animate={nextCell === c.id ? { scale: [1, 1.5, 1] } : { scale: 1 }} transition={{ repeat: nextCell === c.id ? Infinity : 0, duration: 0.9 }} />
              )
            })}
            <i className={`angle-dot center ${(cells.center || 0) >= 3 ? 'done' : ''} ${nextCell === 'center' ? 'next' : ''}`} style={{ left: '50%', top: '50%' }} />
          </div>
        )}
        {phase === 'scan' && <div className="scanline" />}
        {phase === 'scan' && <span className="face-fps mono">{fps} fps</span>}
        <AnimatePresence>
          {(phase === 'ok' || phase === 'fail' || phase === 'error') && (
            <motion.div className="face-result" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
              <div style={{ fontSize: 54 }}>{phase === 'ok' ? '✅' : '🚫'}</div>
              {phase === 'ok' && mode !== 'enroll' && (
                <>
                  <div className="mono" style={{ fontSize: 34, fontWeight: 700 }}>{result.code}</div>
                  <div className="muted">Confianza {result.confidence}% · distancia {result.distance}</div>
                </>
              )}
              {phase === 'ok' && mode === 'enroll' && <div>Rostro registrado · {result.angles} ángulos · {result.samples} muestras</div>}
              {phase === 'fail' && (
                <div className="muted" style={{ maxWidth: 280 }}>
                  {mode === 'verify'
                    ? 'Tu rostro no coincide con el registrado para este código.'
                    : result?.reason === 'no_faces' ? 'Aún no hay rostros registrados.' : 'No te reconocí con suficiente certeza. Ingresa tu número de cliente.'}
                </div>
              )}
              {phase === 'error' && <div className="muted" style={{ maxWidth: 300 }}>{error}</div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="face-progress"><motion.i animate={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <p style={{ textAlign: 'center', fontWeight: 600, margin: '10px 0 6px', minHeight: 24 }}>
        {phase === 'scan' && hint ? <span style={{ color: 'var(--warn)' }}>{hint}</span> : phase === 'scan' || phase === 'check' || phase === 'loading' ? msg : ''}
        {mode === 'enroll' && phase === 'scan' && <span className="muted mono" style={{ fontWeight: 400 }}> · {Math.round(progress * TOTAL)}/{TOTAL}</span>}
      </p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', minHeight: 28 }}>
        {phase === 'scan' && !q && <span className="chip">Buscando rostro…</span>}
        {phase === 'scan' && chips?.map(([k, ok]) => (
          <span key={k} className="chip" style={{ borderColor: ok ? 'rgba(52,211,153,.5)' : 'rgba(251,191,36,.5)' }}>{ok ? '✓' : '•'} {k}</span>
        ))}
      </div>

      {(phase === 'fail' || phase === 'error') && !pinMode && (
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'verify' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8, marginTop: 14 }}>
          <GlowButton variant="ghost" onClick={onClose}>{mode === 'identify' ? 'Usar código' : 'Otro código'}</GlowButton>
          {mode === 'verify' && <GlowButton variant="ghost hot" onClick={() => setPinMode(true)}>PIN coach</GlowButton>}
          <GlowButton variant="solid" onClick={retry}>Reintentar</GlowButton>
        </div>
      )}
      {pinMode && <CoachOverride onCancel={() => setPinMode(false)} onOk={() => onVerified({ match: true, code, override: true })} />}
      {mandatory && (phase === 'scan' || phase === 'loading') && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button className="link-btn" onClick={onClose}>No soy yo · usar otro código</button>
        </div>
      )}
    </div>
  )
}

function CoachOverride({ onCancel, onOk }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const check = async () => {
    try { (await api.adminCheck(pin)) ? onOk() : setErr('PIN incorrecto') } catch (e) { setErr(e.message) }
  }
  return (
    <div className="card" style={{ padding: 12, marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 13 }}>Autorización del coach</span>
      <input className="text-input mono" type="password" inputMode="numeric" maxLength={4} style={{ maxWidth: 100 }} value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && check()} />
      <GlowButton variant="sm" disabled={pin.length !== 4} onClick={check}>Autorizar</GlowButton>
      <GlowButton variant="sm ghost" onClick={onCancel}>Cancelar</GlowButton>
      {err && <span style={{ color: 'var(--hot)', fontSize: 13 }}>{err}</span>}
    </div>
  )
}

function ConsentStep({ text, code, mandatory, onCancel, onAccept }) {
  const [ok, setOk] = useState(false)
  return (
    <div>
      <div style={{ fontSize: 40 }}>🙂</div>
      <h2 style={{ margin: '6px 0' }}>Bienvenido · cliente {code}</h2>
      <p className="muted">
        {mandatory ? 'Es tu primera vez: para registrar tus entrenamientos en tu número debes registrar tu rostro. Se hace una sola vez. ' : ''}
        Sigue el punto que brilla moviendo la cabeza despacio (frente, lados, arriba, abajo y diagonales). Busca buena luz de frente
        y quítate gafas oscuras o gorra. No se guardan fotos, solo vectores numéricos.
      </p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
        <span>{text}</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <GlowButton variant="ghost" onClick={onCancel}>{mandatory ? 'Otro código' : 'Cancelar'}</GlowButton>
        <GlowButton variant="solid" disabled={!ok} onClick={onAccept}>Comenzar registro</GlowButton>
      </div>
    </div>
  )
}
