begin;

alter table public.profiles
  add column first_name text,
  add column middle_name text,
  add column last_name text,
  add column birthdate date;
alter table public.organization_members add column display_name text
  check (display_name is null or (length(btrim(display_name)) between 1 and 80 and display_name !~ '[[:cntrl:]<>]'));

-- Co-members may read profile rows. New personal columns require owner-only RPCs.
revoke select on public.profiles from authenticated;
do $$ declare columns text; begin
  select string_agg(quote_ident(attname), ',') into columns from pg_attribute
    where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
      and attname not in ('first_name','middle_name','last_name','birthdate');
  execute 'grant select ('||columns||') on public.profiles to authenticated';
end $$;
revoke update(display_name) on public.profiles from authenticated;
drop trigger if exists advance_account_onboarding_name on public.profiles;

create function bantai_private.validate_personal_identity(p_first text,p_middle text,p_last text,p_birth date)
returns void language plpgsql stable set search_path='' as $$
begin
  if p_first is null or p_last is null or length(btrim(p_first)) not between 1 and 100
    or length(btrim(p_last)) not between 1 and 100 or length(coalesce(p_middle,''))>100
    or p_first ~ '[[:cntrl:]<>]' or p_last ~ '[[:cntrl:]<>]' or coalesce(p_middle,'') ~ '[[:cntrl:]<>]'
    or p_first !~ '[[:alpha:]]' or p_last !~ '[[:alpha:]]'
    or p_birth > (now() at time zone 'Asia/Manila')::date then
    raise sqlstate 'PT400' using message='Enter valid first and last names and an optional birthdate that is not in the future.';
  end if;
end $$;
revoke all on function bantai_private.validate_personal_identity(text,text,text,date) from public,anon,authenticated;

create function public.get_my_personal_identity()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('firstName',p.first_name,'middleName',p.middle_name,'lastName',p.last_name,
    'birthdate',p.birthdate,'username',u.username,
    'complete',p.first_name is not null and p.last_name is not null and u.username is not null)
  from public.profiles p left join bantai_private.account_usernames u on u.user_id=p.id
  where p.id=(select auth.uid())
$$;

