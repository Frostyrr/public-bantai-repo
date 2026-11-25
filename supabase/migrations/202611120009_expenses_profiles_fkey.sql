-- 202611120009_expenses_profiles_fkey.sql
-- Add foreign key constraints from public.expenses to public.profiles
-- This enables PostgREST schema reflection and relational integrity between expenses and user profiles.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'expenses_submitted_by_profiles_fkey'
      and table_name = 'expenses'
  ) then
    alter table public.expenses
      add constraint expenses_submitted_by_profiles_fkey
      foreign key (submitted_by) references public.profiles(id);
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'expenses_verified_by_profiles_fkey'
      and table_name = 'expenses'
  ) then
    alter table public.expenses
      add constraint expenses_verified_by_profiles_fkey
      foreign key (verified_by) references public.profiles(id);
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'expenses_approved_by_profiles_fkey'
      and table_name = 'expenses'
  ) then
    alter table public.expenses
      add constraint expenses_approved_by_profiles_fkey
      foreign key (approved_by) references public.profiles(id);
  end if;
end $$;

commit;
