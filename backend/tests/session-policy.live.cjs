/* Run only against a freshly migrated disposable Supabase CLI stack with the
 * Custom Access Token Hook enabled. See docs/qa/SESSION_TIMEOUT_REHEARSAL.md. */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const { API_URL, PUBLISHABLE_KEY, SECRET_KEY, BANTAI_TEST_DB_CONTAINER, BANTAI_TEST_EXPRESS_URL } = process.env;
assert.equal(new URL(API_URL).hostname, "127.0.0.1", "Use a disposable loopback Supabase stack");
assert.equal(new URL(BANTAI_TEST_EXPRESS_URL).hostname, "127.0.0.1");
assert.match(BANTAI_TEST_DB_CONTAINER, /^supabase_db_bantai-session-/);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient(API_URL, SECRET_KEY, options);
const password = "Session-fixture-Pass9!";
const runId = randomUUID().slice(0, 8);
const organization = randomUUID();
const otherOrganization = randomUUID();
const expense = randomUUID();
const receipt = randomUUID();
const evidencePath = `${organization}/${expense}/${receipt}`;
const channelUrl = "/organizations/" + organization;
const receiptPath = channelUrl + "/expenses/" + expense + "/evidence?attachment=" + receipt;
function sql(query) {
  return execFileSync("docker", ["exec", "-i", BANTAI_TEST_DB_CONTAINER, "psql", "-U", "postgres",
    "-XqAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" }).trim();
}
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
function clock(at) {
  sql(`create or replace function bantai_private.session_now() returns timestamptz
    language sql volatile set search_path = '' as $$ select ${at ? literal(at) + "::timestamptz" : "clock_timestamp()"} $$;`);
}
function secondsAfter(at, seconds) {
  return new Date(Date.parse(at) + seconds * 1000).toISOString();
}
function claims(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
}
async function account(role) {
  const email = `session-${runId}-${role}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: "Session " + role },
  });
  assert.ifError(error);
  return { id: data.user.id, email, role };
}
async function login(user) {
  const client = createClient(API_URL, PUBLISHABLE_KEY, options);
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
  assert.ifError(error);
  const idOfSession = claims(data.session.access_token).session_id;
  sql(`update bantai_private.sessions set signed_in_at = date_trunc('milliseconds', signed_in_at),
    last_activity_at = date_trunc('milliseconds', last_activity_at) where id = ${literal(idOfSession)};`);
  return { ...user, client, access: data.session.access_token, idOfSession };
}
function request(base, path, session, method = "GET", body) {
  return fetch(base + path, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      ...(session ? { Authorization: "Bearer " + session.access } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const express = (...args) => request(BANTAI_TEST_EXPRESS_URL, ...args);
const direct = (...args) => request(API_URL, ...args);
async function expect(response, status, description, expectedCode) {
  const result = await response;
  const text = await result.text();
  assert.equal(result.status, status, `${description}: ${text.slice(0, 400)}`);
  if (expectedCode) assert.equal(JSON.parse(text).code, expectedCode, description);
  return text;
}
async function policy(presenter, idleSeconds, absoluteSeconds, superAdminExempt = true) {
  const body = { idleSeconds, absoluteSeconds, superAdminExempt, reason: "Disposable test policy update" };
  return JSON.parse(await expect(express("/admin/settings/session-timeout", presenter, "PATCH", body), 200, "save policy")).setting;
}
async function status(admin, account, expected) {
  const directory = await expect(express("/admin/users?q=" + account.id, admin), 200, "admin directory");
  assert.equal(JSON.parse(directory).users[0]?.session_status, expected, account.role + " status");
}
function sessionTimestamp(session, column) {
  return sql(`select to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    from bantai_private.sessions where id = ${literal(session.idOfSession)};`);
}

async function main() {
  const workspaceRoles = ["owner", "organization_admin", "treasurer", "auditor", "member", "student"];
  const roles = ["super_admin", "admin", "user", "never_signed_in", ...workspaceRoles];
  // Keep within the local Auth container's default signup and sign-in limits.
  const users = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await account(role)])));
  sql(`begin;
    set local app.allow_platform_role_change = 'true';
    update public.profiles set role='super_admin' where id=${literal(users.super_admin.id)};
    update public.profiles set role='admin' where id=${literal(users.admin.id)};
    insert into public.organizations(id,name) values
      (${literal(organization)},'Session role matrix'),(${literal(otherOrganization)},'Second workspace');
    insert into public.organization_members(organization_id,profile_id,role) values
      ${workspaceRoles.map((role) => `(${literal(organization)},${literal(users[role].id)},${literal(role)})`).join(",")},
      (${literal(otherOrganization)},${literal(users.member.id)},'auditor');
    update public.organization_members set can_submit_expenses=true
      where organization_id=${literal(organization)} and profile_id=${literal(users.member.id)};
    select set_config('request.jwt.claim.sub', ${literal(users.member.id)}, true);
    insert into public.expenses(id,organization_id,title,category,amount_centavos,incurred_date,submitted_by)
      values (${literal(expense)},${literal(organization)},'Session receipt','supplies',12345,current_date,${literal(users.member.id)});
    commit;`);

  const pdf = Buffer.from("%PDF-1.4\nSession timeout test receipt\n%%EOF");
  const hash = createHash("sha256").update(pdf).digest("hex");
  const bucket = service.storage.from("expense-evidence");
  // Allow reads on a separate private bucket to exercise the session RLS guard
  // independently of the expense bucket's unconditional client denial.
  const probeBucket = "session-test-" + runId;
  assert.ifError((await service.storage.createBucket(probeBucket, { public: false })).error);
  assert.ifError((await service.storage.from(probeBucket).upload("scope.pdf", pdf,
    { contentType: "application/pdf" })).error);
  sql(`create policy "session-test-${runId}" on storage.objects for select to authenticated
    using (bucket_id = ${literal(probeBucket)});`);
  const storageProbePath = "/storage/v1/object/authenticated/" + probeBucket + "/scope.pdf";
  assert.ifError((await bucket.upload(evidencePath, pdf, { contentType: "application/pdf" })).error);
  sql(`insert into public.expense_evidence(id,expense_id,filename,mime,content,storage_path,storage_sha256,storage_verified_at)
    values (${literal(receipt)},${literal(expense)},'test.pdf','application/pdf',decode('${pdf.toString("hex")}','hex'),
      ${literal(evidencePath)},${literal(hash)},now());`);
  const signed = await bucket.createSignedUrl(evidencePath, 300);
  assert.ifError(signed.error);
  const presenter = await login(users.super_admin);
  const initial = JSON.parse(await expect(
    express("/admin/settings/session-timeout", presenter), 200, "migrated policy",
  )).setting;
  assert.deepEqual([initial.idle_seconds, initial.absolute_seconds, initial.super_admin_exempt], [0, 86400, true]);
  assert.equal((await policy(presenter, 0, 0)).absolute_seconds, 0);
  assert.equal((await expect(direct("/rest/v1/profiles?select=id"), 401, "anonymous profile read")).length > 0, true);
  await status(presenter, users.never_signed_in, "logged_out");
  const sessions = Object.fromEntries(await Promise.all(roles
    .filter((role) => !["super_admin", "never_signed_in"].includes(role))
    .map(async (role) => [role, await login(users[role])])));
  const member = sessions.member;
  const admin = sessions.admin;
  const newerMember = await login(users.member);
  const base = sessionTimestamp(newerMember, "last_activity_at");
  clock(base);
  const saved = await policy(presenter, 10, 30);
  assert.deepEqual([saved.idle_seconds, saved.absolute_seconds, saved.super_admin_exempt], [10, 30, true]);
  assert.match(sql("select after_value->>'reason' from public.audit_logs where action='platform_session_timeout_updated' order by id desc limit 1;"), /Disposable test/);
  await status(admin, member, "logged_in");
  await expect(express("/admin/users", member), 403, "ordinary user cannot read session statuses");
  await expect(express("/admin/settings/session-timeout", admin), 200, "admin can read saved policy");
  await expect(express("/admin/settings/session-timeout", admin, "PATCH", {
    idleSeconds: 0, absoluteSeconds: 0, superAdminExempt: true, reason: "Unauthorized test change",
  }), 403, "admin cannot change the policy");
  await expect(express("/user", sessions.user), 200, "signed in without workspace");
  for (const role of workspaceRoles) await expect(express(channelUrl, sessions[role]), 200, role + " workspace access");
  await expect(express("/organizations/" + otherOrganization, member), 200, "second workspace");
  await expect(express(receiptPath, member), 200, "receipt proxy before timeout");
  await expect(direct("/storage/v1/object/authenticated/expense-evidence/" + evidencePath, member), 400, "private evidence bucket");
  await expect(direct(storageProbePath, member), 200, "direct Storage through positive RLS fixture");
  await expect(fetch(signed.data.signedUrl), 200, "simulated historical signed link before timeout");
  const directProfile = "/rest/v1/profiles?select=id&id=eq." + member.id;
  const directEvidence = "/rest/v1/rpc/read_expense_evidence";
  const receiptArgs = { org: organization, expense, attachment: receipt };
  await expect(direct(directProfile, member), 200, "direct table before timeout");
  await expect(direct(directEvidence, member, "POST", receiptArgs), 200, "direct receipt RPC before timeout");
  await expect(direct("/rest/v1/rpc/bantai_check_session", member, "POST", {
    p_session: member.idOfSession, p_user: member.id, p_activity: true,
  }), 403, "session writer stays service-only");

  const originalActivity = sessionTimestamp(member, "last_activity_at");
  clock(secondsAfter(originalActivity, 9.999));
  await expect(express("/notifications/unread-count", member), 200, "passive polling");
  const refreshed = await member.client.auth.refreshSession();
  assert.ifError(refreshed.error);
  assert.equal(claims(refreshed.data.session.access_token).session_id, member.idOfSession);
  assert.equal(sessionTimestamp(member, "last_activity_at"), originalActivity);
  member.access = refreshed.data.session.access_token;
  clock(secondsAfter(originalActivity, 10));
  await status(presenter, member, "logged_in");
  await expect(direct(directProfile, member), 401, "direct table at idle boundary", "session_timed_out");
  await expect(direct(directEvidence, member, "POST", receiptArgs), 401, "direct receipt RPC at idle boundary", "session_timed_out");
  await expect(express(receiptPath, member), 401, "Express receipt at idle boundary", "session_timed_out");
  await expect(direct(storageProbePath, member), 400, "direct Storage denies timed-out session");
  await Promise.all(Array.from({ length: 8 }, () =>
    expect(express("/user/session/activity", member, "POST"), 401, "concurrent activity after expiry", "session_timed_out")));
  assert.equal(sessionTimestamp(member, "last_activity_at"), originalActivity);
  const lateRefresh = await member.client.auth.refreshSession();
  assert.equal(lateRefresh.error?.status, 401);
  assert.match(lateRefresh.error.message, /session timed out/i);
  await expect(direct("/auth/v1/user", member), 200, "native Auth can still read the identity with its preissued JWT");
  await expect(fetch(signed.data.signedUrl), 200, "signed URL retains its independent expiry");

  clock(secondsAfter(base, 10));
  await status(presenter, member, "timed_out"); // Second device has made no request since its original sign-in.
  for (const role of workspaceRoles) await expect(express(channelUrl, sessions[role]), 401, role + " timeout", "session_timed_out");
  await expect(express("/organizations/" + otherOrganization, member), 401, "second workspace timeout", "session_timed_out");
  await expect(express("/admin/users", admin), 401, "platform admin timeout", "session_timed_out");
  await expect(express("/user", sessions.user), 401, "unaffiliated user timeout", "session_timed_out");
  await expect(express("/user/session", presenter), 204, "presenter stays exempt");
  // Browser cleanup/GoTrue sign-out must preserve the terminal reason.
  const logout = await direct("/auth/v1/logout?scope=local", member, "POST");
  assert.ok([204, 403].includes(logout.status));
  await status(presenter, member, "timed_out");

  await policy(presenter, 0, 0);
  clock();
  await policy(presenter, 5, 12);
  const fresh = await login(users.member);
  assert.notEqual(fresh.idOfSession, member.idOfSession);
  const signin = sessionTimestamp(fresh, "signed_in_at");
  for (const elapsed of [4, 8, 11.999]) {
    clock(secondsAfter(signin, elapsed));
    await expect(express("/user/session/activity", fresh, "POST"), 204, "activity before absolute deadline");
  }
  clock(secondsAfter(signin, 12));
  const timedOut = await expect(express("/user/session", fresh), 401, "absolute boundary while active", "session_timed_out");
  assert.equal(JSON.parse(timedOut).reason, "absolute");

  clock();
  await policy(presenter, 0, 0);
  await expect(express("/user/session", fresh), 401, "relaxed policy cannot restore expired session", "session_timed_out");
  const finalMember = await login(users.member);
  await status(presenter, member, "logged_in");
  // Advance past the earlier artificial clock offsets before recording final sign-out.
  clock(secondsAfter(signin, 20));
  assert.ifError((await finalMember.client.auth.signOut({ scope: "local" })).error);
  await status(presenter, member, "logged_out");
  sql(`update public.profiles set suspended_at = bantai_private.session_now() where id=${literal(presenter.id)};`);
  await expect(express("/user/session", presenter), 403, "exempt presenter still subject to suspension");
  assert.equal((await presenter.client.auth.refreshSession()).error?.status, 403);
  sql(`update public.profiles set suspended_at = null,
    sessions_revoked_at = bantai_private.session_now() where id=${literal(presenter.id)};`);
  // Refresh failed on the SDK client, but the previously issued JWT still
  // reaches the durable session gate and must be rejected for explicit revocation.
  await expect(express("/user/session", presenter), 401, "exempt presenter still subject to revocation", "session_revoked");
  clock();
  // Align the test revocation marker with the real clock before obtaining a fresh login.
  sql(`update public.profiles set sessions_revoked_at = clock_timestamp() where id=${literal(presenter.id)};`);
  const freshPresenter = await login(users.super_admin);
  await policy(freshPresenter, 5, 5, false);
  clock(secondsAfter(sessionTimestamp(freshPresenter, "signed_in_at"), 5));
  await expect(express("/user/session", freshPresenter), 401, "presenter subject to policy with exemption off", "session_timed_out");

  assert.equal(sql("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname in ('public','storage');"), "0");
  console.log("Passed role matrix, boundaries, polling, refresh, concurrency, status, receipt proxy, and signed-link check.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => clock());


