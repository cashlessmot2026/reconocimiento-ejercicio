// Fórmulas de composición corporal y cálculo de progreso.
// Las mismas fórmulas las calcula el servidor (trigger ej_assessment_derive); aquí se usan
// para la vista previa en vivo del formulario y para las series de progreso.

export const ACTIVITY = [
  ['sedentario', 'Sedentario (casi sin ejercicio)', 1.2],
  ['ligero', 'Ligero (1 a 3 días por semana)', 1.375],
  ['moderado', 'Moderado (3 a 5 días por semana)', 1.55],
  ['alto', 'Alto (6 a 7 días por semana)', 1.725],
  ['muy_alto', 'Muy alto (doble sesión o trabajo físico)', 1.9],
]
export const EXPERIENCE = [['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzado', 'Avanzado']]
export const GOALS = ['Perder grasa', 'Ganar masa muscular', 'Mejorar condición física', 'Rendimiento deportivo', 'Salud y bienestar', 'Rehabilitación']

export const BMI_COLOR = {
  'Bajo peso': '#60a5fa', Normal: '#34d399', Sobrepeso: '#fbbf24',
  'Obesidad I': '#fb923c', 'Obesidad II': '#f87171', 'Obesidad III': '#ef4444',
}

export const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const r1 = (x) => Math.round(x * 10) / 10

/** YYYY-MM-DD de hoy en la zona horaria local. */
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
export const dayNum = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

export function ageOn(birth, on) {
  if (!birth) return null
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, d] = (on || todayISO()).split('-').map(Number)
  let a = y - by
  if (m < bm || (m === bm && d < bd)) a--
  return a >= 0 ? a : null
}

/** Cálculos derivados a partir de valores de formulario (cadenas o números). */
export function derive(f) {
  const w = num(f.weight_kg), h = num(f.height_cm)
  const waist = num(f.waist_cm), hip = num(f.hip_cm), neck = num(f.neck_cm)
  const age = f.birth_date ? ageOn(f.birth_date, f.measured_on) : num(f.age_years)
  const out = { age, bmi: null, bmiClass: null, whr: null, whtr: null, bmr: null, tdee: null, fatEst: null, fat: null, fatMass: null, lean: null }

  if (w && h) {
    out.bmi = r1(w / ((h / 100) ** 2))
    out.bmiClass = out.bmi < 18.5 ? 'Bajo peso' : out.bmi < 25 ? 'Normal' : out.bmi < 30 ? 'Sobrepeso'
      : out.bmi < 35 ? 'Obesidad I' : out.bmi < 40 ? 'Obesidad II' : 'Obesidad III'
  }
  if (waist && hip) out.whr = Math.round((waist / hip) * 100) / 100
  if (waist && h) out.whtr = Math.round((waist / h) * 100) / 100
  if (w && h && age != null && f.sex) {
    out.bmr = Math.round(10 * w + 6.25 * h - 5 * age + (f.sex === 'M' ? 5 : -161))
    const act = ACTIVITY.find((a) => a[0] === f.activity_level)
    if (act) out.tdee = Math.round(out.bmr * act[2])
  }
  let fat = null
  if (f.sex === 'M' && neck && waist && h && waist > neck) {
    fat = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450
  } else if (f.sex === 'F' && neck && waist && hip && h && waist + hip > neck) {
    fat = 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(h)) - 450
  }
  if (fat != null && fat >= 2 && fat <= 60) out.fatEst = r1(fat)
  out.fat = num(f.body_fat_pct) ?? out.fatEst
  if (out.fat != null && w) {
    out.fatMass = r1((w * out.fat) / 100)
    out.lean = r1(w - out.fatMass)
  }
  return out
}

const pct = (a, b) => (a != null && b != null && a !== 0 ? ((b - a) / a) * 100 : null)

/**
 * Progreso dentro del periodo: la primera medición es la base.
 * - cambio total y % por métrica, y % promedio por día
 * - % de avance hacia la meta de peso (y de % de grasa)
 * - serie por evaluación con % respecto a la anterior, % diario y % acumulado
 */
export function computeProgress(rows) {
  if (!rows?.length) return null
  const list = rows.map((r) => ({ ...r, t: dayNum(r.measured_on), fat: r.body_fat_pct ?? r.fat_est_pct ?? null }))
  const first = list[0], last = list[list.length - 1]
  const days = Math.max(1, last.t - first.t)
  const multi = list.length > 1

  const metric = (key, lowerIsBetter) => {
    const a = first[key], b = last[key]
    if (a == null || b == null) return null
    const change = b - a
    const p = pct(a, b)
    return { first: a, last: b, change, pct: p, perDay: multi && p != null ? p / days : null, good: lowerIsBetter ? change <= 0 : change >= 0 }
  }
  const goalW = [...list].reverse().find((r) => r.goal_weight_kg != null)?.goal_weight_kg ?? null
  const goalF = [...list].reverse().find((r) => r.goal_fat_pct != null)?.goal_fat_pct ?? null
  const toGoal = (a, b, g) => (a != null && b != null && g != null && a !== g ? ((a - b) / (a - g)) * 100 : null)

  const goalWeightPct = toGoal(first.weight_kg, last.weight_kg, goalW)
  const goalFatPct = toGoal(first.fat, last.fat, goalF)

  const series = list.map((r, i) => {
    const prev = list[i - 1]
    const dd = prev ? Math.max(1, r.t - prev.t) : null
    const wPrev = prev ? pct(prev.weight_kg, r.weight_kg) : null
    return {
      ...r,
      day: r.measured_on,
      weightPctPrev: wPrev,
      weightPctDay: wPrev != null ? wPrev / dd : null,
      weightPctCum: pct(first.weight_kg, r.weight_kg),
      goalPct: toGoal(first.weight_kg, r.weight_kg, goalW),
      fatPctCum: pct(first.fat, r.fat),
    }
  })

  return {
    n: list.length, from: first.measured_on, to: last.measured_on, days, series, goalW, goalF,
    weight: metric('weight_kg', goalW != null && goalW < first.weight_kg),
    bmi: metric('bmi', true),
    fat: metric('fat', true),
    muscle: metric('muscle_mass_kg', false),
    lean: metric('lean_mass_kg', false),
    waist: metric('waist_cm', true),
    goalWeightPct, goalFatPct,
    goalPerDay: multi && goalWeightPct != null ? goalWeightPct / days : null,
    last,
  }
}

/** Entrenamiento por día con % de variación respecto al día anterior entrenado. */
export function trainingDaily(daily) {
  const out = []
  let prev = null
  for (const d of daily || []) {
    const work = Number(d.reps || 0) + Number(d.punches || 0)
    const vol = Number(d.volume_kg || 0)
    out.push({
      ...d,
      work,
      workPct: prev && prev.work ? ((work - prev.work) / prev.work) * 100 : null,
      volPct: prev && prev.vol && vol ? ((vol - prev.vol) / prev.vol) * 100 : null,
    })
    prev = { work, vol }
  }
  return out
}

export const fmtPct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
export const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d).replace(/\.0+$/, ''))
