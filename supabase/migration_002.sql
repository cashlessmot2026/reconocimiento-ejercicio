-- =====================================================================
--  Migración 002 · Cargas (lastre), boxeo y reconocimiento facial
-- =====================================================================
create extension if not exists vector with schema extensions;

-- ---------- Columnas nuevas ----------
alter table ej_exercises add column if not exists kind text not null default 'reps';      -- reps | boxing
alter table ej_exercises add column if not exists supports_load boolean not null default false;
alter table ej_exercises add column if not exists bw_factor numeric not null default 0;     -- fracción del peso corporal movida
alter table ej_exercises add column if not exists box_mode text;                             -- shadow | combos | targets | speed
alter table ej_exercises add column if not exists box_config jsonb;

alter table ej_clients  add column if not exists body_weight_kg numeric;

alter table ej_routines add column if not exists load_kg numeric not null default 0;
alter table ej_routines add column if not exists stance text not null default 'orthodox';
alter table ej_routines drop constraint if exists ej_routines_reps_check;
alter table ej_routines add constraint ej_routines_reps_check check (reps between 1 and 600);

alter table ej_sets add column if not exists load_kg numeric not null default 0;
alter table ej_sets add column if not exists body_weight_kg numeric;
alter table ej_sets add column if not exists effective_kg numeric;     -- peso corporal*factor + lastre
alter table ej_sets add column if not exists volume_kg numeric;        -- reps * effective_kg
alter table ej_sets add column if not exists est_1rm numeric;          -- Epley
alter table ej_sets add column if not exists avg_power_w numeric;
alter table ej_sets add column if not exists punches jsonb;            -- {"jab":n,"cross":n,...}
alter table ej_sets add column if not exists attempts int;
alter table ej_sets add column if not exists hits int;
alter table ej_sets add column if not exists accuracy numeric;         -- %
alter table ej_sets add column if not exists avg_punch_speed numeric;  -- m/s
alter table ej_sets add column if not exists peak_punch_speed numeric;
alter table ej_sets add column if not exists guard_pct numeric;
alter table ej_sets add column if not exists punch_rate numeric;       -- golpes / min

-- ---------- Ejercicios con carga ----------
update ej_exercises set supports_load = true, bw_factor = 1.0  where id in ('pullup','dips');
update ej_exercises set supports_load = true, bw_factor = 0.65 where id = 'pushup';
update ej_exercises set supports_load = true, bw_factor = 0.75 where id in ('squat','lunge');
update ej_exercises set supports_load = true, bw_factor = 0.0  where id in ('deadlift','curl','press','lateral','glutebridge');

-- ---------- Boxeo ----------
insert into ej_muscle_groups(id, name, color, region) values
 ('oblicuos','Oblicuos / Rotación','#f97316','core')
on conflict (id) do nothing;

