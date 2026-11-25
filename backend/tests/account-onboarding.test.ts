import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("account onboarding resumes after the name and saves appearance atomically", async () => {
  const db = new PGlite();
  const established = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const newcomer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('test.account', true), '')::uuid
      $$;
      create table public.profiles (id uuid primary key, display_name text);
      create table public.user_preferences (
        user_id uuid primary key references public.profiles(id),
        theme text not null default 'dark' check (theme in ('dark','system')),
        reduced_motion boolean not null default false,
        updated_at timestamptz default now()
      );
      grant select, update (display_name) on public.profiles to authenticated;
      insert into public.profiles values ('${established}', 'Existing');
      insert into public.user_preferences (user_id, theme) values ('${established}', 'system');
    `);
    await db.exec(await readFile("../supabase/migrations/202611170004_account_onboarding.sql", "utf8"));
    await db.query("insert into public.profiles (id, display_name) values ($1, 'Provider Name')", [newcomer]);
    await db.query("insert into public.user_preferences (user_id, reduced_motion) values ($1, true)", [newcomer]);
    await db.query("select set_config('test.account', $1, false)", [newcomer]);
    const finish = (theme: string) =>
      db.query("select public.complete_account_onboarding($1) as theme", [theme]);
    const step = async (id: string) =>
      (await db.query("select onboarding_step from public.profiles where id = $1", [id])).rows;
    assert.deepEqual(await step(established), [{ onboarding_step: null }]);
    assert.deepEqual(await step(newcomer), [{ onboarding_step: "name" }]);
    await db.exec("set role anon");
    await assert.rejects(finish("light"), /permission denied/);
    await db.exec("set role authenticated");
    await assert.rejects(finish("light"), /Save your display name/);
    await assert.rejects(finish("sepia"), /Choose Light, Dark, or System/);
    await db.query("update public.profiles set display_name = 'Provider Name' where id = $1", [newcomer]);
    assert.deepEqual(await step(newcomer), [{ onboarding_step: "appearance" }]);
    assert.deepEqual((await finish("light")).rows, [{ theme: "light" }]);
    assert.deepEqual(await step(newcomer), [{ onboarding_step: null }]);
    assert.deepEqual((await finish("dark")).rows, [{ theme: "light" }]);
    await db.exec("reset role");
    assert.deepEqual((await db.query("select theme, reduced_motion from public.user_preferences where user_id = $1", [newcomer])).rows,
      [{ theme: "light", reduced_motion: true }]);
    assert.deepEqual((await db.query("select theme from public.user_preferences where user_id = $1", [established])).rows,
      [{ theme: "system" }]);
  } finally {
    await db.close();
  }
});
