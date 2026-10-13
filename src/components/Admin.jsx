import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { GlowButton, Stepper, fmtDate } from './ui'
import BodyMap from './BodyMap'

const AX = { stroke: '#8b97b5', fontSize: 11, tickLine: false, axisLine: false }
const TT = { contentStyle: { background: '#0f1528', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10 }, labelStyle: { color: '#e8eefc' } }

export default function Admin({ boot, pin, notify, onLock }) {
  const { exercises, groups } = boot
  const exById = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises])
  const [overview, setOverview] = useState(null)
  const [clients, setClients] = useState([])
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([api.adminOverview(pin), api.adminClients(pin)])
      setOverview(o); setClients(c)
      if (!sel && c.length) setSel(c[0].code)
    } catch (e) { notify(e.message) }
  }, [pin, sel, notify])

  const loadDetail = useCallback(async (code) => {
    if (!code) return
    setLoading(true)
    try { setDetail(await api.adminClient(pin, code)) } catch (e) { notify(e.message) } finally { setLoading(false) }
  }, [pin, notify])

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDetail(sel) }, [sel, loadDetail])

  const filtered = clients.filter((c) => !q || c.code.includes(q) || (c.name || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="section-title" style={{ marginTop: 4 }}>
        <div>
          <h2>{boot.copy.admin_title}</h2>
          <span className="muted">Analítica de clientes y progreso semanal</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GlowButton variant="sm ghost" onClick={() => { loadAll(); loadDetail(sel) }}>↻ Actualizar</GlowButton>
          <GlowButton variant="sm hot" onClick={onLock}>🔒 Bloquear</GlowButton>
        </div>
      </div>

      {overview && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <Kpi label="Clientes" value={overview.totals.clients} />
          <Kpi label="Series totales" value={overview.totals.sets} />
          <Kpi label="Repeticiones" value={overview.totals.reps} />
          <Kpi label="kcal estimadas" value={overview.totals.kcal} />
        </div>
      )}

      <div className="admin-grid">
        <div className="card" style={{ padding: 14 }}>
          <input className="text-input" placeholder="Buscar o abrir código (4 dígitos)" value={q} inputMode="numeric"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && /^\d{4}$/.test(q)) setSel(q) }} />
          {/^\d{4}$/.test(q) && !clients.some((c) => c.code === q) && (
            <GlowButton variant="sm" style={{ marginTop: 8, width: '100%' }} onClick={() => setSel(q)}>Abrir cliente {q}</GlowButton>
          )}
          <div className="client-list" style={{ marginTop: 12 }}>
            {filtered.map((c, i) => (
              <motion.button key={c.code} className={`client-row ${sel === c.code ? 'active' : ''}`} onClick={() => setSel(c.code)}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <span className="client-code">{c.code}</span>
                <span>
                  <div style={{ fontWeight: 600 }}>{c.name || 'Sin nombre'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{c.last_at ? `Último: ${fmtDate(c.last_at)}` : 'Sin actividad'}</div>
                </span>
                <span className="mono" style={{ textAlign: 'right', fontSize: 13 }}>{c.reps}<div className="muted" style={{ fontSize: 10 }}>reps</div></span>
              </motion.button>
            ))}
            {!filtered.length && <div className="muted" style={{ padding: 10 }}>Sin clientes.</div>}
          </div>
          {overview?.weekly?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ fontSize: 11, letterSpacing: '.12em' }}>ACTIVIDAD GLOBAL / SEMANA</div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={overview.weekly.map((w) => ({ ...w, wk: fmtDate(w.week) }))}>
                  <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity={0.6} /><stop offset="1" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="wk" {...AX} /><Tooltip {...TT} />
                  <Area type="monotone" dataKey="reps" name="Reps" stroke="#22d3ee" fill="url(#ga)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <AnimatePresence mode="wait">
            {detail && (
              <motion.div key={sel} initial={{ opacity: 0, y: 10 }} animate={{ opacity: loading ? 0.5 : 1, y: 0 }} exit={{ opacity: 0 }}>
                <ClientDetail detail={detail} code={sel} exById={exById} groups={groups} exercises={exercises}
                  pin={pin} notify={notify} reload={() => { loadDetail(sel); loadAll() }} />
              </motion.div>
            )}
          </AnimatePresence>
          {!detail && <div className="card" style={{ padding: 24 }}><span className="muted">Selecciona un cliente.</span></div>}
        </div>
      </div>
    </>
  )
}

