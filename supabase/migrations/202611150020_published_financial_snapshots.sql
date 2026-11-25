begin;

create table public.published_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  currency text not null,
  collected_centavos numeric not null,
  recognized_spending_centavos numeric not null,
  reserve_centavos numeric not null
);
alter table public.published_financial_snapshots enable row level security;
revoke all on public.published_financial_snapshots from public,anon,authenticated;

create function public.publish_financial_snapshot(org uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  snapshot_id uuid;
  org_currency text;
  totals record;
begin
  select currency into org_currency from public.organizations
    where id=org and closed_at is null and suspended_at is null for share;
  if not found then raise exception 'Workspace unavailable.' using errcode='42501'; end if;
  perform 1 from public.organization_members
    where organization_id=org and profile_id=auth.uid() and status='active' and role='owner' for share;
  if not found then raise exception 'Owner approval required.' using errcode='42501'; end if;
  select * into strict totals from public.member_ledger_totals(org);
  if totals.provisional then
    raise exception 'Resolve provisional accounting before publication.' using errcode='23514';
  end if;
  insert into public.published_financial_snapshots(organization_id,approved_by,currency,
    collected_centavos,recognized_spending_centavos,reserve_centavos)
  values(org,auth.uid(),org_currency,totals.collected_centavos,totals.recognized_spending_centavos,totals.reserve_centavos)
  returning id into snapshot_id;
  return snapshot_id;
end;
$$;

create function public.read_published_financial_snapshot(snapshot uuid)
returns table(approved_at timestamptz,currency text,collected_centavos numeric,
  recognized_spending_centavos numeric,reserve_centavos numeric)
language sql stable security definer set search_path = '' as $$
  select s.approved_at,s.currency,s.collected_centavos,s.recognized_spending_centavos,s.reserve_centavos
  from public.published_financial_snapshots s where s.id=snapshot
$$;
revoke all on function public.publish_financial_snapshot(uuid),public.read_published_financial_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.publish_financial_snapshot(uuid) to authenticated;
grant execute on function public.read_published_financial_snapshot(uuid) to anon,authenticated;
commit;
