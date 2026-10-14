-- =====================================================================
--  Migración 008 · Ejercicios aprendidos de una demostración del coach
--  El coach graba el ejercicio; el sistema extrae la articulación, los ángulos,
--  la curva de movimiento y el tempo, y los usa para contar y puntuar al cliente.
-- =====================================================================

alter table ej_exercises add column if not exists custom   boolean not null default false;
alter table ej_exercises add column if not exists template jsonb;   -- curva de progreso 0..1 (40 puntos) de la repetición modelo
alter table ej_exercises add column if not exists ghost    jsonb;   -- esqueleto animado de la demostración
alter table ej_exercises add column if not exists tempo    jsonb;   -- {up, down, total} en segundos
alter table ej_exercises add column if not exists learned  jsonb;   -- metadatos: articulación, repeticiones vistas, tolerancia...

-- ---------- Guardar un ejercicio nuevo o la demostración de uno existente ----------
create or replace function ej_admin_save_exercise(p_pin text, p_data jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text := nullif(p_data->>'id', '');
  v_row ej_exercises;
  v_slug text;
  v_ll int[]; v_lr int[];
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;

  -- 1) Actualizar la demostración de un ejercicio existente
  if v_id is not null and exists (select 1 from ej_exercises where id = v_id) then
    update ej_exercises set
      template = coalesce(p_data->'template', template),
      ghost    = coalesce(p_data->'ghost', ghost),
      tempo    = coalesce(p_data->'tempo', tempo),
      learned  = coalesce(p_data->'learned', learned),
      rest_angle = coalesce(nullif(p_data->>'rest_angle','')::numeric, rest_angle),
      peak_angle = coalesce(nullif(p_data->>'peak_angle','')::numeric, peak_angle)
    where id = v_id
    returning * into v_row;
    return row_to_json(v_row);
  end if;

  -- 2) Ejercicio nuevo
  if length(coalesce(trim(p_data->>'name'), '')) < 2 or length(p_data->>'name') > 40 then
    raise exception 'El nombre debe tener entre 2 y 40 caracteres';
  end if;
  if not exists (select 1 from ej_muscle_groups where id = p_data->>'primary_group') then
    raise exception 'Grupo muscular principal inválido';
  end if;
  if jsonb_typeof(p_data->'muscles') <> 'array' or jsonb_array_length(p_data->'muscles') = 0 then
    raise exception 'Indica los músculos que trabaja';
  end if;
  select array_agg(x::int) into v_ll from jsonb_array_elements_text(p_data->'landmarks_l') x;
  select array_agg(x::int) into v_lr from jsonb_array_elements_text(p_data->'landmarks_r') x;
  if coalesce(array_length(v_ll, 1), 0) <> 3 or coalesce(array_length(v_lr, 1), 0) <> 3
     or exists (select 1 from unnest(v_ll || v_lr) u where u < 0 or u > 32) then
    raise exception 'Articulación inválida';
  end if;
  if abs((p_data->>'rest_angle')::numeric - (p_data->>'peak_angle')::numeric) < 15 then
    raise exception 'El recorrido del movimiento es demasiado corto (menos de 15°)';
  end if;

  v_slug := regexp_replace(lower(translate(p_data->>'name', 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z0-9]+', '_', 'g');
  v_slug := trim(both '_' from v_slug);
  v_id := 'c_' || left(v_slug, 24) || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);

  insert into ej_exercises(id, name, category, primary_group, muscles, joint_label, landmarks_l, landmarks_r,
    rest_angle, peak_angle, kcal_per_rep, camera_hint, cue, icon, default_sets, default_reps, sort, active,
    kind, supports_load, bw_factor, custom, template, ghost, tempo, learned)
  values (v_id, trim(p_data->>'name'), coalesce(nullif(trim(p_data->>'category'), ''), 'Personalizado'),
    p_data->>'primary_group', p_data->'muscles', coalesce(nullif(p_data->>'joint_label',''), 'Ángulo'), v_ll, v_lr,
    (p_data->>'rest_angle')::numeric, (p_data->>'peak_angle')::numeric,
    least(3, greatest(0.05, coalesce(nullif(p_data->>'kcal_per_rep','')::numeric, 0.4))),
    coalesce(nullif(trim(p_data->>'camera_hint'), ''), 'Cuerpo completo visible, cámara fija'),
    coalesce(nullif(trim(p_data->>'cue'), ''), 'Repite el movimiento como en la demostración'),
    coalesce(nullif(p_data->>'icon',''), '💪'),
    least(20, greatest(1, coalesce(nullif(p_data->>'default_sets','')::int, 3))),
    least(100, greatest(1, coalesce(nullif(p_data->>'default_reps','')::int, 10))),
    (select coalesce(max(sort), 0) + 1 from ej_exercises), true,
    'reps', coalesce((p_data->>'supports_load')::boolean, false),
    least(1.5, greatest(0, coalesce(nullif(p_data->>'bw_factor','')::numeric, 0))),
    true, p_data->'template', p_data->'ghost', p_data->'tempo', p_data->'learned')
  returning * into v_row;
  return row_to_json(v_row);
end $$;

-- ---------- Quitar (desactivar) un ejercicio personalizado; el historial se conserva ----------
create or replace function ej_admin_set_exercise_active(p_pin text, p_id text, p_active boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if not exists (select 1 from ej_exercises where id = p_id and custom) then
    raise exception 'Solo se pueden quitar ejercicios personalizados';
  end if;
  update ej_exercises set active = p_active where id = p_id;
end $$;

-- ---------- Borrar solo la demostración de un ejercicio ----------
create or replace function ej_admin_clear_demo(p_pin text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  update ej_exercises set template = null, ghost = null, tempo = null, learned = null where id = p_id;
end $$;

grant execute on function ej_admin_save_exercise(text, jsonb), ej_admin_set_exercise_active(text, text, boolean),
  ej_admin_clear_demo(text, text) to anon, authenticated;
