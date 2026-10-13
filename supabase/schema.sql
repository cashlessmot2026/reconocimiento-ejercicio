-- =====================================================================
--  KINETIC · Reconocimiento de ejercicio  —  esquema Supabase
--  Ejecutar completo en el SQL Editor del proyecto.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Configuración de la app (textos de UI) ----------
create table if not exists ej_config (
  key   text primary key,
  value jsonb not null
);

-- ---------- Grupos musculares ----------
create table if not exists ej_muscle_groups (
  id     text primary key,
  name   text not null,
  color  text not null,
  region text not null            -- zona en el mapa corporal
);

-- ---------- Catálogo de ejercicios ----------
-- Detección: ángulo en el vértice B del triángulo A-B-C (índices MediaPipe).
-- rest_angle: posición inicial · peak_angle: posición de máxima contracción.
create table if not exists ej_exercises (
  id            text primary key,
  name          text not null,
  category      text not null,
  primary_group text not null references ej_muscle_groups(id),
  muscles       jsonb not null,           -- [{group, pct}]
  joint_label   text not null,            -- "Codo", "Rodilla"...
  landmarks_l   int[] not null,
  landmarks_r   int[] not null,
  rest_angle    numeric not null,
  peak_angle    numeric not null,
  kcal_per_rep  numeric not null default 0.4,
  camera_hint   text not null,
  cue           text not null,
  icon          text not null default '💪',
  default_sets  int not null default 3,
  default_reps  int not null default 10,
  sort          int not null default 0,
  active        boolean not null default true
);

-- ---------- Clientes ----------
create table if not exists ej_clients (
  code       text primary key check (code ~ '^[0-9]{4}$'),
  name       text,
  created_at timestamptz not null default now()
);

