import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { analyzeFace, descDistance, loadFace } from '../lib/face'
import { GlowButton } from './ui'

/*
 * Identificación (máxima exactitud):
 *   1. 3 capturas frontales de calidad (luz, tamaño, confianza) y coherentes entre sí (< 0.40)
 *   2. Prueba de vida: girar la cabeza (o parpadear) y que siga siendo la misma persona
 *   3. Supabase compara las 3 muestras: todas deben señalar al mismo cliente, distancia ≤ umbral
 *      y margen suficiente frente al segundo candidato.
 * Registro: 8 muestras guiadas (frente, un lado, el otro lado, frente) con variedad mínima.
 */

const ENROLL_STEPS = [
  { text: 'Mira de frente a la cámara', need: 3, test: (q) => q.frontal },
  { text: 'Gira la cabeza levemente hacia un lado', need: 2, test: (q) => Math.abs(q.yaw) > 0.12 && Math.abs(q.yaw) < 0.4, side: true },
  { text: 'Ahora gira levemente hacia el otro lado', need: 2, test: (q, st) => Math.abs(q.yaw) > 0.12 && Math.abs(q.yaw) < 0.4 && Math.sign(q.yaw) === -st.side },
  { text: 'Vuelve a mirar de frente', need: 1, test: (q) => q.frontal },
]

