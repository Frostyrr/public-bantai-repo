begin;
-- Exact equality on the existing UNIQUE B-tree; no directory or account data.
create function public.bantai_username_available(p_username text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare candidate text := lower(btrim(p_username) collate "C");
begin
  if candidate is null or candidate !~ '^[a-z][a-z0-9]{5,19}$' then
    raise sqlstate 'PT400' using message='Invalid username format.';
  end if;
  return not exists(select 1 from bantai_private.account_usernames where username=candidate);
end $$;
revoke all on function public.bantai_username_available(text) from public,anon,authenticated;
grant execute on function public.bantai_username_available(text) to service_role;
commit;
