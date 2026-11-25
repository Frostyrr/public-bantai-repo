begin;

-- Collection and treasury totals use the aggregate RPC. Individual records
-- remain accessible to financial officers and to their original account holder.
drop policy obligations_org_read on public.obligations;
create policy obligations_org_read on public.obligations for select to authenticated using (
  public.has_directory_capability(organization_id, 'financial_view')
  or (
    public.is_active_org_member(organization_id, (select auth.uid()))
    and exists (
      select 1 from public.organization_members m
      where m.id = obligations.member_id
        and m.organization_id = obligations.organization_id
        and m.profile_id = (select auth.uid())
    )
  )
);
-- payments_org_read already delegates individual access to its obligation.

commit;