create function public.set_my_personal_identity(p_first text,p_middle text,p_last text,p_birth date,p_username text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=auth.uid(); previous_birth date; clean_username text:=lower(btrim(p_username) collate "C");
begin
  if account is null then raise sqlstate 'PT401' using message='Sign in to continue.'; end if;
  perform bantai_private.validate_personal_identity(p_first,p_middle,p_last,p_birth);
  if clean_username is null or clean_username !~ '^[a-z][a-z0-9]{5,19}$' then
    raise sqlstate 'PT400' using message='Use 6 to 20 letters or digits, starting with a letter.'; end if;
  select birthdate into previous_birth from public.profiles where id=account for no key update;
  if not found then raise sqlstate 'PT404' using message='Profile not found.'; end if;
  if previous_birth is not null and p_birth is distinct from previous_birth then
    raise sqlstate 'PT403' using message='Your saved birthdate requires a verified correction. It cannot be changed here.';
  end if;
  perform public.set_my_username(clean_username);
  update public.profiles set first_name=btrim(p_first),middle_name=nullif(btrim(p_middle),''),last_name=btrim(p_last),birthdate=p_birth,
    onboarding_step=case when onboarding_step='name' then 'appearance' else onboarding_step end where id=account;
  return public.get_my_personal_identity();
end $$;

-- Retain legacy values, but never populate another global display name.
create or replace function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity jsonb:=new.raw_user_meta_data->'bantai_identity'; clean_username text;
begin
  if identity is not null then
    perform bantai_private.validate_personal_identity(identity->>'firstName',identity->>'middleName',identity->>'lastName',nullif(identity->>'birthdate','')::date);
    clean_username:=lower(btrim(identity->>'username') collate "C");
    if clean_username is null or clean_username !~ '^[a-z][a-z0-9]{5,19}$' then raise exception 'Invalid username'; end if;
  end if;
  insert into public.profiles(id,first_name,middle_name,last_name,birthdate,onboarding_step)
    values(new.id,btrim(identity->>'firstName'),nullif(btrim(identity->>'middleName'),''),btrim(identity->>'lastName'),
      nullif(identity->>'birthdate','')::date,case when identity is null then 'name' else 'appearance' end)
    on conflict(id) do nothing;
  if identity is not null then
    insert into bantai_private.account_usernames(user_id,username) values(new.id,clean_username);
    -- Personal identity belongs in profiles, not reusable Auth metadata / AI context.
    update auth.users set raw_user_meta_data=raw_user_meta_data-'bantai_identity' where id=new.id;
  end if;
  return new;
end $$;

create or replace function public.complete_account_onboarding(p_theme text)
returns text language plpgsql security definer set search_path='' as $$
declare account uuid:=auth.uid(); step text;
begin
  if account is null then raise sqlstate 'PT401' using message='Sign in to continue.'; end if;
  if p_theme is null or p_theme not in ('light','dark','system') then raise sqlstate 'PT400' using message='Choose Light, Dark, or System.'; end if;
  select onboarding_step into step from public.profiles where id=account for no key update;
  if not found then raise sqlstate 'PT404' using message='Profile not found.'; end if;
  if step is null then
    return coalesce((select theme from public.user_preferences where user_id=account),'dark');
  end if;
  if not coalesce((public.get_my_personal_identity()->>'complete')::boolean,false) then
    raise sqlstate 'PT409' using message='Complete your name and username before choosing a theme.'; end if;
  insert into public.user_preferences(user_id,theme) values(account,p_theme)
    on conflict(user_id) do update set theme=excluded.theme,updated_at=now();
  update public.profiles set onboarding_step=null where id=account;
  return p_theme;
end $$;

create function public.resolve_account_identity(p_user uuid,p_org uuid default null)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(
    (select nullif(btrim(m.display_name),'') from public.organization_members m where m.profile_id=p_user and m.organization_id=p_org
      and exists(select 1 from public.organization_members viewer where viewer.profile_id=auth.uid() and viewer.organization_id=p_org and viewer.status='active')),
    (select '@'||username from bantai_private.account_usernames where user_id=p_user),'Member')
$$;
create function public.account_identity_labels(p_ids uuid[])
returns table(id uuid,username text,display_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
  select p.id,n.username,coalesce('@'||n.username,'Member'),p.avatar_url from public.profiles p
    left join bantai_private.account_usernames n on n.user_id=p.id where p.id=any(p_ids)
$$;
create function public.organization_identity_labels(p_org uuid)
returns table(id uuid,username text,display_name text,organization_display_name text)
language sql stable security definer set search_path='' as $$
  select m.profile_id,n.username,public.resolve_account_identity(m.profile_id,p_org),m.display_name
    from public.organization_members m left join bantai_private.account_usernames n on n.user_id=m.profile_id
    where m.organization_id=p_org and exists(select 1 from public.organization_members viewer
      where viewer.organization_id=p_org and viewer.profile_id=auth.uid() and viewer.status='active')
$$;
create function public.set_my_organization_display_name(p_org uuid,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.organization_members; clean text:=nullif(btrim(p_name),'');
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Sign in to continue.'; end if;
  if length(clean)>80 or clean ~ '[[:cntrl:]<>]' then raise sqlstate 'PT400' using message='Use at most 80 characters without control characters or angle brackets.'; end if;
  update public.organization_members set display_name=clean where organization_id=p_org and profile_id=auth.uid() and status='active'
    returning * into member;
  if not found then raise sqlstate 'PT403' using message='An active membership is required.'; end if;
  return jsonb_build_object('displayName',clean,'resolvedName',public.resolve_account_identity(auth.uid(),p_org));
end $$;

revoke all on function public.get_my_personal_identity(), public.set_my_personal_identity(text,text,text,date,text),
  public.resolve_account_identity(uuid,uuid), public.account_identity_labels(uuid[]), public.organization_identity_labels(uuid),
  public.set_my_organization_display_name(uuid,text) from public,anon;
grant execute on function public.get_my_personal_identity(), public.set_my_personal_identity(text,text,text,date,text),
  public.resolve_account_identity(uuid,uuid), public.account_identity_labels(uuid[]), public.organization_identity_labels(uuid),
  public.set_my_organization_display_name(uuid,text) to authenticated;

-- This live roster function resolves, searches and exports the same scoped label.
-- Replace only the two audited account-name expressions; directory names stay intact.
do $$ declare source text; begin
  source:=pg_get_functiondef('public.collection_members_page(uuid,uuid,integer,text,text,uuid,jsonb)'::regprocedure);
  source:=replace(source,'p.display_name','public.resolve_account_identity(p.id,org)');
  execute source;
end $$;
notify pgrst,'reload schema';
commit;
