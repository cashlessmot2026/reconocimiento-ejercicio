-- =====================================================================
--  Migración 009 · Reserva de clases
--  El coach crea horarios (día, hora, cupo, tipo, rutina) abiertos, para un
--  grupo de alumnos o individuales. El cliente solo ve horas con cupo.
-- =====================================================================

create table if not exists ej_class_slots (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  class_type    text not null default 'Fuerza',
  starts_at     timestamptz not null,
  duration_min  int  not null default 60 check (duration_min between 10 and 480),
  capacity      int  not null default 10 check (capacity between 1 and 200),
  audience      text not null default 'abierta' check (audience in ('abierta','grupo','individual')),
  routine       jsonb not null default '[]'::jsonb,   -- [{exercise_id,sets,reps,incline_deg,rest_sec,load_kg}]
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists ej_class_slots_start_idx on ej_class_slots(starts_at);

create table if not exists ej_class_bookings (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references ej_class_slots(id) on delete cascade,
  client_code text not null references ej_clients(code) on delete cascade,
  source      text not null default 'cliente' check (source in ('cliente','coach')),
  created_at  timestamptz not null default now(),
  unique (slot_id, client_code)
);
create index if not exists ej_class_bookings_client_idx on ej_class_bookings(client_code);

alter table ej_class_slots enable row level security;     -- sin políticas: solo por RPC
alter table ej_class_bookings enable row level security;

-- ---------- Cliente ----------
-- Clases futuras con cupo (o ya reservadas por el cliente). Las de grupo/individual
-- solo las ve quien fue asignado por el coach.
create or replace function ej_client_classes(p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  return coalesce((select json_agg(t order by t.starts_at) from (
    select * from (
      select s.id, s.title, s.class_type, s.starts_at, s.duration_min, s.capacity, s.audience, s.routine, s.notes,
        (select count(*) from ej_class_bookings b where b.slot_id = s.id)::int as booked,
        exists (select 1 from ej_class_bookings b where b.slot_id = s.id and b.client_code = p_code) as mine,
        coalesce((select b.source from ej_class_bookings b where b.slot_id = s.id and b.client_code = p_code), null) as source
      from ej_class_slots s
      where s.active
        and s.starts_at + make_interval(mins => s.duration_min) > now()
        and s.starts_at < now() + interval '45 days'
    ) x
    where x.mine
       or (x.audience = 'abierta' and x.booked < x.capacity and x.starts_at > now())
  ) t), '[]'::json);
end $$;

create or replace function ej_client_book(p_code text, p_slot uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s ej_class_slots; n int;
begin
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  select * into s from ej_class_slots where id = p_slot and active for update;
  if not found then raise exception 'La clase ya no está disponible'; end if;
  if s.starts_at <= now() then raise exception 'La clase ya comenzó'; end if;
  if exists (select 1 from ej_class_bookings where slot_id = p_slot and client_code = p_code) then return; end if;
  if s.audience <> 'abierta' then raise exception 'Esta clase es solo para el grupo asignado por el coach'; end if;
  select count(*) into n from ej_class_bookings where slot_id = p_slot;
  if n >= s.capacity then raise exception 'La clase está completa'; end if;
  insert into ej_class_bookings(slot_id, client_code, source) values (p_slot, p_code, 'cliente');
end $$;

create or replace function ej_client_cancel_booking(p_code text, p_slot uuid)
returns void language sql security definer set search_path = public as $$
  delete from ej_class_bookings where slot_id = p_slot and client_code = p_code;
$$;

-- ---------- Coach (requieren PIN) ----------
create or replace function ej_admin_classes(p_pin text, p_from timestamptz default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  return coalesce((select json_agg(t order by t.starts_at) from (
    select s.id, s.title, s.class_type, s.starts_at, s.duration_min, s.capacity, s.audience, s.routine, s.notes, s.active,
      coalesce((select json_agg(json_build_object('code', b.client_code, 'name', c.name, 'source', b.source) order by b.created_at)
                from ej_class_bookings b join ej_clients c on c.code = b.client_code
                where b.slot_id = s.id), '[]'::json) as members
    from ej_class_slots s
    where s.active and s.starts_at >= coalesce(p_from, now() - interval '1 day')
  ) t), '[]'::json);
end $$;

-- p_data: { id?, title, class_type, starts: [iso,...], duration_min, capacity, audience, routine, notes, codes: [] }
create or replace function ej_admin_save_class(p_pin text, p_data jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid; v_aud text; v_cap int; v_codes text[]; v_start timestamptz; v_new uuid; v_n int := 0; c text;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  v_aud := coalesce(p_data->>'audience', 'abierta');
  if v_aud not in ('abierta','grupo','individual') then raise exception 'Tipo de clase inválido'; end if;
  v_codes := coalesce(array(select jsonb_array_elements_text(coalesce(p_data->'codes','[]'::jsonb))), '{}');
  foreach c in array v_codes loop
    if c !~ '^[0-9]{4}$' then raise exception 'Código de alumno inválido: %', c; end if;
  end loop;
  v_cap := greatest(1, coalesce((p_data->>'capacity')::int, 10));
  if v_aud = 'individual' then v_cap := 1; end if;
  if v_aud <> 'abierta' then v_cap := greatest(v_cap, coalesce(array_length(v_codes, 1), 0), 1); end if;
  if v_aud = 'individual' and coalesce(array_length(v_codes, 1), 0) > 1 then
    raise exception 'Una clase individual admite un solo alumno';
  end if;

  if nullif(p_data->>'id', '') is not null then
    v_id := (p_data->>'id')::uuid;
    update ej_class_slots set
      title = coalesce(nullif(p_data->>'title',''), title),
      class_type = coalesce(nullif(p_data->>'class_type',''), class_type),
      starts_at = coalesce(((p_data->'starts'->>0))::timestamptz, starts_at),
      duration_min = coalesce((p_data->>'duration_min')::int, duration_min),
      capacity = v_cap, audience = v_aud,
      routine = coalesce(p_data->'routine', routine),
      notes = p_data->>'notes'
    where id = v_id;
    return 1;
  end if;

  if jsonb_array_length(coalesce(p_data->'starts','[]'::jsonb)) = 0 then raise exception 'Falta la fecha y hora'; end if;
  if coalesce(nullif(p_data->>'title',''), '') = '' then raise exception 'Falta el nombre de la clase'; end if;

  for v_start in select (jsonb_array_elements_text(p_data->'starts'))::timestamptz loop
    insert into ej_class_slots(title, class_type, starts_at, duration_min, capacity, audience, routine, notes)
    values (p_data->>'title', coalesce(nullif(p_data->>'class_type',''), 'Fuerza'), v_start,
            coalesce((p_data->>'duration_min')::int, 60), v_cap, v_aud,
            coalesce(p_data->'routine', '[]'::jsonb), p_data->>'notes')
    returning id into v_new;
    foreach c in array v_codes loop
      insert into ej_clients(code) values (c) on conflict do nothing;
      insert into ej_class_bookings(slot_id, client_code, source) values (v_new, c, 'coach') on conflict do nothing;
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function ej_admin_delete_class(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  delete from ej_class_slots where id = p_id;
end $$;

create or replace function ej_admin_class_member(p_pin text, p_slot uuid, p_code text, p_add boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s ej_class_slots; n int;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  if p_code !~ '^[0-9]{4}$' then raise exception 'Código inválido'; end if;
  if not p_add then
    delete from ej_class_bookings where slot_id = p_slot and client_code = p_code;
    return;
  end if;
  select * into s from ej_class_slots where id = p_slot for update;
  if not found then raise exception 'Clase no encontrada'; end if;
  if exists (select 1 from ej_class_bookings where slot_id = p_slot and client_code = p_code) then return; end if;
  select count(*) into n from ej_class_bookings where slot_id = p_slot;
  if n >= s.capacity then raise exception 'La clase está completa (cupo %)', s.capacity; end if;
  insert into ej_clients(code) values (p_code) on conflict do nothing;
  insert into ej_class_bookings(slot_id, client_code, source) values (p_slot, p_code, 'coach');
end $$;

grant execute on function
  ej_client_classes(text), ej_client_book(text, uuid), ej_client_cancel_booking(text, uuid),
  ej_admin_classes(text, timestamptz), ej_admin_save_class(text, jsonb), ej_admin_delete_class(text, uuid),
  ej_admin_class_member(text, uuid, text, boolean)
  to anon, authenticated;
