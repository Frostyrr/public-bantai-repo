begin;
-- Preserve review transactions and auditing while narrowing the return payload.
alter function public.review_expense(uuid,uuid,text,text,integer) rename to review_expense_with_private_result;
alter function public.review_liquidation(uuid,uuid,text,text) rename to review_liquidation_with_private_result;
revoke all on function public.review_expense_with_private_result(uuid,uuid,text,text,integer),
  public.review_liquidation_with_private_result(uuid,uuid,text,text) from public,anon,authenticated;

create function public.review_expense(p_org_id uuid,p_expense_id uuid,p_decision text,p_notes text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.review_expense_with_private_result(p_org_id,p_expense_id,p_decision,p_notes,p_expected_revision);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['verified_by','approved_by','review_notes'];
  end if;
  return result;
end;
$$;

create function public.review_liquidation(p_org_id uuid,p_liquidation_id uuid,p_decision text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.review_liquidation_with_private_result(p_org_id,p_liquidation_id,p_decision,p_notes);
  if not public.can_read_private_financial_rows(p_org_id) then
    result := result - array['reviewed_by','review_notes'];
  end if;
  return result;
end;
$$;

revoke all on function public.review_expense(uuid,uuid,text,text,integer),
  public.review_liquidation(uuid,uuid,text,text) from public,anon;
grant execute on function public.review_expense(uuid,uuid,text,text,integer),
  public.review_liquidation(uuid,uuid,text,text) to authenticated;
commit;
