import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const receiptOrg = "aaaaaaaa-1111-4111-8111-111111111111";
export const receiptForeignOrg = "bbbbbbbb-1111-4111-8111-111111111111";
export const receiptOwner = "11111111-1111-4111-8111-111111111111";
export const receiptMember = "22222222-1111-4111-8111-111111111111";
export const receiptOther = "33333333-1111-4111-8111-111111111111";
export async function receiptDatabaseSql() {
  const migrations = path.resolve(__dirname, "../../../supabase/migrations");
  const files = (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort();
  return `create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    ${await readFile(path.join(__dirname,"supabase-session-auth.sql"),"utf8")}
    ${(await Promise.all(files.map(file => readFile(path.join(migrations,file),"utf8")))).join("\n")}
    insert into auth.users(id) values('${receiptOwner}'),('${receiptMember}'),('${receiptOther}');
    insert into public.organizations(id,name) values('${receiptOrg}','Receipt tests'),('${receiptForeignOrg}','Foreign');
    insert into public.organization_members(organization_id,profile_id,role,can_submit_expenses)
      values('${receiptOrg}','${receiptOwner}','owner',true),('${receiptOrg}','${receiptMember}','member',true),
        ('${receiptForeignOrg}','${receiptOther}','owner',true);`;
}
