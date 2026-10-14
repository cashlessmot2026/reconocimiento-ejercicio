import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : null

function db() {
  if (!supabase) throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  return supabase
}

async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

async function select(table, query = '*', order) {
  let q = db().from(table).select(query)
  if (order) q = q.order(order)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

/** Todo lo que la app necesita para arrancar viene de la base de datos. */
export async function loadBootstrap() {
  const [config, groups, exercises] = await Promise.all([
    select('ej_config', 'key,value'),
    select('ej_muscle_groups', '*'),
    select('ej_exercises', '*', 'sort'),
  ])
  const cfg = Object.fromEntries(config.map((r) => [r.key, r.value]))
  return {
    brand: cfg.brand ?? {},
    copy: cfg.copy ?? {},
    phases: cfg.phases ?? {},
    punches: cfg.punches ?? {},
    groups: Object.fromEntries(groups.map((g) => [g.id, g])),
    exercises,
  }
}

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const api = {
  enterClient: (code) => rpc('ej_client_enter', { p_code: code }),
  addRoutine: (code, r) =>
    rpc('ej_client_add_routine', {
      p_code: code, p_exercise: r.exercise_id, p_sets: r.sets, p_reps: r.reps,
      p_incline: r.incline_deg, p_rest: r.rest_sec, p_load: r.load_kg || 0, p_stance: r.stance || 'orthodox',
    }),
  setWeight: (code, kg) => rpc('ej_client_set_weight', { p_code: code, p_kg: kg }),
  addAssessment: (code, data) => rpc('ej_client_add_assessment', { p_code: code, p_data: data }),
  removeRoutine: (code, id) => rpc('ej_client_remove_routine', { p_code: code, p_id: id }),
  saveSet: async (row) => {
    const { error } = await db().from('ej_sets').insert(row)
    if (error) throw new Error(error.message)
  },

  adminCheck: (pin) => rpc('ej_admin_check', { p_pin: pin }),
  adminOverview: (pin) => rpc('ej_admin_overview', { p_pin: pin }),
  adminClients: (pin) => rpc('ej_admin_clients', { p_pin: pin }),
  adminClient: (pin, code, from, to) =>
    rpc('ej_admin_client_detail', { p_pin: pin, p_code: code, p_from: from || null, p_to: to || null, p_tz: tz() }),
  adminProgress: (pin, code, from, to) =>
    rpc('ej_admin_progress', { p_pin: pin, p_code: code, p_from: from || null, p_to: to || null, p_tz: tz() }),
  adminAddAssessment: (pin, code, data) => rpc('ej_admin_add_assessment', { p_pin: pin, p_code: code, p_data: data }),
  adminDeleteAssessment: (pin, id) => rpc('ej_admin_delete_assessment', { p_pin: pin, p_id: id }),
  adminRename: (pin, code, name) => rpc('ej_admin_set_client_name', { p_pin: pin, p_code: code, p_name: name }),
  adminAddRoutine: (pin, code, r) =>
    rpc('ej_admin_add_routine', {
      p_pin: pin, p_code: code, p_exercise: r.exercise_id, p_sets: r.sets, p_reps: r.reps,
      p_incline: r.incline_deg, p_rest: r.rest_sec, p_load: r.load_kg || 0, p_stance: r.stance || 'orthodox',
    }),
  adminSetWeight: (pin, code, kg) => rpc('ej_admin_set_client_weight', { p_pin: pin, p_code: code, p_kg: kg }),
  adminRemoveRoutine: (pin, id) => rpc('ej_admin_remove_routine', { p_pin: pin, p_id: id }),
}
