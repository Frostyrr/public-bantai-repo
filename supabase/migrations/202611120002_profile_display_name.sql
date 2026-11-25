-- Migration: Add display_name to public.profiles and record user display names from Auth metadata
begin;

alter table public.profiles
  add column if not exists display_name text check (display_name is null or length(trim(display_name)) between 1 and 100);

create or replace function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), '')
  )
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$$;

update public.profiles p
set display_name = nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '')
from auth.users u
where p.id = u.id and p.display_name is null;

commit;
