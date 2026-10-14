-- =====================================================================
--  Migración 007 · Evaluación física (IMC, peso, edad, estatura, composición,
--                  perímetros, salud, objetivos) + progreso y filtro por fechas
-- =====================================================================

create table if not exists ej_assessments (
  id             uuid primary key default gen_random_uuid(),
  client_code    text not null references ej_clients(code) on delete cascade,
  measured_on    date not null default current_date,
  source         text not null default 'cliente' check (source in ('coach','cliente')),
  sex            text check (sex in ('M','F')),
  birth_date     date,
  age_years      int,
  height_cm      numeric,
  weight_kg      numeric,
  body_fat_pct   numeric,
  muscle_mass_kg numeric,
  visceral_fat   numeric,
  body_water_pct numeric,
  neck_cm        numeric,
  chest_cm       numeric,
  waist_cm       numeric,
  hip_cm         numeric,
  arm_cm         numeric,
  thigh_cm       numeric,
  calf_cm        numeric,
  resting_hr     int,
  bp_sys         int,
  bp_dia         int,
  activity_level text check (activity_level in ('sedentario','ligero','moderado','alto','muy_alto')),
  experience     text check (experience in ('principiante','intermedio','avanzado')),
  goal           text,
  goal_weight_kg numeric,
  goal_fat_pct   numeric,
  injuries       text,
  notes          text,
  -- calculados por el servidor
  bmi            numeric,
  bmi_class      text,
  whr            numeric,
  whtr           numeric,
  bmr_kcal       numeric,
  tdee_kcal      numeric,
  fat_est_pct    numeric,
  fat_mass_kg    numeric,
  lean_mass_kg   numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_code, measured_on)
);
create index if not exists ej_assessments_client_idx on ej_assessments(client_code, measured_on);
alter table ej_assessments enable row level security;   -- sin políticas: solo por RPC

-- ---------- Validación y cálculos ----------
create or replace function ej_assessment_derive() returns trigger language plpgsql as $$
declare act numeric; fat numeric;
begin
  if new.height_cm is not null and (new.height_cm < 80 or new.height_cm > 250) then raise exception 'La estatura debe estar entre 80 y 250 cm'; end if;
  if new.weight_kg is not null and (new.weight_kg < 25 or new.weight_kg > 400) then raise exception 'El peso debe estar entre 25 y 400 kg'; end if;
  if new.body_fat_pct is not null and (new.body_fat_pct < 2 or new.body_fat_pct > 70) then raise exception 'El %% de grasa debe estar entre 2 y 70'; end if;
  if new.resting_hr is not null and (new.resting_hr < 30 or new.resting_hr > 220) then raise exception 'La frecuencia en reposo debe estar entre 30 y 220'; end if;
  if new.measured_on > current_date + 1 then raise exception 'La fecha de la medición no puede ser futura'; end if;
  if new.birth_date is not null then
    if new.birth_date > new.measured_on then raise exception 'La fecha de nacimiento es posterior a la medición'; end if;
    new.age_years := date_part('year', age(new.measured_on, new.birth_date))::int;
  end if;
  if new.age_years is not null and (new.age_years < 5 or new.age_years > 110) then raise exception 'La edad debe estar entre 5 y 110 años'; end if;

  new.bmi := null; new.bmi_class := null; new.whr := null; new.whtr := null;
  new.bmr_kcal := null; new.tdee_kcal := null; new.fat_est_pct := null; new.fat_mass_kg := null; new.lean_mass_kg := null;

  if new.weight_kg is not null and new.height_cm is not null then
    new.bmi := round(new.weight_kg / power(new.height_cm / 100.0, 2), 1);
    new.bmi_class := case when new.bmi < 18.5 then 'Bajo peso' when new.bmi < 25 then 'Normal'
                          when new.bmi < 30 then 'Sobrepeso' when new.bmi < 35 then 'Obesidad I'
                          when new.bmi < 40 then 'Obesidad II' else 'Obesidad III' end;
  end if;
  if new.waist_cm is not null and new.hip_cm is not null and new.hip_cm > 0 then new.whr := round(new.waist_cm / new.hip_cm, 2); end if;
  if new.waist_cm is not null and new.height_cm is not null then new.whtr := round(new.waist_cm / new.height_cm, 2); end if;

  -- Mifflin-St Jeor
  if new.weight_kg is not null and new.height_cm is not null and new.age_years is not null and new.sex is not null then
    new.bmr_kcal := round(10 * new.weight_kg + 6.25 * new.height_cm - 5 * new.age_years + case new.sex when 'M' then 5 else -161 end);
    act := case new.activity_level when 'sedentario' then 1.2 when 'ligero' then 1.375 when 'moderado' then 1.55
                                   when 'alto' then 1.725 when 'muy_alto' then 1.9 else null end;
    if act is not null then new.tdee_kcal := round(new.bmr_kcal * act); end if;
  end if;

  -- % de grasa estimado (método de la Marina de EE. UU.)
  if new.sex = 'M' and new.neck_cm is not null and new.waist_cm is not null and new.height_cm is not null and new.waist_cm > new.neck_cm then
    fat := 495 / (1.0324 - 0.19077 * log(new.waist_cm - new.neck_cm) + 0.15456 * log(new.height_cm)) - 450;
  elsif new.sex = 'F' and new.neck_cm is not null and new.waist_cm is not null and new.hip_cm is not null
        and new.height_cm is not null and new.waist_cm + new.hip_cm > new.neck_cm then
    fat := 495 / (1.29579 - 0.35004 * log(new.waist_cm + new.hip_cm - new.neck_cm) + 0.22100 * log(new.height_cm)) - 450;
  end if;
  if fat is not null and fat between 2 and 60 then new.fat_est_pct := round(fat, 1); end if;

  fat := coalesce(new.body_fat_pct, new.fat_est_pct);
  if fat is not null and new.weight_kg is not null then
    new.fat_mass_kg := round(new.weight_kg * fat / 100, 1);
    new.lean_mass_kg := round(new.weight_kg - new.fat_mass_kg, 1);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ej_assessment_derive_trg on ej_assessments;
