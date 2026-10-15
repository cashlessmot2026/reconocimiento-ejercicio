-- =====================================================================
--  Migración 013 · AR-COMBAT (gimnasio de boxeo)
--    · Catálogo solo de boxeo (+ acondicionamiento) y nuevos ejercicios
--    · Clientes con estado (pendiente / activo / suspendido), correo y plan
--    · Suscripción pública con comprobante de pago y aprobación del admin
--    · Contenido editable de la página principal (ej_config 'site') e imágenes
--    · Cola de correos (Edge Function ar-mailer vía pg_net)
--  Requiere haber aplicado antes: schema.sql y migration_002 … 012.
--  Es idempotente: se puede volver a ejecutar.
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
--  1) Marca y textos
-- ---------------------------------------------------------------------
insert into ej_config(key, value) values
 ('brand', '{"name":"AR-COMBAT","tagline":"Gimnasio de boxeo · entrenamiento medido","accent":"#22d3ee"}'),
 ('copy',  '{"enter_code":"Tu código de socio","enter_hint":"Ingresa tu código de 4 dígitos para registrar cada golpe y cada ronda","start":"Entrar","choose":"Elige tu entrenamiento","my_routine":"Mi rutina de boxeo","catalog":"Catálogo","camera_tip":"Colócate de frente, a unos 2 m de la cámara, con la guardia visible","admin_title":"Panel del administrador"}')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------
--  2) Ejercicios: solo boxeo y acondicionamiento de boxeador
-- ---------------------------------------------------------------------
do $$
declare v_ids text[] := array['pullup','curl','press','lateral','deadlift','dips','glutebridge'];
begin
  delete from ej_exercises e
  where e.id = any (v_ids)
    and not exists (select 1 from ej_sets s where s.exercise_id = e.id)
    and not exists (select 1 from ej_routines r where r.exercise_id = e.id);
  update ej_exercises set active = false where id = any (v_ids);
end $$;

update ej_exercises set category = 'Acondicionamiento' where id in ('pushup','squat','lunge','situp','jacks');
update ej_exercises set name = 'Flexiones de boxeador', cue = 'Cuerpo en línea, pecho cerca del suelo, explota al subir' where id = 'pushup';
update ej_exercises set name = 'Sentadillas', cue = 'Base de piernas para pegar fuerte: cadera atrás, rodillas alineadas' where id = 'squat';
update ej_exercises set name = 'Zancadas', cue = 'Paso largo, torso erguido: así se construye el desplazamiento' where id = 'lunge';
update ej_exercises set name = 'Abdominales', cue = 'Core fuerte para rotar y recibir: sube controlado' where id = 'situp';
update ej_exercises set name = 'Jumping jacks', cue = 'Calentamiento y resistencia: ritmo constante' where id = 'jacks';

update ej_exercises set category = 'Sombra'        where id = 'box_shadow';
update ej_exercises set category = 'Combinaciones' where id in ('box_combos','box_onetwo');
update ej_exercises set category = 'Precisión'     where id = 'box_targets';
update ej_exercises set category = 'Velocidad'     where id = 'box_speed';

