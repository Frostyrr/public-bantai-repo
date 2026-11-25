begin;

create table bantai_private.demo_exemptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_lockout boolean not null default false,
  ip_restriction boolean not null default false,
  expires_at timestamptz not null,
  reason text not null
);
alter table bantai_private.demo_exemptions enable row level security;
revoke all on bantai_private.demo_exemptions from public, anon, authenticated;

create function bantai_private.demo_exempt(p_user uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from bantai_private.demo_exemptions e
    join public.profiles p on p.id=e.user_id
    where e.user_id=p_user and p.role='super_admin' and e.expires_at>now()
      and case p_kind when 'account' then e.account_lockout when 'ip' then e.ip_restriction else false end)
$$;
revoke all on function bantai_private.demo_exempt(uuid,text) from public,anon,authenticated;

-- Preserve existing control sessions, without bypassing anonymous credential checks.
create function bantai_private.demo_lock_immunity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.locked_until is distinct from old.locked_until and new.locked_until>now()
     and bantai_private.demo_exempt(new.id,'account') then
    new.locked_until := old.locked_until;
  end if;
  return new;
end $$;
revoke all on function bantai_private.demo_lock_immunity() from public,anon,authenticated;
create trigger bantai_demo_lock_immunity before update of locked_until on public.profiles
for each row execute function bantai_private.demo_lock_immunity();

create function public.bantai_demo_ip_exempt(p_session uuid,p_aal text)
returns boolean language sql stable security definer set search_path = '' as $$
  select bantai_private.demo_exempt(auth.uid(),'ip')
    and bantai_private.session_decision(p_session,auth.uid())='active'
    and bantai_private.mfa_allows(auth.uid(),p_session,p_aal)
$$;
revoke all on function public.bantai_demo_ip_exempt(uuid,text) from public,anon;
grant execute on function public.bantai_demo_ip_exempt(uuid,text) to authenticated;

create function public.get_platform_demo_exemption() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin(true) then raise exception 'Super administrator access required'; end if;
  return coalesce((select to_jsonb(e) - 'user_id' from bantai_private.demo_exemptions e where user_id=auth.uid()),
    jsonb_build_object('account_lockout',false,'ip_restriction',false,'expires_at',null,'reason',''));
end $$;

create function public.set_platform_demo_exemption(p_account boolean,p_ip boolean,p_minutes integer,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  if not public.is_platform_admin(true) then raise exception 'Super administrator access required'; end if;
  if p_account is null or p_ip is null or p_minutes is null or p_minutes not between 5 and 120
     or p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Invalid demo exemption settings'; end if;
  perform pg_advisory_xact_lock(1145130580,3);
  v_before := public.get_platform_demo_exemption();
  insert into bantai_private.demo_exemptions values(auth.uid(),p_account,p_ip,
    now()+make_interval(mins=>p_minutes),trim(p_reason))
  on conflict(user_id) do update set account_lockout=excluded.account_lockout,ip_restriction=excluded.ip_restriction,
    expires_at=excluded.expires_at,reason=excluded.reason;
  v_after := public.get_platform_demo_exemption();
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,before_value,after_value)
  values(null,auth.uid(),'platform_demo_exemption_updated',auth.uid(),v_before,v_after);
  return v_after;
end $$;
revoke all on function public.get_platform_demo_exemption(),public.set_platform_demo_exemption(boolean,boolean,integer,text) from public,anon;
grant execute on function public.get_platform_demo_exemption(),public.set_platform_demo_exemption(boolean,boolean,integer,text) to authenticated;
commit;