create trigger ej_assessment_derive_trg before insert or update on ej_assessments
  for each row execute function ej_assessment_derive();

-- El peso de la última evaluación alimenta el cálculo de cargas de los ejercicios
create or replace function ej_assessment_sync() returns trigger language plpgsql as $$
begin
  if new.weight_kg is not null and not exists (
       select 1 from ej_assessments a
       where a.client_code = new.client_code and a.weight_kg is not null and a.measured_on > new.measured_on) then
    update ej_clients set body_weight_kg = new.weight_kg where code = new.client_code;
  end if;
  return null;
end $$;

drop trigger if exists ej_assessment_sync_trg on ej_assessments;
create trigger ej_assessment_sync_trg after insert or update on ej_assessments
  for each row execute function ej_assessment_sync();

-- ---------- Guardado (una evaluación por cliente y día; se combinan los campos) ----------
create or replace function ej_save_assessment(p_code text, p_data jsonb, p_source text)
returns json language plpgsql security definer set search_path = public as $$
declare v ej_assessments;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_assessments as a (client_code, source, measured_on, sex, birth_date, age_years, height_cm, weight_kg, body_fat_pct, muscle_mass_kg, visceral_fat, body_water_pct, neck_cm, chest_cm, waist_cm, hip_cm, arm_cm, thigh_cm, calf_cm, resting_hr, bp_sys, bp_dia, activity_level, experience, goal, goal_weight_kg, goal_fat_pct, injuries, notes)
  values (p_code, p_source, coalesce(nullif(p_data->>'measured_on','')::date, current_date),
      left(nullif(trim(p_data->>'sex'),''), 1),
      nullif(p_data->>'birth_date','')::date,
      round(nullif(p_data->>'age_years','')::numeric)::int,
      nullif(p_data->>'height_cm','')::numeric,
      nullif(p_data->>'weight_kg','')::numeric,
      nullif(p_data->>'body_fat_pct','')::numeric,
      nullif(p_data->>'muscle_mass_kg','')::numeric,
      nullif(p_data->>'visceral_fat','')::numeric,
      nullif(p_data->>'body_water_pct','')::numeric,
      nullif(p_data->>'neck_cm','')::numeric,
      nullif(p_data->>'chest_cm','')::numeric,
      nullif(p_data->>'waist_cm','')::numeric,
      nullif(p_data->>'hip_cm','')::numeric,
      nullif(p_data->>'arm_cm','')::numeric,
      nullif(p_data->>'thigh_cm','')::numeric,
      nullif(p_data->>'calf_cm','')::numeric,
      round(nullif(p_data->>'resting_hr','')::numeric)::int,
      round(nullif(p_data->>'bp_sys','')::numeric)::int,
      round(nullif(p_data->>'bp_dia','')::numeric)::int,
      left(nullif(trim(p_data->>'activity_level'),''), 20),
      left(nullif(trim(p_data->>'experience'),''), 20),
      left(nullif(trim(p_data->>'goal'),''), 120),
      nullif(p_data->>'goal_weight_kg','')::numeric,
      nullif(p_data->>'goal_fat_pct','')::numeric,
      left(nullif(trim(p_data->>'injuries'),''), 600),
      left(nullif(trim(p_data->>'notes'),''), 600))
  on conflict (client_code, measured_on) do update set
      source = excluded.source,
      sex = coalesce(excluded.sex, a.sex),
      birth_date = coalesce(excluded.birth_date, a.birth_date),
      age_years = coalesce(excluded.age_years, a.age_years),
      height_cm = coalesce(excluded.height_cm, a.height_cm),
      weight_kg = coalesce(excluded.weight_kg, a.weight_kg),
      body_fat_pct = coalesce(excluded.body_fat_pct, a.body_fat_pct),
      muscle_mass_kg = coalesce(excluded.muscle_mass_kg, a.muscle_mass_kg),
      visceral_fat = coalesce(excluded.visceral_fat, a.visceral_fat),
      body_water_pct = coalesce(excluded.body_water_pct, a.body_water_pct),
      neck_cm = coalesce(excluded.neck_cm, a.neck_cm),
      chest_cm = coalesce(excluded.chest_cm, a.chest_cm),
      waist_cm = coalesce(excluded.waist_cm, a.waist_cm),
      hip_cm = coalesce(excluded.hip_cm, a.hip_cm),
      arm_cm = coalesce(excluded.arm_cm, a.arm_cm),
      thigh_cm = coalesce(excluded.thigh_cm, a.thigh_cm),
      calf_cm = coalesce(excluded.calf_cm, a.calf_cm),
      resting_hr = coalesce(excluded.resting_hr, a.resting_hr),
      bp_sys = coalesce(excluded.bp_sys, a.bp_sys),
      bp_dia = coalesce(excluded.bp_dia, a.bp_dia),
      activity_level = coalesce(excluded.activity_level, a.activity_level),
      experience = coalesce(excluded.experience, a.experience),
      goal = coalesce(excluded.goal, a.goal),
      goal_weight_kg = coalesce(excluded.goal_weight_kg, a.goal_weight_kg),
      goal_fat_pct = coalesce(excluded.goal_fat_pct, a.goal_fat_pct),
      injuries = coalesce(excluded.injuries, a.injuries),
      notes = coalesce(excluded.notes, a.notes)
  returning * into v;
  return row_to_json(v);