-- Nuevos ejercicios de boxeo (se apoyan en los motores de sombra, combos, dianas y velocidad)
insert into ej_exercises(id,name,category,primary_group,muscles,joint_label,landmarks_l,landmarks_r,rest_angle,peak_angle,kcal_per_rep,camera_hint,cue,icon,default_sets,default_reps,sort,kind,box_mode,box_config) values
 ('box_jab','Jab constante','Combinaciones','hombros','[{"group":"hombros","pct":45},{"group":"triceps","pct":25},{"group":"oblicuos","pct":15},{"group":"pantorrilla","pct":15}]','Codo','{11,13,15}','{12,14,16}',90,170,0.07,'De frente a la cámara, de rodillas hacia arriba visibles','Jab recto y rápido, vuelve siempre a la guardia','👊',3,60,25,'boxing','combos','{"combos":[[1]],"gap_ms":1500}'),
 ('box_123','Combo 1-2-3','Combinaciones','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":30},{"group":"pecho","pct":15},{"group":"triceps","pct":10},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara, cuerpo hasta la cadera visible','Jab, directo y gancho: gira la cadera en el 3','🥊',3,90,26,'boxing','combos','{"combos":[[1,2,3]],"gap_ms":2400}'),
 ('box_1232','Combo 1-2-3-2','Combinaciones','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":30},{"group":"pecho","pct":15},{"group":"triceps","pct":10},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara, cuerpo hasta la cadera visible','Cierra con el directo atrás tras el gancho','🥊',3,90,27,'boxing','combos','{"combos":[[1,2,3,2]],"gap_ms":2800}'),
 ('box_hooks','Ganchos al cuerpo y cabeza','Combinaciones','oblicuos','[{"group":"oblicuos","pct":40},{"group":"hombros","pct":30},{"group":"pecho","pct":15},{"group":"pantorrilla","pct":15}]','Codo','{11,13,15}','{12,14,16}',90,170,0.09,'De frente a la cámara, cuerpo hasta la cadera visible','Codo a 90°, el golpe nace en la cadera','🌀',3,90,28,'boxing','combos','{"combos":[[3,2,3],[3,4,3],[2,3,4]],"gap_ms":2600}'),
 ('box_uppers','Uppercuts','Combinaciones','hombros','[{"group":"hombros","pct":35},{"group":"core","pct":25},{"group":"oblicuos","pct":20},{"group":"pantorrilla","pct":20}]','Codo','{11,13,15}','{12,14,16}',90,170,0.09,'De frente a la cámara, cuerpo hasta la cadera visible','Flexiona las piernas y sube con el golpe','⤴️',3,90,29,'boxing','combos','{"combos":[[5,6],[1,5,6],[5,2,3]],"gap_ms":2600}'),
 ('box_rounds','Round de sombra 3 min','Sombra','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":25},{"group":"pecho","pct":15},{"group":"triceps","pct":15},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente a la cámara, de rodillas hacia arriba visibles','Muévete, cambia ángulos y no bajes las manos','⏱️',3,180,30,'boxing','shadow','{}'),
 ('box_sprint','Sprint de golpes 10 s','Velocidad','hombros','[{"group":"hombros","pct":45},{"group":"triceps","pct":25},{"group":"core","pct":20},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.07,'De frente a la cámara','Ráfaga explosiva: máximo de golpes limpios en 10 s','💨',5,10,31,'boxing','speed','{}'),
 ('box_stamina','Resistencia 60 s','Velocidad','hombros','[{"group":"hombros","pct":40},{"group":"triceps","pct":25},{"group":"core","pct":20},{"group":"pantorrilla","pct":15}]','Codo','{11,13,15}','{12,14,16}',90,170,0.07,'De frente a la cámara','Mantén el ritmo y la guardia durante todo el minuto','🔥',3,60,32,'boxing','speed','{}'),
 ('box_fasttargets','Dianas rápidas','Precisión','hombros','[{"group":"hombros","pct":40},{"group":"oblicuos","pct":20},{"group":"triceps","pct":20},{"group":"pecho","pct":10},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.08,'De frente, a 2 m de la cámara','Dianas que desaparecen en 1 segundo: reflejos y precisión','🎯',3,60,33,'boxing','targets','{"window_ms":1000}'),
 ('box_combat','Rounds de combate 5×3','Sombra','hombros','[{"group":"hombros","pct":35},{"group":"oblicuos","pct":25},{"group":"pecho","pct":15},{"group":"triceps","pct":15},{"group":"pantorrilla","pct":10}]','Codo','{11,13,15}','{12,14,16}',90,170,0.09,'De frente a la cámara, de rodillas hacia arriba visibles','Intensidad de combate: 5 rounds de 3 minutos con descanso corto','🏆',5,180,34,'boxing','shadow','{}')
on conflict (id) do update set
  name = excluded.name, category = excluded.category, primary_group = excluded.primary_group, muscles = excluded.muscles,
  camera_hint = excluded.camera_hint, cue = excluded.cue, icon = excluded.icon,
  default_sets = excluded.default_sets, default_reps = excluded.default_reps, sort = excluded.sort,
  kind = excluded.kind, box_mode = excluded.box_mode, box_config = excluded.box_config, active = true;

-- ---------------------------------------------------------------------
--  3) Clientes: estado, correo, teléfono y plan
-- ---------------------------------------------------------------------
alter table ej_clients add column if not exists email     text;
alter table ej_clients add column if not exists phone     text;
alter table ej_clients add column if not exists status    text not null default 'activo';
alter table ej_clients add column if not exists plan_id   text;
alter table ej_clients add column if not exists joined_at timestamptz not null default now();
do $$ begin
  alter table ej_clients add constraint ej_clients_status_chk check (status in ('pendiente','activo','suspendido'));
exception when duplicate_object then null; end $$;
create index if not exists ej_clients_email_idx on ej_clients(lower(email));

-- Los clientes solo se crean desde el panel o por suscripción: ya no basta con escribir un código.
create or replace function ej_clients_gate() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('ej.allow_client', true), '') <> '1' then return null; end if;
  return new;
