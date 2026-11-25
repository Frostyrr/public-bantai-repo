begin;

-- An explicit profile unlock (including the admin enforcement RPC) must also
-- reset the private credential lock checked before sign-in. Expiry alone does
-- not update the profile, so normal progressive lockout tiers are preserved.
create function bantai_private.clear_account_login_restriction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from bantai_private.login_failure_streaks
  where target = new.id::text;
  return new;
end;
$$;

revoke all on function bantai_private.clear_account_login_restriction()
from public, anon, authenticated;

create trigger clear_account_login_restriction
after update of locked_until on public.profiles
for each row when (new.locked_until is null)
execute function bantai_private.clear_account_login_restriction();

commit;