-- ---------- Rutinas (coach o cliente) ----------
create table if not exists ej_routines (
  id          uuid primary key default gen_random_uuid(),
  client_code text not null references ej_clients(code) on delete cascade,
  exercise_id text not null references ej_exercises(id),
  sets        int not null default 3 check (sets between 1 and 20),
  reps        int not null default 10 check (reps between 1 and 200),
  incline_deg int not null default 0 check (incline_deg between -90 and 90),
  rest_sec    int not null default 60,
  assigned_by text not null default 'cliente' check (assigned_by in ('coach','cliente')),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- Series registradas ----------
create table if not exists ej_sets (
  id            uuid primary key default gen_random_uuid(),
  client_code   text not null references ej_clients(code) on delete cascade,
  exercise_id   text not null references ej_exercises(id),
  routine_id    uuid references ej_routines(id) on delete set null,
  set_number    int not null,
  reps          int not null,
  target_reps   int,
  incline_deg   int default 0,
  torso_tilt    numeric,            -- inclinación medida del torso (°)
  min_angle     numeric,
  max_angle     numeric,
  avg_rom       numeric,            -- rango de movimiento medio (°)
  avg_rep_sec   numeric,
  peak_speed    numeric,
  fatigue_pct   numeric,
  form_score    numeric,
  kcal          numeric,
  duration_sec  numeric,
  rep_log       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists ej_sets_client_idx on ej_sets(client_code, created_at desc);

-- ---------- Admin (PIN hasheado, nunca legible) ----------
create table if not exists ej_admin_secret (
  id       int primary key default 1 check (id = 1),
  pin_hash text not null
);

-- =====================================================================
--  RLS
-- =====================================================================
alter table ej_config    enable row level security;
alter table ej_muscle_groups enable row level security;
alter table ej_exercises     enable row level security;
alter table ej_clients       enable row level security;
alter table ej_routines      enable row level security;
alter table ej_sets  enable row level security;
alter table ej_admin_secret  enable row level security;

drop policy if exists "read config" on ej_config;
create policy "read config" on ej_config for select using (true);
drop policy if exists "read groups" on ej_muscle_groups;
create policy "read groups" on ej_muscle_groups for select using (true);
drop policy if exists "read ej_exercises" on ej_exercises;
create policy "read ej_exercises" on ej_exercises for select using (active);
drop policy if exists "insert sets" on ej_sets;
create policy "insert sets" on ej_sets for insert with check (client_code ~ '^[0-9]{4}$');
-- ej_clients / ej_routines / lecturas de series: solo vía funciones RPC.

-- =====================================================================
--  RPC públicas (cliente)
-- =====================================================================
create or replace function ej_client_enter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  select json_build_object(
    'code', c.code, 'name', c.name,
    'routine', coalesce((select json_agg(x order by x.position, x.created_at) from (
        select ro.id, ro.exercise_id, ro.sets, ro.reps, ro.incline_deg, ro.rest_sec, ro.assigned_by, ro.position, ro.created_at
        from ej_routines ro where ro.client_code = c.code) x), '[]'::json),
    'today', (select json_build_object('sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
              from ej_sets w where w.client_code = c.code and w.created_at >= date_trunc('day', now())),
    'recent', coalesce((select json_agg(y) from (
        select w.exercise_id, w.set_number, w.reps, w.form_score, w.created_at
        from ej_sets w where w.client_code = c.code order by w.created_at desc limit 8) y), '[]'::json)
  ) into r from ej_clients c where c.code = p_code;
  return r;
end $$;

create or replace function ej_client_add_routine(p_code text, p_exercise text, p_sets int, p_reps int, p_incline int, p_rest int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_routines(client_code, exercise_id, sets, reps, incline_deg, rest_sec, assigned_by, position)
  values (p_code, p_exercise, p_sets, p_reps, p_incline, coalesce(p_rest,60), 'cliente',
          (select coalesce(max(position),0)+1 from ej_routines where client_code = p_code))
  returning id into v;
  return v;
end $$;

create or replace function ej_client_remove_routine(p_code text, p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from ej_routines where id = p_id and client_code = p_code and assigned_by = 'cliente';
$$;

-- =====================================================================
--  RPC admin (requieren PIN)
-- =====================================================================
create or replace function ej_admin_check(p_pin text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select exists(select 1 from ej_admin_secret where pin_hash = crypt(p_pin, pin_hash));
$$;

create or replace function ej_admin_clients(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by t.last_at desc nulls last) from (
    select c.code, c.name, c.created_at,
      count(w.id) as sets, coalesce(sum(w.reps),0) as reps,
      coalesce(round(sum(w.kcal)::numeric,1),0) as kcal, max(w.created_at) as last_at,
      count(distinct date_trunc('day', w.created_at)) as days
    from ej_clients c left join ej_sets w on w.client_code = c.code
    group by c.code) t), '[]'::json);
end $$;

create or replace function ej_admin_client_detail(p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return json_build_object(
    'client', (select row_to_json(c) from ej_clients c where c.code = p_code),
    'weekly', coalesce((select json_agg(t order by t.week) from (
        select date_trunc('week', w.created_at)::date as week,
          count(*) as sets, sum(w.reps) as reps, round(sum(w.kcal)::numeric,1) as kcal,
          round(avg(w.form_score)::numeric,1) as form, round(avg(w.avg_rom)::numeric,1) as rom,
          round(avg(w.fatigue_pct)::numeric,1) as fatigue,
          count(distinct date_trunc('day', w.created_at)) as days
        from ej_sets w where w.client_code = p_code
        group by 1) t), '[]'::json),
    'by_exercise', coalesce((select json_agg(t order by t.reps desc) from (
        select w.exercise_id, count(*) as sets, sum(w.reps) as reps, max(w.reps) as best_set,
          round(avg(w.form_score)::numeric,1) as form, round(avg(w.avg_rom)::numeric,1) as rom,
          round(avg(w.incline_deg)::numeric,1) as incline, round(avg(w.torso_tilt)::numeric,1) as tilt
        from ej_sets w where w.client_code = p_code group by 1) t), '[]'::json),
    'by_group', coalesce((select json_agg(t order by t.load desc) from (
        select (m->>'group') as group_id,
          round(sum(w.reps * (m->>'pct')::numeric / 100)::numeric,1) as load
        from ej_sets w join ej_exercises e on e.id = w.exercise_id,
             jsonb_array_elements(e.muscles) m
        where w.client_code = p_code group by 1) t), '[]'::json),
    'weekly_exercise', coalesce((select json_agg(t) from (
        select date_trunc('week', w.created_at)::date as week, w.exercise_id, sum(w.reps) as reps
        from ej_sets w where w.client_code = p_code group by 1,2) t), '[]'::json),
    'sets', coalesce((select json_agg(t) from (
        select w.* from ej_sets w where w.client_code = p_code
        order by w.created_at desc limit 200) t), '[]'::json),
    'routine', coalesce((select json_agg(r order by r.position) from ej_routines r where r.client_code = p_code), '[]'::json)
  );
end $$;

create or replace function ej_admin_overview(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return json_build_object(
    'totals', (select json_build_object('clients', (select count(*) from ej_clients),
               'sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
               from ej_sets),
    'weekly', coalesce((select json_agg(t order by t.week) from (
        select date_trunc('week', created_at)::date as week, count(*) as sets, sum(reps) as reps,
               count(distinct client_code) as active_clients
        from ej_sets group by 1) t), '[]'::json)
  );
end $$;

create or replace function ej_admin_set_client_name(p_pin text, p_code text, p_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  insert into ej_clients(code, name) values (p_code, p_name)
  on conflict (code) do update set name = excluded.name;
end $$;

create or replace function ej_admin_add_routine(p_pin text, p_code text, p_exercise text, p_sets int, p_reps int, p_incline int, p_rest int)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_routines(client_code, exercise_id, sets, reps, incline_deg, rest_sec, assigned_by, position)
  values (p_code, p_exercise, p_sets, p_reps, p_incline, coalesce(p_rest,60), 'coach',
          (select coalesce(max(position),0)+1 from ej_routines where client_code = p_code))
  returning id into v;
  return v;
end $$;

create or replace function ej_admin_remove_routine(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  delete from ej_routines where id = p_id;
end $$;

revoke all on function ej_admin_check(text) from public;
grant execute on function ej_admin_check(text) to anon, authenticated;
grant execute on function ej_client_enter(text), ej_client_add_routine(text,text,int,int,int,int),
  ej_client_remove_routine(text,uuid), ej_admin_clients(text), ej_admin_client_detail(text,text),
  ej_admin_overview(text), ej_admin_set_client_name(text,text,text),
  ej_admin_add_routine(text,text,text,int,int,int,int), ej_admin_remove_routine(text,uuid)
  to anon, authenticated;

-- =====================================================================
--  DATOS SEMILLA
-- =====================================================================
insert into ej_admin_secret(id, pin_hash) values (1, crypt('1234', gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;

insert into ej_config(key, value) values
 ('brand', '{"name":"KINETIC","tagline":"Visión artificial para tu entrenamiento","accent":"#22d3ee"}'),
 ('copy',  '{"enter_code":"Número de cliente","enter_hint":"Ingresa tu código de 4 dígitos para registrar cada repetición","start":"Iniciar","choose":"Elige tu ejercicio","my_routine":"Mi rutina","catalog":"Catálogo","camera_tip":"Colócate de cuerpo completo frente a la cámara","admin_title":"Panel del coach"}'),
 ('phases', '{"idle":"LISTO","loading":"CARGANDO","concentric":"SUBIDA","hold":"PICO","eccentric":"BAJADA","rest":"DESCANSO","lost":"SIN CUERPO"}')
on conflict (key) do update set value = excluded.value;

insert into ej_muscle_groups(id, name, color, region) values
 ('pecho','Pecho','#f43f5e','chest'),
 ('espalda','Espalda / Dorsal','#8b5cf6','back'),
 ('hombros','Hombros','#f59e0b','shoulders'),
 ('biceps','Bíceps','#22d3ee','arms'),
 ('triceps','Tríceps','#3b82f6','arms'),
 ('antebrazo','Antebrazo','#14b8a6','forearms'),
 ('core','Core / Abdomen','#eab308','core'),
 ('cuadriceps','Cuádriceps','#10b981','thighs'),
 ('isquios','Isquiotibiales','#84cc16','thighs'),
 ('gluteos','Glúteos','#ec4899','glutes'),
 ('pantorrilla','Pantorrilla','#06b6d4','calves')
on conflict (id) do update set name=excluded.name, color=excluded.color, region=excluded.region;

insert into ej_exercises(id,name,category,primary_group,muscles,joint_label,landmarks_l,landmarks_r,rest_angle,peak_angle,kcal_per_rep,camera_hint,cue,icon,default_sets,default_reps,sort) values
 ('pullup','Dominadas','Tracción','espalda','[{"group":"espalda","pct":55},{"group":"biceps","pct":25},{"group":"antebrazo","pct":10},{"group":"core","pct":10}]','Codo','{11,13,15}','{12,14,16}',155,85,0.9,'Cámara de frente, cuerpo completo y barra visibles','Barbilla sobre la barra, baja con control','🧗',4,8,1),
 ('pushup','Flexiones','Empuje','pecho','[{"group":"pecho","pct":50},{"group":"triceps","pct":25},{"group":"hombros","pct":15},{"group":"core","pct":10}]','Codo','{11,13,15}','{12,14,16}',155,95,0.5,'Cámara lateral a la altura del suelo','Cuerpo en línea recta, pecho cerca del suelo','🫸',3,12,2),
 ('squat','Sentadilla','Piernas','cuadriceps','[{"group":"cuadriceps","pct":45},{"group":"gluteos","pct":30},{"group":"isquios","pct":15},{"group":"core","pct":10}]','Rodilla','{23,25,27}','{24,26,28}',160,100,0.6,'Cámara lateral o de frente, cuerpo completo','Cadera atrás, rodillas alineadas con los pies','🏋️',4,12,3),
 ('curl','Curl de bíceps','Brazos','biceps','[{"group":"biceps","pct":70},{"group":"antebrazo","pct":30}]','Codo','{11,13,15}','{12,14,16}',150,55,0.3,'Cámara de frente o lateral, torso visible','Codos pegados al cuerpo, sin balanceo','💪',3,12,4),
 ('press','Press militar','Empuje','hombros','[{"group":"hombros","pct":60},{"group":"triceps","pct":30},{"group":"core","pct":10}]','Codo','{11,13,15}','{12,14,16}',85,155,0.5,'Cámara de frente, brazos visibles','Bloquea arriba, baja hasta la barbilla','🙌',4,10,5),
 ('lateral','Elevaciones laterales','Hombros','hombros','[{"group":"hombros","pct":85},{"group":"espalda","pct":15}]','Hombro','{23,11,13}','{24,12,14}',25,80,0.3,'Cámara de frente, brazos visibles','Sube hasta la altura de los hombros','🕊️',3,15,6),
 ('lunge','Zancada','Piernas','cuadriceps','[{"group":"cuadriceps","pct":45},{"group":"gluteos","pct":35},{"group":"isquios","pct":20}]','Rodilla','{23,25,27}','{24,26,28}',160,100,0.6,'Cámara lateral, cuerpo completo','Rodilla trasera cerca del suelo','🦵',3,10,7),
 ('deadlift','Peso muerto','Bisagra','isquios','[{"group":"isquios","pct":35},{"group":"gluteos","pct":30},{"group":"espalda","pct":25},{"group":"core","pct":10}]','Cadera','{11,23,25}','{12,24,26}',165,100,0.8,'Cámara lateral, cuerpo completo','Espalda neutra, empuja la cadera adelante','⚡',4,8,8),
 ('dips','Fondos','Empuje','triceps','[{"group":"triceps","pct":50},{"group":"pecho","pct":35},{"group":"hombros","pct":15}]','Codo','{11,13,15}','{12,14,16}',160,95,0.7,'Cámara lateral','Baja hasta 90° de codo','🤸',3,10,9),
 ('glutebridge','Puente de glúteo','Glúteos','gluteos','[{"group":"gluteos","pct":65},{"group":"isquios","pct":25},{"group":"core","pct":10}]','Cadera','{11,23,25}','{12,24,26}',130,165,0.35,'Cámara lateral a ras de suelo','Aprieta glúteos arriba 1 segundo','🍑',3,15,10),
 ('situp','Abdominales','Core','core','[{"group":"core","pct":85},{"group":"cuadriceps","pct":15}]','Cadera','{11,23,25}','{12,24,26}',125,70,0.3,'Cámara lateral a ras de suelo','Sube con el abdomen, no con el cuello','🔥',3,20,11),
 ('jacks','Jumping jacks','Cardio','hombros','[{"group":"hombros","pct":40},{"group":"pantorrilla","pct":30},{"group":"cuadriceps","pct":20},{"group":"core","pct":10}]','Hombro','{23,11,13}','{24,12,14}',30,140,0.2,'Cámara de frente, cuerpo completo','Brazos arriba y piernas abiertas a la vez','✨',3,30,12)
on conflict (id) do update set name=excluded.name, category=excluded.category, primary_group=excluded.primary_group,
  muscles=excluded.muscles, joint_label=excluded.joint_label, landmarks_l=excluded.landmarks_l, landmarks_r=excluded.landmarks_r,
  rest_angle=excluded.rest_angle, peak_angle=excluded.peak_angle, kcal_per_rep=excluded.kcal_per_rep,
  camera_hint=excluded.camera_hint, cue=excluded.cue, icon=excluded.icon, default_sets=excluded.default_sets,
  default_reps=excluded.default_reps, sort=excluded.sort;