end $$;

create or replace function ej_client_add_assessment(p_code text, p_data jsonb)
returns json language sql security definer set search_path = public as $$
  select ej_save_assessment(p_code, p_data, 'cliente');
$$;

create or replace function ej_admin_add_assessment(p_pin text, p_code text, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return ej_save_assessment(p_code, p_data, 'coach');
end $$;

create or replace function ej_admin_delete_assessment(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  delete from ej_assessments where id = p_id;
end $$;

-- ---------- Progreso por rango de fechas ----------
create or replace function ej_admin_progress(p_pin text, p_code text, p_from date default null, p_to date default null, p_tz text default 'UTC')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare tz text := coalesce(nullif(p_tz,''),'UTC');
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return json_build_object(
    'assessments', coalesce((select json_agg(a order by a.measured_on) from (
        select * from ej_assessments
        where client_code = p_code
          and (p_from is null or measured_on >= p_from) and (p_to is null or measured_on <= p_to)) a), '[]'::json),
    'latest', (select row_to_json(a) from (
        select * from ej_assessments where client_code = p_code order by measured_on desc limit 1) a),
    'daily', coalesce((select json_agg(d order by d.day) from (
        select (w.created_at at time zone tz)::date as day,
               count(*) as sets,
               coalesce(sum(w.reps) filter (where e.kind = 'reps'), 0) as reps,
               coalesce(sum(w.reps) filter (where e.kind = 'boxing'), 0) as punches,
               round(coalesce(sum(w.volume_kg), 0)::numeric, 0) as volume_kg,
               round(coalesce(sum(w.kcal), 0)::numeric, 1) as kcal,
               round(avg(w.form_score)::numeric, 1) as form,
               round(coalesce(sum(w.duration_sec), 0)::numeric / 60, 1) as minutes
        from ej_sets w join ej_exercises e on e.id = w.exercise_id
        where w.client_code = p_code
          and (p_from is null or (w.created_at at time zone tz)::date >= p_from)
          and (p_to is null or (w.created_at at time zone tz)::date <= p_to)
        group by 1) d), '[]'::json)
  );
end $$;

-- ---------- Detalle del cliente: ahora con filtro de fechas ----------
drop function if exists ej_admin_client_detail(text, text);
create or replace function ej_admin_client_detail(p_pin text, p_code text, p_from date default null, p_to date default null, p_tz text default 'UTC')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare tz text := coalesce(nullif(p_tz,''),'UTC');
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
        from ej_sets w join ej_exercises e on e.id = w.exercise_id where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to)
        group by 1) t), '[]'::json),
    'by_exercise', coalesce((select json_agg(t order by t.reps desc) from (
        select w.exercise_id, count(*) as sets, sum(w.reps) as reps, max(w.reps) as best_set,
          round(avg(w.form_score)::numeric,1) as form, round(avg(w.avg_rom)::numeric,1) as rom,
          round(avg(w.incline_deg)::numeric,1) as incline, round(avg(w.torso_tilt)::numeric,1) as tilt,
          max(w.load_kg) as max_load, round(max(w.est_1rm)::numeric,1) as best_1rm,
          round(sum(w.volume_kg)::numeric,0) as volume_kg,
          round(avg(w.accuracy)::numeric,1) as accuracy, round(max(w.peak_punch_speed)::numeric,2) as punch_peak
        from ej_sets w where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to) group by 1) t), '[]'::json),
    'by_group', coalesce((select json_agg(t order by t.load desc) from (
        select (m->>'group') as group_id,
          round(sum(w.reps * (m->>'pct')::numeric / 100 * (1 + coalesce(w.load_kg,0) / 40))::numeric,1) as load
        from ej_sets w join ej_exercises e on e.id = w.exercise_id,
             jsonb_array_elements(e.muscles) m
        where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to) group by 1) t), '[]'::json),
    'weekly_exercise', coalesce((select json_agg(t) from (
        select date_trunc('week', w.created_at)::date as week, w.exercise_id, sum(w.reps) as reps,
               max(w.load_kg) as max_load, round(max(w.est_1rm)::numeric,1) as best_1rm
        from ej_sets w where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to) group by 1,2) t), '[]'::json),
    'punch_types', coalesce((select json_agg(t order by t.n desc) from (
        select k as punch, sum(case when v ~ '^[0-9]+$' then v::int else 0 end) as n
        from ej_sets w, jsonb_each_text(coalesce(w.punches,'{}'::jsonb)) as p(k, v)
        where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to) and v ~ '^[0-9]+$' group by k) t), '[]'::json),
    'sets', coalesce((select json_agg(t) from (
        select w.id, w.created_at, w.exercise_id, w.set_number, w.reps, w.target_reps, w.form_score, w.fatigue_pct,
               w.peak_speed, w.incline_deg, w.kcal, w.load_kg, w.est_1rm, w.accuracy, w.avg_punch_speed, w.guard_pct
        from ej_sets w where w.client_code = p_code and (p_from is null or (w.created_at at time zone tz)::date >= p_from) and (p_to is null or (w.created_at at time zone tz)::date <= p_to)
        order by w.created_at desc limit 200) t), '[]'::json),
    'routine', coalesce((select json_agg(r order by r.position) from ej_routines r where r.client_code = p_code), '[]'::json)
  );
