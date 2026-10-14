import { useMemo, useState } from 'react'
import { ACTIVITY, BMI_COLOR, EXPERIENCE, GOALS, derive, num, todayISO } from '../lib/body'
import { GlowButton } from './ui'

const KEYS = [
  'sex', 'birth_date', 'age_years', 'height_cm', 'weight_kg',
  'body_fat_pct', 'muscle_mass_kg', 'visceral_fat', 'body_water_pct',
  'neck_cm', 'chest_cm', 'waist_cm', 'hip_cm', 'arm_cm', 'thigh_cm', 'calf_cm',
  'resting_hr', 'bp_sys', 'bp_dia',
  'activity_level', 'experience', 'goal', 'goal_weight_kg', 'goal_fat_pct', 'injuries', 'notes',
]
const NUMERIC = KEYS.filter((k) => !['sex', 'birth_date', 'activity_level', 'experience', 'goal', 'injuries', 'notes'].includes(k))

const SECTIONS = [
  { title: 'Datos básicos', icon: '🧍', fields: [
    { k: 'height_cm', label: 'Estatura', unit: 'cm', req: true },
    { k: 'weight_kg', label: 'Peso', unit: 'kg', req: true },
    { k: 'birth_date', label: 'Fecha de nacimiento', type: 'date' },
    { k: 'age_years', label: 'Edad', unit: 'años', hint: 'solo si no sabes la fecha de nacimiento' },
  ] },
  { title: 'Composición corporal', icon: '⚖️', hint: 'De una báscula de bioimpedancia o de un plicómetro. Si no la tienes, deja en blanco: se estima con perímetros.', fields: [
    { k: 'body_fat_pct', label: 'Grasa corporal', unit: '%' },
    { k: 'muscle_mass_kg', label: 'Masa muscular', unit: 'kg' },
    { k: 'visceral_fat', label: 'Grasa visceral', unit: 'nivel' },
    { k: 'body_water_pct', label: 'Agua corporal', unit: '%' },
  ] },
  { title: 'Perímetros', icon: '📏', fields: [
    { k: 'neck_cm', label: 'Cuello', unit: 'cm' },
    { k: 'chest_cm', label: 'Pecho', unit: 'cm' },
    { k: 'waist_cm', label: 'Cintura (ombligo)', unit: 'cm' },
    { k: 'hip_cm', label: 'Cadera', unit: 'cm' },
    { k: 'arm_cm', label: 'Brazo', unit: 'cm' },
    { k: 'thigh_cm', label: 'Muslo', unit: 'cm' },
    { k: 'calf_cm', label: 'Pantorrilla', unit: 'cm' },
  ] },
  { title: 'Salud', icon: '❤️', fields: [
    { k: 'resting_hr', label: 'Pulso en reposo', unit: 'lpm' },
    { k: 'bp_sys', label: 'Presión sistólica', unit: 'mmHg' },
    { k: 'bp_dia', label: 'Presión diastólica', unit: 'mmHg' },
  ] },
]

const init = (initial) => {
  const f = { measured_on: todayISO() }
  for (const k of KEYS) f[k] = initial?.[k] ?? ''
  return f
}

