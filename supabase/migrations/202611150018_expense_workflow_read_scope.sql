begin;
create policy expense_member_workflow_scope on public.expenses
  as restrictive for select to authenticated
  using (
    status = 'approved' or submitted_by = auth.uid() or exists (
      select 1 from public.organization_members m
      where m.organization_id=expenses.organization_id and m.profile_id=auth.uid()
        and m.status='active' and m.role in ('owner','organization_admin','treasurer','auditor')
    )
  );
commit;
