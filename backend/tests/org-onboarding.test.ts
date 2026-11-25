import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("organization onboarding progress RLS, isolation, and authoritative state", async () => {
  const db = new PGlite();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const memberId = "10000000-0000-4000-8000-000000000002";
  const outsiderId = "10000000-0000-4000-8000-000000000003";

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable
        as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(
      await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"),
    );
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users(id, email) values
        ('${ownerId}', 'owner@example.com'),
        ('${memberId}', 'member@example.com'),
        ('${outsiderId}', 'outsider@example.com');
      set role authenticated;
      set request.jwt.claim.sub='${ownerId}';
    `);

    const orgA = (
      await db.query<{ result: { id: string } }>(
        `select public.create_typed_organization('Org Alpha', 'PHP', 'workplace', '20000000-0000-4000-8000-000000000001') as result`,
      )
    ).rows[0].result.id;
    const orgB = (
      await db.query<{ result: { id: string } }>(
        `select public.create_typed_organization('Org Beta', 'USD', 'club', '20000000-0000-4000-8000-000000000002') as result`,
      )
    ).rows[0].result.id;

    // Owner can save and read their own progress in Org Alpha
    await db.query(
      `insert into public.organization_onboarding_progress (user_id, organization_id, tours)
       values ($1, $2, $3::jsonb)`,
      [
        ownerId,
        orgA,
        JSON.stringify({
          org_overview: { version: 1, status: "completed", step: 2 },
        }),
      ],
    );

    const ownerRowsA = await db.query<{ organization_id: string; tours: Record<string, unknown> }>(
      `select organization_id, tours from public.organization_onboarding_progress where user_id = $1`,
      [ownerId],
    );
    assert.equal(ownerRowsA.rows.length, 1);
    assert.equal(ownerRowsA.rows[0].organization_id, orgA);

    // Org Beta has no progress yet (org isolation)
    const ownerRowsB = await db.query(
      `select organization_id from public.organization_onboarding_progress where user_id = $1 and organization_id = $2`,
      [ownerId, orgB],
    );
    assert.equal(ownerRowsB.rows.length, 0);

    // Add memberId to Org Alpha
    const orgAInfo = (
      await db.query<{ invite_code: string }>(
        `select invite_code from public.organizations where id = $1`,
        [orgA],
      )
    ).rows[0];
    await db.exec(`set request.jwt.claim.sub='${memberId}';`);
    await db.query(`select public.join_organization_by_code($1)`, [orgAInfo.invite_code]);

    // Member cannot read owner's progress
    const memberReadsOwner = await db.query(
      `select user_id from public.organization_onboarding_progress where user_id = $1`,
      [ownerId],
    );
    assert.equal(memberReadsOwner.rows.length, 0);

    // Member cannot insert or update owner's progress
    await assert.rejects(
      db.query(
        `insert into public.organization_onboarding_progress (user_id, organization_id, checklist_dismissed)
         values ($1, $2, true)`,
        [ownerId, orgA],
      ),
    );

    // Member CAN insert and update their own progress in Org Alpha
    await db.query(
      `insert into public.organization_onboarding_progress (user_id, organization_id, checklist_dismissed)
       values ($1, $2, true)`,
      [memberId, orgA],
    );
    const memberOwn = await db.query<{ checklist_dismissed: boolean }>(
      `select checklist_dismissed from public.organization_onboarding_progress where user_id = $1 and organization_id = $2`,
      [memberId, orgA],
    );
    assert.equal(memberOwn.rows[0].checklist_dismissed, true);

    // Outsider cannot insert progress for Org Alpha
    await db.exec(`set request.jwt.claim.sub='${outsiderId}';`);
    await assert.rejects(
      db.query(
        `insert into public.organization_onboarding_progress (user_id, organization_id, checklist_dismissed)
         values ($1, $2, false)`,
        [outsiderId, orgA],
      ),
    );
  } finally {
    await db.close();
  }
});
