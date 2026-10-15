import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, loadBootstrap } from './lib/api'
import { loadPoseLandmarker } from './lib/pose'
import { GlowButton, Toast } from './components/ui'
import Home from './components/Home'
import PinModal from './components/PinModal'
import Landing from './components/Landing'
import { useSite } from './lib/site'
import { TopbarDisplay } from './components/DisplayControls'

const Session = lazy(() => import('./components/Session'))
const Admin = lazy(() => import('./components/Admin'))

export default function App() {
  const [boot, setBoot] = useState(null)
  const [bootErr, setBootErr] = useState(null)
  const [client, setClient] = useState(null)
  const [plan, setPlan] = useState(null)
  const [view, setView] = useState(() => (location.hash === '#ingresar' ? 'home' : 'landing'))
  const [site, refreshSite] = useSite()
  const [pinOpen, setPinOpen] = useState(false)
  const [adminPin, setAdminPin] = useState(null)
  const [toast, setToast] = useState(null)
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
    if (location.hash === '#admin') setPinOpen(true)
  }, [])

  // El catálogo y el modelo de pose solo se cargan al salir de la página principal
  useEffect(() => {
    if (view === 'landing') return undefined
    if (!boot && !bootErr) doBoot()
    // Con un pequeño retraso para no competir con la carga inicial de la pantalla
    const pre = setTimeout(() => loadPoseLandmarker().catch(() => {}), 2500)
    return () => clearTimeout(pre)
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const goClient = useCallback(() => {
    setView('home')
    history.replaceState(null, '', `${location.pathname}#ingresar`)
    window.scrollTo(0, 0)
  }, [])
  const goLanding = useCallback(() => {
    setView('landing')
    history.replaceState(null, '', location.pathname)
  }, [])

  useEffect(() => {
    document.title = `${site.brand.name} · ${site.brand.tagline}`
  }, [site])

  const refreshClient = useCallback(async (code) => {
    const c = await api.enterClient(code)
    setClient(c)
    return c
  }, [])

  // Acceso oculto: 5 toques rápidos sobre el logo
  const onBrandTap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 2500), now]
    if (taps.current.length >= 5) {
      taps.current = []
      adminPin ? setView('admin') : setPinOpen(true)
    }
  }

  const onPinSuccess = (pin) => {
    setAdminPin(pin); setPinOpen(false); setView('admin'); history.replaceState(null, '', location.pathname)
  }

  if (view === 'landing') {
    return (
      <div className="shell">
        <div className="aurora" /><div className="grid-bg" />
        <Landing site={site} onEnter={goClient} onBrandTap={onBrandTap} notify={notify} />
        <PinModal open={pinOpen} title="Panel del administrador" onClose={() => setPinOpen(false)} onSuccess={onPinSuccess} />
        <Toast msg={toast} />
      </div>
    )
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <GlowButton variant="solid" onClick={doBoot}>Reintentar</GlowButton>
                <GlowButton variant="ghost" onClick={goLanding}>← Volver al inicio</GlowButton>
              </div>
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
          <motion.div className="brand-mark" whileTap={{ rotate: 20, scale: 0.92 }}>AR</motion.div>
          <div>
            <h1>{site.brand.name}</h1>
            <small>{site.brand.tagline}</small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TopbarDisplay notify={notify} />
          {view === 'admin' && (
            <GlowButton variant="sm ghost" onClick={() => setView('home')}>← Salir del panel</GlowButton>
          )}
          {view !== 'workout' && (
            <GlowButton variant="sm ghost" onClick={goLanding}>🏠 Inicio</GlowButton>
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
          <motion.main key="home" className="container" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }}>
            <Home
              boot={boot}
              client={client}
              onEnter={refreshClient}
              onLogout={() => setClient(null)}
              onStart={(p) => { setPlan(p); setView('workout') }}
              notify={notify}
            />
          </motion.main>
        )}
        {view === 'admin' && adminPin && (
          <motion.main key="admin" className="container" style={{ maxWidth: 1500 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0 } }}>
            <Admin boot={boot} site={site} onSiteSaved={refreshSite} pin={adminPin} notify={notify} onReloadBoot={() => loadBootstrap().then(setBoot).catch(() => {})} onLock={() => { setAdminPin(null); setView('home') }} />
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

      <PinModal
        open={pinOpen}
        title={boot.copy.admin_title}
        onClose={() => setPinOpen(false)}
        onSuccess={onPinSuccess}
      />
      <Toast msg={toast} />
    </div>
  )
}
