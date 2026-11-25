import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_CURRENCIES } from "../../frontend/src/lib/currencies";
import { organizationTypes } from "../../frontend/src/lib/organizationTypes";

test("onboarding currencies, owner/templates, idempotency and historical currency safety", async () => {
  const db = new PGlite();
  const actor = "10000000-0000-4000-8000-000000000001";
  let request = 0;
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile(path.join(__dirname, "fixtures", "supabase-session-auth.sql"), "utf8"));
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(dir, file), "utf8"));
    await db.exec(`insert into auth.users(id) values('${actor}');set role authenticated;set request.jwt.claim.sub='${actor}';`);
    const create = async (currency: string, type = "other") => {
      const id = `20000000-0000-4000-8000-${String(++request).padStart(12, "0")}`;
      const sql = `select public.create_typed_organization(' Onboarding ', $1, $2, '${id}') as result`;
      const result = (await db.query<{ result: { id: string; currency: string; role: string } }>(sql, [currency, type])).rows[0].result;
      assert.equal(result.role, "owner"); assert.equal(result.currency, currency);
      assert.equal((await db.query<{ result: { id: string } }>(sql, [currency, type])).rows[0].result.id, result.id);
      await assert.rejects(db.query(sql, [currency === "PHP" ? "USD" : "PHP", type]), /different organization details/);
      assert.equal((await db.query(`select id from public.organization_directory_members where organization_id='${result.id}'`)).rows.length, 0);
      return result.id;
    };
    for (const item of SUPPORTED_CURRENCIES) await create(item.code);
    for (const type of organizationTypes) {
      const org = await create("PHP", type.value);
      const labels = (await db.query<{ label: string }>(`select label from public.directory_field_definitions where organization_id='${org}' and active`)).rows.map(row => row.label).sort();
      assert.deepEqual(labels, [...type.fields].sort());
    }
    const studentOrg = await create("PHP", "student");
    await db.query(`insert into public.organization_directory_members(organization_id, display_name, attributes)
      values ($1, 'Existing', '{"student_id":" 001-00a01 "}'),
        ($1, 'Legacy A', '{"student_id":"002-00001"}'), ($1, 'Legacy B', '{"student_id":"002-00001"}')`, [studentOrg]);
    const roster = [
      { display_name: "Repeat", attributes: { student_id: "001-00A01" } },
      { display_name: "Ambiguous", attributes: { student_id: "002-00001" } },
      { display_name: "New", attributes: { student_id: "001-00001" } },
      { display_name: "Repeated in file", attributes: { student_id: "001-00001" } },
      { display_name: "No ID", attributes: {} },
    ];
    const preview = await db.query<{ result: { row: number; status: string }[] }>(
      "select public.preview_directory_import($1,$2::jsonb) as result", [studentOrg, JSON.stringify(roster)],
    );
    assert.deepEqual(preview.rows[0].result.map(row => row.status),
      ["identifier_exists", "identifier_conflict", "new", "duplicate_in_file", "new"]);
    const commit = (requestId: string, rows: typeof roster) => db.query<{ result: { inserted: number; skipped: number } }>(
      "select public.commit_directory_import($1,$2,$3::jsonb) as result", [studentOrg, requestId, JSON.stringify(rows)],
    );
    const studentImport = "30000000-0000-4000-8000-000000000010";
    const committed = await commit(studentImport, roster);
    assert.equal(committed.rows[0].result.inserted, 2);
    assert.equal(committed.rows[0].result.skipped, 3);
    assert.deepEqual((await commit(studentImport, roster)).rows, committed.rows);
    assert.equal((await commit("30000000-0000-4000-8000-000000000011", [roster[2]])).rows[0].result.inserted, 0);
    const addFields = (requestId: string, rows: unknown[], field: { key: string; label: string; kind: string }) =>
      db.query("select public.commit_directory_import_with_fields($1,$2,$3::jsonb,$4::jsonb) as result",
        [studentOrg, requestId, JSON.stringify(rows), JSON.stringify([field])]);
    const committee = { key: "committee", label: "Committee", kind: "text" };
    const committeeRoster = [{ display_name: "Committee member", attributes: { student_id: "003-00001", committee: "Events" } }];
    const fieldRequest = "30000000-0000-4000-8000-000000000012";
    const fieldBatch = await addFields(fieldRequest, committeeRoster, committee);
    assert.deepEqual((await addFields(fieldRequest, committeeRoster, committee)).rows, fieldBatch.rows);
    assert.equal((await db.query(
      "select count(*)::int as count from public.organization_directory_members where organization_id=$1 and attributes->>'committee'='Events'",
      [studentOrg],
    )).rows[0].count, 1);
    const failedField = { key: "unwanted", label: "Unwanted", kind: "text" };
    await assert.rejects(addFields("30000000-0000-4000-8000-000000000013", [roster[2]], failedField), /already in the directory/);
    assert.equal((await db.query(
      "select key from public.directory_field_definitions where organization_id=$1 and key='unwanted'", [studentOrg],
    )).rows.length, 0);
    await assert.rejects(addFields("30000000-0000-4000-8000-000000000014", committeeRoster,
      { ...committee, key: "different_key" }), /conflicts/);
    const clubOrg = await create("PHP", "club");
    await db.query("insert into public.organization_directory_members(organization_id,display_name,member_code) values ($1,'Existing','CLUB001')", [clubOrg]);
    const clubImport = await db.query<{ result: { status: string }[] }>(
      "select public.preview_directory_import($1,$2::jsonb) as result",
      [clubOrg, JSON.stringify([{ display_name: "Repeat club member", member_code: " club001 " }])],
    );
    assert.equal(clubImport.rows[0].result[0].status, "identifier_exists");
    await assert.rejects(create("ZZZ"), /supported currency/);
    const org = await create("USD");
    await db.query(`select public.update_organization('${org}','Editable before finances','EUR')`);
    const collection = (await db.query<{ result: { id: string; currency: string } }>(`select public.create_collection('${org}','Euro collection') as result`)).rows[0].result;
    const archive = (archive: boolean) => db.query<{ status: string }>(
      "select public.set_collection_archived($1,$2,$3) as status", [org, collection.id, archive],
    );
    assert.equal((await archive(true)).rows[0].status, "archived");
    const archives = (await db.query<{ entries: { id: string }[] }>(
      "select public.list_collection_archives($1,'Euro',0) as entries", [org],
    )).rows[0].entries;
    assert.deepEqual(archives.map(entry => entry.id), [collection.id]);
    await assert.rejects(db.query("select public.set_collection_archived($1,$2,false)", [collection.id, collection.id]), /cannot archive or restore/);
    await assert.rejects(db.query("select public.update_collection($1,$2,'Changed')", [org, collection.id]), /Restore the collection/);
    assert.equal((await archive(false)).rows[0].status, "active");
    assert.equal((await db.query<{ entries: unknown[] }>(
      "select public.list_collection_archives($1,'Euro',0) as entries", [org],
    )).rows[0].entries.length, 0);
    await db.query("select public.update_collection($1,$2,'Euro collection',p_status => 'closed')", [org, collection.id]);
    assert.equal((await archive(true)).rows[0].status, "archived");
    assert.equal((await archive(false)).rows[0].status, "closed");
    await db.exec("reset role");
    assert.ok((await db.query("select 1 from public.audit_logs where organization_id=$1 and action='collections.update'", [org])).rows.length >= 4);
    await db.exec("set role authenticated");
    const disposable = (await db.query<{ result: {id: string} }>(
      "select public.create_collection($1,'Unused collection') as result", [org],
    )).rows[0].result.id;
    await assert.rejects(db.query("select public.delete_collection($1,$2,$3)", [org, disposable, "Wrong"]), /exact collection name/);
    await db.query("select public.delete_collection($1,$2,$3)", [org, disposable, "Unused collection"]);
    assert.equal((await db.query("select id from public.collections where id=$1", [disposable])).rows.length, 0);
    assert.equal(collection.currency, "EUR");
    await db.query(`select public.create_budget('${org}','Euro budget',10000)`);
    await db.query(`select public.submit_expense('${org}','Euro expense',100,'supplies','2026-11-14')`);
    const requestId = "30000000-0000-4000-8000-000000000001";
    const draft = {title:"Reviewed expense",amountCentavos:250,category:"supplies",incurredDate:"2026-11-14"};
    const submit = (payload: typeof draft) => db.query(
      "select public.submit_reviewed_expense($1,$2,$3::jsonb) as result",
      [org,requestId,JSON.stringify(payload)],
    );
    assert.deepEqual((await submit(draft)).rows,(await submit(draft)).rows);
    await assert.rejects(submit({...draft,amountCentavos:251}), /different expense details/);
    assert.equal((await db.query("select id from public.expenses where organization_id=$1 and title=$2",[org,draft.title])).rows.length,1);
    const receipt = {name:"receipt.pdf",mime:"application/pdf",data:Buffer.from("%PDF-1.4\n%%EOF").toString("base64")};
    const withEvidence = (file: typeof receipt) => db.query<{result:{id:string}}>(
      "select public.submit_expense_with_evidence($1,$2,$3::jsonb,$4::jsonb) as result",
      [org,"30000000-0000-4000-8000-000000000002",JSON.stringify({...draft,title:"With receipt"}),JSON.stringify([file])],
    );
    await assert.rejects(withEvidence({...receipt,data:Buffer.from("not a real receipt").toString("base64")}),/Unsupported receipt/);
    const expenseId = (await withEvidence(receipt)).rows[0].result.id;
    assert.equal((await withEvidence(receipt)).rows[0].result.id,expenseId);
    await assert.rejects(db.query("select pending_expense_storage_copies(1)"), /permission denied/);
    await assert.rejects(
      db.query("select submit_expense($1,'External receipt',100,'supplies','2026-11-15',p_receipt_url=>'https://example.invalid/file')", [org]),
      /attach a receipt file/i,
    );
    const evidence = await db.query<{files:{id:string;name:string;data?:string}[]}>(
      "select public.read_expense_evidence($1,$2) as files",[org,expenseId],
    );
    assert.equal(evidence.rows[0].files.length,1);
    assert.equal(evidence.rows[0].files[0].data,undefined);
    await db.exec("reset role");
    const { rows: [copy] } = await db.query<{id:string;object_path:string;sha256:string}>(
      "select id, object_path, sha256 from pending_expense_storage_copies(20)");
    const confirmCopy = (hash: string) => db.query(
      "select confirm_expense_storage_copy($1,$2,$3) as confirmed", [copy.id, copy.object_path, hash]);
    assert.deepEqual((await confirmCopy("0".repeat(64))).rows, [{confirmed:false}]);
    assert.deepEqual((await confirmCopy(copy.sha256)).rows, [{confirmed:true}]);
    assert.deepEqual((await confirmCopy(copy.sha256)).rows, [{confirmed:false}]);
    assert.equal((await db.query("select id from pending_expense_storage_copies(20)")).rows.length, 0);
    const persisted = await db.query("select encode(content,'base64') as data from expense_evidence where id=$1", [copy.id]);
    assert.deepEqual(persisted.rows, [{data:receipt.data}]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${actor}'`);
    await assert.rejects(db.query("select public.read_expense_evidence($1,$2)",[collection.id,expenseId]),/unavailable/);
    await assert.rejects(db.query(
      "select public.review_expense($1,$2,'approved',null,999)", [org, expenseId],
    ), /expense was revised/);
    await assert.rejects(db.query(
      "select public.review_expense_internal($1,$2,'approved',null)", [org, expenseId],
    ), /permission denied/);
    const membership = (await db.query<{ id: string }>(`select id from public.organization_members where organization_id='${org}'`)).rows[0].id;
    await db.query(`select public.create_cash_advance('${org}','${membership}','Euro advance','Test currency inheritance',100,'cash',null)`);
    const advance = (await db.query<{ id: string }>(
      "select id from public.cash_advances where organization_id=$1", [org],
    )).rows[0];
    await assert.rejects(db.query("select public.delete_cash_advance($1,$2)", [org, advance.id]), /must be retained/);
    for (const table of ["collections", "budgets", "expenses", "cash_advances"]) {
      assert.deepEqual((await db.query(`select distinct currency from public.${table} where organization_id='${org}'`)).rows, [{ currency: "EUR" }]);
    }
    await assert.rejects(db.query(`select public.update_organization('${org}','Keep currency','USD')`), /cannot change after financial records/);
    await assert.rejects(db.query(`select public.update_organization_profile('${org}','Keep currency','USD',null)`), /cannot change after financial records/);
    await db.query(`select public.update_organization('${org}','Name changes still work','EUR')`);
    await db.exec("reset role");
    await assert.rejects(db.query(`insert into public.collections(organization_id,title,currency,created_by) values('${org}','Stale client','USD','${actor}')`), /currency changed/);
    assert.deepEqual((await db.query(`select currency,target_amount_centavos from public.collections where id='${collection.id}'`)).rows, [{ currency: "EUR", target_amount_centavos: 0 }]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${actor}'`);
    const closedOrg = await create("PHP");
    await db.query("select submit_expense_with_evidence($1,$2,$3,$4)", [
      closedOrg, "30000000-0000-4000-8000-000000000055",
      { title: "Historical receipt", category: "supplies", amountCentavos: 100, incurredDate: "2026-11-15" }, [receipt],
    ]);
    await db.query("select delete_organization($1)", [closedOrg]);
    await db.exec("reset role");
    const { rows: [closedCopy] } = await db.query<typeof copy>(
      "select id, object_path, sha256 from pending_expense_storage_copies(20)");
    assert.deepEqual((await db.query("select confirm_expense_storage_copy($1,$2,$3) as confirmed",
      [closedCopy.id, closedCopy.object_path, closedCopy.sha256])).rows, [{ confirmed: true }]);
    await assert.rejects(db.query("update expense_evidence set content=content||decode('ff','hex') where id=$1",
      [closedCopy.id]), /closed/);
  } finally { await db.close(); }
});