function Kpi({ label, value, delta }) {
  return (
    <motion.div className="card kpi" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <small>{label}</small>
      <b>{value}</b>
      {delta != null && (
        <span className="delta" style={{ color: delta >= 0 ? 'var(--ok)' : 'var(--hot)' }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs semana anterior
        </span>
      )}
    </motion.div>
  )
}

function ClientDetail({ detail, code, exById, groups, exercises, pin, notify, reload }) {
  const weekly = (detail.weekly || []).map((w) => ({ ...w, wk: fmtDate(w.week) }))
  const cur = weekly[weekly.length - 1], prev = weekly[weekly.length - 2]
  const delta = cur && prev && prev.reps ? Math.round(((cur.reps - prev.reps) / prev.reps) * 100) : null
  const totalReps = (detail.by_exercise || []).reduce((a, e) => a + Number(e.reps), 0)
  const totalSets = (detail.by_exercise || []).reduce((a, e) => a + Number(e.sets), 0)
  const avgForm = weekly.length ? (weekly.reduce((a, w) => a + Number(w.form || 0), 0) / weekly.length).toFixed(0) : '—'

  const maxLoad = Math.max(1, ...(detail.by_group || []).map((g) => Number(g.load)))
  const loads = Object.fromEntries((detail.by_group || []).map((g) => [g.group_id, Number(g.load) / maxLoad]))
  const groupData = (detail.by_group || []).map((g) => ({ name: groups[g.group_id]?.name || g.group_id, load: Number(g.load), color: groups[g.group_id]?.color }))

  // Reps por ejercicio y semana (apilado)
  const exIds = [...new Set((detail.weekly_exercise || []).map((r) => r.exercise_id))]
  const stack = {}
  ;(detail.weekly_exercise || []).forEach((r) => {
    const k = r.week
    stack[k] = stack[k] || { week: k, wk: fmtDate(k) }
    stack[k][r.exercise_id] = Number(r.reps)
  })
  const stackData = Object.values(stack).sort((a, b) => a.week.localeCompare(b.week))

  const [name, setName] = useState(detail.client?.name || '')
  useEffect(() => setName(detail.client?.name || ''), [detail])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="client-code" style={{ fontSize: 24 }}>{code}</span>
        <input className="text-input" style={{ maxWidth: 260 }} placeholder="Nombre del cliente" value={name} onChange={(e) => setName(e.target.value)} />
        <GlowButton variant="sm" onClick={async () => { try { await api.adminRename(pin, code, name); notify('Nombre guardado'); reload() } catch (e) { notify(e.message) } }}>Guardar</GlowButton>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{detail.client ? `Alta: ${fmtDate(detail.client.created_at)}` : 'Cliente nuevo'}</span>
      </div>

      <div className="kpis">
        <Kpi label="Reps esta semana" value={cur?.reps ?? 0} delta={delta} />
        <Kpi label="Reps totales" value={totalReps} />
        <Kpi label="Series totales" value={totalSets} />
        <Kpi label="Técnica media" value={avgForm} />
      </div>

      <div className="charts">
        <div className="card chart-card">
          <h3>Progreso semanal · volumen y energía</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={weekly}>
              <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />
              <XAxis dataKey="wk" {...AX} /><YAxis yAxisId="l" {...AX} /><YAxis yAxisId="r" orientation="right" {...AX} />
              <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="reps" name="Reps" fill="#22d3ee" radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" dataKey="kcal" name="kcal" stroke="#fb7185" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Calidad · técnica, rango y fatiga</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={weekly}>
              <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />
              <XAxis dataKey="wk" {...AX} /><YAxis {...AX} />
              <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="form" name="Técnica" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="rom" name="ROM °" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="fatigue" name="Fatiga %" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Reps por ejercicio / semana</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stackData}>
              <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />
              <XAxis dataKey="wk" {...AX} /><YAxis {...AX} />
              <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
              {exIds.map((id) => (
                <Bar key={id} dataKey={id} stackId="a" name={exById[id]?.name || id} fill={groups[exById[id]?.primary_group]?.color || '#64748b'} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Grupos musculares trabajados</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
            <BodyMap groups={groups} loads={loads} size={120} />
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={groupData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" {...AX} /><YAxis type="category" dataKey="name" width={90} {...AX} />
                <Tooltip {...TT} />
                <Bar dataKey="load" name="Carga (reps ponderadas)" radius={[0, 6, 6, 0]}>
                  {groupData.map((g, i) => <Cell key={i} fill={g.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <RoutineEditor detail={detail} code={code} exercises={exercises} exById={exById} pin={pin} notify={notify} reload={reload} />

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Resumen por ejercicio</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Mejor serie</th><th>Técnica</th><th>ROM °</th><th>Inclinación</th><th>Torso °</th></tr></thead>
            <tbody>
              {(detail.by_exercise || []).map((e) => (
                <tr key={e.exercise_id}>
                  <td>{exById[e.exercise_id]?.icon} {exById[e.exercise_id]?.name}</td>
                  <td className="mono">{e.sets}</td><td className="mono">{e.reps}</td><td className="mono">{e.best_set}</td>
                  <td className="mono">{e.form ?? '—'}</td><td className="mono">{e.rom ?? '—'}</td>
                  <td className="mono">{e.incline ?? 0}°</td><td className="mono">{e.tilt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Historial de series</h3>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table>
            <thead><tr><th>Fecha</th><th>Ejercicio</th><th>Serie</th><th>Reps</th><th>Técnica</th><th>Fatiga</th><th>Vel. pico</th><th>Incl.</th><th>kcal</th></tr></thead>
            <tbody>
              {(detail.sets || []).map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{exById[s.exercise_id]?.name}</td>
                  <td className="mono">{s.set_number}</td>
                  <td className="mono">{s.reps}/{s.target_reps ?? '—'}</td>
                  <td className="mono">{s.form_score ?? '—'}</td>
                  <td className="mono">{s.fatigue_pct != null ? `${s.fatigue_pct}%` : '—'}</td>
                  <td className="mono">{s.peak_speed ?? '—'}</td>
                  <td className="mono">{s.incline_deg}°</td>
                  <td className="mono">{s.kcal}</td>
                </tr>
              ))}
              {!detail.sets?.length && <tr><td colSpan={9} className="muted">Sin series registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function RoutineEditor({ detail, code, exercises, exById, pin, notify, reload }) {
  const [ex, setEx] = useState(exercises[0]?.id)
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(10)
  const [incline, setIncline] = useState(0)
  const [rest, setRest] = useState(60)

  const add = async () => {
    try {
      await api.adminAddRoutine(pin, code, { exercise_id: ex, sets, reps, incline_deg: incline, rest_sec: rest })
      notify('Ejercicio asignado'); reload()
    } catch (e) { notify(e.message) }
  }
  const remove = async (id) => {
    try { await api.adminRemoveRoutine(pin, id); reload() } catch (e) { notify(e.message) }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Rutina del cliente</h3>
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {(detail.routine || []).map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line)' }}>
            <span style={{ fontSize: 22 }}>{exById[r.exercise_id]?.icon}</span>
            <span style={{ fontWeight: 600 }}>{exById[r.exercise_id]?.name}</span>
            <span className="mono muted">{r.sets}×{r.reps} · {r.incline_deg}° · {r.rest_sec}s</span>
            <span className="chip" style={{ fontSize: 11 }}>{r.assigned_by === 'coach' ? 'Coach' : 'Cliente'}</span>
            <GlowButton variant="sm hot ghost" style={{ marginLeft: 'auto' }} onClick={() => remove(r.id)}>✕</GlowButton>
          </div>
        ))}
        {!detail.routine?.length && <span className="muted">Sin ejercicios asignados.</span>}
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Ejercicio</label>
          <select className="text-input" value={ex} onChange={(e) => setEx(e.target.value)}>
            {exercises.map((e) => <option key={e.id} value={e.id} style={{ background: '#0f1528' }}>{e.icon} {e.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}><label>Series</label><Stepper value={sets} onChange={setSets} max={20} /></div>
        <div className="field" style={{ margin: 0 }}><label>Reps</label><Stepper value={reps} onChange={setReps} max={100} /></div>
        <div className="field" style={{ margin: 0 }}>
          <label>Inclinación <b>{incline}°</b></label>
          <input type="range" min={-45} max={90} step={5} value={incline} onChange={(e) => setIncline(+e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Descanso <b>{rest}s</b></label>
          <input type="range" min={15} max={240} step={15} value={rest} onChange={(e) => setRest(+e.target.value)} />
        </div>
        <GlowButton variant="solid ok" onClick={add}>＋ Asignar</GlowButton>
      </div>
    </div>
  )
}
