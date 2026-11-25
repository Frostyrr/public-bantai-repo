begin;

create table bantai_private.account_usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9]{5,19}$')
);
alter table bantai_private.account_usernames enable row level security;
revoke all on bantai_private.account_usernames from public, anon, authenticated;

create function public.get_my_username()
returns text language sql stable security definer set search_path = ''
as $$
  select username from bantai_private.account_usernames where user_id = (select auth.uid())
$$;

create function public.set_my_username(p_username text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_username text := lower(btrim(p_username) collate "C");
begin
  if v_user is null then raise sqlstate 'PT401' using message = 'Sign in to continue.'; end if;
  if v_username is null or v_username !~ '^[a-z][a-z0-9]{5,19}$' then
    raise sqlstate 'PT400' using message = 'Use 6 to 20 letters or digits, starting with a letter.';
  end if;
  insert into bantai_private.account_usernames (user_id, username) values (v_user, v_username)
  on conflict (user_id) do update set username = excluded.username;
  return v_username;
exception when unique_violation then
  raise sqlstate 'PT409' using message = 'That username is unavailable.';
end;
$$;

create function public.resolve_login_username(p_username text)
returns text language sql stable security definer set search_path = ''
as $$
  select u.email from bantai_private.account_usernames n
  join auth.users u on u.id = n.user_id
  where n.username = lower(p_username collate "C")
$$;

revoke all on function public.get_my_username(), public.set_my_username(text), public.resolve_login_username(text)
  from public, anon, authenticated;
grant execute on function public.get_my_username(), public.set_my_username(text) to authenticated;
grant execute on function public.resolve_login_username(text) to service_role;

commit;
