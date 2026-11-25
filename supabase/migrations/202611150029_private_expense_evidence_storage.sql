begin;

alter table public.expense_evidence
  add column storage_path text unique,
  add column storage_sha256 text,
  add column storage_verified_at timestamptz,
  add constraint verified_storage_metadata check (
    (storage_path is null and storage_sha256 is null and storage_verified_at is null)
    or (storage_path is not null and storage_sha256 is not null
      and storage_sha256 ~ '^[0-9a-f]{64}$' and storage_verified_at is not null)
  );

-- Database-only test engines lack the Supabase Storage schema.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values ('expense-evidence','expense-evidence',false,1048576,
      array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do nothing;
    if not exists (select 1 from storage.buckets where id='expense-evidence' and not public
      and file_size_limit=1048576 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf']
      and cardinality(allowed_mime_types)=4) then
      raise exception 'Existing expense-evidence bucket has incompatible settings.';
    end if;
    -- A restrictive policy also protects this bucket from unrelated permissive policies.
    execute $policy$create policy expense_evidence_no_client_access on storage.objects
      as restrictive for all to anon,authenticated
      using (bucket_id <> 'expense-evidence') with check (bucket_id <> 'expense-evidence')$policy$;
  end if;
end;
$$;

create function public.pending_expense_storage_copies(batch_size integer default 20)
returns table(id uuid, object_path text, mime text, data text, sha256 text)
language sql stable security definer set search_path = '' as $$
  select a.id,e.organization_id::text||'/'||e.id::text||'/'||a.id::text,
    a.mime,encode(a.content,'base64'),encode(sha256(a.content),'hex')
  from public.expense_evidence a join public.expenses e on e.id=a.expense_id
  where a.storage_verified_at is null order by a.id limit least(greatest(coalesce(batch_size,20),1),100)
$$;

create function public.confirm_expense_storage_copy(attachment uuid, expected_path text, expected_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.expense_evidence a set storage_path=expected_path, storage_sha256=expected_hash,
    storage_verified_at=now()
  from public.expenses e where e.id=a.expense_id and a.id=attachment and a.storage_verified_at is null
    and expected_path=e.organization_id::text||'/'||e.id::text||'/'||a.id::text
    and expected_hash=encode(sha256(a.content),'hex');
  return found;
end;
$$;

revoke all on function public.pending_expense_storage_copies(integer),
  public.confirm_expense_storage_copy(uuid,text,text) from public,anon,authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.pending_expense_storage_copies(integer),
      public.confirm_expense_storage_copy(uuid,text,text) to service_role;
  end if;
end;
$$;

create function public.expense_storage_location(org uuid, expense uuid, attachment uuid)
returns table(object_path text, sha256 text)
language sql stable security definer set search_path = '' as $$
  select a.storage_path,a.storage_sha256
  from public.expense_evidence a join public.expenses e on e.id=a.expense_id
  where e.organization_id=org and e.id=expense and a.id=attachment
    and a.storage_verified_at is not null
    and public.is_active_org_member(org,auth.uid())
    and (e.submitted_by=auth.uid() or public.can_read_private_financial_rows(org))
$$;
revoke all on function public.expense_storage_location(uuid,uuid,uuid) from public,anon;
grant execute on function public.expense_storage_location(uuid,uuid,uuid) to authenticated;

create function public.reject_new_external_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.receipt_url is null then new.receipt_url := old.receipt_url; end if;
    if new.receipt_url is not distinct from old.receipt_url then return new; end if;
  end if;
  if new.receipt_url is not null then
    raise exception 'Attach a receipt file instead of adding an external link.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_new_external_receipt() from public,anon,authenticated;
create trigger preserve_legacy_receipt_reference before insert or update of receipt_url on public.expenses
  for each row execute function public.reject_new_external_receipt();

commit;
