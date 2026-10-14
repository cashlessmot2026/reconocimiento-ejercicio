-- =====================================================================
--  Migración 005 · Registro facial simplificado: frente + izquierda + derecha (≥4 muestras)
-- =====================================================================
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
  if n < 4 or n > 24 then raise exception 'Se requieren entre 4 y 24 muestras'; end if;

  drop table if exists _s;
  create temp table _s on commit drop as
    select i, s->>'pose' as pose, ej_to_vec(s->'d') as v
    from jsonb_array_elements(p_samples) with ordinality t(s, i);

  select count(*) into centers from _s where pose = 'center';
  if centers < 2 then raise exception 'Faltan capturas frontales'; end if;
  if (select count(distinct pose) from _s) < 2 then raise exception 'Faltan ángulos por capturar'; end if;

  -- Coherencia: las frontales deben ser muy parecidas entre sí y todas las demás
  -- cercanas al promedio frontal (misma persona desde otro ángulo).
  select max(a.v <-> b.v) into spread from _s a, _s b where a.i < b.i and a.pose = 'center' and b.pose = 'center';
  if spread > 0.50 then raise exception 'Las capturas frontales no son consistentes. Repite con buena luz.'; end if;
  select max(s.v <-> c.m) into far from _s s, (select avg(v) m from _s where pose = 'center') c;
  if far > 0.72 then raise exception 'Alguna captura no coincide con tu rostro. Repite el registro.'; end if;

  -- El mismo rostro no puede existir con otro código
  select client_code into other from (
    select f.client_code, q.i, min(f.embedding <-> q.v) d
    from ej_faces f, (select i, v from _s where pose = 'center') q
    where f.client_code <> p_code group by f.client_code, q.i
  ) x group by client_code having avg(d) < 0.45 limit 1;
  if other is not null then raise exception 'Este rostro ya está registrado con otro número de cliente'; end if;

  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_faces(client_code, embedding, pose) select p_code, v, pose from _s;
  return json_build_object('ok', true, 'samples', n, 'angles', (select count(distinct pose) from _s),
                           'spread', round(spread::numeric, 3), 'far', round(far::numeric, 3));
end $$;

