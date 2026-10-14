-- =====================================================================
--  Migración 004 · Interruptor del reconocimiento facial (lo controla el coach)
-- =====================================================================
update ej_config set value = jsonb_set(value, '{enabled}', 'true'::jsonb, true)
where key = 'face' and not (value ? 'enabled');

create or replace function ej_admin_set_face_enabled(p_pin text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v jsonb;
begin
  if not ej_admin_check(p_pin) then raise exception 'PIN incorrecto'; end if;
  update ej_config set value = jsonb_set(value, '{enabled}', to_jsonb(p_enabled), true)
  where key = 'face' returning value into v;
  return v;
end $$;

grant execute on function ej_admin_set_face_enabled(text, boolean) to anon, authenticated;
