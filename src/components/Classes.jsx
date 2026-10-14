import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { GlowButton, Modal } from './ui'

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
export const fmtDay = (iso) => {
  const d = new Date(iso)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
}
export const fmtDayLong = (iso) => new Date(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
const spotsLeft = (s) => Math.max(0, s.capacity - s.booked)
const TYPE_ICON = { Fuerza: '🏋️', Boxeo: '🥊', Funcional: '🔥', Cardio: '🏃', Movilidad: '🧘', Personalizada: '🎯' }
export const classIcon = (t) => TYPE_ICON[t] || '📅'

/** Carga las clases del cliente y las refresca cada minuto. */
export function useClasses(client) {
  const [slots, setSlots] = useState(null)
  const code = client?.code
  const reload = useCallback(async () => {
    if (!code) { setSlots(null); return }
    try { setSlots(await api.classes(code)) } catch { setSlots((s) => s ?? []) }
  }, [code])
  useEffect(() => {
    reload()
    if (!code) return undefined
    const t = setInterval(reload, 60000)
    return () => clearInterval(t)
  }, [reload, code])
  return { slots, reload }
}

/** Banner animado: rota las próximas clases con cupo y abre la reserva. */
export function ClassBanner({ slots, onOpen }) {
  const [i, setI] = useState(0)
  const list = useMemo(() => {
    if (!slots) return []
    const mine = slots.filter((s) => s.mine)
    const open = slots.filter((s) => !s.mine)
    return [...mine.slice(0, 1), ...open].slice(0, 6)
  }, [slots])
  useEffect(() => {
    if (list.length < 2) return undefined
    const t = setInterval(() => setI((n) => (n + 1) % list.length), 3800)
    return () => clearInterval(t)
  }, [list.length])
  if (!slots) return null
  const s = list[i % Math.max(list.length, 1)]
  const myCount = slots.filter((x) => x.mine).length

  return (
    <motion.button
      type="button"
      className="class-banner"
      onClick={onOpen}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.99 }}
    >
      <span className="cb-glow" />
      <span className="cb-icon">{s ? classIcon(s.class_type) : '📅'}</span>
      <span className="cb-body">
        <span className="cb-kicker">{myCount > 0 ? `Tienes ${myCount} clase${myCount > 1 ? 's' : ''} reservada${myCount > 1 ? 's' : ''}` : 'RESERVA TU CLASE'}</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={s?.id || 'none'}
            className="cb-main"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3 }}
          >
            {s ? (
              <>
                <b>{s.title}</b> · {fmtDay(s.starts_at)} {fmtTime(s.starts_at)}
                <span className={`cb-spots ${s.mine ? 'mine' : spotsLeft(s) <= 2 ? 'low' : ''}`}>
                  {s.mine ? '✓ Reservada' : spotsLeft(s) === 1 ? 'Último cupo' : `${spotsLeft(s)} cupos`}
                </span>
              </>
            ) : (
              <span>Por ahora no hay horarios disponibles. Vuelve pronto.</span>
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="cb-cta">{list.length ? 'Ver horarios →' : 'Ver →'}</span>
      {list.length > 1 && (
        <span className="cb-dots">
          {list.map((x, k) => <i key={x.id} className={k === i % list.length ? 'on' : ''} />)}
        </span>
      )}
    </motion.button>
  )
}