end $$;
drop trigger if exists ej_clients_gate_trg on ej_clients;
create trigger ej_clients_gate_trg before insert on ej_clients for each row execute function ej_clients_gate();

-- Solo los clientes activos pueden registrar entrenamientos, rutinas, evaluaciones y reservas.
create or replace function ej_require_active_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from ej_clients where code = new.client_code;
  if st is null then raise exception 'Código no encontrado'; end if;
  if st <> 'activo' then raise exception 'Tu acceso aún no está activo'; end if;
  return new;
end $$;
drop trigger if exists ej_active_sets_trg on ej_sets;
create trigger ej_active_sets_trg before insert on ej_sets for each row execute function ej_require_active_client();
drop trigger if exists ej_active_routines_trg on ej_routines;
create trigger ej_active_routines_trg before insert on ej_routines for each row execute function ej_require_active_client();
drop trigger if exists ej_active_assess_trg on ej_assessments;
create trigger ej_active_assess_trg before insert on ej_assessments for each row execute function ej_require_active_client();
drop trigger if exists ej_active_book_trg on ej_class_bookings;
create trigger ej_active_book_trg before insert on ej_class_bookings for each row execute function ej_require_active_client();

-- Entrada del cliente: el código debe existir y estar activo.
create or replace function ej_client_enter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare c ej_clients; r json;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  select * into c from ej_clients where code = p_code;
  if not found then raise exception 'Código no encontrado. Si ya te suscribiste, revisa el correo con tu código.'; end if;
  if c.status = 'pendiente' then
    raise exception 'Tu pago está en revisión. Te avisaremos por correo cuando tu acceso sea aprobado.';
  end if;
  if c.status <> 'activo' then raise exception 'Tu acceso no está activo. Habla con tu entrenador.'; end if;
  select json_build_object(
    'code', c.code, 'name', c.name, 'body_weight_kg', c.body_weight_kg, 'plan_id', c.plan_id,
    'assessment', (select row_to_json(x) from (select * from ej_assessments where client_code = c.code order by measured_on desc limit 1) x),
    'routine', coalesce((select json_agg(x order by x.position, x.created_at) from (
        select ro.id, ro.exercise_id, ro.sets, ro.reps, ro.incline_deg, ro.rest_sec, ro.load_kg, ro.stance,
               ro.assigned_by, ro.position, ro.created_at
        from ej_routines ro where ro.client_code = c.code) x), '[]'::json),
    'today', (select json_build_object('sets', count(*), 'reps', coalesce(sum(reps),0), 'kcal', coalesce(round(sum(kcal)::numeric,1),0))
              from ej_sets w where w.client_code = c.code and w.created_at >= date_trunc('day', now()))
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
--  4) Pagos, imágenes y configuración de correo
-- ---------------------------------------------------------------------
create table if not exists ej_payments (
  id          uuid primary key default gen_random_uuid(),
  client_code text not null references ej_clients(code) on delete cascade,
  plan_id     text,
  plan_name   text,
  amount      numeric,
  proof       text,               -- comprobante (data URL de imagen o PDF)
  proof_mime  text,
  status      text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado')),
  note        text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists ej_payments_status_idx on ej_payments(status, created_at desc);
alter table ej_payments enable row level security;       -- sin políticas: solo por RPC

create table if not exists ej_media (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null,
  data       text not null,       -- data URL
  created_at timestamptz not null default now()
);
alter table ej_media enable row level security;

create table if not exists ej_mail_config (
  id           int primary key default 1 check (id = 1),
  function_url text,              -- https://<proyecto>.supabase.co/functions/v1/ar-mailer
  secret       text,              -- el mismo valor que MAILER_SECRET de la función
  app_url      text               -- https://… (dirección pública de la app)
);
alter table ej_mail_config enable row level security;

-- Planes iniciales (el admin los edita en «Sitio web»). Solo si aún no hay contenido.
insert into ej_config(key, value) values ('site', jsonb_build_object('plans', jsonb_build_array(
  jsonb_build_object('id','xl','name','Plan XL','price',110000,'period','mes','tagline','Entrena boxeo todo el mes',
    'features', jsonb_build_array('Clases grupales de boxeo','Medición de golpes con cámara','Reserva de clases desde la app','Seguimiento de tu progreso'),
    'highlight', false, 'badge', ''),
  jsonb_build_object('id','xl-cardio','name','Plan XL Cardio Box','price',0,'period','mes','tagline','Boxeo + cardio de alta quema',
    'features', jsonb_build_array('Todo lo del Plan XL','Clases de cardio box','Rutinas de resistencia y velocidad','Evaluación física y objetivos'),
    'highlight', false, 'badge', ''),
  jsonb_build_object('id','elite-combat','name','Plan Elite Combat','price',0,'period','mes','tagline','Profesional, intenso y de mayor exigencia',
    'features', jsonb_build_array('Rounds de combate y sparring técnico','Rutinas de alta exigencia','Seguimiento personalizado del entrenador','Prioridad en reservas'),
    'highlight', true, 'badge', 'Más exigente'))))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
--  5) Utilidades internas
-- ---------------------------------------------------------------------
create or replace function ej_new_code() returns text
language plpgsql security definer set search_path = public as $$
declare v text; i int;
begin
  for i in 1..80 loop
    v := lpad((floor(random() * 10000))::int::text, 4, '0');
    if not exists (select 1 from ej_clients where code = v) then return v; end if;
  end loop;
  raise exception 'No quedan códigos de 4 dígitos disponibles';
