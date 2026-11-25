import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  personalIdentitySchema,
  validBirthdate,
  validRegistrationPassword,
} from "../src/modules/user/personalIdentity";
import {
  identityError,
  resolveOrganizationDisplayName,
  composePersonalName,
} from "../../frontend/src/lib/identity";
import { assessPassword } from "../../frontend/src/lib/passwordPolicy";
import { resolveIdentityPayload } from "../src/utils/identityContext";

test("structured identity accepts international names and optional birthdates consistently", () => {
  assert.equal(
    composePersonalName({
      firstName: "Juan",
      middleName: " Miguel ",
      lastName: "Dela Cruz",
      birthdate: null,
      username: null,
    }),
    "Juan Miguel Dela Cruz",
  );
  assert.equal(
    composePersonalName({
      firstName: "Juan",
      middleName: null,
      lastName: "Dela Cruz",
      birthdate: null,
      username: null,
    }),
    "Juan Dela Cruz",
  );
  for (const password of [
    "password",
    "Correct!42",
    "A long memorable passphrase",
    "12345678",
    "a".repeat(73),
  ])
    assert.equal(
      validRegistrationPassword(password),
      !assessPassword(password).error,
    );
  for (const firstName of ["José", "李", "Anne-Marie", "O’Connor", "أحمد"]) {
    const input = {
      firstName: ` ${firstName} `,
      lastName: "Dela Cruz",
      username: "Member123",
      birthdate: null,
    };
    assert.equal(personalIdentitySchema.parse(input).firstName, firstName);
    assert.equal(identityError({ ...input, middleName: null }), null);
  }
  assert.equal(validBirthdate("2024-02-29"), true);
  for (const date of ["2025-02-29", "2000-04-31", "9999-01-01", "01/02/2000"]) {
    assert.equal(validBirthdate(date), false);
    assert.equal(
      personalIdentitySchema.safeParse({
        firstName: "A",
        lastName: "B",
        username: "member1",
        birthdate: date,
      }).success,
      false,
    );
  }
  assert.equal(
    personalIdentitySchema.safeParse({
      firstName: "123",
      lastName: "B",
      username: "member1",
    }).success,
    false,
  );
  assert.equal(
    personalIdentitySchema.safeParse({
      firstName: "A\nB",
      lastName: "B",
      username: "member1",
    }).success,
    false,
  );
});

test("identity presentation preserves directory names, snapshots and immutable actor IDs", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const labels = new Map([
    [id, { id, username: "member1", display_name: "Local nickname" }],
  ]);
  const original = {
    actor_id: id,
    actor_name: "Old global",
    profiles: { id, display_name: "Old global" },
    organization_directory_members: { id, email: "roster@example.test", display_name: "Roster Name" },
    members: [
      {
        id: "00000000-0000-4000-8000-000000000099",
        display_name: "Directory Student",
        member_code: "2026-001",
        email: null,
        phone: null,
        status: "active",
        attributes: {},
      },
    ],
    users: [{ id, email: "account@example.test", display_name: "Old global" }],
    before_value: { profiles: { id, display_name: "Historical snapshot" } },
  };
  const result = resolveIdentityPayload(original, labels) as typeof original;
  assert.equal(result.actor_id, id);
  assert.equal(result.actor_name, "Local nickname");
  assert.equal(result.profiles.display_name, "Local nickname");
  assert.equal(
    result.organization_directory_members.display_name,
    "Roster Name",
  );
  assert.equal(result.members[0].display_name, "Directory Student");
  assert.equal(result.users[0].display_name, "Local nickname");
  assert.equal(
    result.before_value.profiles.display_name,
    "Historical snapshot",
  );
  assert.equal(original.profiles.display_name, "Old global");
  assert.equal(resolveOrganizationDisplayName("member1", "  "), "@member1");
});