end $$;

-- ---------- Ingreso del cliente: incluye su última evaluación ----------
create or replace function ej_client_enter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  select json_build_object(
    'code', c.code, 'name', c.name, 'body_weight_kg', c.body_weight_kg,
    'assessment', (select row_to_json(x) from (select * from ej_assessments where client_code = c.code order by measured_on desc limit 1) x),
    'routine', coalesce((select json_agg(x order by x.position, x.created_at) from (
        select ro.id, ro.exercise_id, ro.sets, ro.reps, ro.incline_deg, ro.rest_sec, ro.load_kg, ro.stance,
               ro.assigned_by, ro.position, ro.created_at
        from ej_routines ro where ro.client_code = c.code) x), '[]'::json),
    'today', (select json_build_object('sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
              from ej_sets w where w.client_code = c.code and w.created_at >= date_trunc('day', now()))
  ) into r from ej_clients c where c.code = p_code;
  return r;
end $$;

revoke execute on function ej_save_assessment(text, jsonb, text) from public, anon, authenticated;
grant execute on function ej_client_add_assessment(text, jsonb), ej_admin_add_assessment(text, text, jsonb),
  ej_admin_delete_assessment(text, uuid), ej_admin_progress(text, text, date, date, text),
  ej_admin_client_detail(text, text, date, date, text), ej_client_enter(text) to anon, authenticated;