end $$;
revoke all on function ej_new_code() from public, anon, authenticated;

-- Envía un correo por la Edge Function; nunca bloquea ni hace fallar la operación.
create or replace function ej_mail_notify(p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare c ej_mail_config;
begin
  select * into c from ej_mail_config where id = 1;
  if c.function_url is null or c.secret is null then return; end if;
  perform net.http_post(
    url := c.function_url,
    body := p_payload || jsonb_build_object('kind', p_kind, 'app_url', coalesce(c.app_url, '')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mailer-secret', c.secret),
    timeout_milliseconds := 20000);
exception when others then
  null;
end $$;
revoke all on function ej_mail_notify(text, jsonb) from public, anon, authenticated;

create or replace function ej_plan_of(p_plan text)
returns jsonb language sql security definer set search_path = public as $$
  select p from ej_config c, jsonb_array_elements(coalesce(c.value->'plans', '[]'::jsonb)) p
  where c.key = 'site' and p->>'id' = p_plan limit 1;
$$;
revoke all on function ej_plan_of(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  6) Público: imágenes y suscripción
-- ---------------------------------------------------------------------
create or replace function ej_media_get(p_id uuid)
returns json language sql security definer set search_path = public as $$
  select json_build_object('mime', mime, 'data', data) from ej_media where id = p_id;
$$;

create or replace function ej_public_subscribe(
  p_name text, p_email text, p_phone text, p_plan text, p_proof text, p_mime text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_plan jsonb; v_email text := lower(trim(coalesce(p_email, ''))); v_name text := trim(coalesce(p_name, ''));
  v_code text; v_st text; v_pending int; v_recent int;
begin
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Escribe tu nombre completo'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120 then raise exception 'Correo electrónico inválido'; end if;
  if p_proof is null or length(p_proof) < 100 then raise exception 'Adjunta el comprobante de pago'; end if;
  if length(p_proof) > 3500000 then raise exception 'El comprobante pesa demasiado (máx. ~2,5 MB)'; end if;
  if coalesce(p_mime, '') not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception 'Formato de comprobante no permitido (usa imagen o PDF)';
  end if;
  v_plan := ej_plan_of(p_plan);
  if v_plan is null then raise exception 'El plan seleccionado no existe'; end if;
  if coalesce((v_plan->>'price')::numeric, 0) <= 0 then raise exception 'Este plan aún no tiene precio definido'; end if;

  select count(*) into v_pending from ej_payments where status = 'pendiente';
  if v_pending > 400 then raise exception 'Hay demasiadas solicitudes en revisión. Inténtalo más tarde'; end if;
  select count(*) into v_recent from ej_payments p join ej_clients c on c.code = p.client_code
   where lower(c.email) = v_email and p.created_at > now() - interval '1 day';
  if v_recent >= 3 then raise exception 'Ya enviaste varias solicitudes hoy. Espera la revisión de tu pago'; end if;

  select code, status into v_code, v_st from ej_clients where lower(email) = v_email order by joined_at limit 1;
  if v_code is not null and v_st = 'activo' then
    raise exception 'Este correo ya tiene una cuenta activa. Ingresa con tu código';
  end if;
  if v_code is null then
    v_code := ej_new_code();
    perform set_config('ej.allow_client', '1', true);
    insert into ej_clients(code, name, email, phone, status, plan_id)
    values (v_code, v_name, v_email, nullif(trim(coalesce(p_phone, '')), ''), 'pendiente', p_plan);
  else
    update ej_clients set plan_id = p_plan, name = coalesce(nullif(name, ''), v_name) where code = v_code;
  end if;
  insert into ej_payments(client_code, plan_id, plan_name, amount, proof, proof_mime)
  values (v_code, p_plan, v_plan->>'name', (v_plan->>'price')::numeric, p_proof, p_mime);

  perform ej_mail_notify('welcome_pending', jsonb_build_object(
    'to', v_email, 'name', v_name, 'code', v_code, 'plan_name', v_plan->>'name', 'amount', (v_plan->>'price')::numeric));
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  7) Administrador (requiere PIN)
-- ---------------------------------------------------------------------
create or replace function ej_admin_members(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by t.joined_at desc) from (
    select c.code, c.name, c.email, c.phone, c.status, c.plan_id, c.joined_at,
           (select max(w.created_at) from ej_sets w where w.client_code = c.code) as last_at
    from ej_clients c) t), '[]'::json);
