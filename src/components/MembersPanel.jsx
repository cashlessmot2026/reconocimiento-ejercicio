import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { fmtCOP, waLink } from '../lib/site'
import { GlowButton, Modal } from './ui'

const STATUS = {
  pendiente: { label: 'Pendiente', color: 'var(--warn)' },
  activo: { label: 'Activo', color: 'var(--ok)' },
  suspendido: { label: 'Suspendido', color: 'var(--hot)' },
  aprobado: { label: 'Aprobado', color: 'var(--ok)' },
  rechazado: { label: 'Rechazado', color: 'var(--hot)' },
}
const Badge = ({ s }) => (
  <span className="chip" style={{ borderColor: STATUS[s]?.color, color: STATUS[s]?.color }}>{STATUS[s]?.label || s}</span>
)
const when = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function MembersPanel({ open, onClose, pin, site, notify, onChanged, initialTab = 'pagos' }) {
  const [tab, setTab] = useState(initialTab)
  const [payments, setPayments] = useState([])
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(null)
  const [proof, setProof] = useState(null) // { id, mime, data }
  const [note, setNote] = useState({})
  const [q, setQ] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', plan: '', code: '', notify: true })
  const [created, setCreated] = useState(null)
  const [approved, setApproved] = useState(null) // { code, name, phone, plan }
  const [copied, setCopied] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.adminPayments(pin), api.adminMembers(pin)])
      setPayments(p); setMembers(m)
    } catch (e) { notify(e.message) }
  }, [pin, notify])

  useEffect(() => { if (open) { setTab(initialTab); load() } }, [open, load, initialTab])

  const pending = payments.filter((p) => p.status === 'pendiente')
  const planName = useMemo(() => Object.fromEntries(site.plans.map((p) => [p.id, p.name])), [site.plans])

  const showProof = async (p) => {
    setBusy(p.id)
    try { const r = await api.adminPaymentProof(pin, p.id); setProof({ id: p.id, mime: r.mime, data: r.data }) }
    catch (e) { notify(e.message) } finally { setBusy(null) }
  }

  const review = async (p, approve) => {
    if (!approve && !window.confirm('¿Rechazar este pago? Se avisará al cliente por correo.')) return
    setBusy(p.id)
    try {
      await api.adminReviewPayment(pin, p.id, approve, note[p.id])
      notify(approve ? `✓ Pago aprobado: el cliente ${p.code} ya tiene acceso` : 'Pago rechazado')
      if (approve) { setApproved({ code: p.code, name: p.name, phone: p.phone, plan: p.plan_name }); setCopied(false) }
      setProof(null); await load(); onChanged?.()
    } catch (e) { notify(e.message) } finally { setBusy(null) }
  }

  const create = async () => {
    setBusy('create')
    try {
      const r = await api.adminCreateClient(pin, form)
      setCreated({ code: r.code, name: form.name, emailed: !!form.email && form.notify })
      setForm({ name: '', email: '', phone: '', plan: '', code: '', notify: true })
      await load(); onChanged?.()
    } catch (e) { notify(e.message) } finally { setBusy(null) }
  }

  const setStatus = async (m, status) => {
    try { await api.adminUpdateMember(pin, m.code, { status }); await load(); onChanged?.() } catch (e) { notify(e.message) }
  }

  const msgFor = (a) =>
    `Hola ${a.name || ''}, tu pago del ${a.plan || 'plan'} en ${site.brand.name} fue aprobado ✅. Tu código de acceso es: ${a.code}. Ingresa aquí: ${window.location.origin}${window.location.pathname}`
  const copyCode = async (a) => {
    try { await navigator.clipboard.writeText(a.code); setCopied(true) } catch { notify(`Código: ${a.code}`) }
  }

  const shownMembers = members.filter((m) => {
    const t = q.trim().toLowerCase()
    return !t || m.code.includes(t) || (m.name || '').toLowerCase().includes(t) || (m.email || '').toLowerCase().includes(t)
  })

  return (
    <Modal open={open} onClose={onClose} className="trainer-sheet">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>👥 Miembros y pagos</h2>
          <div className="muted" style={{ fontSize: 13 }}>Valida los pagos para dar acceso, o crea clientes y asígnales un código.</div>
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>

      <div className="tabs" style={{ margin: '14px 0' }}>
        {[['pagos', `💳 Pagos${pending.length ? ` (${pending.length})` : ''}`], ['miembros', `👥 Miembros (${members.length})`], ['crear', '＋ Crear cliente']].map(([k, l]) => (
          <button key={k} type="button" className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}><span>{l}</span></button>
        ))}
      </div>

      {tab === 'pagos' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {approved && (
            <div className="card" style={{ padding: 16, borderColor: 'var(--ok)' }}>
              <div className="muted" style={{ fontSize: 12, letterSpacing: '.12em' }}>PAGO APROBADO · ACCESO ACTIVO</div>
              <div className="mono" style={{ fontSize: 40, fontWeight: 700, color: 'var(--accent)' }}>{approved.code}</div>
              <div className="muted" style={{ marginBottom: 10 }}>
                {approved.name || 'Cliente'} · Se envió el aviso por correo. Si no le llega, entrégale el código por aquí:
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <GlowButton variant="sm" onClick={() => copyCode(approved)}>{copied ? '✓ Copiado' : '📋 Copiar código'}</GlowButton>
                {waLink(approved.phone) && (
                  <a className="glow-btn sm solid ok" href={waLink(approved.phone, msgFor(approved))} target="_blank" rel="noreferrer">💬 Enviar por WhatsApp</a>
                )}
                {!waLink(approved.phone) && <span className="muted" style={{ fontSize: 12 }}>El cliente no dejó teléfono: copia el código y envíaselo.</span>}
                <GlowButton variant="sm ghost" onClick={() => setApproved(null)}>Cerrar</GlowButton>
              </div>
            </div>
          )}
          {payments.length === 0 && <div className="card" style={{ padding: 16 }}><span className="muted">Aún no hay pagos.</span></div>}
          {payments.map((p) => (
            <div key={p.id} className="card pay-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="client-code">{p.code}</span>
                  <b>{p.name || 'Sin nombre'}</b>
                  <Badge s={p.status} />
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {p.plan_name} · <b className="mono" style={{ color: 'var(--text)' }}>{fmtCOP(p.amount)}</b> · {when(p.created_at)}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{p.email}{p.phone ? ` · ${p.phone}` : ''}</div>
                {p.note && <div style={{ fontSize: 12, marginTop: 4 }}>📝 {p.note}</div>}
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <GlowButton variant="sm" disabled={busy === p.id} onClick={() => (proof?.id === p.id ? setProof(null) : showProof(p))}>
                  {proof?.id === p.id ? 'Ocultar' : '🧾 Ver comprobante'}
                </GlowButton>
                {p.status === 'pendiente' && (
                  <>
                    <input className="text-input" style={{ padding: '6px 10px', fontSize: 13, width: 190 }} placeholder="Nota (opcional)"
                      value={note[p.id] || ''} onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))} />
                    <span style={{ display: 'flex', gap: 6 }}>
                      <GlowButton variant="sm solid ok" disabled={busy === p.id} onClick={() => review(p, true)}>✓ Aprobar</GlowButton>
                      <GlowButton variant="sm hot ghost" disabled={busy === p.id} onClick={() => review(p, false)}>Rechazar</GlowButton>
                    </span>
                  </>
                )}
              </div>
              {proof?.id === p.id && (
                <div className="proof-view">
                  {proof.mime === 'application/pdf'
                    ? <a className="link" href={proof.data} download={`comprobante-${p.code}.pdf`}>Descargar comprobante (PDF)</a>
                    : <img src={proof.data} alt="Comprobante de pago" />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'miembros' && (
        <>
          <input className="text-input" placeholder="Buscar por nombre, correo o código" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Correo</th><th>Plan</th><th>Estado</th><th>Último uso</th><th /></tr></thead>
              <tbody>
                {shownMembers.map((m) => (
                  <tr key={m.code}>
                    <td className="mono">{m.code}</td>
                    <td>{m.name || '—'}</td>
                    <td className="muted">{m.email || '—'}</td>
                    <td>{planName[m.plan_id] || m.plan_id || '—'}</td>
                    <td><Badge s={m.status} /></td>
                    <td className="muted">{m.last_at ? when(m.last_at) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.status !== 'activo' && <GlowButton variant="sm ok" onClick={() => setStatus(m, 'activo')}>Activar</GlowButton>}{' '}
                      {m.status === 'activo' && <GlowButton variant="sm hot ghost" onClick={() => setStatus(m, 'suspendido')}>Suspender</GlowButton>}
                    </td>
                  </tr>
                ))}
                {!shownMembers.length && <tr><td colSpan={7} className="muted">Sin resultados.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'crear' && (
        <div style={{ maxWidth: 560 }}>
          {created && (
            <div className="card" style={{ padding: 16, marginBottom: 14, borderColor: 'var(--ok)' }}>
              <div className="muted" style={{ fontSize: 12, letterSpacing: '.12em' }}>CLIENTE CREADO</div>
              <div className="mono" style={{ fontSize: 40, fontWeight: 700, color: 'var(--accent)' }}>{created.code}</div>
              <div className="muted">
                {created.name} · {created.emailed ? 'Se envió el código por correo.' : 'Entrégale este código al cliente.'}
              </div>
            </div>
          )}
          <div className="field"><label>Nombre completo</label>
            <input className="text-input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>Correo (para enviarle su código)</label>
            <input className="text-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="field"><label>Teléfono (opcional)</label>
            <input className="text-input" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="field"><label>Plan</label>
            <select className="text-input" value={form.plan} onChange={(e) => set('plan', e.target.value)}>
              <option value="">Sin plan</option>
              {site.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="field"><label>Código de 4 dígitos (vacío = se genera automáticamente)</label>
            <input className="text-input mono" inputMode="numeric" maxLength={4} value={form.code}
              onChange={(e) => set('code', e.target.value.replace(/\D/g, ''))} placeholder="Automático" /></div>
          <label className="check"><input type="checkbox" checked={form.notify} onChange={(e) => set('notify', e.target.checked)} /> Enviar correo de bienvenida con su código</label>
          <div style={{ marginTop: 14 }}>
            <GlowButton variant="solid ok" disabled={busy === 'create' || form.name.trim().length < 2 || (form.code && form.code.length !== 4)} onClick={create}>
              {busy === 'create' ? 'Creando…' : 'Crear cliente y asignar código'}
            </GlowButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
