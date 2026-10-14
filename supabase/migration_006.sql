-- =====================================================================
--  Migración 006 · Retirada del reconocimiento facial
--  (la app ya no lo usa; se eliminan sus tablas, funciones y configuración)
-- =====================================================================
-- 1) Funciones que consultaban ej_faces, sin rostros
create or replace function ej_client_enter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  select json_build_object(
    'code', c.code, 'name', c.name, 'body_weight_kg', c.body_weight_kg,
    'routine', coalesce((select json_agg(x order by x.position, x.created_at) from (
        select ro.id, ro.exercise_id, ro.sets, ro.reps, ro.incline_deg, ro.rest_sec, ro.load_kg, ro.stance,
               ro.assigned_by, ro.position, ro.created_at
        from ej_routines ro where ro.client_code = c.code) x), '[]'::json),
    'today', (select json_build_object('sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
              from ej_sets w where w.client_code = c.code and w.created_at >= date_trunc('day', now()))
  ) into r from ej_clients c where c.code = p_code;
  return r;
end $$;

create or replace function ej_admin_clients(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by t.last_at desc nulls last) from (
    select c.code, c.name, c.created_at,
      count(w.id) as sets, coalesce(sum(w.reps),0) as reps,
      coalesce(round(sum(w.kcal)::numeric,1),0) as kcal, max(w.created_at) as last_at
    from ej_clients c left join ej_sets w on w.client_code = c.code
    group by c.code) t), '[]'::json);
end $$;

create or replace function ej_admin_client_detail(p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return json_build_object(
    'client', (select json_build_object('code', c.code, 'name', c.name, 'created_at', c.created_at,
                 'body_weight_kg', c.body_weight_kg)
               from ej_clients c where c.code = p_code),
    'weekly', coalesce((select json_agg(t order by t.week) from (
        select date_trunc('week', w.created_at)::date as week,
          count(*) as sets, sum(w.reps) filter (where e.kind = 'reps') as reps,
          round(sum(w.kcal)::numeric,1) as kcal,
          round(avg(w.form_score)::numeric,1) as form, round(avg(w.avg_rom)::numeric,1) as rom,
          round(avg(w.fatigue_pct)::numeric,1) as fatigue,
          round(sum(w.volume_kg)::numeric,0) as volume_kg,
          max(w.load_kg) as max_load, round(max(w.est_1rm)::numeric,1) as best_1rm,
          round(avg(w.avg_power_w)::numeric,0) as power_w,
          sum(w.reps) filter (where e.kind = 'boxing') as punches,
          round(avg(w.accuracy)::numeric,1) as accuracy,
          round(avg(w.avg_punch_speed)::numeric,2) as punch_speed,
          round(max(w.peak_punch_speed)::numeric,2) as punch_peak,
          round(avg(w.guard_pct)::numeric,1) as guard,
          count(distinct date_trunc('day', w.created_at)) as days
        from ej_sets w join ej_exercises e on e.id = w.exercise_id where w.client_code = p_code
        group by 1) t), '[]'::json),
    'by_exercise', coalesce((select json_agg(t order by t.reps desc) from (
        select w.exercise_id, count(*) as sets, sum(w.reps) as reps, max(w.reps) as best_set,
          round(avg(w.form_score)::numeric,1) as form, round(avg(w.avg_rom)::numeric,1) as rom,
          round(avg(w.incline_deg)::numeric,1) as incline, round(avg(w.torso_tilt)::numeric,1) as tilt,
          max(w.load_kg) as max_load, round(max(w.est_1rm)::numeric,1) as best_1rm,
          round(sum(w.volume_kg)::numeric,0) as volume_kg,
          round(avg(w.accuracy)::numeric,1) as accuracy, round(max(w.peak_punch_speed)::numeric,2) as punch_peak
        from ej_sets w where w.client_code = p_code group by 1) t), '[]'::json),
    'by_group', coalesce((select json_agg(t order by t.load desc) from (
        select (m->>'group') as group_id,
          round(sum(w.reps * (m->>'pct')::numeric / 100 * (1 + coalesce(w.load_kg,0) / 40))::numeric,1) as load
        from ej_sets w join ej_exercises e on e.id = w.exercise_id,
             jsonb_array_elements(e.muscles) m
        where w.client_code = p_code group by 1) t), '[]'::json),
    'weekly_exercise', coalesce((select json_agg(t) from (
        select date_trunc('week', w.created_at)::date as week, w.exercise_id, sum(w.reps) as reps,
               max(w.load_kg) as max_load, round(max(w.est_1rm)::numeric,1) as best_1rm
        from ej_sets w where w.client_code = p_code group by 1,2) t), '[]'::json),
    'punch_types', coalesce((select json_agg(t order by t.n desc) from (
        select k as punch, sum(case when v ~ '^[0-9]+$' then v::int else 0 end) as n
        from ej_sets w, jsonb_each_text(coalesce(w.punches,'{}'::jsonb)) as p(k, v)
        where w.client_code = p_code and v ~ '^[0-9]+$' group by k) t), '[]'::json),
    'sets', coalesce((select json_agg(t) from (
        select w.id, w.created_at, w.exercise_id, w.set_number, w.reps, w.target_reps, w.form_score, w.fatigue_pct,
               w.peak_speed, w.incline_deg, w.kcal, w.load_kg, w.est_1rm, w.accuracy, w.avg_punch_speed, w.guard_pct
        from ej_sets w where w.client_code = p_code
        order by w.created_at desc limit 200) t), '[]'::json),
    'routine', coalesce((select json_agg(r order by r.position) from ej_routines r where r.client_code = p_code), '[]'::json)
  );
end $$;

-- 2) Retirar lo relacionado con rostros
drop function if exists ej_face_identify(jsonb);
drop function if exists ej_face_enroll(text, jsonb);
drop function if exists ej_face_verify(text, jsonb);
drop function if exists ej_admin_set_face_enabled(text, boolean);
drop function if exists ej_admin_face_delete(text, text);
drop function if exists ej_to_vec(jsonb);
drop table if exists ej_faces;
delete from ej_config where key = 'face';
