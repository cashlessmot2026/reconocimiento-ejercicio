-- =====================================================================
--  Migración 012 · IA: reintentos con otros modelos ante alta demanda (503)
--                  y clases propuestas «abiertas» por defecto
-- =====================================================================

create or replace function ej_ai_poll(p_job uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  j ej_ai_jobs; resp record; v_text text; o jsonb; ids text[]; routine jsonb := '[]'::jsonb; r jsonb; out jsonb;
  v_models text[]; v_next text;
begin
  select * into j from ej_ai_jobs where id = p_job;
  if not found then return json_build_object('status', 'error', 'error', 'Consulta no encontrada'); end if;
  if j.result is not null then return j.result::json; end if;

  select status_code, content, error_msg, timed_out into resp from net._http_response where id = j.request_id;
  if not found then
    if now() - j.created_at > interval '120 seconds' then
      out := jsonb_build_object('status', 'error', 'error', 'La IA tardó demasiado. Inténtalo de nuevo.');
      update ej_ai_jobs set result = out where id = p_job;
      return out::json;
    end if;
    return json_build_object('status', 'pending');
  end if;

  v_text := null;
  if resp.status_code = 200 then
    begin
      select string_agg(p->>'text', '') into v_text
      from jsonb_array_elements(resp.content::jsonb->'candidates'->0->'content'->'parts') p
      where p ? 'text' and coalesce((p->>'thought')::boolean, false) = false;
    exception when others then v_text := null;
    end;
  end if;

  if v_text is null or length(trim(v_text)) = 0 then
    -- Demanda alta (503) o error: reintenta con otro modelo (hasta 5 intentos)
    select array[model, fallback, 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'] into v_models from ej_ai_config where id = 1;
    if j.tries < 5 then
      v_next := v_models[j.tries + 1];
      update ej_ai_jobs set model = v_next where id = p_job;
      perform ej_ai_send(p_job);
      return json_build_object('status', 'pending');
    end if;
    out := jsonb_build_object('status', 'error', 'error', 'La IA no está disponible ahora. Inténtalo en un momento.');
    update ej_ai_jobs set result = out where id = p_job;
    return out::json;
  end if;

  v_text := trim(v_text);
  if j.kind = 'text' then
    out := jsonb_build_object('status', 'done', 'data', to_jsonb(v_text));
  else
    begin
      o := v_text::jsonb;
    exception when others then
      out := jsonb_build_object('status', 'error', 'error', 'La IA devolvió una respuesta inválida, intenta reformular');
      update ej_ai_jobs set result = out where id = p_job;
      return out::json;
    end;
    if j.kind = 'cue' then
      out := jsonb_build_object('status', 'done', 'data', jsonb_build_object(
        'cue', left(coalesce(o->>'cue', ''), 120), 'camera_hint', left(coalesce(o->>'camera_hint', ''), 120)));
    else
      select array_agg(id) into ids from ej_exercises where active is not false;
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
      out := jsonb_build_object('status', 'done', 'data', jsonb_build_object(
        'title', left(coalesce(o->>'title', 'Clase'), 60),
        'class_type', case when (o->>'class_type') in ('Fuerza','Boxeo','Funcional','Cardio','Movilidad','Personalizada') then o->>'class_type' else 'Fuerza' end,
        'duration_min', least(240, greatest(15, coalesce((o->>'duration_min')::int, 60))),
        'capacity', least(100, greatest(1, coalesce((o->>'capacity')::int, 10))),
        'audience', case when (o->>'audience') in ('abierta','grupo','individual') then o->>'audience' else 'abierta' end,
        'routine', routine,
        'notes', left(coalesce(o->>'notes', ''), 200)));
    end if;
  end if;
  update ej_ai_jobs set result = out where id = p_job;
  return out::json;
end $$;

create or replace function ej_admin_ai_class(p_pin text, p_text text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if length(trim(coalesce(p_text, ''))) < 5 then raise exception 'Describe la clase que quieres'; end if;
  perform ej_ai_hit('admin', 300);
  return ej_ai_start('class',
    'Diseñas clases para un gimnasio. Devuelve SOLO un JSON con esta forma: {"title":string,"class_type":"Fuerza|Boxeo|Funcional|Cardio|Movilidad|Personalizada","duration_min":number,"capacity":number,"audience":"abierta|grupo|individual","routine":[{"exercise_id":string,"sets":number,"reps":number,"rest_sec":number}],"notes":string}. ' ||
    'Usa SOLO exercise_id del catálogo. Para ejercicios de boxeo (tipo boxing) "reps" son los segundos por round. Usa audience "abierta" salvo que el coach pida explícitamente un grupo cerrado o una clase individual. Ajusta series y repeticiones al nivel y a la duración pedidos (aprox. 6-10 min por ejercicio). "notes" es una indicación breve para el alumno.' ||
    E'\nCatálogo (id | nombre | categoría | tipo | series x reps):\n' || ej_ai_catalog(),
    'Petición del coach: ' || left(p_text, 600), true);
end $$;
