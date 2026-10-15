import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { compressImage } from '../lib/image'
import { fmtCOP } from '../lib/site'
import { GlowButton, Modal } from './ui'
import { Img } from './Media'

const TABS = [
  ['brand', '🏷️ Marca'], ['hero', '🖼️ Slider'], ['features', '✨ Destacados'], ['courses', '🥊 Cursos'],
  ['online', '💻 Online'], ['plans', '💳 Planes'], ['payment', '▦ Pago'], ['contact', '📍 Contacto'],
]

const clone = (o) => JSON.parse(JSON.stringify(o))
const uid = () => Math.random().toString(36).slice(2, 8)

function Text({ label, value, onChange, area, placeholder, type = 'text' }) {
  return (
    <div className="field">
      <label>{label}</label>
      {area
        ? <textarea className="text-input" rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className="text-input" type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

function ImageField({ label, value, onChange, pin, notify, maxSide = 1400, quality = 0.78 }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const r = await compressImage(file, { maxSide, quality })
      const id = await api.adminUploadMedia(pin, r.mime, r.data)
      onChange(`media:${id}`)
      notify('✓ Imagen subida')
    } catch (e) { notify(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="img-field">
        <Img src={value} className="img-thumb" alt="" fallback="🖼️" />
        <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 0 }}>
          <input className="text-input" placeholder="Pega una URL o sube una imagen" value={value?.startsWith('media:') ? '' : value || ''}
            onChange={(e) => onChange(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            <GlowButton variant="sm" type="button" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Subiendo…' : '⬆ Subir imagen'}</GlowButton>
            {value && <GlowButton variant="sm ghost hot" type="button" onClick={() => onChange('')}>Quitar</GlowButton>}
            {value?.startsWith('media:') && <span className="chip ok" style={{ fontSize: 11 }}>Imagen propia</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Repeater({ items, onChange, make, render, label, max = 12 }) {
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const a = [...items]; [a[i], a[j]] = [a[j], a[i]]
    onChange(a)
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((it, i) => (
        <div key={it.id || i} className="card ed-item">
          <div className="ed-item-head">
            <b>{label} {i + 1}</b>
            <span style={{ display: 'flex', gap: 6 }}>
              <GlowButton variant="sm icon ghost" type="button" onClick={() => move(i, -1)} disabled={i === 0}>↑</GlowButton>
              <GlowButton variant="sm icon ghost" type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</GlowButton>
              <GlowButton variant="sm icon hot ghost" type="button" onClick={() => onChange(items.filter((_, k) => k !== i))}>✕</GlowButton>
            </span>
          </div>
          {render(it, (patch) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x))))}
        </div>
      ))}
      {items.length < max && <GlowButton variant="ghost" type="button" onClick={() => onChange([...items, make()])}>＋ Agregar {label.toLowerCase()}</GlowButton>}
    </div>
  )
}

export default function SiteEditor({ open, onClose, site, pin, notify, onSaved }) {
  const [d, setD] = useState(() => clone(site))
  const [tab, setTab] = useState('hero')
  const [busy, setBusy] = useState(false)
  const [mailTo, setMailTo] = useState('')
  useEffect(() => { if (open) setD(clone(site)) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const sec = (k, patch) => setD((s) => ({ ...s, [k]: { ...s[k], ...patch } }))
  const img = { pin, notify }

  const save = async () => {
    setBusy(true)
    try {
      await api.adminSaveSite(pin, d)
      notify('✓ Página actualizada')
      await onSaved?.()
    } catch (e) { notify(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} className="trainer-sheet">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>🌐 Sitio web</h2>
          <div className="muted" style={{ fontSize: 13 }}>Lo que editas aquí es lo que ven los visitantes al entrar a la página principal.</div>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <GlowButton variant="sm solid ok" disabled={busy} onClick={save}>{busy ? 'Guardando…' : '💾 Guardar cambios'}</GlowButton>
          <GlowButton variant="sm icon hot ghost" onClick={onClose}>✕</GlowButton>
        </span>
      </div>

      <div className="tabs" style={{ margin: '14px 0' }}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}><span>{l}</span></button>
        ))}
      </div>

      {tab === 'brand' && (
        <div className="ed-grid">
          <Text label="Nombre del gimnasio" value={d.brand.name} onChange={(v) => sec('brand', { name: v })} />
          <Text label="Lema" value={d.brand.tagline} onChange={(v) => sec('brand', { tagline: v })} />
          <ImageField label="Logo (opcional; reemplaza el cuadro «AR»)" value={d.brand.logo} onChange={(v) => sec('brand', { logo: v })} maxSide={400} {...img} />
        </div>
      )}

      {tab === 'hero' && (
        <Repeater label="Diapositiva" items={d.hero.slides} max={8}
          onChange={(slides) => sec('hero', { slides })}
          make={() => ({ id: uid(), kicker: 'NUEVO', title: 'Título', subtitle: 'Descripción', image: '', cta_label: 'Ver planes', cta_target: 'planes' })}
          render={(s, set) => (
            <div className="ed-grid">
              <Text label="Etiqueta superior" value={s.kicker} onChange={(v) => set({ kicker: v })} />
              <Text label="Título" value={s.title} onChange={(v) => set({ title: v })} />
              <Text label="Descripción" area value={s.subtitle} onChange={(v) => set({ subtitle: v })} />
              <Text label="Texto del botón" value={s.cta_label} onChange={(v) => set({ cta_label: v })} />
              <div className="field"><label>El botón lleva a</label>
                <select className="text-input" value={s.cta_target} onChange={(e) => set({ cta_target: e.target.value })}>
                  {[['inicio', 'Inicio'], ['cursos', 'Cursos'], ['online', 'Clases online'], ['planes', 'Planes'], ['contacto', 'Contacto']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <ImageField label="Imagen de fondo" value={s.image} onChange={(v) => set({ image: v })} maxSide={1600} {...img} />
            </div>
          )} />
      )}

      {tab === 'features' && (
        <>
          <Text label="Título de la sección" value={d.features.title} onChange={(v) => sec('features', { title: v })} />
          <Repeater label="Destacado" items={d.features.items} max={8}
            onChange={(items) => sec('features', { items })}
            make={() => ({ icon: '🥊', title: 'Título', text: 'Descripción' })}
            render={(it, set) => (
              <div className="ed-grid">
                <Text label="Icono (emoji)" value={it.icon} onChange={(v) => set({ icon: v })} />
                <Text label="Título" value={it.title} onChange={(v) => set({ title: v })} />
                <Text label="Texto" area value={it.text} onChange={(v) => set({ text: v })} />
              </div>
            )} />
        </>
      )}

      {tab === 'courses' && (
        <>
          <Text label="Título de la sección" value={d.courses.title} onChange={(v) => sec('courses', { title: v })} />
          <Text label="Introducción" area value={d.courses.intro} onChange={(v) => sec('courses', { intro: v })} />
          <Repeater label="Curso" items={d.courses.items} max={9}
            onChange={(items) => sec('courses', { items })}
            make={() => ({ title: 'Nuevo curso', level: 'Todos los niveles', text: 'Descripción', schedule: '', image: '' })}
            render={(it, set) => (
              <div className="ed-grid">
                <Text label="Nombre" value={it.title} onChange={(v) => set({ title: v })} />
                <Text label="Nivel" value={it.level} onChange={(v) => set({ level: v })} />
                <Text label="Descripción" area value={it.text} onChange={(v) => set({ text: v })} />
                <Text label="Horario" value={it.schedule} onChange={(v) => set({ schedule: v })} placeholder="Lun · Mié · Vie 6:00 pm" />
                <ImageField label="Imagen" value={it.image} onChange={(v) => set({ image: v })} {...img} />
              </div>
            )} />
        </>
      )}

      {tab === 'online' && (
        <>
          <Text label="Título de la sección" value={d.online.title} onChange={(v) => sec('online', { title: v })} />
          <Text label="Introducción" area value={d.online.intro} onChange={(v) => sec('online', { intro: v })} />
          <Text label="Texto del botón" value={d.online.cta_label} onChange={(v) => sec('online', { cta_label: v })} />
          <Repeater label="Clase online" items={d.online.items} max={9}
            onChange={(items) => sec('online', { items })}
            make={() => ({ title: 'Nueva clase', text: 'Descripción', price: '', image: '' })}
            render={(it, set) => (
              <div className="ed-grid">
                <Text label="Nombre" value={it.title} onChange={(v) => set({ title: v })} />
                <Text label="Descripción" area value={it.text} onChange={(v) => set({ text: v })} />
                <Text label="Precio o nota (opcional)" value={it.price} onChange={(v) => set({ price: v })} placeholder="Incluida en tu plan" />
                <ImageField label="Imagen" value={it.image} onChange={(v) => set({ image: v })} {...img} />
              </div>
            )} />
        </>
      )}

      {tab === 'plans' && (
        <>
          <Text label="Título de la sección" value={d.plans_section.title} onChange={(v) => sec('plans_section', { title: v })} />
          <Text label="Introducción" area value={d.plans_section.intro} onChange={(v) => sec('plans_section', { intro: v })} />
          <p className="muted" style={{ fontSize: 12 }}>Un plan con precio 0 aparece como «Precio por definir» y no se puede contratar. El precio que se cobra es el guardado aquí.</p>
          <Repeater label="Plan" items={d.plans} max={6}
            onChange={(plans) => setD((s) => ({ ...s, plans }))}
            make={() => ({ id: `plan-${uid()}`, name: 'Nuevo plan', price: 0, period: 'mes', tagline: '', features: [], highlight: false, badge: '' })}
            render={(p, set) => (
              <div className="ed-grid">
                <Text label="Nombre" value={p.name} onChange={(v) => set({ name: v })} />
                <Text label={`Precio (COP)${Number(p.price) ? ' · ' + fmtCOP(p.price) : ''}`} type="number" value={p.price}
                  onChange={(v) => set({ price: Math.max(0, Number(v) || 0) })} />
                <Text label="Periodo" value={p.period} onChange={(v) => set({ period: v })} placeholder="mes" />
                <Text label="Frase corta" value={p.tagline} onChange={(v) => set({ tagline: v })} />
                <Text label="Insignia (opcional)" value={p.badge} onChange={(v) => set({ badge: v })} placeholder="Más exigente" />
                <label className="check"><input type="checkbox" checked={!!p.highlight} onChange={(e) => set({ highlight: e.target.checked })} /> Plan destacado</label>
                <Text label="Beneficios (uno por línea)" area value={(p.features || []).join('\n')}
                  onChange={(v) => set({ features: v.split('\n').map((x) => x.trim()).filter(Boolean) })} />
              </div>
            )} />
        </>
      )}

      {tab === 'payment' && (
        <div className="ed-grid">
          <ImageField label="Código QR de pago (lo ve el cliente al suscribirse)" value={d.payment.qr_image}
            onChange={(v) => sec('payment', { qr_image: v })} maxSide={900} quality={0.92} {...img} />
          <Text label="Instrucciones de pago" area value={d.payment.instructions} onChange={(v) => sec('payment', { instructions: v })} />
          <Text label="Datos de cuenta / referencia (opcional)" area value={d.payment.account_info} onChange={(v) => sec('payment', { account_info: v })} />
          <div className="field">
            <label>Probar el envío de correos</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="text-input" style={{ flex: 1, minWidth: 200 }} type="email" placeholder="tu@correo.com" value={mailTo} onChange={(e) => setMailTo(e.target.value)} />
              <GlowButton variant="sm" type="button" disabled={!mailTo} onClick={async () => {
                try { await api.adminMailTest(pin, mailTo); notify('Correo de prueba en camino') } catch (e) { notify(e.message) }
              }}>Enviar prueba</GlowButton>
            </div>
          </div>
        </div>
      )}

      {tab === 'contact' && (
        <div className="ed-grid">
          <Text label="Título" value={d.contact.title} onChange={(v) => sec('contact', { title: v })} />
          <Text label="Dirección" value={d.contact.address} onChange={(v) => sec('contact', { address: v })} />
          <Text label="Horario" value={d.contact.schedule} onChange={(v) => sec('contact', { schedule: v })} />
          <Text label="WhatsApp" value={d.contact.whatsapp} onChange={(v) => sec('contact', { whatsapp: v })} />
          <Text label="Instagram" value={d.contact.instagram} onChange={(v) => sec('contact', { instagram: v })} />
          <Text label="Correo público" value={d.contact.email} onChange={(v) => sec('contact', { email: v })} />
        </div>
      )}
    </Modal>
  )
}