end $$;

create or replace function ej_admin_create_client(
  p_pin text, p_name text, p_email text, p_phone text, p_plan text, p_code text default null, p_notify boolean default true)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_email text := nullif(lower(trim(coalesce(p_email, ''))), ''); v_plan jsonb;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe el nombre del cliente'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo electrónico inválido'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    v_code := trim(p_code);
    if v_code !~ '^[0-9]{4}$' then raise exception 'El código debe tener 4 dígitos'; end if;
    if exists (select 1 from ej_clients where code = v_code) then raise exception 'Ese código ya está en uso'; end if;
  else
    v_code := ej_new_code();
  end if;
  perform set_config('ej.allow_client', '1', true);
  insert into ej_clients(code, name, email, phone, status, plan_id)
  values (v_code, trim(p_name), v_email, nullif(trim(coalesce(p_phone, '')), ''), 'activo', nullif(p_plan, ''));
  v_plan := ej_plan_of(p_plan);
  if p_notify and v_email is not null then
    perform ej_mail_notify('welcome_active', jsonb_build_object(
      'to', v_email, 'name', trim(p_name), 'code', v_code, 'plan_name', coalesce(v_plan->>'name', '')));
  end if;
  return json_build_object('code', v_code);
end $$;

create or replace function ej_admin_update_member(p_pin text, p_code text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  update ej_clients set
    name   = coalesce(nullif(trim(p_data->>'name'), ''), name),
    email  = case when p_data ? 'email' then nullif(lower(trim(p_data->>'email')), '') else email end,
    phone  = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else phone end,
    plan_id = case when p_data ? 'plan_id' then nullif(p_data->>'plan_id', '') else plan_id end,
    status = case when (p_data->>'status') in ('pendiente','activo','suspendido') then p_data->>'status' else status end
  where code = p_code;
end $$;

create or replace function ej_admin_payments(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by (t.status = 'pendiente') desc, t.created_at desc) from (
    select p.id, p.client_code as code, c.name, c.email, c.phone, p.plan_id, p.plan_name, p.amount,
           p.status, p.note, p.proof_mime, p.created_at, p.reviewed_at, c.status as client_status
    from ej_payments p join ej_clients c on c.code = p.client_code
    order by p.created_at desc limit 300) t), '[]'::json);
