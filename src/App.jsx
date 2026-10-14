import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, loadBootstrap } from './lib/api'
import { loadPoseLandmarker } from './lib/pose'
import { GlowButton, Toast } from './components/ui'
import Home from './components/Home'
import PinModal from './components/PinModal'
import FaceId from './components/FaceId'

const Session = lazy(() => import('./components/Session'))
const Admin = lazy(() => import('./components/Admin'))

export default function App() {
  const [boot, setBoot] = useState(null)
  const [bootErr, setBootErr] = useState(null)
  const [client, setClient] = useState(null)
  const [plan, setPlan] = useState(null)
  const [view, setView] = useState('home')
  const [pinOpen, setPinOpen] = useState(false)
  const [adminPin, setAdminPin] = useState(null)
  const [toast, setToast] = useState(null)
  const [gate, setGate] = useState(null) // { mode: 'enroll' | 'verify', client }
  const taps = useRef([])

  const notify = useCallback((m) => {
    setToast(m)
    clearTimeout(notify.t)
    notify.t = setTimeout(() => setToast(null), 2800)
  }, [])

  const doBoot = useCallback(() => {
    setBootErr(null)
    loadBootstrap().then(setBoot).catch((e) => setBootErr(e.message))
  }, [])

  useEffect(() => {
    doBoot()
    // Precarga el modelo de pose en segundo plano
    loadPoseLandmarker().catch(() => {})
    if (location.hash === '#admin') setPinOpen(true)
  }, [doBoot])

  useEffect(() => {
    if (boot?.brand?.name) document.title = boot.brand.name
  }, [boot])

  const refreshClient = useCallback(async (code) => {
    const c = await api.enterClient(code)
    setClient(c)
    return c
  }, [])

  // Entrada: por rostro → acceso directo. Por código → si es la primera vez, registro facial
  // obligatorio (una sola vez); si ya tiene rostro, verificación 1:1 contra ese código.
  const login = useCallback(async (code, via) => {
    const [c, face] = await Promise.all([api.enterClient(code), api.faceConfig().catch(() => boot?.face || {})])
    setBoot((b) => ({ ...b, face }))
    // Reconocimiento facial desactivado por el coach → entrada directa con el código
    if (via === 'face' || face.enabled === false) { setClient(c); return }
    setClient(null)
    setGate({ mode: c.face_samples > 0 ? 'verify' : 'enroll', client: c })
  }, [boot])

  const passGate = useCallback(async (msg) => {
    const c = await api.enterClient(gate.client.code)
    setGate(null)
    setClient(c)
    if (msg) notify(msg)
  }, [gate, notify])

  // Acceso oculto: 5 toques rápidos sobre el logo
  const onBrandTap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 2500), now]
    if (taps.current.length >= 5) {
      taps.current = []
      adminPin ? setView('admin') : setPinOpen(true)
    }
  }

  if (!boot) {
    return (
      <div className="shell">
        <div className="aurora" /><div className="grid-bg" />
        <div className="center-msg" style={{ position: 'fixed' }}>
          {bootErr ? (
            <div className="card" style={{ padding: 24, maxWidth: 420 }}>
              <h3 style={{ marginTop: 0 }}>No se pudo conectar con la base de datos</h3>
              <p className="muted">{bootErr}</p>
              <GlowButton variant="solid" onClick={doBoot}>Reintentar</GlowButton>
            </div>
          ) : (
            <div><div className="loader" /><span className="muted">Conectando…</span></div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="aurora" /><div className="grid-bg" />
      <header className="topbar">
        <div className="brand" onClick={onBrandTap} onDoubleClick={(e) => e.preventDefault()}>
          <motion.div className="brand-mark" whileTap={{ rotate: 20, scale: 0.92 }}>K</motion.div>
          <div>
            <h1>{boot.brand.name}</h1>
            <small>{boot.brand.tagline}</small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {view === 'admin' && (
            <GlowButton variant="sm ghost" onClick={() => setView('home')}>← Salir del panel</GlowButton>
          )}
          {client && view === 'home' && (
            <motion.span className="chip" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
              <span className="dot" style={{ background: 'var(--ok)', boxShadow: '0 0 8px var(--ok)' }} />
              Cliente <b className="mono">{client.code}</b>
            </motion.span>
          )}
        </div>
      </header>

      <Suspense fallback={<div className="center-msg" style={{ position: 'fixed', zIndex: 50 }}><div className="loader" /></div>}>
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.main key="home" className="container" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <Home
              boot={boot}
              client={client}
              onEnter={refreshClient}
              onLogin={login}
              faceEnabled={boot.face?.enabled !== false}
              onLogout={() => setClient(null)}
              onStart={(p) => { setPlan(p); setView('workout') }}
              notify={notify}
            />
          </motion.main>
        )}
        {view === 'admin' && adminPin && (
          <motion.main key="admin" className="container" style={{ maxWidth: 1500 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Admin boot={boot} pin={adminPin} notify={notify} onFaceConfig={(face) => setBoot((b) => ({ ...b, face }))} onLock={() => { setAdminPin(null); setView('home') }} />
          </motion.main>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {view === 'workout' && plan && client && (
          <Session
            key="workout"
            boot={boot}
            client={client}
            plan={plan}
            notify={notify}
            onExit={async () => { setView('home'); setPlan(null); await refreshClient(client.code).catch(() => {}) }}
          />
        )}
      </AnimatePresence>
      </Suspense>

      <FaceId
        open={!!gate}
        mode={gate?.mode}
        code={gate?.client.code}
        mandatory
        consentText={boot.face?.consent}
        onClose={() => setGate(null)}
        onEnrolled={(r) => passGate(`✓ Rostro registrado desde ${r.angles} ángulos · ${r.samples} muestras`)}
        onVerified={(r) => passGate(r.override ? 'Acceso autorizado por el coach' : `✓ Identidad verificada · ${r.confidence}%`)}
      />

      <PinModal
        open={pinOpen}
        title={boot.copy.admin_title}
        onClose={() => setPinOpen(false)}
        onSuccess={(pin) => { setAdminPin(pin); setPinOpen(false); setView('admin'); history.replaceState(null, '', location.pathname) }}
      />
      <Toast msg={toast} />
    </div>
  )
}