test("identity migration keeps private fields owner-only and nicknames membership-scoped", async (t) => {
  const db = new PGlite();
  const first = "00000000-0000-4000-8000-000000000001",
    second = "00000000-0000-4000-8000-000000000002";
  const org1 = "00000000-0000-4000-8000-000000000011",
    org2 = "00000000-0000-4000-8000-000000000012";
  const asUser = (user: string) =>
    db.query("select set_config('request.user',$1,false)", [user]);
  const save = (username = "member1", birthdate: string | null = null) =>
    db.query(
      "select public.set_my_personal_identity('José',null,'Dela Cruz',$1::date,$2)",
      [birthdate, username],
    );
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create schema bantai_private;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.user',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      create table public.profiles(id uuid primary key references auth.users(id),display_name text,avatar_url text,onboarding_step text);
      create table public.organization_members(id uuid primary key default gen_random_uuid(),organization_id uuid,profile_id uuid,role text,status text default 'active',unique(organization_id,profile_id));
      create table public.user_preferences(user_id uuid primary key,theme text,updated_at timestamptz);
      grant select on public.profiles to authenticated;grant update(display_name,avatar_url) on public.profiles to authenticated;
      create function public.collection_members_page(org uuid,collection uuid,page_offset integer,search_text text,filter_status text,target_obligation uuid,amounts jsonb)
        returns jsonb language plpgsql as $$begin return '{}'::jsonb;end$$;
      insert into auth.users(id,email) values('${first}','first@example.test'),('${second}','second@example.test');
      insert into public.profiles(id,display_name) values('${first}','Legacy Full Name'),('${second}','Another Legacy Name');
      insert into public.organization_members(organization_id,profile_id,role) values('${org1}','${first}','member'),('${org2}','${first}','member'),('${org1}','${second}','owner');`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/202611170006_account_usernames.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/202611180003_structured_identity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await t.test(
      "legacy values remain intact and null birthdate is accepted",
      async () => {
        await asUser(first);
        await save();
        const result = await db.query<{
          display_name: string;
          birthdate: null;
        }>("select display_name,birthdate from profiles where id=$1", [first]);
        assert.equal(result.rows[0].display_name, "Legacy Full Name");
        assert.equal(result.rows[0].birthdate, null);
      },
    );
    await t.test(
      "username collisions are atomic and personal updates roll back",
      async () => {
        await asUser(second);
        await assert.rejects(save("MEMBER1"));
        assert.equal(
          (
            await db.query<{ first_name: null }>(
              "select first_name from profiles where id=$1",
              [second],
            )
          ).rows[0].first_name,
          null,
        );
        await save("member2");
      },
    );
    await t.test(
      "private columns are not readable through co-member table grants",
      async () => {
        const grants = await db.query<{ name: string; allowed: boolean }>(
          `select name,has_column_privilege('authenticated','public.profiles',name,'select') allowed from unnest(array['first_name','middle_name','last_name','birthdate','id','avatar_url']) name`,
        );
        assert.deepEqual(
          grants.rows.map((row) => row.allowed),
          [false, false, false, false, true, true],
        );
        await asUser(first);
        const own = (
          await db.query<{ identity: { username: string } }>(
            "select get_my_personal_identity() identity",
          )
        ).rows[0].identity;
        assert.equal(own.username, "member1");
        await db.exec("set role authenticated");
        await assert.rejects(db.exec("select birthdate from public.profiles"));
        await db.exec("reset role");
      },
    );
    await t.test(
      "birthdates may be set once, with no arbitrary minimum age",
      async () => {
        await asUser(first);
        await save("member1", "2024-02-29");
        await assert.rejects(save("member1", "2024-03-01"));
        await assert.rejects(save("member1", null));
        await assert.rejects(save("member1", "9999-01-01"));
      },
    );
    await t.test(
      "nicknames clear to username and stay in their own organization",
      async () => {
        await asUser(first);
        await db.query("select set_my_organization_display_name($1,'Marc')", [
          org1,
        ]);
        await db.query("select set_my_organization_display_name($1,'Frosty')", [
          org2,
        ]);
        const label = async (org: string) =>
          (
            await db.query<{ name: string }>(
              "select resolve_account_identity($1,$2) name",
              [first, org],
            )
          ).rows[0].name;
        assert.equal(await label(org1), "Marc");
        assert.equal(await label(org2), "Frosty");
        await db.query("select set_my_organization_display_name($1,'')", [
          org1,
        ]);
        assert.equal(await label(org1), "@member1");
        assert.equal(await label(org2), "Frosty");
        await asUser(second);
        assert.equal(await label(org2), "@member1");
        await db.query(
          "select set_my_organization_display_name($1,'Owner nickname')",
          [org1],
        );
        await asUser(first);
        assert.equal(await label(org1), "@member1");
        await db.exec(
          `update organization_members set status='suspended' where profile_id='${first}' and organization_id='${org2}'`,
        );
        await assert.rejects(
          db.query("select set_my_organization_display_name($1,'Blocked')", [
            org2,
          ]),
        );
        assert.equal(
          (
            await db.query<{ role: string }>(
              "select role from organization_members where profile_id=$1 and organization_id=$2",
              [first, org1],
            )
          ).rows[0].role,
          "member",
        );
      },
    );
    await t.test(
      "new signup identity is validated, usernames reserved, and metadata scrubbed",
      async () => {
        await db.exec(
          "create trigger auth_user_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user()",
        );
        const id = "00000000-0000-4000-8000-000000000003";
        const identity = {
          firstName: "李",
          lastName: "王",
          username: "third123",
          birthdate: null,
        };
        await db.query(
          "insert into auth.users(id,email,raw_user_meta_data) values($1,'third@example.test',$2::jsonb)",
          [id, JSON.stringify({ bantai_identity: identity })],
        );
        const row = (
          await db.query<{ first_name: string; onboarding_step: string }>(
            "select first_name,onboarding_step from profiles where id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(row.first_name, "李");
        assert.equal(row.onboarding_step, "appearance");
        assert.deepEqual(
          (
            await db.query<{ raw_user_meta_data: object }>(
              "select raw_user_meta_data from auth.users where id=$1",
              [id],
            )
          ).rows[0].raw_user_meta_data,
          {},
        );
        const google = "00000000-0000-4000-8000-000000000004";
        await db.query(
          "insert into auth.users(id,email,raw_user_meta_data) values($1,'google@example.test','{\"full_name\":\"Unparsed Provider Name\"}')",
          [google],
        );
        await asUser(google);
        const missing = (
          await db.query<{ identity: { firstName: null; complete: boolean } }>(
            "select get_my_personal_identity() identity",
          )
        ).rows[0].identity;
        assert.equal(missing.firstName, null);
        assert.equal(missing.complete, false);
        await assert.rejects(
          db.exec("select complete_account_onboarding('dark')"),
        );
        await db.exec("select set_my_personal_identity('New',null,'User',null,'google123')");
        assert.equal((await db.query<{theme:string}>("select complete_account_onboarding('dark') theme")).rows[0].theme,"dark");
        assert.equal((await db.query<{theme:string}>("select complete_account_onboarding('light') theme")).rows[0].theme,"dark");
      },
    );
  } finally {
    await db.close();
  }
});
