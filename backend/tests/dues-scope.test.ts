import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type Groq from "groq-sdk";
import { parseDuesAmount } from "../../frontend/src/utils/duesAssignment";

async function assertBaniCollectionQuery(db: PGlite, org: string, owner: string, collection: string, otherOrg: string) {
  process.env.SUPABASE_URL = "https://collections-fixture.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  const { streamChatResponse } = await import("../src/modules/ai/ai.service");
  const { resolveNavigation } = await import("../src/modules/ai/ai.navigation");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://collections-fixture.test");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-user");
    if (url.pathname === "/rest/v1/collections") {
      const workspace = url.searchParams.get("organization_id")?.slice(3);
      const id = url.searchParams.get("id")?.slice(3);
      // The bridge translates the repository's read-only PostgREST calls into
      // real SQL on the migrated fixture, with authenticated RLS still applied.
      const result = id
        ? await db.query("select id, title as label from public.collections where organization_id=$1 and id=$2", [workspace, id])
        : await db.query("select id, title, currency, target_amount_centavos, status, due_date from public.collections where organization_id=$1 order by created_at desc", [workspace]);
      return Response.json(result.rows);
    }
    assert.equal(url.pathname, "/rest/v1/rpc/collection_financial_totals");
    const { target_org, target_collection } = JSON.parse(String(init?.body));
    const totals = await db.query("select * from public.collection_financial_totals($1, $2)", [target_org, target_collection]);
    return Response.json(totals.rows);
  };
  try {
    const ctx = { organizationId: org, userId: owner, accessToken: "fixture-user", role: "owner" };
    for (const enabled of [true, false]) {
      const requests: { tools?: unknown[]; messages: unknown }[] = [];
      const client = { chat: { completions: { create: async function* (request: typeof requests[number]) {
        requests.push(request);
        yield { choices: [{ delta: requests.length === 1
          ? { tool_calls: [{ index: 0, id: "collections", function: { name: "list_collections_campaigns", arguments: "{}" } }] }
          : { content: "Dues has PHP 600 assessed and PHP 50 collected." } }] };
      } } } } as unknown as Groq;
      const events = [];
      for await (const event of streamChatResponse(ctx, "Scope tests", "Owner", [], "How are Collections & Dues doing?",
        undefined, undefined, client, undefined, undefined, enabled ? { pathname: `/app/org/${org}/overview`, search: "" } : undefined)) events.push(event);
      const results = events.filter(event => event.type === "tool_result" && event.data.tool !== "bani_actions");
      assert.deepEqual(results.map(event => event.data.tool), ["list_collections_campaigns"]);
      const payload = results[0].data.result;
      const data = enabled ? payload.data : payload;
      const dues = data.find((row: { id: string }) => row.id === collection);
      assert.equal(dues?.title, "Dues");
      assert.equal(dues?.assessed_amount, "600.00");
      assert.equal(dues?.collected_amount, "50.00");
      assert.match(JSON.stringify(requests[1].messages), enabled ? /Clickable navigation actions are attached/ : /No navigation action is attached/);
      assert.equal(JSON.stringify(requests[0].tools).includes("navigate_to"), enabled);
      if (!enabled) {
        assert.equal(payload.navigation, undefined);
        continue;
      }
      assert.equal(payload.navigation.page.immediate, false);
      assert.equal(payload.navigation.page.target.destination, "collections");
      assert.equal(payload.navigation.records.destination, "collection");
      assert.ok(payload.navigation.records.ids.includes(collection));
      const target = { destination: "collection", record: collection };
      assert.equal((await resolveNavigation(ctx, target)).path, `/app/org/${org}/collections/${collection}`);
      await assert.rejects(resolveNavigation({ ...ctx, organizationId: otherOrg }, target), { statusCode: 404 });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("scope money input is decimal safe", () => {
  assert.equal(parseDuesAmount("0.29"), 29);
  assert.equal(parseDuesAmount("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  for (const value of ["-1", "1.234", "1e3", "", "90071992547409.92"]) assert.equal(parseDuesAmount(value), null);
});

type Preview = { eligible: number; alreadyAssigned: number; newAssignments: number; totalCentavos: string; token: string; canConfirm: boolean; assigned?: number; changed?: boolean };
test("directory scope review, eligibility changes, limits, duplicates and payments", async () => {
  const db = new PGlite();
  const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const org = uuid(1), otherOrg = uuid(2), owner = uuid(3), regular = uuid(4), coll = uuid(5);
  const members = [10, 11, 12, 13, 14, 15, 16].map(uuid), groups = [20, 21, 22].map(uuid);
  const auth = () => db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
  const call = async (scope: string, g: string[] = [], m: string[] = [], apply = false, token: string | null = null, amount = 15000) =>
    (await db.query<{ result: Preview }>(`select public.collection_dues_scope($1::uuid,$2::uuid,$3,$4::uuid[],$5::uuid[],$6::bigint,null,$7,$8) as result`, [org, coll, scope, g, m, amount, apply, token])).rows[0].result;
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(dir, file), "utf8"));
    await db.exec(`insert into auth.users(id) values('${owner}'),('${regular}');
      insert into public.organizations(id,name) values('${org}','Scope tests'),('${otherOrg}','Other');
      insert into public.organization_members(organization_id,profile_id,role) values('${org}','${owner}','owner'),('${org}','${regular}','member');
      insert into public.collections(id,organization_id,title,created_by) values('${coll}','${org}','Dues','${owner}');
      insert into public.organization_directory_members(id,organization_id,display_name,status) values
        ('${members[0]}','${org}','A','active'),('${members[1]}','${org}','B','active'),('${members[2]}','${org}','C','active'),
        ('${members[3]}','${org}','Archived','archived'),('${members[4]}','${otherOrg}','Foreign','active');
      insert into public.directory_groups(organization_id,id,name) values('${org}','${groups[0]}','Officers'),('${org}','${groups[1]}','Team'),('${otherOrg}','${groups[2]}','Foreign');
      insert into public.directory_group_members values('${org}','${groups[0]}','${members[0]}'),('${org}','${groups[0]}','${members[1]}'),('${org}','${groups[1]}','${members[1]}'),('${org}','${groups[1]}','${members[2]}'),('${org}','${groups[1]}','${members[3]}');`);
    await auth();
    const all = await call("all"); assert.equal(all.eligible, 3); assert.equal(all.totalCentavos, "45000");
    assert.equal((await db.query(`select id from public.obligations`)).rows.length, 0);
    assert.equal((await call("groups", groups.slice(0, 2))).eligible, 3);
    await assert.rejects(call("groups", [groups[2]]), /do not belong/);
    await assert.rejects(call("selected", [], [members[4]]), /do not belong/);
    await db.exec(`set request.jwt.claim.sub='${regular}'`); await assert.rejects(call("all"), /cannot assign/); await auth();
    const selected = await call("selected", [], [members[0], members[0]]); assert.equal(selected.eligible, 1);
    const archived = await call("selected", [], [members[3]]); assert.equal(archived.eligible, 0); assert.equal(archived.canConfirm, false);
    assert.equal((await call("selected", [], [members[0]], true, selected.token, 15001)).changed, true, "changed amount requires renewed review");
    // The fingerprint includes the distinct selected population, so duplicates are normalized.
    assert.equal((await call("selected", [], [members[0]], true, selected.token)).assigned, 1);
    assert.equal((await call("selected", [], [members[0]], true, selected.token)).changed, true);
    const grouped = await call("groups", groups.slice(0, 2)); assert.equal(grouped.alreadyAssigned, 1); assert.equal(grouped.newAssignments, 2);
    await db.exec(`reset role;delete from public.directory_group_members where member_id='${members[2]}';`); await auth();
    const changed = await call("groups", groups.slice(0, 2), [], true, grouped.token);
    assert.equal(changed.changed, true); assert.equal(changed.newAssignments, 1);
    assert.equal((await db.query(`select id from public.obligations`)).rows.length, 1);
    assert.equal((await call("groups", groups.slice(0, 2), [], true, changed.token)).assigned, 1);
    await db.exec(`reset role;delete from public.directory_group_members where member_id='${members[0]}';`); await auth();
    assert.equal((await db.query(`select id from public.obligations`)).rows.length, 2);
    const creation = (await db.query<{review:{token:string}}>(
      "select public.collection_creation_review($1,'selected','{}',$2::uuid[],25000) as review",[org,[members[0]]],
    )).rows[0].review;
    const create = (token: string, requestId = uuid(99), title = "Standard dues") => db.query<{result:{id:string;changed?:boolean}}>(
      "select public.create_assessed_collection($1,$2,null,null,null,0,null,'selected','{}',$3::uuid[],25000,true,$4,$5) as result",
      [org,title,[members[0]],token,requestId],
    );
    const remove = (id: string, title: string) => db.query<{ action: string }>(
      "select public.delete_collection($1,$2,$3)->>'action' as action", [org, id, title],
    );
    assert.equal((await create("stale")).rows[0].result.changed,true);
    const testCollection = (await create(creation.token, uuid(98), "Test collection")).rows[0].result.id;
    assert.equal((await remove(testCollection, "Test collection")).rows[0].action, "deleted");
    assert.equal((await db.query("select id from public.obligations where collection_id=$1", [testCollection])).rows.length, 0);
    const newCollection=(await create(creation.token)).rows[0].result.id;
    assert.equal((await create(creation.token)).rows[0].result.id,newCollection);
    assert.equal((await db.query("select amount_centavos from public.obligations where collection_id=$1",[newCollection])).rows.length,1);
    await db.query("select public.collection_assessment_policy($1,$2,30000,true)",[org,newCollection]);
    const change=(await db.query<{result:{token:string}}>(
      "select public.collection_scope_settings($1,$2,'selected','{}',$3::uuid[]) as result",[org,newCollection,[members[0],members[1]]],
    )).rows[0].result;
    await db.query("select public.collection_scope_settings($1,$2,'selected','{}',$3::uuid[],$4)",[org,newCollection,[members[0],members[1]],change.token]);
    assert.deepEqual((await db.query("select amount_centavos from public.obligations where collection_id=$1 order by amount_centavos",[newCollection])).rows,
      [{amount_centavos:25000},{amount_centavos:30000}]);
    await assert.rejects(remove(newCollection, "Standard dues"), /must be retained/);
    await db.query("select public.collection_assessment_policy($1,$2,30000,false)",[org,newCollection]);
    await db.query("select public.collection_assessment_policy($1,$2,35000,true)",[org,newCollection]);
    await db.exec(`reset role; update public.organization_directory_members set status='archived' where id='${members[1]}';
      update public.organization_directory_members set status='active' where id='${members[1]}';`);
    await auth();
    assert.equal((await db.query("select id from public.obligations where collection_id=$1",[newCollection])).rows.length,2);
    const beforeNew = await call("all");
    await db.exec(`reset role;insert into public.organization_directory_members(id,organization_id,display_name) values('${members[5]}','${org}','New before confirmation');`); await auth();
    const renewed = await call("all", [], [], true, beforeNew.token); assert.equal(renewed.changed, true); assert.equal(renewed.newAssignments, 2);
    assert.equal((await call("all", [], [], true, renewed.token)).assigned, 2);
    await db.exec(`reset role;insert into public.organization_directory_members(id,organization_id,display_name) values('${members[6]}','${org}','Future');`); await auth();
    assert.equal((await db.query(`select id from public.obligations where directory_member_id='${members[6]}'`)).rows.length, 0);
    const zero = await call("selected", [], [members[6]], false, null, 0); await call("selected", [], [members[6]], true, zero.token, 0);
    assert.equal((await db.query<{ status: string }>(`select status from public.obligations where directory_member_id='${members[6]}'`)).rows[0].status, "paid");
    const obligation = (await db.query<{ id: string }>(`select id from public.obligations where directory_member_id='${members[0]}'`)).rows[0].id;
    await db.query(`select public.record_payment('${org}','${obligation}',5000,'cash',null,'scope-payment')`);
    const payment = (id: string, amount: number, method: string, reference: string | null) =>
      db.query<{ result: { id: string; is_duplicate_replay: boolean } }>(
        "select public.record_payment($1,$2,$3,$4,$5,'scope-payment') as result",
        [org, id, amount, method, reference],
      );
    const replay = (await payment(obligation, 5000, "cash", null)).rows[0].result;
    assert.equal(replay.is_duplicate_replay, true);
    const otherObligation = (await db.query<{ id: string }>(
      "select id from public.obligations where collection_id=$1 and id<>$2 limit 1", [coll, obligation],
    )).rows[0].id;
    for (const conflict of [
      () => payment(otherObligation, 5000, "cash", null),
      () => payment(obligation, 5001, "cash", null),
      () => payment(obligation, 5000, "bank_transfer", null),
      () => payment(obligation, 5000, "cash", "different reference"),
    ]) {
      await assert.rejects(conflict, { code: "PT409" });
    }
    await db.exec(`set request.jwt.claim.sub='${regular}'`);
    await assert.rejects(() => payment(obligation, 5000, "cash", null), /Unauthorized to record payments/);
    await auth();
    assert.deepEqual((await db.query("select id from public.payments where obligation_id=$1", [obligation])).rows, [{ id: replay.id }]);
    assert.deepEqual((await db.query(`select assessed_centavos,paid_centavos,remaining_centavos from public.directory_member_financial_summary('${org}','${members[0]}')`)).rows, [{ assessed_centavos: "40000", paid_centavos: "5000", remaining_centavos: "35000" }]);
    assert.deepEqual((await db.query(`select total_expected_centavos,total_collected_centavos from public.collection_financial_totals('${org}','${coll}')`)).rows, [{total_expected_centavos:"60000",total_collected_centavos:"5000"}]);
    await assertBaniCollectionQuery(db, org, owner, coll, otherOrg);
    await db.exec(`reset role;insert into public.organization_directory_members(organization_id,display_name) select '${org}','Bulk '||n from generate_series(1,501) n;`); await auth();
    assert.equal(Number((await db.query<{count:string}>("select public.collection_group_eligible_count($1,$2::uuid[]) as count",[org,groups.slice(0,2)])).rows[0].count),1);
    await assert.rejects(db.query("select public.collection_group_eligible_count($1,$2::uuid[])",[org,[groups[2]]]),/valid groups/);
    const selectedCollection = (await db.query<{result:{id:string}}>(
      "select public.create_scoped_collection($1,'Selected',null,null,null,0,null,'selected','{}',$2::uuid[]) as result",
      [org,[members[0]]],
    )).rows[0].result.id;
    const selectedRoster = (await db.query<{result:{total:number}}>(
      "select public.collection_members_page($1,$2,0,'','all') as result",[org,selectedCollection],
    )).rows[0].result;
    assert.equal(selectedRoster.total,1);
    await db.exec(`set request.jwt.claim.sub='${regular}'`);
    await assert.rejects(db.query("select public.collection_scope_settings($1,$2,'all')",[org,selectedCollection]),/unavailable/);
    await auth();
    const scoped = (await db.query<{result:{id:string}}>(
      "select public.create_scoped_collection($1,'Scoped',null,null,null,0,null,'groups',$2::uuid[],'{}') as result",
      [org,groups.slice(0,2)],
    )).rows[0].result.id;
    const roster = async (filter = "all", offset = 0) => (await db.query<{result:{rows:{status:string;outside_scope:boolean}[];total:number;notAssessed:number}}>(
      "select public.collection_members_page($1,$2,$3,'',$4) as result",[org,scoped,offset,filter],
    )).rows[0].result;
    assert.equal((await roster()).total,1);
    assert.equal((await roster()).rows[0].status,"not_assessed");
    assert.equal((await db.query("select id from public.obligations where collection_id=$1",[scoped])).rows.length,0);
    await assert.rejects(db.query("select public.assign_directory_obligations($1,$2,$3::uuid[],100)",[org,scoped,[members[6]]]),/selected members changed/i);
    await db.query("select public.assign_directory_obligations($1,$2,$3::uuid[],100)",[org,scoped,[members[1]]]);
    await db.exec(`reset role;delete from public.directory_group_members where member_id='${members[1]}';
      insert into public.directory_group_members values('${org}','${groups[0]}','${members[6]}');`);await auth();
    assert.equal((await roster("assessed")).rows[0].outside_scope,true);
    assert.equal((await roster("not_assessed")).notAssessed,1);
    const review = (await db.query<{result:{token:string}}>("select public.collection_scope_settings($1,$2,'all') as result",[org,scoped])).rows[0].result;
    await db.query("select public.collection_scope_settings($1,$2,'all','{}','{}',$3)",[org,scoped,review.token]);
    assert.equal((await roster()).rows.length,26);
    const filterAmounts = async (amounts: Record<string, number | boolean>, offset = 0, status = "all") =>
      (await db.query<{result:{rows:{obligation_id:string|null;amount_centavos:number;paid_centavos:number;remaining_centavos:number}[]}}>(
        "select public.collection_members_page($1,$2,$3,'',$4,null,$5::jsonb) as result",
        [org, scoped, offset, status, JSON.stringify(amounts)],
      )).rows[0].result.rows;
    const matches = await filterAmounts({ assessedMin: 100, assessedMax: 100, paidMax: 0, balanceMin: 100 }, 0, "pending");
    assert.equal(matches.length, 1);
    assert.deepEqual([matches[0].amount_centavos, matches[0].paid_centavos, matches[0].remaining_centavos], [100,0,100]);
    assert.equal((await filterAmounts({ balanceMax: 0 })).length, 0);
    assert.equal((await filterAmounts({ noAssessment: true }, 25)).length, 26);
    assert.ok((await filterAmounts({ noAssessment: true })).every(row => row.obligation_id === null));
    assert.equal((await filterAmounts({ assessedMax: 99 })).length, 0);
    const beforeClose=(await roster()).total;
    await db.exec(`reset role;update public.collections set status='closed' where id='${scoped}';
      insert into public.organization_directory_members(organization_id,display_name) values('${org}','After close');`);await auth();
    assert.equal((await roster()).total,beforeClose);
    assert.equal((await roster("not_assessed",25)).rows.length,26);
    const over = await call("all", [], [], false, null, Number.MAX_SAFE_INTEGER);
    assert.equal(over.newAssignments, 502); assert.equal(over.canConfirm, false); assert.equal(over.totalCentavos, (502n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
    await assert.rejects(call("all", [], [], true, over.token, Number.MAX_SAFE_INTEGER), /500 new-member limit/);
    assert.equal((await db.query(`select id from public.obligations`)).rows.length, 8);

    const paidCollection = (await create(creation.token, uuid(97), "Collection with payment")).rows[0].result.id;
    const paidObligation = (await db.query<{ id: string }>("select id from public.obligations where collection_id=$1", [paidCollection])).rows[0].id;
    const recorded = await db.query<{ id: string }>(
      "select public.record_payment($1,$2,5000,'cash',null,'assessed-payment')->>'id' as id", [org, paidObligation],
    );
    await assert.rejects(remove(paidCollection, "Collection with payment"), /must be retained/);
    await db.query("select public.reverse_payment($1,$2,'Test reversal')", [org, recorded.rows[0].id]);
    await assert.rejects(remove(paidCollection, "Collection with payment"), /must be retained/);
  } finally { await db.close(); }
});