end $$;

create or replace function ej_admin_payment_proof(p_pin text, p_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return (select json_build_object('mime', proof_mime, 'data', proof) from ej_payments where id = p_id);
end $$;

create or replace function ej_admin_review_payment(p_pin text, p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare p ej_payments; c ej_clients;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  select * into p from ej_payments where id = p_id for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  select * into c from ej_clients where code = p.client_code;
  update ej_payments set status = case when p_approve then 'aprobado' else 'rechazado' end,
         note = nullif(trim(coalesce(p_note, '')), ''), reviewed_at = now() where id = p_id;
  if p_approve then
    update ej_clients set status = 'activo', plan_id = coalesce(p.plan_id, plan_id) where code = c.code;
  end if;
  if c.email is not null then
    perform ej_mail_notify(case when p_approve then 'approved' else 'rejected' end, jsonb_build_object(
      'to', c.email, 'name', coalesce(c.name, ''), 'code', c.code, 'plan_name', coalesce(p.plan_name, ''),
      'note', coalesce(nullif(trim(coalesce(p_note, '')), ''), '')));
  end if;
end $$;

create or replace function ej_admin_save_site(p_pin text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Contenido inválido'; end if;
  if length(p_data::text) > 400000 then raise exception 'El contenido es demasiado grande'; end if;
  insert into ej_config(key, value) values ('site', p_data)
  on conflict (key) do update set value = excluded.value;
end $$;

create or replace function ej_admin_upload_media(p_pin text, p_mime text, p_data text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if coalesce(p_mime, '') not in ('image/jpeg','image/png','image/webp') then raise exception 'Solo imágenes JPG, PNG o WebP'; end if;
  if p_data is null or length(p_data) < 100 or length(p_data) > 3500000 then raise exception 'Imagen vacía o demasiado pesada'; end if;
  insert into ej_media(mime, data) values (p_mime, p_data) returning id into v;
  return v;
end $$;

create or replace function ej_admin_mail_test(p_pin text, p_to text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;
  if not exists (select 1 from ej_mail_config where id = 1 and function_url is not null and secret is not null) then
    raise exception 'El correo aún no está configurado (tabla ej_mail_config)';
  end if;
  perform ej_mail_notify('test', jsonb_build_object('to', p_to, 'name', 'Administrador'));
end $$;

grant execute on function
  ej_media_get(uuid), ej_public_subscribe(text, text, text, text, text, text),
  ej_admin_members(text), ej_admin_create_client(text, text, text, text, text, text, boolean),
  ej_admin_update_member(text, text, jsonb), ej_admin_payments(text), ej_admin_payment_proof(text, uuid),
  ej_admin_review_payment(text, uuid, boolean, text), ej_admin_save_site(text, jsonb),
  ej_admin_upload_media(text, text, text), ej_admin_mail_test(text, text), ej_client_enter(text)
  to anon, authenticated;