insert into ej_exercises(id,name,category,primary_group,muscles,joint_label,landmarks_l,landmarks_r,rest_angle,peak_angle,kcal_per_rep,camera_hint,cue,icon,default_sets,default_reps,sort,kind,box_mode,box_config) values
 ('box_shadow','Sombra libre','Boxeo','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":25},{"group":"pecho","pct":15},{"group":"triceps","pct":15},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara, de rodillas hacia arriba visibles','Golpea y vuelve rápido a la guardia','🥊',3,120,20,'boxing','shadow','{}'),
 ('box_combos','Combos guiados','Boxeo','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":30},{"group":"pecho","pct":15},{"group":"triceps","pct":10},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara, cuerpo hasta la cadera visible','Ejecuta el combo que se canta','🎯',3,90,21,'boxing','combos','{"combos":[[1,2],[1,1,2],[1,2,3],[2,3,2],[1,2,5,2],[1,6,3,2],[3,2,3],[1,2,3,4]],"gap_ms":2600}'),
 ('box_targets','Dianas de precisión','Boxeo','hombros','[{"group":"hombros","pct":40},{"group":"oblicuos","pct":20},{"group":"triceps","pct":20},{"group":"pecho","pct":10},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente, a 2 m de la cámara','Golpea la diana iluminada antes de que desaparezca','⭕',3,60,22,'boxing','targets','{"window_ms":1600}'),
 ('box_speed','Velocidad 30 s','Boxeo','hombros','[{"group":"hombros","pct":45},{"group":"triceps","pct":25},{"group":"core","pct":20},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.07,'De frente a la cámara','Máximo de golpes rectos limpios en 30 s','⚡',3,30,23,'boxing','speed','{}'),
 ('box_onetwo','Jab – Directo (1-2)','Boxeo','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":25},{"group":"pecho","pct":20},{"group":"triceps","pct":20}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara','Jab con la mano adelantada, directo girando la cadera','👊',3,60,24,'boxing','combos','{"combos":[[1,2]],"gap_ms":2000}')
on conflict (id) do update set name=excluded.name, category=excluded.category, muscles=excluded.muscles,
  camera_hint=excluded.camera_hint, cue=excluded.cue, icon=excluded.icon, default_sets=excluded.default_sets,
  default_reps=excluded.default_reps, sort=excluded.sort, kind=excluded.kind, box_mode=excluded.box_mode, box_config=excluded.box_config;

insert into ej_config(key, value) values
 ('punches', '{"1":{"id":"jab","name":"Jab","short":"1"},"2":{"id":"cross","name":"Directo","short":"2"},"3":{"id":"lead_hook","name":"Gancho adelante","short":"3"},"4":{"id":"rear_hook","name":"Gancho atrás","short":"4"},"5":{"id":"lead_upper","name":"Uppercut adelante","short":"5"},"6":{"id":"rear_upper","name":"Uppercut atrás","short":"6"}}'),
 ('face', '{"threshold":0.45,"margin":0.06,"samples":8,"consent":"Acepto que se guarde una huella facial numérica (128 valores, sin fotos) para identificarme en este gimnasio."}')
on conflict (key) do update set value = excluded.value;

-- ---------- Rostros (solo vectores, nunca imágenes) ----------
create table if not exists ej_faces (
  id          uuid primary key default gen_random_uuid(),
  client_code text not null references ej_clients(code) on delete cascade,
  embedding   extensions.vector(128) not null,
  quality     numeric,
  created_at  timestamptz not null default now()
);
create index if not exists ej_faces_client_idx on ej_faces(client_code);
alter table ej_faces enable row level security;   -- sin políticas: inaccesible salvo por RPC

-- Convierte un arreglo JSON en vector normalizado
create or replace function ej_to_vec(p jsonb)
returns extensions.vector language sql immutable set search_path = public, extensions as $$
  select (select array_agg(x::float8 order by i) from jsonb_array_elements_text(p) with ordinality t(x, i))::vector;
$$;

-- Identificación: todas las muestras enviadas deben coincidir con el mismo cliente
create or replace function ej_face_identify(p_descs jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  thr numeric := coalesce((select (value->>'threshold')::numeric from ej_config where key='face'), 0.45);
  mrg numeric := coalesce((select (value->>'margin')::numeric from ej_config where key='face'), 0.06);
  best record; second numeric; n int := jsonb_array_length(p_descs); agree int;
begin
  if n < 1 or n > 10 then raise exception 'Muestras inválidas'; end if;
  -- distancia media por cliente: para cada muestra se toma la mejor coincidencia de ese cliente
  with q as (
    select i, ej_to_vec(d) v from jsonb_array_elements(p_descs) with ordinality t(d, i)
  ), per as (
    select f.client_code, q.i, min(f.embedding <-> q.v) dist
    from ej_faces f cross join q group by f.client_code, q.i
  ), agg as (
    select client_code, avg(dist) mean_d, max(dist) worst_d from per group by client_code
  )
  select * into best from agg order by mean_d limit 1;

  if best is null then return json_build_object('match', false, 'reason', 'no_faces'); end if;

  with q as (
    select i, ej_to_vec(d) v from jsonb_array_elements(p_descs) with ordinality t(d, i)
  ), per as (
    select f.client_code, q.i, min(f.embedding <-> q.v) dist
    from ej_faces f cross join q group by f.client_code, q.i
  )
  select min(m) into second from (select client_code, avg(dist) m from per where client_code <> best.client_code group by client_code) s;

  -- cada muestra individual debe tener como mejor cliente al mismo
  with q as (
    select i, ej_to_vec(d) v from jsonb_array_elements(p_descs) with ordinality t(d, i)
  ), ranked as (
    select q.i, f.client_code, row_number() over (partition by q.i order by f.embedding <-> q.v) rn
    from ej_faces f cross join q
  )
  select count(*) into agree from ranked where rn = 1 and client_code = best.client_code;

  if best.mean_d <= thr and best.worst_d <= thr + 0.08 and agree = n
     and (second is null or second - best.mean_d >= mrg) then
    return json_build_object('match', true, 'code', best.client_code,
      'distance', round(best.mean_d::numeric, 3),
      'confidence', round(greatest(0, least(1, 1 - best.mean_d / (thr * 2)))::numeric * 100, 1));
  end if;
  return json_build_object('match', false, 'reason', 'no_match', 'distance', round(best.mean_d::numeric, 3));
end $$;

create or replace function ej_face_enroll(p_code text, p_descs jsonb, p_replace boolean default true)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare n int := jsonb_array_length(p_descs); other text; incons numeric;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  if n < 3 or n > 20 then raise exception 'Se requieren entre 3 y 20 muestras'; end if;
  -- coherencia interna: todas las muestras deben ser de la misma persona
  select max(a.v <-> b.v) into incons from
    (select ej_to_vec(d) v, i from jsonb_array_elements(p_descs) with ordinality t(d,i)) a,
    (select ej_to_vec(d) v, i from jsonb_array_elements(p_descs) with ordinality t(d,i)) b where a.i < b.i;
  if incons > 0.55 then raise exception 'Las muestras no son consistentes, repite el registro con buena luz'; end if;
  -- no permitir el mismo rostro en otro código
  select f.client_code into other from ej_faces f,
    (select ej_to_vec(d) v from jsonb_array_elements(p_descs) d) q
  where f.client_code <> p_code group by f.client_code having avg(f.embedding <-> q.v) < 0.40 limit 1;
  if other is not null then raise exception 'Este rostro ya está registrado con otro número de cliente'; end if;

  insert into ej_clients(code) values (p_code) on conflict do nothing;
  if p_replace then delete from ej_faces where client_code = p_code; end if;
  insert into ej_faces(client_code, embedding)
    select p_code, ej_to_vec(d) from jsonb_array_elements(p_descs) d;
  return json_build_object('ok', true, 'samples', (select count(*) from ej_faces where client_code = p_code),
                           'spread', round(incons::numeric, 3));
end $$;

create or replace function ej_client_set_weight(p_code text, p_kg numeric)
returns void language sql security definer set search_path = public as $$
  update ej_clients set body_weight_kg = case when p_kg between 25 and 300 then p_kg else null end where code = p_code;
$$;

-- ---------- RPC cliente actualizadas ----------
create or replace function ej_client_enter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  select json_build_object(
    'code', c.code, 'name', c.name, 'body_weight_kg', c.body_weight_kg,
    'face_samples', (select count(*) from ej_faces f where f.client_code = c.code),
    'routine', coalesce((select json_agg(x order by x.position, x.created_at) from (
        select ro.id, ro.exercise_id, ro.sets, ro.reps, ro.incline_deg, ro.rest_sec, ro.load_kg, ro.stance,
               ro.assigned_by, ro.position, ro.created_at
        from ej_routines ro where ro.client_code = c.code) x), '[]'::json),
    'today', (select json_build_object('sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
              from ej_sets w where w.client_code = c.code and w.created_at >= date_trunc('day', now()))
  ) into r from ej_clients c where c.code = p_code;
  return r;
end $$;

drop function if exists ej_client_add_routine(text,text,int,int,int,int);
create or replace function ej_client_add_routine(p_code text, p_exercise text, p_sets int, p_reps int, p_incline int, p_rest int,
  p_load numeric default 0, p_stance text default 'orthodox')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_routines(client_code, exercise_id, sets, reps, incline_deg, rest_sec, load_kg, stance, assigned_by, position)
  values (p_code, p_exercise, p_sets, p_reps, p_incline, coalesce(p_rest,60), coalesce(p_load,0), coalesce(p_stance,'orthodox'), 'cliente',
          (select coalesce(max(position),0)+1 from ej_routines where client_code = p_code))
  returning id into v;
  return v;
end $$;

drop function if exists ej_admin_add_routine(text,text,text,int,int,int,int);
create or replace function ej_admin_add_routine(p_pin text, p_code text, p_exercise text, p_sets int, p_reps int, p_incline int, p_rest int,
  p_load numeric default 0, p_stance text default 'orthodox')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_routines(client_code, exercise_id, sets, reps, incline_deg, rest_sec, load_kg, stance, assigned_by, position)
  values (p_code, p_exercise, p_sets, p_reps, p_incline, coalesce(p_rest,60), coalesce(p_load,0), coalesce(p_stance,'orthodox'), 'coach',
          (select coalesce(max(position),0)+1 from ej_routines where client_code = p_code))
  returning id into v;
  return v;
end $$;

create or replace function ej_admin_set_client_weight(p_pin text, p_code text, p_kg numeric)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  update ej_clients set body_weight_kg = p_kg where code = p_code;
end $$;

create or replace function ej_admin_face_delete(p_pin text, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  delete from ej_faces where client_code = p_code;
end $$;

-- ---------- Analítica ampliada ----------
create or replace function ej_admin_clients(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by t.last_at desc nulls last) from (
    select c.code, c.name, c.created_at,
      count(w.id) as sets, coalesce(sum(w.reps),0) as reps,
      coalesce(round(sum(w.kcal)::numeric,1),0) as kcal, max(w.created_at) as last_at,
      (select count(*) from ej_faces f where f.client_code = c.code) as face_samples
    from ej_clients c left join ej_sets w on w.client_code = c.code
    group by c.code) t), '[]'::json);
end $$;

create or replace function ej_admin_client_detail(p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return json_build_object(
    'client', (select json_build_object('code', c.code, 'name', c.name, 'created_at', c.created_at,
                 'body_weight_kg', c.body_weight_kg,
                 'face_samples', (select count(*) from ej_faces f where f.client_code = c.code))
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
        select k as punch, sum(v::int) as n
        from ej_sets w, jsonb_each_text(coalesce(w.punches,'{}'::jsonb)) as p(k, v)
        where w.client_code = p_code and k not in ('stance') group by k) t), '[]'::json),
    'sets', coalesce((select json_agg(t) from (
        select w.id, w.created_at, w.exercise_id, w.set_number, w.reps, w.target_reps, w.form_score, w.fatigue_pct,
               w.peak_speed, w.incline_deg, w.kcal, w.load_kg, w.est_1rm, w.accuracy, w.avg_punch_speed, w.guard_pct
        from ej_sets w where w.client_code = p_code
        order by w.created_at desc limit 200) t), '[]'::json),
    'routine', coalesce((select json_agg(r order by r.position) from ej_routines r where r.client_code = p_code), '[]'::json)
  );
end $$;

grant execute on function ej_face_identify(jsonb), ej_face_enroll(text,jsonb,boolean), ej_client_set_weight(text,numeric),
  ej_client_enter(text), ej_client_add_routine(text,text,int,int,int,int,numeric,text),
  ej_admin_add_routine(text,text,text,int,int,int,int,numeric,text), ej_admin_set_client_weight(text,text,numeric),
  ej_admin_face_delete(text,text), ej_admin_clients(text), ej_admin_client_detail(text,text)
  to anon, authenticated;
revoke execute on function ej_to_vec(jsonb) from anon, authenticated, public;
