import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIanaTimeZone } from "../src/modules/organizations/organizations.repository";
import {
  buildTimeZoneOption,
  formatUtcOffset,
  getTimeZoneOptions,
  getUtcOffsetMinutes,
} from "../../frontend/src/lib/timezones";

test("regional settings RPC enforces permissions, validation, atomic currency/timezone updates, and initial timezone", async () => {
  const db = new PGlite();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const memberId = "10000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(dir, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users(id) values ('${ownerId}'), ('${memberId}');
      set role authenticated;
      set request.jwt.claim.sub = '${ownerId}';
    `);

    const reqId = "20000000-0000-4000-8000-000000000001";
    const org = (
      await db.query<{ result: { id: string; currency: string; invite_code: string } }>(
        `select public.create_typed_organization('Regional Org', 'PHP', 'other', '${reqId}') as result`
      )
    ).rows[0].result;

    // Initial browser timezone suggestion sets time_zone when null
    const initialTz = (
      await db.query<{ tz: string }>(
        "select public.set_initial_organization_time_zone($1, $2) as tz",
        [org.id, "Asia/Manila"]
      )
    ).rows[0].tz;
    assert.equal(initialTz, "Asia/Manila");

    // Does not overwrite an existing saved timezone
    const keptTz = (
      await db.query<{ tz: string }>(
        "select public.set_initial_organization_time_zone($1, $2) as tz",
        [org.id, "America/New_York"]
      )
    ).rows[0].tz;
    assert.equal(keptTz, "Asia/Manila");

    // Invalid timezone or currency is rejected
    await assert.rejects(
      db.query("select public.update_organization_regional_settings($1, $2, $3)", [
        org.id,
        "USD",
        "Invalid/Zone",
      ]),
      /valid IANA time zone/
    );
    await assert.rejects(
      db.query("select public.update_organization_regional_settings($1, $2, $3)", [
        org.id,
        "USD",
        "EST",
      ]),
      /valid IANA time zone/
    );
    await assert.rejects(
      db.query("select public.update_organization_regional_settings($1, $2, $3)", [
        org.id,
        "ZZZ",
        "Asia/Tokyo",
      ]),
      /supported currency/
    );

    // Atomic update of both currency and timezone before financial records exist
    const updated = (
      await db.query<{ result: { id: string; currency: string; time_zone: string } }>(
        "select public.update_organization_regional_settings($1, $2, $3) as result",
        [org.id, "USD", "Asia/Singapore"]
      )
    ).rows[0].result;
    assert.equal(updated.currency, "USD");
    assert.equal(updated.time_zone, "Asia/Singapore");

    // Non-admin member cannot update regional settings
    const inviteCode = (
      await db.query<{ invite_code: string }>(
        "select invite_code from public.organizations where id = $1",
        [org.id]
      )
    ).rows[0].invite_code;
    await db.exec(`set request.jwt.claim.sub = '${memberId}';`);
    await db.query("select public.join_organization_by_code($1)", [inviteCode]);
    await assert.rejects(
      db.query("select public.update_organization_regional_settings($1, $2, $3)", [
        org.id,
        "PHP",
        "Asia/Manila",
      ]),
      /Only workspace owners and administrators/
    );

    // Switch back to owner and create a financial record (collection with a due date)
    await db.exec(`set request.jwt.claim.sub = '${ownerId}';`);
    const collection = (
      await db.query<{ result: { id: string } }>(
        "select public.create_collection($1, 'Annual Dues', p_due_date => '2026-06-15') as result",
        [org.id]
      )
    ).rows[0].result;

    // Attempting to change currency + timezone together after financial records exist fails atomically
    await assert.rejects(
      db.query("select public.update_organization_regional_settings($1, $2, $3)", [
        org.id,
        "EUR",
        "Europe/London",
      ]),
      /Currency cannot change after financial records exist/
    );

    // Verify time_zone was NOT partially updated when currency failed
    const afterFailedRow = (
      await db.query<{ currency: string; time_zone: string }>(
        "select currency::text, time_zone from public.organizations where id = $1",
        [org.id]
      )
    ).rows[0];
    assert.equal(afterFailedRow.currency, "USD");
    assert.equal(afterFailedRow.time_zone, "Asia/Singapore");

    // Updating only timezone after financial records exist succeeds and preserves existing due_date
    const tzOnly = (
      await db.query<{ result: { currency: string; time_zone: string } }>(
        "select public.update_organization_regional_settings($1, null, $2) as result",
        [org.id, "America/New_York"]
      )
    ).rows[0].result;
    assert.equal(tzOnly.currency, "USD");
    assert.equal(tzOnly.time_zone, "America/New_York");

    const collectionRow = (
      await db.query<{ due_date: Date | string }>(
        "select due_date::text as due_date from public.collections where id = $1",
        [collection.id]
      )
    ).rows[0];
    assert.equal(collectionRow.due_date, "2026-06-15");
  } finally {
    await db.close();
  }
});

test("timezone helpers format human-readable labels, handle DST offsets, and validate IANA zones", () => {
  assert.equal(isValidIanaTimeZone("Asia/Manila"), true);
  assert.equal(isValidIanaTimeZone("UTC"), true);
  assert.equal(isValidIanaTimeZone("EST"), false);
  assert.equal(isValidIanaTimeZone("Invalid/City"), false);

  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");

  assert.equal(getUtcOffsetMinutes("Asia/Manila", winter), 480);
  assert.equal(formatUtcOffset(480), "UTC+08:00");
  assert.equal(buildTimeZoneOption("Asia/Manila", winter).label, "Philippines — Manila (UTC+08:00)");

  // Daylight Saving Time check for America/New_York: EST (-05:00) in Jan vs EDT (-04:00) in Jul
  assert.equal(getUtcOffsetMinutes("America/New_York", winter), -300);
  assert.equal(getUtcOffsetMinutes("America/New_York", summer), -240);
  assert.equal(buildTimeZoneOption("America/New_York", winter).offsetLabel, "UTC-05:00");
  assert.equal(buildTimeZoneOption("America/New_York", summer).offsetLabel, "UTC-04:00");

  const options = getTimeZoneOptions(winter);
  assert.ok(options.some((o) => o.value === "Asia/Manila" && o.searchText.includes("philippines")));
});
