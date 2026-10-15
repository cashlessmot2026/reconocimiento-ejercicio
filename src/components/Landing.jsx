import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { fmtCOP, waLink } from '../lib/site'
import { compressImage, fileToDataUrl } from '../lib/image'
import { GlowButton, Modal } from './ui'
import { Img } from './Media'

const NAV = [
  ['inicio', 'Inicio'], ['cursos', 'Cursos'], ['online', 'Online'], ['planes', 'Planes'], ['contacto', 'Contacto'],
]

const goTo = (id) => {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const reveal = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5 },
}

export default function Landing({ site, onEnter, onBrandTap, notify }) {
  const [menu, setMenu] = useState(false)
  const [plan, setPlan] = useState(null)
  const brand = site.brand

  return (
    <div className="landing">
      <header className="l-nav">
        <div className="brand" onClick={onBrandTap} onDoubleClick={(e) => e.preventDefault()}>
          {brand.logo
            ? <Img src={brand.logo} className="l-logo" alt={brand.name} fallback="AR" />
            : <motion.div className="brand-mark" whileTap={{ rotate: 20, scale: 0.92 }}>AR</motion.div>}
          <div>
            <h1>{brand.name}</h1>
            <small>{brand.tagline}</small>
          </div>
        </div>
        <nav className={`l-links ${menu ? 'open' : ''}`}>
          {NAV.map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setMenu(false); goTo(id) }}>{label}</button>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <GlowButton variant="sm solid" onClick={onEnter}>Ingresar</GlowButton>
          <button type="button" className="l-burger" aria-label="Menú" onClick={() => setMenu((m) => !m)}>
            <span /><span /><span />
          </button>
        </div>
      </header>

      <Hero slides={site.hero.slides} onPlans={() => goTo('planes')} />

      <section className="l-sec">
        <motion.h2 className="l-h2" {...reveal}>{site.features.title}</motion.h2>
        <div className="feat-grid">
          {site.features.items.map((f, i) => (
            <motion.div key={i} className="card feat" {...reveal} transition={{ duration: 0.5, delay: i * 0.07 }}>
              <div className="feat-ic">{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="cursos" className="l-sec">
        <motion.h2 className="l-h2" {...reveal}>{site.courses.title}</motion.h2>
        <motion.p className="l-intro muted" {...reveal}>{site.courses.intro}</motion.p>
        <div className="course-grid">
          {site.courses.items.map((c, i) => (
            <motion.article key={i} className="card course" {...reveal} transition={{ duration: 0.5, delay: i * 0.08 }} whileHover={{ y: -6 }}>
              <Img src={c.image} alt={c.title} className="course-img" fallback="🥊" />
              <div className="course-body">
                {c.level && <span className="chip">{c.level}</span>}
                <h3>{c.title}</h3>
                <p className="muted">{c.text}</p>
                {c.schedule && <div className="course-sched">🗓️ {c.schedule}</div>}
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <section id="online" className="l-sec l-online">
        <motion.h2 className="l-h2" {...reveal}>{site.online.title}</motion.h2>
        <motion.p className="l-intro muted" {...reveal}>{site.online.intro}</motion.p>
        <div className="course-grid two">
          {site.online.items.map((c, i) => (
            <motion.article key={i} className="card course" {...reveal} transition={{ duration: 0.5, delay: i * 0.08 }} whileHover={{ y: -6 }}>
              <Img src={c.image} alt={c.title} className="course-img" fallback="💻" />
              <div className="course-body">
                <span className="chip">En línea</span>
                <h3>{c.title}</h3>
                <p className="muted">{c.text}</p>
                {c.price && <div className="course-sched">💲 {c.price}</div>}
              </div>
            </motion.article>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <GlowButton variant="solid" onClick={() => goTo('planes')}>{site.online.cta_label || 'Ver planes'}</GlowButton>
        </div>
      </section>

      <section id="planes" className="l-sec">
        <motion.h2 className="l-h2" {...reveal}>{site.plans_section.title}</motion.h2>
        <motion.p className="l-intro muted" {...reveal}>{site.plans_section.intro}</motion.p>
        <div className="plan-grid">
          {site.plans.map((p, i) => (
            <motion.div key={p.id} className={`card plan ${p.highlight ? 'hl' : ''}`} {...reveal}
              transition={{ duration: 0.5, delay: i * 0.1 }} whileHover={{ y: -8 }}>
              {p.badge && <span className="plan-badge">{p.badge}</span>}
              <h3>{p.name}</h3>
              <p className="muted" style={{ margin: '0 0 14px' }}>{p.tagline}</p>
              <div className="plan-price">
                {Number(p.price) > 0
                  ? <><b className="mono">{fmtCOP(p.price)}</b><span className="muted">/ {p.period || 'mes'}</span></>
                  : <b style={{ fontSize: 20 }}>Precio por definir</b>}
              </div>
              <ul className="plan-feats">
                {(p.features || []).map((f, k) => <li key={k}>✓ {f}</li>)}
              </ul>
              <GlowButton variant={p.highlight ? 'solid hot' : 'solid'} disabled={!(Number(p.price) > 0)} onClick={() => setPlan(p)}>
                Suscribirme
              </GlowButton>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="contacto" className="l-sec">
        <motion.div className="card l-contact" {...reveal}>
          <div>
            <h2 className="l-h2" style={{ textAlign: 'left', margin: 0 }}>{site.contact.title || 'Contacto'}</h2>
            <p className="muted" style={{ marginTop: 8 }}>¿Ya eres socio? Entra con tu código y empieza a entrenar.</p>
            <GlowButton variant="solid ok" onClick={onEnter}>Ingresar con mi código</GlowButton>
          </div>
          <div className="l-contact-list">
            {site.contact.address && <div>📍 {site.contact.address}</div>}
            {site.contact.schedule && <div>🕒 {site.contact.schedule}</div>}
            {site.contact.whatsapp && (
              <div>💬 {waLink(site.contact.whatsapp)
                ? <a className="link" href={waLink(site.contact.whatsapp, `Hola ${site.brand.name}, quiero información`)} target="_blank" rel="noreferrer">{site.contact.whatsapp}</a>
                : site.contact.whatsapp}</div>
            )}
            {site.contact.instagram && <div>📸 {site.contact.instagram}</div>}
            {site.contact.email && <div>✉️ {site.contact.email}</div>}
            {!site.contact.address && !site.contact.schedule && !site.contact.whatsapp && !site.contact.instagram && !site.contact.email && (
              <div className="muted">Muy pronto publicaremos aquí nuestros datos de contacto.</div>
            )}
          </div>
        </motion.div>
      </section>

      <footer className="l-foot muted">© {new Date().getFullYear()} {brand.name} · {brand.tagline}</footer>

      <SubscribeModal plan={plan} site={site} onClose={() => setPlan(null)} onEnter={onEnter} notify={notify} />
    </div>
  )
}

/** Slider principal con autoplay, flechas y puntos; el borde conserva la luz giratoria. */
function Hero({ slides, onPlans }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = slides.length
  const next = useCallback((d = 1) => setI((x) => (x + d + n) % n), [n])
  useEffect(() => {
    if (paused || n < 2) return undefined
    const t = setInterval(() => next(1), 6500)
    return () => clearInterval(t)
  }, [paused, n, next])
  const s = slides[i % n]
  const target = (t) => { if (t === 'ingresar') return; goTo(t || 'planes') }

  return (
    <section id="inicio" className="hero-slider glow-frame"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <AnimatePresence mode="wait">
        <motion.div key={s.id || i} className="hs-slide"
          initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.55 }}>
          <Img src={s.image} alt="" className="hs-bg" fallback="🥊" />
          <div className="hs-shade" />
          <div className="hs-copy">
            <motion.span className="chip hs-kicker" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <span className="dot" style={{ background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />{s.kicker}
            </motion.span>
            <motion.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>{s.title}</motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>{s.subtitle}</motion.p>
            <motion.div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
              <GlowButton variant="solid" onClick={() => target(s.cta_target)}>{s.cta_label || 'Ver planes'}</GlowButton>
              <GlowButton variant="ghost" onClick={onPlans}>Planes y precios</GlowButton>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
      {n > 1 && (
        <>
          <button type="button" className="hs-arrow left" aria-label="Anterior" onClick={() => next(-1)}>‹</button>
          <button type="button" className="hs-arrow right" aria-label="Siguiente" onClick={() => next(1)}>›</button>
          <div className="hs-dots">
            {slides.map((x, k) => (
              <button key={x.id || k} type="button" aria-label={`Diapositiva ${k + 1}`} className={k === i % n ? 'on' : ''} onClick={() => setI(k)} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/** Suscripción: datos → QR de pago + comprobante → confirmación. */
function SubscribeModal({ plan, site, onClose, onEnter, notify }) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState({ name: '', email: '', phone: '' })
  const [proof, setProof] = useState(null) // { data, mime, name }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    if (plan) { setStep(1); setProof(null); setErr(''); setBusy(false) }
  }, [plan])

  const okStep1 = f.name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())

  const pick = async (file) => {
    setErr('')
    if (!file) return
    try {
      if (file.type === 'application/pdf') {
        if (file.size > 1_800_000) throw new Error('El PDF pesa demasiado (máx. 1,8 MB). Adjunta una captura.')
        setProof({ data: await fileToDataUrl(file), mime: 'application/pdf', name: file.name })
      } else if (file.type.startsWith('image/')) {
        const r = await compressImage(file, { maxSide: 1500, quality: 0.8 })
        setProof({ data: r.data, mime: r.mime, name: file.name })
      } else {
        throw new Error('Adjunta una imagen (JPG, PNG) o un PDF')
      }
    } catch (e) { setErr(e.message); setProof(null) }
  }

  const send = async () => {
    setBusy(true); setErr('')
    try {
      await api.subscribe({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), plan: plan.id, proof: proof.data, mime: proof.mime })
      setStep(3)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!plan} onClose={onClose} className="sub-sheet">
      {plan && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, letterSpacing: '.14em' }}>SUSCRIPCIÓN</div>
              <h2 style={{ margin: 0 }}>{plan.name}</h2>
              <div className="mono" style={{ fontSize: 22, color: 'var(--accent)' }}>{fmtCOP(plan.price)} <span className="muted" style={{ fontSize: 13 }}>/ {plan.period || 'mes'}</span></div>
            </div>
            <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
          </div>

          {step === 1 && (
            <>
              <div className="field"><label>Nombre completo</label>
                <input className="text-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Tu nombre" autoComplete="name" /></div>
              <div className="field"><label>Correo electrónico (te enviaremos tu código)</label>
                <input className="text-input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="tu@correo.com" autoComplete="email" /></div>
              <div className="field"><label>Teléfono / WhatsApp (opcional)</label>
                <input className="text-input" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="300 000 0000" autoComplete="tel" /></div>
              <GlowButton variant="solid" disabled={!okStep1} onClick={() => setStep(2)}>Continuar al pago →</GlowButton>
            </>
          )}

          {step === 2 && (
            <>
              <div className="pay-box">
                <div className="pay-qr">
                  {site.payment.qr_image
                    ? <Img src={site.payment.qr_image} alt="Código QR de pago" className="pay-qr-img" fallback="▦" />
                    : <div className="img-fallback pay-qr-img"><span>▦</span></div>}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12, letterSpacing: '.12em' }}>VALOR A PAGAR</div>
                  <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{fmtCOP(plan.price)}</div>
                  <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>{site.payment.instructions}</p>
                  {site.payment.account_info && <p style={{ fontSize: 13, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{site.payment.account_info}</p>}
                  {!site.payment.qr_image && <p style={{ color: 'var(--warn)', fontSize: 13 }}>El QR de pago aún no está publicado. Escríbenos para recibirlo.</p>}
                </div>
              </div>

              <div className="field">
                <label>Comprobante de pago (imagen o PDF)</label>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
                <button type="button" className={`drop ${proof ? 'ok' : ''}`} onClick={() => fileRef.current?.click()}>
                  {proof
                    ? <>✓ {proof.name || 'Comprobante adjunto'} <small className="muted">· toca para cambiar</small></>
                    : <>📎 Adjuntar comprobante</>}
                </button>
                {proof?.mime?.startsWith('image/') && <img className="proof-prev" src={proof.data} alt="Vista previa del comprobante" />}
              </div>
              {err && <p style={{ color: 'var(--hot)', margin: '6px 0' }}>{err}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <GlowButton variant="ghost" onClick={() => setStep(1)}>← Atrás</GlowButton>
                <GlowButton variant="solid ok" disabled={!proof || busy} onClick={send}>{busy ? 'Enviando…' : 'Enviar y unirme'}</GlowButton>
              </div>
            </>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '18px 0 6px' }}>
              <div style={{ fontSize: 54 }}>🥊</div>
              <h2 style={{ margin: '6px 0' }}>¡Bienvenido a la familia {site.brand.name}!</h2>
              <p className="muted">
                Enviamos un correo a <b style={{ color: 'var(--text)' }}>{f.email}</b> con tu código personal.
                Tu acceso a la aplicación se activará cuando validemos tu pago y te avisaremos por el mismo correo.
              </p>
              <GlowButton variant="solid" onClick={onClose}>Entendido</GlowButton>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                ¿Ya fue aprobado? <button type="button" className="link" onClick={() => { onClose(); onEnter() }}>Ingresa con tu código</button>
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
