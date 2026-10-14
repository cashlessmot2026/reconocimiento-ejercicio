import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { BMI_COLOR, addDays, computeProgress, fmtNum, fmtPct, todayISO, trainingDaily } from '../lib/body'
import AssessmentForm from './AssessmentForm'
import { GlowButton, Modal, fmtDate } from './ui'

const AX = { stroke: '#8b97b5', fontSize: 11, tickLine: false, axisLine: false }
const TT = { contentStyle: { background: '#0f1528', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10 }, labelStyle: { color: '#e8eefc' } }
const GRID = <CartesianGrid stroke="rgba(148,163,184,.1)" vertical={false} />

export const emptyRange = { from: '', to: '' }

/** Filtro por fechas: aplica a la evaluación física, al entrenamiento y a toda la analítica del cliente. */
export function RangeBar({ range, setRange }) {
  const today = todayISO()
  const presets = [
    ['7 días', addDays(today, -6), today],
    ['30 días', addDays(today, -29), today],
    ['90 días', addDays(today, -89), today],
    ['Este año', `${today.slice(0, 4)}-01-01`, today],
    ['Todo', '', ''],
  ]
  const active = (p) => range.from === p[1] && range.to === p[2]
  return (
    <div className="card range-bar">
      <span className="muted" style={{ fontSize: 12, letterSpacing: '.1em' }}>📅 PERIODO</span>
      <label className="rng"><span>Desde</span>
        <input type="date" className="text-input" value={range.from} max={range.to || today} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      </label>
      <label className="rng"><span>Hasta</span>
        <input type="date" className="text-input" value={range.to} min={range.from || undefined} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </label>
      <div className="presets">
        {presets.map((p) => (
          <button key={p[0]} className={`chip-btn ${active(p) ? 'on' : ''}`} onClick={() => setRange({ from: p[1], to: p[2] })}>{p[0]}</button>
        ))}
      </div>
    </div>
  )
}

