begin;
alter table public.published_financial_snapshots
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references public.profiles(id);

create function public.withdraw_financial_snapshot(org uuid, snapshot uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.organization_members
    where organization_id=org and profile_id=auth.uid() and status='active' and role='owner' for share;
  if not found then raise exception 'Owner approval required.' using errcode='42501'; end if;
  update public.published_financial_snapshots
    set withdrawn_at=now(), withdrawn_by=auth.uid()
    where id=snapshot and organization_id=org and withdrawn_at is null;
  return found;
end;
$$;

create or replace function public.read_published_financial_snapshot(snapshot uuid)
returns table(approved_at timestamptz,currency text,collected_centavos numeric,
  recognized_spending_centavos numeric,reserve_centavos numeric)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return query select s.approved_at,s.currency,s.collected_centavos,s.recognized_spending_centavos,s.reserve_centavos
    from public.published_financial_snapshots s where s.id=snapshot and s.withdrawn_at is null;
end;
$$;

revoke all on function public.withdraw_financial_snapshot(uuid,uuid) from public,anon;
grant execute on function public.withdraw_financial_snapshot(uuid,uuid) to authenticated;
commit;