/** Hoja de reservas: pestañas por día y las horas con cupo. */
export function BookingSheet({ open, onClose, client, slots, reload, boot, notify, onStartClass }) {
  const [busy, setBusy] = useState(null)
  const [day, setDay] = useState(null)
  const exById = useMemo(() => Object.fromEntries((boot?.exercises || []).map((e) => [e.id, e])), [boot])
  const days = useMemo(() => {
    const m = new Map()
    ;(slots || []).forEach((s) => { const k = dayKey(s.starts_at); if (!m.has(k)) m.set(k, s.starts_at) })
    return [...m.entries()].map(([k, iso]) => ({ k, iso }))
  }, [slots])
  const cur = days.find((d) => d.k === day) || days[0]
  const shown = (slots || []).filter((s) => cur && dayKey(s.starts_at) === cur.k)

  const act = async (s, fn, ok) => {
    setBusy(s.id)
    try { await fn(); await reload(); notify(ok) } catch (e) { notify(e.message); reload() } finally { setBusy(null) }
  }

  return (
    <Modal open={open} onClose={onClose} className="book-sheet">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>📅 Reserva tu clase</h2>
          <div className="muted" style={{ fontSize: 13 }}>Solo se muestran horarios con cupo disponible.</div>
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>

      {!slots ? <div style={{ padding: 30, textAlign: 'center' }}><div className="loader" /></div>
        : days.length === 0 ? (
          <div className="card" style={{ padding: 20, marginTop: 14 }}>
            <p className="muted" style={{ margin: 0 }}>No hay clases con cupo por ahora. Tu coach publicará nuevos horarios.</p>
          </div>
        ) : (
          <>
            <div className="day-strip">
              {days.map((d) => {
                const n = slots.filter((s) => dayKey(s.starts_at) === d.k).length
                return (
                  <button key={d.k} type="button" className={`day-pill ${cur?.k === d.k ? 'on' : ''}`} onClick={() => setDay(d.k)}>
                    <span>{fmtDay(d.iso)}</span><small>{n} {n === 1 ? 'clase' : 'clases'}</small>
                  </button>
                )
              })}
            </div>
            <div className="slot-list">
              <AnimatePresence mode="popLayout">
                {shown.map((s, idx) => {
                  const left = spotsLeft(s)
                  const pct = Math.min(100, Math.round((s.booked / s.capacity) * 100))
                  const items = (s.routine || []).map((r) => ({ r, ex: exById[r.exercise_id] })).filter((x) => x.ex)
                  return (
                    <motion.div key={s.id} layout className={`card slot-card ${s.mine ? 'mine' : ''}`}
                      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.04 }}>
                      <div className="slot-time mono">{fmtTime(s.starts_at)}<small>{s.duration_min} min</small></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{classIcon(s.class_type)} {s.title}</div>
                        <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                          <span>{s.class_type}</span>
                          <span>{s.audience === 'abierta' ? 'Abierta' : s.audience === 'grupo' ? '👥 Tu grupo' : '🎯 Individual'}</span>
                          <span>{s.mine ? '✓ Reservada' : `${left} de ${s.capacity} cupos`}</span>
                        </div>
                        {s.audience === 'abierta' && !s.mine && (
                          <div className="cap-bar"><i style={{ width: `${pct}%` }} className={left <= 2 ? 'low' : ''} /></div>
                        )}
                        {items.length > 0 && (
                          <div className="slot-ex">
                            {items.map(({ r, ex }, k) => (
                              <span key={k} className="chip" style={{ fontSize: 11 }}>
                                {ex.icon} {ex.name} <span className="muted mono">{ex.kind === 'boxing' ? `${r.sets}×${r.reps}s` : `${r.sets}×${r.reps}`}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {s.notes && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>📝 {s.notes}</div>}
                      </div>
                      <div className="slot-act">
                        {s.mine ? (
                          <>
                            {items.length > 0 && <GlowButton variant="sm solid ok" onClick={() => { onClose(); onStartClass(s, items) }}>▶ Iniciar</GlowButton>}
                            <GlowButton variant="sm hot ghost" disabled={busy === s.id}
                              onClick={() => act(s, () => api.cancelClass(client.code, s.id), 'Reserva cancelada')}>Cancelar</GlowButton>
                          </>
                        ) : (
                          <GlowButton variant="sm solid" disabled={busy === s.id}
                            onClick={() => act(s, () => api.bookClass(client.code, s.id), '✓ Clase reservada')}>
                            {busy === s.id ? '…' : 'Reservar'}
                          </GlowButton>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </>
        )}
    </Modal>
  )
}