export default function ProgressSection({ progress, range, code, pin, notify, reload }) {
  const [open, setOpen] = useState(false)
  const rows = progress?.assessments || []
  const P = useMemo(() => computeProgress(rows), [rows])
  const T = useMemo(() => trainingDaily(progress?.daily), [progress])
  const filtered = !!(range.from || range.to)
  const label = (d) => fmtDate(d)
  const series = (P?.series || []).map((s) => ({ ...s, lbl: label(s.measured_on) }))
  const tdata = T.map((t) => ({ ...t, lbl: label(t.day) }))

  const del = async (id) => {
    try { await api.adminDeleteAssessment(pin, id); notify('Evaluación eliminada'); reload() } catch (e) { notify(e.message) }
  }
  const save = async (data) => {
    await api.adminAddAssessment(pin, code, data)
    setOpen(false)
    notify('Evaluación guardada')
    reload()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>📋 Evaluación física y progreso</h3>
            <span className="muted" style={{ fontSize: 13 }}>
              {P ? `${P.n} evaluación${P.n > 1 ? 'es' : ''} · ${label(P.from)}${P.n > 1 ? ` → ${label(P.to)} (${P.days} días)` : ''}` : filtered ? 'Sin evaluaciones en este periodo' : 'Aún no hay evaluaciones'}
            </span>
          </div>
          <GlowButton variant="solid ok" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>＋ Nueva evaluación</GlowButton>
        </div>

        {P && (
          <div className="kpis" style={{ marginTop: 14 }}>
            <Stat label="IMC actual" value={fmtNum(P.last.bmi)} sub={P.last.bmi_class} color={BMI_COLOR[P.last.bmi_class]} />
            <Stat label="Peso actual" value={`${fmtNum(P.last.weight_kg)} kg`}
              sub={P.weight && P.n > 1 ? `${fmtNum(P.weight.change)} kg · ${fmtPct(P.weight.pct)}` : null} good={P.weight?.good} />
            <Stat label="% grasa" value={P.last.fat != null ? `${fmtNum(P.last.fat)}%` : '—'}
              sub={P.fat && P.n > 1 ? `${fmtNum(P.fat.change)} pts` : P.last.body_fat_pct == null && P.last.fat_est_pct != null ? 'estimado' : null} good={P.fat?.good} />
            <Stat label="Avance hacia la meta" value={P.goalWeightPct != null ? `${fmtNum(P.goalWeightPct, 0)}%` : '—'}
              sub={P.goalW != null ? `meta ${fmtNum(P.goalW)} kg` : 'sin peso meta'} good={P.goalWeightPct != null ? P.goalWeightPct >= 0 : null} />
            <Stat label="Avance diario promedio" value={P.goalPerDay != null ? `${fmtNum(P.goalPerDay, 2)}%/día` : P.weight?.perDay != null ? `${fmtPct(P.weight.perDay, 2)}/día` : '—'}
              sub={P.goalPerDay != null ? 'de la meta de peso' : 'cambio de peso'} />
            <Stat label="Metabolismo basal" value={P.last.bmr_kcal ? `${P.last.bmr_kcal} kcal` : '—'} sub={P.last.tdee_kcal ? `gasto ${P.last.tdee_kcal} kcal` : null} />
            <Stat label="Cintura / cadera" value={fmtNum(P.last.whr, 2)} sub={P.waist && P.n > 1 ? `cintura ${fmtNum(P.waist.change)} cm` : null} good={P.waist?.good} />
            <Stat label="Masa magra" value={P.last.lean_mass_kg != null ? `${fmtNum(P.last.lean_mass_kg)} kg` : '—'}
              sub={P.lean && P.n > 1 ? `${fmtNum(P.lean.change)} kg` : null} good={P.lean?.good} />
          </div>
        )}
        {P?.last && (P.last.goal || P.last.injuries) && (
          <div className="muted" style={{ fontSize: 13, marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {P.last.goal && <span>🎯 {P.last.goal}</span>}
            {P.last.experience && <span>🏅 {P.last.experience}</span>}
            {P.last.injuries && <span>⚠️ {P.last.injuries}</span>}
          </div>
        )}
      </div>

      {P && (
        <div className="charts">
          <div className="card chart-card">
            <h3>Peso e IMC</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={series}>
                {GRID}
                <XAxis dataKey="lbl" {...AX} /><YAxis yAxisId="l" {...AX} domain={['auto', 'auto']} /><YAxis yAxisId="r" orientation="right" {...AX} domain={['auto', 'auto']} />
                <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
                {P.goalW != null && <ReferenceLine yAxisId="l" y={P.goalW} stroke="#34d399" strokeDasharray="5 4" label={{ value: 'meta', fill: '#34d399', fontSize: 11 }} />}
                <Line yAxisId="l" dataKey="weight_kg" name="Peso (kg)" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="r" dataKey="bmi" name="IMC" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h3>% de avance diario</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={series}>
                {GRID}
                <XAxis dataKey="lbl" {...AX} /><YAxis yAxisId="l" {...AX} /><YAxis yAxisId="r" orientation="right" {...AX} />
                <Tooltip {...TT} formatter={(v) => (v == null ? '—' : `${Number(v).toFixed(2)}%`)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="weightPctDay" name="Cambio de peso por día (%)" fill="#fbbf24" radius={[6, 6, 0, 0]} />
                <Line yAxisId="r" dataKey="goalPct" name="Avance acumulado a la meta (%)" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h3>Composición corporal</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series}>
                {GRID}
                <XAxis dataKey="lbl" {...AX} /><YAxis {...AX} domain={['auto', 'auto']} />
                <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="fat" name="% grasa" stroke="#fb7185" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="muscle_mass_kg" name="Masa muscular (kg)" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="lean_mass_kg" name="Masa magra (kg)" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h3>Perímetros (cm)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series}>
                {GRID}
                <XAxis dataKey="lbl" {...AX} /><YAxis {...AX} domain={['auto', 'auto']} />
                <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="waist_cm" name="Cintura" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="hip_cm" name="Cadera" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="chest_cm" name="Pecho" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="arm_cm" name="Brazo" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line dataKey="thigh_cm" name="Muslo" stroke="#fb7185" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {P && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Evaluaciones del periodo</h3>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Fecha</th><th>Peso</th><th>IMC</th><th>% grasa</th><th>M. magra</th><th>Cintura</th>
                <th>Δ% vs anterior</th><th>% por día</th><th>% acum.</th><th>Avance meta</th><th>Fuente</th><th />
              </tr></thead>
              <tbody>
                {[...P.series].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>{label(r.measured_on)}</td>
                    <td className="mono">{fmtNum(r.weight_kg)} kg</td>
                    <td className="mono" style={{ color: BMI_COLOR[r.bmi_class] }}>{fmtNum(r.bmi)}</td>
                    <td className="mono">{r.fat != null ? `${fmtNum(r.fat)}%` : '—'}</td>
                    <td className="mono">{r.lean_mass_kg != null ? `${fmtNum(r.lean_mass_kg)} kg` : '—'}</td>
                    <td className="mono">{r.waist_cm != null ? `${fmtNum(r.waist_cm)} cm` : '—'}</td>
                    <td className="mono">{fmtPct(r.weightPctPrev, 2)}</td>
                    <td className="mono">{fmtPct(r.weightPctDay, 2)}</td>
                    <td className="mono">{fmtPct(r.weightPctCum, 2)}</td>
                    <td className="mono">{r.goalPct != null ? `${fmtNum(r.goalPct, 0)}%` : '—'}</td>
                    <td><span className="chip" style={{ fontSize: 11 }}>{r.source === 'coach' ? 'Coach' : 'Cliente'}</span></td>
                    <td><button className="link-btn" title="Eliminar" onClick={() => del(r.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {T.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Entrenamiento por día · % de avance</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tdata}>
              {GRID}
              <XAxis dataKey="lbl" {...AX} /><YAxis {...AX} />
              <Tooltip {...TT} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="reps" name="Repeticiones" stackId="a" fill="#22d3ee" />
              <Bar dataKey="punches" name="Golpes" stackId="a" fill="#fb7185" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 320 }}>
            <table>
              <thead><tr><th>Día</th><th>Series</th><th>Reps</th><th>Golpes</th><th>Volumen</th><th>kcal</th><th>Min</th><th>Técnica</th><th>Δ% trabajo</th><th>Δ% volumen</th></tr></thead>
              <tbody>
                {[...T].reverse().map((t) => (
                  <tr key={t.day}>
                    <td>{label(t.day)}</td>
                    <td className="mono">{t.sets}</td><td className="mono">{t.reps}</td><td className="mono">{t.punches}</td>
                    <td className="mono">{Number(t.volume_kg) ? `${t.volume_kg} kg` : '—'}</td>
                    <td className="mono">{t.kcal}</td><td className="mono">{t.minutes}</td>
                    <td className="mono">{t.form ?? '—'}</td>
                    <td className="mono" style={{ color: t.workPct == null ? undefined : t.workPct >= 0 ? 'var(--ok)' : 'var(--hot)' }}>{fmtPct(t.workPct, 0)}</td>
                    <td className="mono" style={{ color: t.volPct == null ? undefined : t.volPct >= 0 ? 'var(--ok)' : 'var(--hot)' }}>{fmtPct(t.volPct, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Δ% compara cada día de entrenamiento con el anterior (trabajo = repeticiones + golpes).</div>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} className="assess-sheet">
        {open && (
          <AssessmentForm
            key={code}
            source="coach"
            title={`Evaluación física · cliente ${code}`}
            initial={progress?.latest ? { ...progress.latest, injuries: progress.latest.injuries, notes: '' } : null}
            onSubmit={save}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </div>
  )
}

function Stat({ label, value, sub, color, good }) {
  const c = color || (good == null ? undefined : good ? 'var(--ok)' : 'var(--hot)')
  return (
    <div className="card kpi">
      <small>{label}</small>
      <b style={color ? { color } : undefined}>{value}</b>
      {sub && <span className="delta" style={{ color: c || 'var(--muted)' }}>{sub}</span>}
    </div>
  )
}
