-- =====================================================================
--  Migración 003 · Registro facial obligatorio (una sola vez) multi-ángulo
--                  y verificación 1:1 al entrar con código
-- =====================================================================

alter table ej_faces add column if not exists pose text;   -- celda de ángulo: center, l1, l2, r1, r2, u, d, ul, ur, dl, dr

-- Registro: solo si el cliente aún no tiene rostro (una sola vez).
-- Para registrar de nuevo, el coach debe restablecerlo (ej_admin_face_delete).
drop function if exists ej_face_enroll(text, jsonb, boolean);
create or replace function ej_face_enroll(p_code text, p_samples jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  n int := jsonb_array_length(p_samples);
  other text; spread numeric; far numeric; centers int;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  if exists (select 1 from ej_faces where client_code = p_code) then
    raise exception 'Este cliente ya tiene su rostro registrado. Solo el coach puede restablecerlo.';
  end if;
  if n < 10 or n > 24 then raise exception 'Se requieren entre 10 y 24 muestras'; end if;

  drop table if exists _s;
  create temp table _s on commit drop as
    select i, s->>'pose' as pose, ej_to_vec(s->'d') as v
    from jsonb_array_elements(p_samples) with ordinality t(s, i);

  select count(*) into centers from _s where pose = 'center';
  if centers < 3 then raise exception 'Faltan capturas frontales'; end if;
  if (select count(distinct pose) from _s) < 7 then raise exception 'Faltan ángulos por capturar'; end if;

  -- Coherencia: las frontales deben ser muy parecidas entre sí y todas las demás
  -- cercanas al promedio frontal (misma persona desde otro ángulo).
  select max(a.v <-> b.v) into spread from _s a, _s b where a.i < b.i and a.pose = 'center' and b.pose = 'center';
  if spread > 0.42 then raise exception 'Las capturas frontales no son consistentes. Repite con buena luz.'; end if;
  select max(s.v <-> c.m) into far from _s s, (select avg(v) m from _s where pose = 'center') c;
  if far > 0.72 then raise exception 'Alguna captura no coincide con tu rostro. Repite el registro.'; end if;

  -- El mismo rostro no puede existir con otro código
  select f.client_code into other
  from ej_faces f, (select v from _s where pose = 'center') q
  where f.client_code <> p_code
  group by f.client_code having avg(f.embedding <-> q.v) < 0.42 limit 1;
  if other is not null then raise exception 'Este rostro ya está registrado con otro número de cliente'; end if;

  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_faces(client_code, embedding, pose) select p_code, v, pose from _s;
  return json_build_object('ok', true, 'samples', n, 'angles', (select count(distinct pose) from _s),
                           'spread', round(spread::numeric, 3), 'far', round(far::numeric, 3));
end $$;

-- Verificación 1:1: ¿estas muestras pertenecen al cliente p_code?
create or replace function ej_face_verify(p_code text, p_descs jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  thr numeric := coalesce((select (value->>'threshold')::numeric from ej_config where key='face'), 0.45);
  mrg numeric := coalesce((select (value->>'margin')::numeric from ej_config where key='face'), 0.06);
  mine record; rival numeric; n int := jsonb_array_length(p_descs);
begin
  if n < 1 or n > 10 then raise exception 'Muestras inválidas'; end if;
  if not exists (select 1 from ej_faces where client_code = p_code) then
    return json_build_object('match', false, 'reason', 'not_enrolled');
  end if;
  with q as (select i, ej_to_vec(d) v from jsonb_array_elements(p_descs) with ordinality t(d, i)),
       per as (select q.i, min(f.embedding <-> q.v) d from ej_faces f, q where f.client_code = p_code group by q.i)
  select avg(d) mean_d, max(d) worst_d into mine from per;

  with q as (select i, ej_to_vec(d) v from jsonb_array_elements(p_descs) with ordinality t(d, i)),
       per as (select f.client_code, q.i, min(f.embedding <-> q.v) d from ej_faces f, q
               where f.client_code <> p_code group by f.client_code, q.i)
  select min(m) into rival from (select client_code, avg(d) m from per group by client_code) x;

  if mine.mean_d <= thr and mine.worst_d <= thr + 0.08 and (rival is null or rival - mine.mean_d >= mrg) then
    return json_build_object('match', true, 'code', p_code, 'distance', round(mine.mean_d::numeric, 3),
      'confidence', round(greatest(0, least(1, 1 - mine.mean_d / (thr * 2)))::numeric * 100, 1));
  end if;
  return json_build_object('match', false, 'reason', 'no_match', 'distance', round(mine.mean_d::numeric, 3));
end $$;

grant execute on function ej_face_enroll(text, jsonb), ej_face_verify(text, jsonb) to anon, authenticated;

update ej_config set value = value || '{"consent":"Acepto que se guarde mi huella facial numérica (vectores de 128 valores, sin fotos) para identificarme y registrar mis entrenamientos en mi número de cliente."}'::jsonb
where key = 'face';
