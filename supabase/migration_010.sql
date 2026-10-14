-- =====================================================================
--  Migración 010 · IA con Gemini (servidor)
--  La clave vive SOLO en la tabla ej_ai_config (sin políticas RLS: nadie con la
--  clave pública puede leerla). Se carga aparte, no está en este archivo:
--     insert into ej_ai_config(id, api_key) values (1, '<CLAVE>')
--     on conflict (id) do update set api_key = excluded.api_key;
--  Solo se envían métricas anónimas (sin nombre ni código de cliente).
-- =====================================================================

create extension if not exists http with schema extensions;

create table if not exists ej_ai_config (
  id       int primary key default 1 check (id = 1),
  api_key  text,
  model    text not null default 'gemini-3.8-flash',
  fallback text not null default 'gemini-3.5-flash'
);
alter table ej_ai_config enable row level security;

create table if not exists ej_ai_usage (
  scope text not null,
  day   date not null default current_date,
  n     int  not null default 0,
  primary key (scope, day)
);
alter table ej_ai_usage enable row level security;

-- ---------- Núcleo: llamada a Gemini y límite de uso ----------
create or replace function ej_ai_hit(p_scope text, p_limit int)
returns void language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into ej_ai_usage(scope, day, n) values (p_scope, current_date, 1)
  on conflict (scope, day) do update set n = ej_ai_usage.n + 1
  returning n into v;
  if v > p_limit then
    raise exception 'Llegaste al límite diario de ayuda con IA. Inténtalo mañana.';
  end if;
end $$;

create or replace function ej_ai_call(p_system text, p_prompt text, p_json boolean default false)
returns text language plpgsql security definer set search_path = public, extensions
set statement_timeout = '75s' as $$
declare
  v_key text; v_models text[]; m text; v_body jsonb; r extensions.http_response; v_text text;
begin
  select api_key, array[model, fallback] into v_key, v_models from ej_ai_config where id = 1;
  if v_key is null then raise exception 'La IA no está configurada'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '40');
  v_body := jsonb_build_object(
    'systemInstruction', jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', p_system))),
    'contents', jsonb_build_array(jsonb_build_object('role', 'user', 'parts', jsonb_build_array(jsonb_build_object('text', p_prompt)))),
    'generationConfig', jsonb_build_object('temperature', 0.5, 'maxOutputTokens', 4096)
      || case when p_json then jsonb_build_object('responseMimeType', 'application/json') else '{}'::jsonb end
  );
  foreach m in array v_models loop
    begin
      r := extensions.http((
        'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' || m || ':generateContent',
        array[extensions.http_header('x-goog-api-key', v_key)], 'application/json', v_body::text
      )::extensions.http_request);
      if r.status = 200 then
        select string_agg(p->>'text', '') into v_text
        from jsonb_array_elements(r.content::jsonb->'candidates'->0->'content'->'parts') p
        where p ? 'text' and coalesce((p->>'thought')::boolean, false) = false;
        if v_text is not null and length(trim(v_text)) > 0 then return trim(v_text); end if;
      end if;
    exception when others then
      null;  -- prueba con el modelo de respaldo
    end;
  end loop;
  raise exception 'La IA no está disponible ahora. Inténtalo en un momento.';
end $$;

revoke all on function ej_ai_call(text, text, boolean) from public, anon, authenticated;
revoke all on function ej_ai_hit(text, int) from public, anon, authenticated;

create or replace function ej_ai_catalog()
returns text language sql security definer set search_path = public as $$
  select coalesce(string_agg(format('%s | %s | %s | %s | %sx%s', id, name, category, kind, default_sets, default_reps), E'\n' order by sort), '')
  from ej_exercises where active is not false;
$$;
revoke all on function ej_ai_catalog() from public, anon, authenticated;