export default function FaceId({ open, mode, code, consentText, onClose, onIdentified, onEnrolled }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="card sheet face-sheet" initial={{ y: 40, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, opacity: 0 }}>
            <FaceInner mode={mode} code={code} consentText={consentText} onClose={onClose} onIdentified={onIdentified} onEnrolled={onEnrolled} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FaceInner({ mode, code, consentText, onClose, onIdentified, onEnrolled }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const runRef = useRef(true)
  const [phase, setPhase] = useState(mode === 'enroll' ? 'consent' : 'loading')
  const [msg, setMsg] = useState('Cargando modelos de reconocimiento…')
  const [q, setQ] = useState(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (phase === 'consent') return
    runRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        setMsg('Cargando modelos de reconocimiento…')
        const [, stream] = await Promise.all([
          loadFace(),
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } }),
        ])
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setPhase('scan')
        await (mode === 'enroll' ? runEnroll() : runIdentify())
      } catch (e) {
        if (!cancelled) { setPhase('error'); setMsg(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : e.message) }
      }
    })()
    return () => {
      cancelled = true
      runRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt, phase === 'consent']) // eslint-disable-line react-hooks/exhaustive-deps

  const frame = () => new Promise((r) => requestAnimationFrame(r))

  async function next() {
    const v = videoRef.current
    if (!runRef.current || !v) throw new Error('cancel')
    const f = await analyzeFace(v)
    draw(f)
    setQ(f?.quality || null)
    await frame()
    return f
  }

  async function runIdentify() {
    const front = []
    let lastT = 0
    setMsg('Mira de frente a la cámara')
    while (front.length < 3) {
      const f = await next()
      if (!f || !f.quality.good || !f.quality.frontal) continue
      if (performance.now() - lastT < 180) continue
      if (front.length && descDistance(f.descriptor, front[front.length - 1]) > 0.4) { front.length = 0; continue }
      front.push(f.descriptor); lastT = performance.now()
      setProgress(front.length / 5)
    }
    // Prueba de vida: giro de cabeza o parpadeo, manteniendo la identidad
    setMsg('Prueba de vida: gira la cabeza lentamente hacia un lado')
    let live = false, earOpen = false
    const t0 = performance.now()
    while (!live) {
      if (performance.now() - t0 > 15000) throw new Error('No se completó la prueba de vida. Inténtalo de nuevo.')
      const f = await next()
      if (!f || f.quality.score < 0.7) continue
      if (descDistance(f.descriptor, front[0]) > 0.55) continue
      if (f.quality.ear > 0.27) earOpen = true
      if (Math.abs(f.quality.yaw) > 0.22 || (earOpen && f.quality.ear < 0.19)) live = true
    }
    setProgress(0.8)
    setMsg('Verificando identidad…')
    setPhase('check')
    const r = await api.faceIdentify(front)
    setProgress(1)
    setResult(r)
    setPhase(r.match ? 'ok' : 'fail')
    if (r.match) setTimeout(() => onIdentified(r), 1100)
  }

  async function runEnroll() {
    const samples = []
    const st = { side: 0 }
    for (const step of ENROLL_STEPS) {
      setMsg(step.text)
      let got = 0
      while (got < step.need) {
        const f = await next()
        if (!f || !f.quality.good) continue
        if (!step.test(f.quality, st)) continue
        const prev = samples[samples.length - 1]
        if (prev && descDistance(prev, f.descriptor) < 0.04) continue      // variedad
        if (samples.length && descDistance(samples[0], f.descriptor) > 0.55) continue // misma persona
        if (step.side && !st.side) st.side = Math.sign(f.quality.yaw)
        samples.push(f.descriptor); got++
        setProgress(samples.length / 8)
        await new Promise((r) => setTimeout(r, 220))
      }
    }
    setPhase('check'); setMsg('Guardando huella facial…')
    const r = await api.faceEnroll(code, samples)
    setResult(r)
    setPhase('ok')
    setTimeout(() => onEnrolled(r), 1200)
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
    const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke()
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(34,211,238,0.85)'
    for (const p of f.landmarks) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill() }
  }

  if (phase === 'consent') {
    return (
      <ConsentStep text={consentText} onCancel={onClose} onAccept={() => setPhase('loading')} />
    )
  }

  const chips = q && [
    ['Luz', q.okLight], ['Distancia', q.okSize], ['Nitidez', q.okScore], ['Frontal', q.frontal],
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{mode === 'enroll' ? 'Registrar rostro' : 'Reconocimiento facial'}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{mode === 'enroll' ? `Cliente ${code}` : 'Solo tu huella numérica se compara en el servidor'}</div>
        </div>
        <GlowButton variant="sm icon hot ghost" onClick={onClose}>✕</GlowButton>
      </div>

      <div className="face-stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className="face-oval" />
        {phase === 'scan' && <div className="scanline" />}
        <AnimatePresence>
          {(phase === 'ok' || phase === 'fail') && (
            <motion.div className="face-result" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
              <div style={{ fontSize: 54 }}>{phase === 'ok' ? '✅' : '🚫'}</div>
              {phase === 'ok' && mode === 'identify' && (
                <>
                  <div className="mono" style={{ fontSize: 34, fontWeight: 700 }}>{result.code}</div>
                  <div className="muted">Confianza {result.confidence}% · distancia {result.distance}</div>
                </>
              )}
              {phase === 'ok' && mode === 'enroll' && <div>Rostro registrado · {result.samples} muestras</div>}
              {phase === 'fail' && (
                <div className="muted" style={{ maxWidth: 260 }}>
                  {result?.reason === 'no_faces' ? 'Aún no hay rostros registrados.' : 'No te reconocí con suficiente certeza. Ingresa tu número de cliente.'}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="face-progress"><motion.i animate={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <p style={{ textAlign: 'center', fontWeight: 600, margin: '10px 0 6px', minHeight: 24 }}>{phase === 'error' ? '⚠️ ' + msg : msg}</p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', minHeight: 28 }}>
        {chips?.map(([k, ok]) => (
          <span key={k} className="chip" style={{ borderColor: ok ? 'rgba(52,211,153,.5)' : 'rgba(251,191,36,.5)' }}>{ok ? '✓' : '•'} {k}</span>
        ))}
      </div>
      {(phase === 'fail' || phase === 'error') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <GlowButton variant="ghost" onClick={onClose}>Usar código</GlowButton>
          <GlowButton variant="solid" onClick={() => { setResult(null); setProgress(0); setPhase('loading'); setAttempt((a) => a + 1) }}>Reintentar</GlowButton>
        </div>
      )}
    </div>
  )
}

function ConsentStep({ text, onCancel, onAccept }) {
  const [ok, setOk] = useState(false)
  return (
    <div>
      <div style={{ fontSize: 40 }}>🙂</div>
      <h2 style={{ margin: '6px 0' }}>Registrar mi rostro</h2>
      <p className="muted">Se tomarán 8 capturas guiadas. No se guardan fotos: solo un vector numérico que no permite reconstruir tu cara. Puedes pedir al coach que lo borre cuando quieras.</p>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
        <span>{text}</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <GlowButton variant="ghost" onClick={onCancel}>Cancelar</GlowButton>
        <GlowButton variant="solid" disabled={!ok} onClick={onAccept}>Comenzar</GlowButton>
      </div>
    </div>
  )
}
