begin;

alter table public.profiles
  add column onboarding_step text check (onboarding_step in ('name', 'appearance'));
-- Existing accounts have NULL. Only newly created profiles start onboarding.
alter table public.profiles alter column onboarding_step set default 'name';

alter table public.user_preferences drop constraint user_preferences_theme_check;
alter table public.user_preferences add constraint user_preferences_theme_check
  check (theme in ('light', 'dark', 'system'));

create function public.advance_account_onboarding_name()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.onboarding_step = 'name' and length(trim(new.display_name)) > 0 then
    new.onboarding_step := 'appearance';
  end if;
  return new;
end;
$$;
revoke all on function public.advance_account_onboarding_name() from public, anon, authenticated;

create trigger advance_account_onboarding_name before update of display_name on public.profiles
  for each row execute function public.advance_account_onboarding_name();

create function public.complete_account_onboarding(p_theme text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  current_step text;
begin
  if account_id is null then
    raise sqlstate 'PT401' using message = 'Sign in to continue.';
  end if;
  if p_theme is null or p_theme not in ('light', 'dark', 'system') then
    raise sqlstate 'PT400' using message = 'Choose Light, Dark, or System.';
  end if;

  select onboarding_step into current_step from public.profiles
    where id = account_id for no key update;
  if not found or current_step = 'name' then
    raise sqlstate 'PT409' using message = 'Save your display name before choosing a theme.';
  end if;
  if current_step is null then
    return coalesce((select theme from public.user_preferences where user_id = account_id), 'dark');
  end if;

  insert into public.user_preferences (user_id, theme) values (account_id, p_theme)
    on conflict (user_id) do update set theme = excluded.theme, updated_at = now();
  update public.profiles set onboarding_step = null where id = account_id;
  return p_theme;
end;
$$;
revoke all on function public.complete_account_onboarding(text) from public, anon;
grant execute on function public.complete_account_onboarding(text) to authenticated;

notify pgrst, 'reload schema';
commit;
