begin;
create or replace function public.review_expense(p_org_id uuid,p_expense_id uuid,p_decision text,p_notes text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_active_org_member(p_org_id,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  result := public.review_expense_with_private_result(p_org_id,p_expense_id,p_decision,p_notes,p_expected_revision);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['verified_by','approved_by','review_notes'];
  end if;
  return result;
end;
$$;

create or replace function public.review_liquidation(p_org_id uuid,p_liquidation_id uuid,p_decision text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_active_org_member(p_org_id,auth.uid()) then
    raise exception 'Active workspace access required.' using errcode='42501';
  end if;
  result := public.review_liquidation_with_private_result(p_org_id,p_liquidation_id,p_decision,p_notes);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['reviewed_by','review_notes'];
  end if;
  return result;
end;
$$;

commit;