export default function AssessmentForm({ initial, source, title, onSubmit, onClose }) {
  const [f, setF] = useState(() => init(initial))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const d = useMemo(() => derive(f), [f])

  const submit = async () => {
    setErr('')
    if (!num(f.weight_kg) || !num(f.height_cm)) { setErr('La estatura y el peso son obligatorios.'); return }
    if (!f.sex) { setErr('Indica el sexo (se usa en el metabolismo basal y el % de grasa).'); return }
    if (!f.birth_date && !num(f.age_years)) { setErr('Indica la fecha de nacimiento o la edad.'); return }
    const data = { measured_on: f.measured_on }
    for (const k of KEYS) {
      const v = f[k]
      if (v === '' || v == null) continue
      data[k] = NUMERIC.includes(k) ? num(v) : v
    }
    if (f.birth_date) delete data.age_years
    setBusy(true)
    try { await onSubmit(data) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="assess">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title || 'Evaluación física'}</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            {source === 'coach' ? 'Registrada por el coach' : 'Completa lo que conozcas; estatura, peso, sexo y edad son obligatorios.'}
          </div>
        </div>
        <GlowButton variant="sm icon hot ghost" onClick={onClose} type="button">✕</GlowButton>
      </div>

      <div className="form-sec">
        <div className="form-sec-title">📅 Fecha de la medición</div>
        <div className="form-grid">
          <label className="fld">
            <span>Fecha</span>
            <input type="date" className="text-input" value={f.measured_on} max={todayISO()} onChange={(e) => set('measured_on', e.target.value || todayISO())} />
          </label>
          <div className="fld">
            <span>Sexo <b className="req">*</b></span>
            <div className="seg">
              {[['M', 'Hombre'], ['F', 'Mujer']].map(([v, l]) => (
                <button key={v} type="button" className={f.sex === v ? 'on' : ''} onClick={() => set('sex', v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {SECTIONS.map((s) => (
        <div className="form-sec" key={s.title}>
          <div className="form-sec-title">{s.icon} {s.title}</div>
          {s.hint && <div className="muted" style={{ fontSize: 12, margin: '-4px 0 8px' }}>{s.hint}</div>}
          <div className="form-grid">
            {s.fields.map((x) => (
              <label className="fld" key={x.k}>
                <span>{x.label} {x.req && <b className="req">*</b>}{x.unit && <small>{x.unit}</small>}</span>
                {x.type === 'date' ? (
                  <input type="date" className="text-input" value={f[x.k]} max={todayISO()} onChange={(e) => set(x.k, e.target.value)} />
                ) : (
                  <input className="text-input mono" inputMode="decimal" value={f[x.k]}
                    onChange={(e) => set(x.k, e.target.value.replace(/[^0-9.,]/g, ''))} />
                )}
                {x.hint && <em>{x.hint}</em>}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="form-sec">
        <div className="form-sec-title">🎯 Objetivo y hábitos</div>
        <div className="form-grid">
          <label className="fld">
            <span>Objetivo principal</span>
            <select className="text-input" value={f.goal} onChange={(e) => set('goal', e.target.value)}>
              <option value="">— Elige —</option>
              {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>Peso meta <small>kg</small></span>
            <input className="text-input mono" inputMode="decimal" value={f.goal_weight_kg} onChange={(e) => set('goal_weight_kg', e.target.value.replace(/[^0-9.,]/g, ''))} />
          </label>
          <label className="fld">
            <span>% de grasa meta <small>%</small></span>
            <input className="text-input mono" inputMode="decimal" value={f.goal_fat_pct} onChange={(e) => set('goal_fat_pct', e.target.value.replace(/[^0-9.,]/g, ''))} />
          </label>
          <label className="fld">
            <span>Nivel de actividad</span>
            <select className="text-input" value={f.activity_level} onChange={(e) => set('activity_level', e.target.value)}>
              <option value="">— Elige —</option>
              {ACTIVITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="fld">
            <span>Experiencia</span>
            <select className="text-input" value={f.experience} onChange={(e) => set('experience', e.target.value)}>
              <option value="">— Elige —</option>
              {EXPERIENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="fld" style={{ marginTop: 10 }}>
          <span>Lesiones, dolencias o limitaciones</span>
          <textarea className="text-input" rows={2} maxLength={600} value={f.injuries} onChange={(e) => set('injuries', e.target.value)} />
        </label>
        <label className="fld" style={{ marginTop: 10 }}>
          <span>Notas</span>
          <textarea className="text-input" rows={2} maxLength={600} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>

      <div className="preview">
        <div className="form-sec-title">🧮 Cálculos en vivo</div>
        <div className="preview-grid">
          <Calc label="IMC" value={d.bmi != null ? d.bmi : '—'} sub={d.bmiClass} color={BMI_COLOR[d.bmiClass]} />
          <Calc label="Edad" value={d.age != null ? `${d.age} años` : '—'} />
          <Calc label="Relación cintura/cadera" value={d.whr ?? '—'} sub={d.whr == null ? null : riskWhr(d.whr, f.sex)} />
          <Calc label="Cintura/estatura" value={d.whtr ?? '—'} sub={d.whtr == null ? null : d.whtr < 0.5 ? 'Riesgo bajo' : d.whtr < 0.6 ? 'Riesgo aumentado' : 'Riesgo alto'} />
          <Calc label="Metabolismo basal" value={d.bmr != null ? `${d.bmr} kcal` : '—'} />
          <Calc label="Gasto diario" value={d.tdee != null ? `${d.tdee} kcal` : '—'} sub={d.tdee == null ? 'elige nivel de actividad' : null} />
          <Calc label="% grasa" value={d.fat != null ? `${d.fat}%` : '—'} sub={f.body_fat_pct ? 'medido' : d.fatEst != null ? 'estimado (Marina EE. UU.)' : null} />
          <Calc label="Masa magra" value={d.lean != null ? `${d.lean} kg` : '—'} sub={d.fatMass != null ? `grasa ${d.fatMass} kg` : null} />
        </div>
      </div>

      {err && <div className="form-err">{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <GlowButton variant="ghost" type="button" onClick={onClose}>Cancelar</GlowButton>
        <GlowButton variant="solid ok" type="button" disabled={busy} onClick={submit}>{busy ? 'Guardando…' : '✓ Guardar evaluación'}</GlowButton>
      </div>
    </div>
  )
}

function Calc({ label, value, sub, color }) {
  return (
    <div className="calc">
      <small>{label}</small>
      <b className="mono" style={color ? { color } : undefined}>{value}</b>
      {sub && <span style={color ? { color } : undefined}>{sub}</span>}
    </div>
  )
}

function riskWhr(v, sex) {
  const hi = sex === 'F' ? 0.85 : 0.9
  return v < hi ? 'Riesgo bajo' : 'Riesgo aumentado'
}