-- Evaluación física anónima del último registro
create or replace function ej_ai_assessment_json(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select to_jsonb(a) - 'id' - 'client_code' - 'created_at' - 'updated_at' - 'notes'
  from (select * from ej_assessments where client_code = p_code order by measured_on desc limit 1) a;
$$;
revoke all on function ej_ai_assessment_json(text) from public, anon, authenticated;

create or replace function ej_ai_goals_text(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  a := ej_ai_assessment_json(p_code);
  if a is null then raise exception 'Primero completa la evaluación física'; end if;
  return ej_ai_call(
    'Eres un entrenador personal y nutricionista deportivo. Escribes en español, claro y motivador. No diagnosticas enfermedades ni sustituyes a un profesional de salud: si algún valor sale de rango (IMC, presión, frecuencia cardiaca) o hay lesiones, recomienda consultar a un profesional. Formato: 1) "Dónde estás" en 2 frases, 2) "Objetivos" 3 metas medibles a 4, 8 y 12 semanas, 3) "Qué hacer" 4 acciones concretas de entrenamiento y hábitos. Máximo 220 palabras, sin tablas.',
    'Datos de la evaluación física (JSON): ' || a::text
  );
end $$;
revoke all on function ej_ai_goals_text(text) from public, anon, authenticated;

-- ---------- Cliente ----------
create or replace function ej_client_ai_tip(p_code text, p_stats jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  if p_stats is null or length(p_stats::text) > 8000 then raise exception 'Datos de la serie inválidos'; end if;
  perform ej_ai_hit('c:' || p_code, 25);
  return ej_ai_call(
    'Eres un entrenador personal que comenta la técnica de un cliente tras su serie. Español, tono cercano y motivador, 2 a 3 frases en total, sin saludos largos. Señala UNA cosa que hizo bien y UNA corrección concreta basada en los números (ritmo, rango de movimiento, fatiga, similitud con la demostración, inclinación). No inventes datos que no estén. No des consejos médicos.',
    'Resultados de la sesión (JSON): ' || p_stats::text
  );
end $$;

create or replace function ej_client_ai_goals(p_code text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  perform ej_ai_hit('c:' || p_code, 25);
  return ej_ai_goals_text(p_code);
end $$;

create or replace function ej_client_ai_ask(p_code text, p_q text)
returns text language plpgsql security definer set search_path = public as $$
declare q text := left(trim(coalesce(p_q, '')), 300);
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  if length(q) < 3 then raise exception 'Escribe tu pregunta'; end if;
  perform ej_ai_hit('c:' || p_code, 25);
  return ej_ai_call(
    'Eres el asistente de entrenamiento de un gimnasio. Respondes en español en máximo 90 palabras. Solo hablas de ejercicio, técnica, rutinas y hábitos de entrenamiento. Cuando recomiendes un ejercicio, elígelo SOLO del catálogo siguiente y usa su nombre exacto. Si la pregunta es médica o ajena al entrenamiento, di que lo consulte con su coach o un profesional.' ||
    E'\nCatálogo (id | nombre | categoría | tipo | series x reps):\n' || ej_ai_catalog(),
    'Pregunta del cliente: ' || q
  );
end $$;

-- ---------- Coach (requieren PIN) ----------
create or replace function ej_admin_ai_summary(p_pin text, p_code text, p_from date default null, p_to date default null, p_tz text default 'UTC')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare d jsonb; pr jsonb; payload text;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  perform ej_ai_hit('admin', 300);
  d := ej_admin_client_detail(p_pin, p_code, p_from, p_to, p_tz)::jsonb - 'client';
  pr := ej_admin_progress(p_pin, p_code, p_from, p_to, p_tz)::jsonb;
  payload := left(jsonb_build_object('entrenamiento', d, 'evaluacion_y_progreso', pr)::text, 14000);
  return ej_ai_call(
    'Eres analista de entrenamiento y asistes al coach. Español, claro y accionable. Estructura: "Qué mejoró", "Qué se estancó o preocupa", "Qué ajustar en la rutina" (3 acciones concretas). Cita cifras reales de los datos; si faltan datos, dilo. Máximo 200 palabras. Los ejercicios vienen por id; el catálogo es:' || E'\n' || ej_ai_catalog(),
    'Datos del cliente (anónimos, JSON): ' || payload
  );
end $$;

create or replace function ej_admin_ai_goals(p_pin text, p_code text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  perform ej_ai_hit('admin', 300);
  return ej_ai_goals_text(p_code);
end $$;

create or replace function ej_admin_ai_class(p_pin text, p_text text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare out_t text; o jsonb; ids text[]; routine jsonb := '[]'::jsonb; r jsonb;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if length(trim(coalesce(p_text, ''))) < 5 then raise exception 'Describe la clase que quieres'; end if;
  perform ej_ai_hit('admin', 300);
  select array_agg(id) into ids from ej_exercises where active is not false;
  out_t := ej_ai_call(
    'Diseñas clases para un gimnasio. Devuelve SOLO un JSON con esta forma: {"title":string,"class_type":"Fuerza|Boxeo|Funcional|Cardio|Movilidad|Personalizada","duration_min":number,"capacity":number,"audience":"abierta|grupo|individual","routine":[{"exercise_id":string,"sets":number,"reps":number,"rest_sec":number}],"notes":string}. ' ||
    'Usa SOLO exercise_id del catálogo. Para ejercicios de boxeo (tipo boxing) "reps" son los segundos por round. Ajusta series y repeticiones al nivel y a la duración pedidos (aprox. 6-10 min por ejercicio). "notes" es una indicación breve para el alumno.' ||
    E'\nCatálogo (id | nombre | categoría | tipo | series x reps):\n' || ej_ai_catalog(),
    'Petición del coach: ' || left(p_text, 600), true
  );
  begin
    o := out_t::jsonb;
  exception when others then
    raise exception 'La IA devolvió una respuesta inválida, intenta reformular';
  end;
  for r in select * from jsonb_array_elements(coalesce(o->'routine', '[]'::jsonb)) loop
    if (r->>'exercise_id') = any (ids) then
      routine := routine || jsonb_build_array(jsonb_build_object(
        'exercise_id', r->>'exercise_id',
        'sets', least(20, greatest(1, coalesce((r->>'sets')::int, 3))),
        'reps', least(300, greatest(1, coalesce((r->>'reps')::int, 10))),
        'incline_deg', 0,
        'rest_sec', least(240, greatest(15, coalesce((r->>'rest_sec')::int, 60))),
        'load_kg', 0));
    end if;
  end loop;
  return json_build_object(
    'title', left(coalesce(o->>'title', 'Clase'), 60),
    'class_type', case when (o->>'class_type') in ('Fuerza','Boxeo','Funcional','Cardio','Movilidad','Personalizada') then o->>'class_type' else 'Fuerza' end,
    'duration_min', least(240, greatest(15, coalesce((o->>'duration_min')::int, 60))),
    'capacity', least(100, greatest(1, coalesce((o->>'capacity')::int, 10))),
    'audience', case when (o->>'audience') in ('abierta','grupo','individual') then o->>'audience' else 'abierta' end,
    'routine', routine,
    'notes', left(coalesce(o->>'notes', ''), 200)
  );
end $$;

create or replace function ej_admin_ai_cue(p_pin text, p_name text, p_category text default null, p_joint text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare o jsonb;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe primero el nombre del ejercicio'; end if;
  perform ej_ai_hit('admin', 300);
  begin
    o := ej_ai_call(
      'Redactas textos para la ficha de un ejercicio. Devuelve SOLO JSON {"cue":string,"camera_hint":string}. "cue": indicación técnica corta (máx. 100 caracteres), imperativa, en español. "camera_hint": dónde colocar la cámara para que se vea el cuerpo (máx. 100 caracteres).',
      format('Ejercicio: %s. Categoría: %s. Articulación principal: %s.', left(p_name, 60), coalesce(p_category, '-'), coalesce(p_joint, '-')), true
    )::jsonb;
  exception when others then
    raise exception 'La IA devolvió una respuesta inválida, intenta de nuevo';
  end;
  return json_build_object('cue', left(coalesce(o->>'cue', ''), 120), 'camera_hint', left(coalesce(o->>'camera_hint', ''), 120));
end $$;

create or replace function ej_admin_ai_message(p_pin text, p_slot uuid default null, p_kind text default 'recordatorio', p_extra text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare s ej_class_slots; n int; ctx text;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  perform ej_ai_hit('admin', 300);
  if p_slot is not null then
    select * into s from ej_class_slots where id = p_slot;
    if found then
      select count(*) into n from ej_class_bookings where slot_id = p_slot;
      ctx := format('Clase "%s" (%s) el %s a las %s, %s min, %s de %s cupos ocupados.', s.title, s.class_type,
                    to_char(s.starts_at at time zone 'America/Bogota', 'TMDay DD "de" TMMonth'),
                    to_char(s.starts_at at time zone 'America/Bogota', 'HH24:MI'), s.duration_min, n, s.capacity);
    end if;
  end if;
  return ej_ai_call(
    'Escribes mensajes cortos para que un coach los envíe por WhatsApp a sus alumnos. Español, cercano, con 1-2 emojis, máximo 45 palabras, sin hashtags. Devuelve solo el texto del mensaje.',
    format('Tipo de mensaje: %s. %s %s', case when p_kind = 'motivacion' then 'motivación' else 'recordatorio de clase' end,
           coalesce(ctx, ''), coalesce('Contexto extra: ' || left(p_extra, 200), ''))
  );
end $$;

grant execute on function
  ej_client_ai_tip(text, jsonb), ej_client_ai_goals(text), ej_client_ai_ask(text, text),
  ej_admin_ai_summary(text, text, date, date, text), ej_admin_ai_goals(text, text),
  ej_admin_ai_class(text, text), ej_admin_ai_cue(text, text, text, text),
  ej_admin_ai_message(text, uuid, text, text)
  to anon, authenticated;
