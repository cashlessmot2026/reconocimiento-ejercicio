import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { GlowButton, Modal, Stepper } from './ui'
import { classIcon, fmtDayLong } from './Classes'
import { AiTextModal } from './AiParts'

const TYPES = ['Fuerza', 'Boxeo', 'Funcional', 'Cardio', 'Movilidad', 'Personalizada']
const AUD = [['abierta', '🌐 Abierta (reservan los clientes)'], ['grupo', '👥 Grupo de alumnos'], ['individual', '🎯 Individual']]
const pad = (n) => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const time = (iso) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
const parseCodes = (t) => [...new Set((t.match(/\d{4}/g) || []))]

const blank = () => ({
  title: '', class_type: 'Fuerza', date: todayStr(), time: '18:00', duration_min: 60,
  audience: 'abierta', capacity: 10, codes: '', repeat: 1, notes: '', routine: [],
})

export default function ClassManager({ open, onClose, boot, pin, notify }) {
  const [list, setList] = useState([])
  const [form, setForm] = useState(blank)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [msgSlot, setMsgSlot] = useState(null)
  const [msgKind, setMsgKind] = useState('recordatorio')
  const [addCode, setAddCode] = useState({})
  const exercises = boot.exercises.filter((e) => e.active !== false)
  const exById = useMemo(() => Object.fromEntries(boot.exercises.map((e) => [e.id, e])), [boot.exercises])

  const load = useCallback(async () => {
    try { setList(await api.adminClasses(pin)) } catch (e) { notify(e.message) }
  }, [pin, notify])
  useEffect(() => { if (open) load() }, [open, load])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const addEx = (id) => {
    const ex = exById[id]
    if (!ex) return
    set('routine', [...form.routine, { exercise_id: id, sets: ex.default_sets || 3, reps: ex.default_reps || 10, incline_deg: 0, rest_sec: 60, load_kg: 0 }])
  }
  const patchEx = (i, p) => set('routine', form.routine.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const save = async () => {
    if (!form.title.trim()) { notify('Ponle un nombre a la clase'); return }
    const codes = parseCodes(form.codes)
    if (form.audience !== 'abierta' && !codes.length) { notify('Agrega al menos un alumno (código de 4 dígitos)'); return }
    if (form.audience === 'individual' && codes.length > 1) { notify('Una clase individual admite un solo alumno'); return }
    const [y, m, d] = form.date.split('-').map(Number)
    const [hh, mm] = form.time.split(':').map(Number)
    if (!y || Number.isNaN(hh)) { notify('Revisa la fecha y la hora'); return }
    const starts = []
    for (let w = 0; w < Math.max(1, form.repeat); w++) starts.push(new Date(y, m - 1, d + 7 * w, hh, mm).toISOString())
    setBusy(true)
    try {
      const n = await api.adminSaveClass(pin, {
        title: form.title.trim(), class_type: form.class_type, starts, duration_min: form.duration_min,
        audience: form.audience, capacity: form.capacity, codes, routine: form.routine, notes: form.notes.trim(),
      })
      notify(`✓ ${n} clase${n > 1 ? 's' : ''} creada${n > 1 ? 's' : ''}`)
      setForm(blank()); setCreating(false); load()
    } catch (e) { notify(e.message) } finally { setBusy(false) }
  }

  const del = async (s) => {
    if (!window.confirm(`¿Eliminar «${s.title}» y sus reservas?`)) return
    try { await api.adminDeleteClass(pin, s.id); load() } catch (e) { notify(e.message) }
  }
  const member = async (s, code, add) => {
    try { await api.adminClassMember(pin, s.id, code, add); setAddCode((a) => ({ ...a, [s.id]: '' })); load() } catch (e) { notify(e.message) }
  }

  const grouped = useMemo(() => {
    const g = []
    list.forEach((s) => {
      const k = new Date(s.starts_at).toDateString()
      const last = g[g.length - 1]
      if (last && last.k === k) last.items.push(s); else g.push({ k, iso: s.starts_at, items: [s] })
    })
    return g
  }, [list])

  return (
    <Modal open={open} onClose={onClose} className="trainer-sheet">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>📅 Clases y horarios</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Define días, horas, cupo, tipo y rutina. Los clientes solo ven los horarios con cupo; las clases de grupo o individuales solo las ve quien asignes.
          </div>
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>

      <div style={{ margin: '14px 0' }}>
        <GlowButton variant={creating ? 'ghost' : 'solid ok'} onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cerrar formulario' : '＋ Nueva clase'}
        </GlowButton>
      </div>

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="field" style={{ marginTop: 0 }}>
            <label>✨ Armar con IA (describe la clase)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="text-input" style={{ flex: 1, minWidth: 220 }} value={aiText} onChange={(e) => setAiText(e.target.value)}
                placeholder="Clase de 45 min, tren superior, nivel principiante, 8 personas" />
              <GlowButton variant="sm solid" disabled={aiBusy || aiText.trim().length < 5} onClick={async () => {
                setAiBusy(true)
                try {
                  const r = await api.adminAiClass(pin, aiText.trim())
                  setForm((f) => ({ ...f, title: r.title, class_type: r.class_type, duration_min: r.duration_min, capacity: r.capacity,
                    audience: r.audience, routine: r.routine, notes: r.notes }))
                  notify('✓ Propuesta lista: revisa y ajusta antes de crear')
                } catch (e) { notify(e.message) } finally { setAiBusy(false) }
              }}>{aiBusy ? 'Pensando…' : 'Generar'}</GlowButton>
            </div>
          </div>
          <div className="cls-form">
            <div className="field"><label>Nombre de la clase</label>
              <input className="text-input" placeholder="Ej. Fuerza tren superior" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="field"><label>Tipo de clase</label>
              <select className="text-input" value={form.class_type} onChange={(e) => set('class_type', e.target.value)}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div className="field"><label>Fecha</label>
              <input className="text-input" type="date" value={form.date} min={todayStr()} onChange={(e) => set('date', e.target.value)} /></div>
            <div className="field"><label>Hora</label>
              <input className="text-input" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} /></div>
            <div className="field"><label>Duración <b>{form.duration_min} min</b></label>
              <Stepper value={form.duration_min} onChange={(v) => set('duration_min', v)} min={15} max={240} step={15} /></div>
            <div className="field"><label>Repetir cada semana <b>{form.repeat} {form.repeat === 1 ? 'vez' : 'veces'}</b></label>
              <Stepper value={form.repeat} onChange={(v) => set('repeat', v)} min={1} max={12} /></div>
          </div>

          <div className="field"><label>Quién puede asistir</label>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
              {AUD.map(([k, l]) => (
                <button key={k} type="button" className={form.audience === k ? 'on' : ''}
                  onClick={() => setForm((f) => ({ ...f, audience: k, capacity: k === 'individual' ? 1 : (f.audience === 'individual' ? 10 : f.capacity) }))}>{l}</button>
              ))}
            </div>
          </div>
          {form.audience !== 'individual' && (
            <div className="field"><label>Alumnos por clase (cupo) <b>{form.capacity}</b></label>
              <Stepper value={form.capacity} onChange={(v) => set('capacity', v)} min={1} max={100} /></div>
          )}
          {form.audience !== 'abierta' && (
            <div className="field"><label>{form.audience === 'grupo' ? 'Códigos del grupo (separados por coma o espacio)' : 'Código del alumno'}</label>
              <input className="text-input mono" inputMode="numeric" placeholder="0001, 0002, 0003" value={form.codes} onChange={(e) => set('codes', e.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>{parseCodes(form.codes).length} alumno(s) reconocido(s)</span></div>
          )}

          <div className="field"><label>Rutina o ejercicios de la clase</label>
            <select className="text-input" value="" onChange={(e) => { addEx(e.target.value); e.target.value = '' }}>
              <option value="">＋ Agregar ejercicio…</option>
              {exercises.map((e) => <option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}
            </select>
            {form.routine.map((r, i) => {
              const ex = exById[r.exercise_id]
              const box = ex?.kind === 'boxing'
              return (
                <div key={i} className="cls-ex">
                  <b>{ex?.icon} {ex?.name}</b>
                  <div className="cls-ex-ctl">
                    <span className="muted">{box ? 'Rounds' : 'Series'}</span><Stepper value={r.sets} onChange={(v) => patchEx(i, { sets: v })} max={box ? 12 : 20} />
                    <span className="muted">{box ? 'Seg.' : 'Reps'}</span><Stepper value={r.reps} onChange={(v) => patchEx(i, { reps: v })} min={box ? 15 : 1} step={box ? 15 : 1} max={box ? 300 : 100} />
                    <GlowButton variant="sm icon hot ghost" onClick={() => set('routine', form.routine.filter((_, k) => k !== i))}>✕</GlowButton>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="field"><label>Notas para el alumno (opcional)</label>
            <input className="text-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Trae toalla, calentar 5 min antes…" /></div>
          <GlowButton variant="solid" disabled={busy} onClick={save}>{busy ? 'Guardando…' : form.repeat > 1 ? `Crear ${form.repeat} clases` : 'Crear clase'}</GlowButton>
        </div>
      )}

      {grouped.length === 0 && <div className="card" style={{ padding: 16 }}><span className="muted">No hay clases programadas.</span></div>}
      {grouped.map((g) => (
        <div key={g.k} style={{ marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', margin: '6px 0' }}>{fmtDayLong(g.iso)}</div>
          {g.items.map((s) => {
            const full = s.members.length >= s.capacity
            return (
              <div key={s.id} className="card cls-row">
                <div className="mono cls-time">{time(s.starts_at)}<small>{s.duration_min} min</small></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{classIcon(s.class_type)} {s.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.class_type} · {s.audience === 'abierta' ? 'Abierta' : s.audience === 'grupo' ? 'Grupo' : 'Individual'} ·{' '}
                    <b style={{ color: full ? 'var(--hot)' : 'var(--ok)' }}>{s.members.length}/{s.capacity}</b> alumnos
                    {(s.routine || []).length > 0 && ` · ${(s.routine || []).map((r) => exById[r.exercise_id]?.name).filter(Boolean).join(', ')}`}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                    {s.members.map((m) => (
                      <span key={m.code} className="chip" style={{ fontSize: 12 }}>
                        <span className="mono">{m.code}</span>{m.name ? ` ${m.name}` : ''}{m.source === 'coach' ? ' ·👥' : ''}
                        <button type="button" className="chip-x" aria-label="Quitar" onClick={() => member(s, m.code, false)}>✕</button>
                      </span>
                    ))}
                    {!full && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <input className="text-input mono" style={{ width: 90, padding: '6px 10px' }} inputMode="numeric" maxLength={4} placeholder="Código"
                          value={addCode[s.id] || ''} onChange={(e) => setAddCode((a) => ({ ...a, [s.id]: e.target.value.replace(/\D/g, '') }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && /^\d{4}$/.test(addCode[s.id] || '')) member(s, addCode[s.id], true) }} />
                        <GlowButton variant="sm" disabled={!/^\d{4}$/.test(addCode[s.id] || '')} onClick={() => member(s, addCode[s.id], true)}>＋</GlowButton>
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <GlowButton variant="sm ghost" onClick={() => setMsgSlot(s)}>💬 Mensaje</GlowButton>
                  <GlowButton variant="sm hot ghost" onClick={() => del(s)}>Eliminar</GlowButton>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      <AiTextModal open={!!msgSlot} onClose={() => setMsgSlot(null)} copyable title="Mensaje para tus alumnos"
        hint={msgSlot ? `${msgSlot.title} · ${time(msgSlot.starts_at)}` : ''}
        run={() => api.adminAiMessage(pin, msgSlot?.id, msgKind)}>
        <div className="seg" style={{ marginTop: 12 }}>
          {[['recordatorio', '⏰ Recordatorio'], ['motivacion', '🔥 Motivación']].map(([k, l]) => (
            <button key={k} type="button" className={msgKind === k ? 'on' : ''} onClick={() => setMsgKind(k)}>{l}</button>
          ))}
        </div>
      </AiTextModal>
    </Modal>
  )
}
