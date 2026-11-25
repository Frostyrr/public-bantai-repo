import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type Groq from "groq-sdk";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_session_test";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.BANI_SMART_NAVIGATION = "true";
// Tests explicitly enable visual capabilities below, independent of developer .env.
process.env.RECEIPT_AI_ENABLED = "false";
process.env.BANI_RECEIPTS_ENABLED = "false";
process.env.BANI_IMAGES_ENABLED = "false";

const nativeFetch = globalThis.fetch;
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jwt = (label: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.${label}`;
const userId = "11111111-1111-4111-8111-111111111111";
const ownOrg = "22222222-2222-4222-8222-222222222222";
const otherOrg = "33333333-3333-4333-8333-333333333333";
const navigationCollection = "44444444-4444-4444-8444-444444444444";
const navigationBudget = "dddd4444-4444-4444-8444-444444444444";
let navigationRole = "owner";
let navigationRecordVisible = true;
const baniChatId = "55555555-5555-4555-8555-555555555555";
const baniMessages: Record<string, unknown>[] = [];
let server: Server;
let base: string;
let storageFailure = false;
let membershipRelationshipFailure = false;
let membershipDatabaseFailure = false;
let financialFailure = false;
let artificialDelay = 0;
let activeReads = 0;
let peakReads = 0;
let receiptContextDenied = false;
let imageContextDenied = false;
const imageContextCalls: Record<string,unknown>[] = [];
const receiptContextCalls: Record<string,unknown>[] = [];
let observedFinancialQueries: URL[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let denyDirectoryExport = false;
let failDirectoryExportCapability = false;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "test-project.supabase.co") return nativeFetch(input, init);
    const token = new Headers(init?.headers).get("Authorization");
    if(url.pathname==="/auth/v1/signup") {
      const input=JSON.parse(String(init?.body));
      assert.equal(input.data.bantai_identity.firstName,"José");
      assert.equal(input.data.bantai_identity.lastName,"Dela Cruz");
      assert.equal(input.data.bantai_identity.birthdate,null);
      assert.equal(input.data.bantai_identity.username,"newuser1");
      assert.equal(input.gotrue_meta_security.captcha_token,"test-captcha");
      return json({user:{id:userId,email:input.email},session:null});
    }
    if (url.pathname === "/auth/v1/user") {
      if (token === "Bearer " + jwt("invalid")) return json({ message: "Invalid token" }, 401);
      return json({ id: userId, aud: "authenticated", email: "student@example.test",
        email_confirmed_at: token === "Bearer " + jwt("unverified") ? null : "2026-11-12T00:00:00Z",
        created_at: "2026-11-12T00:00:00Z", app_metadata: {}, user_metadata: { display_name: "Student User" } });
    }
    if (url.pathname === "/rest/v1/rpc/bantai_check_session") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("apikey"), process.env.SUPABASE_SERVICE_ROLE_KEY);
      assert.deepEqual(JSON.parse(init?.body as string), { p_session: sessionId, p_user: userId, p_activity: false, p_aal: "aal1" });
      return json("active");
    }
    assert.equal(token, "Bearer " + jwt("valid"), "Database reads must forward the user's token");
    if (url.pathname === "/rest/v1/rpc/get_my_personal_identity") return json({firstName:null,middleName:null,lastName:null,birthdate:null,username:"studentuser",complete:false});
    if (url.pathname === "/rest/v1/rpc/get_my_username") return json("studentuser");
    if (url.pathname === "/rest/v1/rpc/organization_identity_labels") return json(JSON.parse(String(init?.body)).p_org===ownOrg?[{id:userId,username:"studentuser",display_name:"@studentuser",organization_display_name:null}]:[]);
    if (url.pathname === "/rest/v1/rpc/account_identity_labels") return json(JSON.parse(String(init?.body)).p_ids.map((id:string)=>({id,username:"studentuser",display_name:"@studentuser",avatar_url:null})));
    if (url.pathname === "/rest/v1/ai_conversations") {
      assert.equal(url.searchParams.get("id"), "eq." + baniChatId);
      if (init?.method === "PATCH") return new Response(null, { status: 204 });
      assert.equal(url.searchParams.get("organization_id"), "eq." + ownOrg);
      return json([{ id: baniChatId, organization_id: ownOrg, created_by: userId, title: "Reports" }]);
    }
    if (url.pathname === "/rest/v1/ai_messages") {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.conversation_id, baniChatId);
        const message = { ...body, id: randomUUID(), created_at: new Date().toISOString() };
        baniMessages.push(message);
        return json(message, 201);
      }
      assert.equal(url.searchParams.get("conversation_id"), "eq." + baniChatId);
      return json([...baniMessages].reverse());
    }
    if (url.pathname === "/rest/v1/rpc/check_ai_workspace_quota") return json({ allowed: true });
    if (url.pathname === "/rest/v1/rpc/bani_image_context") {
      const body=JSON.parse(String(init?.body));imageContextCalls.push(body);
      assert.equal(body.org,ownOrg);assert.equal(body.conversation,baniChatId);
      return imageContextDenied?json({code:"42501",message:"Image unavailable"},403):json({images:[],expiredCount:1});
    }
    if (url.pathname === "/rest/v1/rpc/bani_image_stream_access") return json(true);
    if (url.pathname === "/rest/v1/rpc/bani_receipt_context") {
      const body=JSON.parse(String(init?.body));receiptContextCalls.push(body);
      assert.equal(body.org,ownOrg);assert.equal(body.conversation,baniChatId);
      return receiptContextDenied?json({code:"42501",message:"Receipt unavailable"},403):json({receipts:[],expiredCount:1});
    }
    if (url.pathname === "/rest/v1/rpc/receipt_ai_access" || url.pathname === "/rest/v1/rpc/bani_receipt_stream_access") return json(true);
    if (url.pathname === "/rest/v1/rpc/record_ai_usage_log") return json(null);
    if (url.pathname === "/rest/v1/budgets" && url.searchParams.get("select") === "id,label:name") {
      assert.equal(url.searchParams.get("organization_id"), "eq." + ownOrg);
      assert.equal(url.searchParams.get("id"), "eq." + navigationBudget);
      assert.equal(url.searchParams.get("archived_at"), "is.null");
      return json(navigationRecordVisible ? [{ id: navigationBudget, label: "Logistics Budget" }] : []);
    }
    if (url.pathname === "/rest/v1/collections" && url.searchParams.get("select") === "id,label:title") {
      assert.equal(url.searchParams.get("organization_id"), "eq." + ownOrg);
      assert.equal(url.searchParams.get("id"), "eq." + navigationCollection);
      assert.equal(init?.method, "GET");
      return json(navigationRecordVisible ? [{ id: navigationCollection, label: "Pilot dues" }] : []);
    }
    if (url.pathname === "/rest/v1/rpc/has_directory_capability") {
      const body = JSON.parse(init?.body as string);
      if (failDirectoryExportCapability && body.capability === "export") return json({ code: "57014" }, 503);
      return json(body.target_org === ownOrg && !(denyDirectoryExport && body.capability === "export"));
    }
    if (url.pathname === "/rest/v1/organization_directory_members" && url.searchParams.has("or")) {
      assert.equal(url.searchParams.get("organization_id"), "eq." + ownOrg);
      assert.match(url.searchParams.get("or") ?? "", /attributes->>student_id\.ilike\."%00041%"/);
      return new Response(JSON.stringify([{ id: userId, display_name: "Sample Member", member_code: null, attributes: { student_id: "00041" } }]), {
        headers: { "content-type": "application/json", "content-range": "0-0/1" },
      });
    }
    if (url.pathname === "/rest/v1/organization_directory_members" && init?.method === "HEAD") {
      assert.equal(url.searchParams.get("organization_id"),"eq."+ownOrg);
      const status = url.searchParams.get("status");
      assert.ok(status === "eq.active" || status === "eq.archived", "Every directory count must state its lifecycle scope");
      return new Response(null,{status:200,headers:{"content-range":`*/${status === "eq.active" ? 0 : 2}`}});
    }
    if (url.pathname === "/rest/v1/directory_groups" && init?.method === "HEAD") {
      return new Response(null,{status:200,headers:{"content-range":"*/0"}});
    }
    if (["/rest/v1/rpc/directory_member_delete_preview","/rest/v1/rpc/delete_directory_member"].includes(url.pathname)) {
      const body=JSON.parse(init?.body as string);
      assert.equal(body.target_org,ownOrg);
      const protectedMember=body.target_member === "bbbb2222-2222-4222-8222-222222222222";
      if (url.pathname.endsWith("delete_preview")) return json({canDelete:!protectedMember,obligations:protectedMember?1:0,groupMemberships:0});
      return protectedMember ? json({code:"23503",message:"Protected financial records"},400) : new Response(null,{status:204});
    }
    if (url.pathname === "/rest/v1/rpc/collection_members_page") {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.org, ownOrg);
      assert.equal(body.collection, "aaaa1111-1111-4111-8111-111111111111");
      const member = { name: "Sample Member", organization_directory_members: { member_code: null, attributes: {student_id:"00041",department:"=Editorial"} } };
      const assessed = {...member,status:"partially_paid",obligation_id:"test",amount_centavos:25000,paid_centavos:10000,remaining_centavos:15000};
      const unassessed = {...member,name:"Unassessed Member",status:"not_assessed",obligation_id:null};
      if (body.amounts) {
        assert.deepEqual(body.amounts, { paidMin: 10000, balanceMax: 15000 });
        return json({ rows: [assessed] });
      }
      return json({rows:body.filter_status === "not_assessed" ? [unassessed] : [assessed, unassessed]});
    }
    if (url.pathname === "/rest/v1/directory_field_definitions") {
      return json([
        { key: "student_id", label:"Student ID", display_order:10, kind: "text", options: [] },
        { key: "department", label:"Department", display_order:30, kind: "select", options: ["Editorial"] },
      ]);
    }
    if (url.pathname === "/rest/v1/organization_members" && url.searchParams.get("select")?.includes("organizations")) {
      assert.match(url.searchParams.get("select")!, /organizations!organization_members_organization_id_fkey\(/);
      if (membershipDatabaseFailure) {
        return json({ code: "57014", message: "Internal query timeout" }, 500);
      }
    }
    if ((membershipRelationshipFailure || membershipDatabaseFailure) && url.pathname === "/rest/v1/organization_members") {
      assert.equal(membershipDatabaseFailure, false, "Unexpected database errors must not trigger the fallback");
      if (url.searchParams.get("select")?.includes("organizations!")) {
        return json({ code: "PGRST200", message: "Relationship unavailable" }, 400);
      }
      assert.equal(url.searchParams.get("profile_id"), "eq." + userId);
      assert.equal(url.searchParams.get("status"), "eq.active");
      return json([{ id: userId, profile_id: userId, organization_id: ownOrg, role: "owner" }]);
    }
    if (membershipRelationshipFailure && url.pathname === "/rest/v1/organizations") {
      assert.equal(url.searchParams.get("id"), `in.(${ownOrg})`);
      return json([{ id: ownOrg, name: "Pilot", currency: "PHP" }]);
    }
    if (url.pathname === "/rest/v1/rpc/directory_member_financial_summary") {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.target_org, ownOrg);
      assert.equal(body.target_member, "bbbb2222-2222-4222-8222-222222222222");
      return json([{currency:"PHP",obligation_count:1,assessed_centavos:"50000",paid_centavos:"0",remaining_centavos:"50000",overpaid_centavos:"0"}]);
    }
    if (url.pathname === "/rest/v1/rpc/collection_dues_scope") {
      const body=JSON.parse(init?.body as string);
      if(body.target_org !== ownOrg) return json({code:"42501",message:"Not authorized"},403);
      assert.equal(body.assessed_centavos,25000);
      const result={currency:"PHP",scope:body.assignment_scope,eligible:2,alreadyAssigned:1,newAssignments:1,totalCentavos:"25000",token:"b".repeat(32),canConfirm:true};
      return json({...result,changed:body.apply_assignment&&body.expected_token === "a".repeat(32),assigned:body.apply_assignment&&body.expected_token === "b".repeat(32)?1:0});
    }
    if (url.pathname === "/rest/v1/rpc/collection_roster_page") {
      const body=JSON.parse(init?.body as string);
      assert.equal(body.target_org,ownOrg);
      assert.equal(body.page_offset,25);
      assert.equal(body.search_text,"Student");
      return json([{id:"bbbb2222-2222-4222-8222-222222222222"}]);
    }
    if (url.pathname === "/rest/v1/rpc/collection_obligation_financials") {
      return new Response(JSON.stringify([{obligation_id:"bbbb2222-2222-4222-8222-222222222222",paid_centavos:"0",remaining_centavos:"50000"}]), {status:200,headers:{"Content-Type":"application/json"}});
    }
    if (url.pathname === "/rest/v1/rpc/redacted_transaction_details") return json(null);
    if (url.pathname === "/rest/v1/rpc/workspace_financial_summary") {
      assert.equal(JSON.parse(init?.body as string).org, ownOrg);
      if (artificialDelay) {
        activeReads++;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise(resolve => setTimeout(resolve, artificialDelay));
        activeReads--;
      }
      if (financialFailure) return json({ message: "Private database failure" }, 500);
      return json({ total_collected_centavos: 0, reserve_balance_centavos: -20000 });
    }
    if (url.pathname === "/rest/v1/rpc/workspace_budget_totals") return json([]);
    if (url.pathname === "/rest/v1/rpc/collection_financial_totals") {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.target_org, ownOrg);
      if (artificialDelay) {
        activeReads++;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise(resolve => setTimeout(resolve, artificialDelay));
        activeReads--;
      }
      if (financialFailure) return json({ message: "Private database failure" }, 500);
      return json([{ collection_id: body.target_collection ?? "aaaa1111-1111-4111-8111-111111111111",
        total_obligations_count: 1, paid_obligations_count: 0, partially_paid_count: 0, pending_count: 1,
        total_expected_centavos: "50000", total_collected_centavos: "0" }]);
    }
    if (artificialDelay && ['/rest/v1/payments', '/rest/v1/collections', '/rest/v1/obligations', '/rest/v1/budgets', '/rest/v1/expenses', '/rest/v1/cash_advances', '/rest/v1/advance_accounting'].includes(url.pathname)) {
      activeReads++;
      peakReads = Math.max(peakReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, artificialDelay));
      activeReads--;
    }

    if (['/rest/v1/payments', '/rest/v1/collections', '/rest/v1/budgets', '/rest/v1/expenses'].includes(url.pathname)) {
      observedFinancialQueries.push(url);
      if (financialFailure && url.pathname === '/rest/v1/payments') return json({ message: 'Private database failure' }, 500);
    }
    if (url.pathname === "/rest/v1/rpc/create_typed_organization") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "55555555-5555-5555-5555-555555555555",
        name: body.org_name,
        currency: body.org_currency || "PHP",
        invite_code: "abc12345",
        role: "owner"
      });
    }
    if (url.pathname === "/rest/v1/rpc/join_organization_by_code") {
      const body = JSON.parse(init?.body as string);
      if (body.code === "valid123") {
        return json({
          id: ownOrg,
          name: "Joined Org",
          currency: "PHP",
          role: "member"
        });
      }
      return json({ message: "Invalid invitation code." }, 400);
    }
    if (url.pathname === "/rest/v1/organization_members" && url.searchParams.has("organization_id") && !url.searchParams.has("profile_id")) {
      return json([{
        id: "77777777-7777-4777-8777-777777777777",
        profile_id: userId,
        role: "owner",
        status: "active",
        created_at: "2026-11-12T00:00:00Z",
        profiles: { id: userId, display_name: "Student User" }
      }]);
    }
    if (url.pathname === "/rest/v1/reporting_periods") {
      return json([{
        id: "88888888-8888-8888-8888-888888888888",
        organization_id: ownOrg,
        name: "AY 2026-2027 Sem 1",
        start_date: "2026-08-01",
        end_date: "2026-12-15",
        status: "active",
        is_default: true,
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_reporting_period") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "88888888-8888-8888-8888-888888888888",
        organization_id: body.p_org_id,
        name: body.p_name,
        start_date: body.p_start_date,
        end_date: body.p_end_date,
        status: "active",
        is_default: body.p_is_default,
      });
    }
    if (url.pathname === "/rest/v1/spaces") {
      return json([{
        id: "99999999-9999-9999-9999-999999999999",
        organization_id: ownOrg,
        name: "Annual Summit 2026",
        description: "Operations",
        status: "active",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_space") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "99999999-9999-9999-9999-999999999999",
        organization_id: body.p_org_id,
        name: body.p_name,
        description: body.p_description,
        status: "active",
      });
    }
    if (url.pathname === "/rest/v1/rpc/update_member_role") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: body.p_membership_id,
        role: body.p_new_role,
      });
    }
    if (url.pathname === "/rest/v1/collections") {
      return json([{
        id: "aaaa1111-1111-4111-8111-111111111111",
        organization_id: ownOrg,
        title: "Semester Membership Dues",
        currency: "PHP",
        target_amount_centavos: 50000,
        status: "active",
        created_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_collection") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "aaaa1111-1111-4111-8111-111111111111",
        organization_id: body.p_org_id,
        title: body.p_title,
        currency: "PHP",
        target_amount_centavos: body.p_target_centavos,
        status: "active",
        assigned_obligations_count: body.p_assign_all ? 1 : 0,
      });
    }
    if (url.pathname === "/rest/v1/obligations") {
      return json([{
        id: "bbbb2222-2222-4222-8222-222222222222",
        collection_id: "aaaa1111-1111-4111-8111-111111111111",
        member_id: "77777777-7777-4777-8777-777777777777",
        amount_centavos: 50000,
        status: "pending",
        created_at: "2026-11-12T00:00:00Z",
        organization_members: {
          id: "77777777-7777-4777-8777-777777777777",
          profile_id: userId,
          role: "owner",
          profiles: { id: userId, display_name: "Student User" },
        },
      }]);
    }
    if (url.pathname === "/rest/v1/payments") {
      return json([{
        id: "cccc3333-3333-4333-8333-333333333333",
        organization_id: ownOrg,
        collection_id: "aaaa1111-1111-4111-8111-111111111111",
        obligation_id: "bbbb2222-2222-4222-8222-222222222222",
        amount_centavos: 50000,
        payment_method: "cash",
        receipt_number: "RCP-2026-0001",
        status: "completed",
        paid_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/record_payment") {
      const body = JSON.parse(init?.body as string);
      if (body.p_idempotency_key === "conflicting-payment") {
        return json({ code: "PT409", message: "Internal payment details" }, 409);
      }
      return json({
        id: "cccc3333-3333-4333-8333-333333333333",
        obligation_id: body.p_obligation_id,
        amount_centavos: body.p_amount_centavos,
        payment_method: body.p_payment_method,
        receipt_number: "RCP-2026-0001",
        idempotency_key: body.p_idempotency_key || "key-123",
        status: "completed",
        is_duplicate_replay: false,
      });
    }
    if (url.pathname === "/rest/v1/rpc/reverse_payment") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: body.p_payment_id,
        receipt_number: "RCP-2026-0001",
        status: "reversed",
        reversal_reason: body.p_reason,
        reversed_at: "2026-11-12T00:00:00Z",
      });
    }
    if (url.pathname === "/rest/v1/budgets") {
      return json([{
        id: "dddd4444-4444-4444-8444-444444444444",
        organization_id: ownOrg,
        name: "Logistics Budget",
        currency: "PHP",
        allocated_amount_centavos: 100000,
        status: "active",
        created_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_budget") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "dddd4444-4444-4444-8444-444444444444",
        organization_id: body.p_org_id,
        name: body.p_name,
        currency: "PHP",
        allocated_amount_centavos: body.p_allocated_centavos,
        status: "active",
      });
    }
    if (url.pathname === "/rest/v1/expenses") {
      return json([{
        id: "eeee5555-5555-4555-8555-555555555555",
        organization_id: ownOrg,
        title: "Sound System Rental",
        category: "equipment",
        amount_centavos: 25000,
        currency: "PHP",
        incurred_date: "2026-11-12",
        status: "pending",
        created_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/submit_expense") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "eeee5555-5555-4555-8555-555555555555",
        organization_id: body.p_org_id,
        title: body.p_title,
        amount_centavos: body.p_amount_centavos,
        category: body.p_category,
        status: "pending",
      });
    }
    if (url.pathname === "/rest/v1/rpc/review_expense") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: body.p_expense_id,
        status: body.p_decision,
        review_notes: body.p_notes,
      });
    }
    if (url.pathname === "/rest/v1/advance_accounting") {
      return json([{ budget_id: null, released: 20000, spent: 0, returned: 0, unsettled: 20000,
        discrepancy: 0, loss: 0, overlap: 0, unallocated_overlap: 0, attributed_from_unallocated: 0, provisional: false }]);
    }
    if (url.pathname === "/rest/v1/budget_accounting") {
      return json([]);
    }
    if (url.pathname === "/rest/v1/cash_advances") {
      return json([{
        id: "ffff6666-6666-4666-8666-666666666666",
        organization_id: ownOrg,
        accountable_person_id: "77777777-7777-4777-8777-777777777777",
        title: "Event Float",
        purpose: "Food stall change",
        amount_released_centavos: 20000,
        currency: "PHP",
        status: "outstanding",
        released_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/create_cash_advance") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "ffff6666-6666-4666-8666-666666666666",
        organization_id: body.p_org_id,
        title: body.p_title,
        amount_released_centavos: body.p_amount_centavos,
        status: "outstanding",
      });
    }
    if (url.pathname === "/rest/v1/rpc/submit_liquidation") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: "12121212-1212-4212-8212-121212121212",
        cash_advance_id: body.p_cash_advance_id,
        total_spent_centavos: body.p_spent_centavos,
        total_returned_centavos: body.p_returned_centavos,
        outstanding_balance_centavos: 0,
        status: "submitted",
      });
    }
    if (url.pathname === "/rest/v1/rpc/review_liquidation") {
      const body = JSON.parse(init?.body as string);
      return json({
        id: body.p_liquidation_id,
        status: body.p_decision,
      });
    }
    if (url.pathname === "/rest/v1/rpc/get_organization_audit_logs") {
      return json([{
        id: 1,
        organization_id: ownOrg,
        action: "payments.insert",
        actor_name: "Student User",
        occurred_at: "2026-11-12T00:00:00Z",
      }]);
    }
    if (url.pathname === "/rest/v1/approvals") return json([]);
    if (url.pathname === "/rest/v1/profiles") {
      if (init?.method === "PATCH") {
        const body = JSON.parse(init?.body as string);
        return json({ id: userId, display_name: body.display_name, avatar_url: body.avatar_url });
      }
      return json({ id: userId, display_name: "Student User", avatar_url: null, created_at: "2026-11-12T00:00:00Z" });
    }
    if (url.pathname === "/rest/v1/user_preferences") {
      if (init?.method === "POST") {
        const body = JSON.parse(init?.body as string);
        return json({
          theme: body.theme || "dark",
          reduced_motion: Boolean(body.reduced_motion),
          default_organization_id: body.default_organization_id || null,
          notifications: body.notifications || {},
        });
      }
      return json({
        theme: "dark",
        reduced_motion: false,
        default_organization_id: null,
        notifications: { email_approvals: true },
      });
    }
    if (url.pathname === "/rest/v1/rpc/complete_account_onboarding") {
      const body = JSON.parse(init?.body as string);
      assert.deepEqual(body, { p_theme: "light" });
      return json("light");
    }
    if (url.pathname === "/rest/v1/rpc/leave_organization") {
      return json({ success: true, organization_id: ownOrg });
    }
    if (url.pathname === "/rest/v1/rpc/delete_personal_account") {
      return json({ success: true });
    }
    if (url.pathname === "/rest/v1/rpc/check_org_deletability") {
      return json({
        organization_id: ownOrg,
        is_deletable: true,
        unliquidated_count: 0,
        unliquidated_amount_centavos: 0,
        members_count: 1,
        reasons: [],
      });
    }
    if (url.pathname === "/rest/v1/rpc/transfer_organization_ownership") {
      return json({ success: true });
    }
    if (url.pathname === "/rest/v1/rpc/delete_organization") {
      return json({ success: true, organization_id: ownOrg });
    }
    assert.equal(url.searchParams.get("profile_id"), "eq." + userId);
    assert.equal(url.searchParams.get("status"), "eq.active");
    if (storageFailure) return json({ message: "internal database details", code: "42P01" }, 400);
    if (url.searchParams.has("organization_id")) {
      return json(url.searchParams.get("organization_id") === "eq." + ownOrg
        ? { organization_id: ownOrg, role: navigationRole, organizations: { id: ownOrg, name: "Pilot" } } : null);
    }
    return json([{ organization_id: ownOrg, role: "owner", organizations: { id: ownOrg, name: "Pilot" } }]);
  };
  const { default: app } = await import("../src/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
const get = (path: string, token?: string) => nativeFetch(base + path, {
  headers: token ? { Authorization: "Bearer " + jwt(token), "X-Role": "organization_admin" } : {},
});
const post = (path: string, body: unknown, token?: string) => nativeFetch(base + path, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + jwt(token) } : {}),
  },
  body: JSON.stringify(body),
});
const patch = (path: string, body: unknown, token?: string) => nativeFetch(base + path, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + jwt(token) } : {}),
  },
  body: JSON.stringify(body),
});
const del = (path: string, body?: unknown, token?: string) => nativeFetch(base + path, {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + jwt(token) } : {}),
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

test("Bani navigation rechecks membership, role and record visibility using the caller's token", async () => {
  const endpoint = (org: string) => "/organizations/" + org + "/ai/navigation/resolve";
  const target = { destination: "collection", record: navigationCollection };
  assert.equal((await post(endpoint(ownOrg), target)).status, 401);
  assert.equal((await post(endpoint(otherOrg), target, "valid")).status, 404);
  const available = await post(endpoint(ownOrg), target, "valid");
  assert.equal(available.status, 200);
  assert.equal(available.headers.get("cache-control"), "no-store");
  assert.deepEqual(await available.json(), { path: `/app/org/${ownOrg}/collections/${navigationCollection}` });
  try {
    navigationRecordVisible = false;
    assert.equal((await post(endpoint(ownOrg), target, "valid")).status, 404);
    navigationRole = "member";
    assert.equal((await post(endpoint(ownOrg), { destination: "audit_logs" }, "valid")).status, 403);
    assert.equal((await post(endpoint(ownOrg), { destination: "new_expense" }, "valid")).status, 403);
  } finally {
    navigationRole = "owner";
    navigationRecordVisible = true;
  }
});

test("Bani navigation returns a feature-specific response when the backend flag is off", async () => {
  const { env } = await import("../src/constants/env");
  const previous = env.BANI_SMART_NAVIGATION;
  env.BANI_SMART_NAVIGATION = "false";
  try {
    const response = await post(`/organizations/${ownOrg}/ai/navigation/resolve`, { destination: "collections" }, "valid");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "navigation_unavailable");
  } finally {
    env.BANI_SMART_NAVIGATION = previous;
  }
});

test("Bani streams and persists report choices, then rejects unauthorized, stale, and unsupported selections", async () => {
  const thread = `/organizations/${ownOrg}/ai/conversations/${baniChatId}`;
  const response = await post(thread + "/chat", {
    prompt: "show me the reports",
    navigationPage: { pathname: `/app/org/${ownOrg}/overview`, search: "" },
  }, "valid");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const sse = await response.text();
  const events = sse.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  assert.equal(events[0].type, "text_delta");
  assert.equal(events[1].data.tool, "bani_actions");
  assert.match(sse, /\[DONE\]/);
  const reopened = await get(thread, "valid");
  const { messages } = await reopened.json();
  assert.deepEqual(messages.at(-1).tool_results, [events[1].data]);

  const submit = (action: unknown) => post(thread + "/chat", { prompt: "Chosen action", action }, "valid");
  assert.equal((await submit({ id: "approve_expense" })).status, 400);
  try {
    navigationRole = "member";
    assert.equal((await submit({ id: "unpaid_members", collectionId: navigationCollection })).status, 403);
    navigationRole = "owner";
    navigationRecordVisible = false;
    const rejected = await submit({ id: "collection_progress", collectionId: navigationCollection });
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).message, /collection is no longer available/);
    assert.equal((await post(`/organizations/${otherOrg}/ai/conversations/${baniChatId}/chat`,
      { prompt: "Chosen action", action: { id: "transparency" } }, "valid")).status, 404);
    assert.equal(baniMessages.length, 2, "Rejected actions should not alter conversation history");
  } finally {
    navigationRole = "owner";
    navigationRecordVisible = true;
  }
});

test("financial budget lookup streams data with clickable actions and resolves them against current access", async () => {
  const { streamChatResponse } = await import("../src/modules/ai/ai.service");
  const requests: Array<{ messages?: unknown }> = [];
  const client = { chat: { completions: { create: async function* (request: { messages?: unknown }) {
    requests.push(request);
    yield { choices: [{ delta: requests.length === 1
      ? { tool_calls: [{ index: 0, id: "budget", function: { name: "list_budgets_and_burn_rate", arguments: "{}" } }] }
      : { content: "Logistics has PHP 1,000 allocated." } }] };
  } } } } as unknown as Groq;
  const events = [];
  for await (const event of streamChatResponse(
    { role: "owner", organizationId: ownOrg, accessToken: jwt("valid"), userId },
    "Pilot", "Member", [], "What are our budget allocations?", undefined, undefined, client, undefined, undefined,
    { pathname: `/app/org/${ownOrg}/overview`, search: "" },
  )) events.push(event);
  const result = events.find(event => event.type === "tool_result")?.data.result;
  assert.equal(result.kind, "financial_navigation");
  assert.equal(result.data[0].name, "Logistics Budget");
  assert.deepEqual(result.navigation.page, { target: { destination: "budgets" }, label: "Budgets", immediate: false });
  assert.deepEqual(result.navigation.records, { destination: "budget", ids: [navigationBudget] });
  assert.match(JSON.stringify(requests[1].messages), /Omit row-by-row restatements and tables/);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /"kind":"financial_navigation"/);
  const target = { destination: result.navigation.records.destination, record: result.navigation.records.ids[0] };
  const endpoint = `/organizations/${ownOrg}/ai/navigation/resolve`;
  const open = await post(endpoint, target, "valid");
  assert.deepEqual(await open.json(), { path: `/app/org/${ownOrg}/budgets?budget=${navigationBudget}` });
  navigationRecordVisible = false;
  try {
    assert.equal((await post(endpoint, target, "valid")).status, 404);
  } finally {
    navigationRecordVisible = true;
  }
});
test("health works without authenticating", async () => {
  assert.equal((await get("/health")).status, 200);
});
test("the app caches allowed authorization preflights", async () => {
  const response = await nativeFetch(base + "/user", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(response.headers.get("access-control-max-age"), "600");
});
test("protected endpoints reject missing and invalid tokens", async () => {
  for (const path of ["/user", "/organizations", "/organizations/" + ownOrg]) {
    assert.equal((await get(path)).status, 401);
    assert.equal((await get(path, "invalid")).status, 401);
  }
});
test("unverified users are denied", async () => {
  assert.equal((await get("/user", "unverified")).status, 403);
});
test("profile identity comes from verified Auth response", async () => {
  const response = await get("/user", "valid");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.id, userId);
  assert.equal(data.displayName, "@studentuser");
  assert.equal(data.username,"studentuser");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("registration validates structured identity on the server while birthdate remains optional",async()=>{
  const body={firstName:" José ",middleName:"",lastName:"Dela Cruz",username:"NewUser1",email:"new@example.test",password:"SampleStrong!42",captchaToken:"test-captcha"};
  assert.equal((await post("/auth/register",body)).status,204);
  assert.equal((await post("/auth/register",{...body,firstName:"123"})).status,400);
  assert.equal((await post("/auth/register",{...body,birthdate:"2025-02-29"})).status,400);
  assert.equal((await post("/auth/register",{...body,password:"password"})).status,400);
});
test("organization reads scope by actor and ignore client roles", async () => {
  const response = await get("/organizations/" + ownOrg, "valid");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).membership.role, "owner");
  assert.equal((await get("/organizations/" + otherOrg, "valid")).status, 404);
});
test("organization list recovers when the embedded relationship is unavailable", async () => {
  membershipRelationshipFailure = true;
  try {
    const response = await get("/organizations", "valid");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memberships[0].organizations.id, ownOrg);
  } finally {
    membershipRelationshipFailure = false;
  }
});
test("unexpected membership database errors surface without the compatibility fallback", async () => {
  membershipDatabaseFailure = true;
  try {
    for (const path of ["/organizations", "/organizations/" + ownOrg]) {
      const response = await get(path, "valid");
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /Internal query timeout|57014/);
    }
  } finally {
    membershipDatabaseFailure = false;
  }
});
test("invalid IDs are rejected before database access", async () => {
  assert.equal((await get("/organizations/not-a-uuid", "valid")).status, 400);
});
test("directory writes return field errors for unknown, mistyped and invalid-choice attributes", async () => {
  for (const attributes of [{ student_id: 7 }, { removed_field: "value" }, { department: "Invalid" }]) {
    const response = await post(`/organizations/${ownOrg}/directory`, {
      display_name: "Offline member", member_code: null, email: null, phone: null, attributes,
    }, "valid");
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.issues[0].field.startsWith("attributes."));
  }
  const response = await post(`/organizations/${otherOrg}/directory`, {
    display_name: "Unauthorized", member_code: null, email: null, phone: null,
  }, "valid");
  assert.equal(response.status, 403);
});
test("self-service organization creation assigns owner role", async () => {
  const res = await post("/organizations", { name: "New Student Council", currency: "PHP", organizationType: "student", requestId: userId }, "valid");
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.organization.name, "New Student Council");
  assert.equal(data.organization.role, "owner");
  assert.equal(data.organization.currency, "PHP");
  assert.ok(data.organization.invite_code);
});
test("self-service organization creation validates input", async () => {
  const res = await post("/organizations", { name: " " }, "valid");
  assert.equal(res.status, 400);
});
test("self-service join organization with invite code", async () => {
  const res = await post("/organizations/join", { code: "valid123" }, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.organization.role, "member");
});
test("self-service join organization rejects bad code", async () => {
  const res = await post("/organizations/join", { code: "wrongcode" }, "valid");
  assert.equal(res.status, 400);
});
test("organization member roster returns active members for member", async () => {
  const res = await get("/organizations/" + ownOrg + "/members", "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.members.length, 1);
  assert.equal(data.members[0].role, "owner");
});
test("organization reporting periods list and create", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/periods", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.periods.length, 1);
  assert.equal(listData.periods[0].name, "AY 2026-2027 Sem 1");

  const createRes = await post(
    "/organizations/" + ownOrg + "/periods",
    { name: "Q1 2026", startDate: "2026-01-01", endDate: "2026-03-31", isDefault: false },
    "valid"
  );
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.period.name, "Q1 2026");
});
test("organization spaces list and create", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/spaces", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.spaces.length, 1);
  assert.equal(listData.spaces[0].name, "Annual Summit 2026");

  const createRes = await post(
    "/organizations/" + ownOrg + "/spaces",
    { name: "Tech Symposium", description: "Department initiative" },
    "valid"
  );
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.space.name, "Tech Symposium");
});
test("organization collections list and create", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/collections", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.collections.length, 1);
  assert.equal(listData.collections[0].title, "Semester Membership Dues");

  const createRes = await post(
    "/organizations/" + ownOrg + "/collections",
    {
      title: "Science Fair Dues",
      targetCentavos: 100000,
      assignAll: true,
      defaultObligationCentavos: 50000,
    },
    "valid"
  );
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.collection.title, "Science Fair Dues");
  assert.equal(createData.collection.assigned_obligations_count, 1);
});
test("organization collection obligations list", async () => {
  const res = await get("/organizations/" + ownOrg + "/collections/aaaa1111-1111-4111-8111-111111111111/obligations", "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.obligations.length, 1);
  assert.equal(data.obligations[0].amount_centavos, 50000);
});
test("payment recording and reversal workflow", async () => {
  const payRes = await post(
    "/organizations/" + ownOrg + "/payments",
    {
      obligationId: "bbbb2222-2222-4222-8222-222222222222",
      amountCentavos: 50000,
      paymentMethod: "cash",
      idempotencyKey: "test-key-123",
    },
    "valid"
  );
  assert.equal(payRes.status, 201);
  const payData = await payRes.json();
  assert.equal(payData.payment.receipt_number, "RCP-2026-0001");
  assert.equal(payData.payment.status, "completed");

  const revRes = await post(
    "/organizations/" + ownOrg + "/payments/cccc3333-3333-4333-8333-333333333333/reverse",
    { reason: "Incorrect cash amount tendered" },
    "valid"
  );
  assert.equal(revRes.status, 200);
  const revData = await revRes.json();
  assert.equal(revData.payment.status, "reversed");
  assert.equal(revData.payment.reversal_reason, "Incorrect cash amount tendered");
});
test("conflicting payment replay returns HTTP 409 without database details", async () => {
  const response = await post("/organizations/" + ownOrg + "/payments", {
    obligationId: "bbbb2222-2222-4222-8222-222222222222",
    amountCentavos: 50000,
    paymentMethod: "cash",
    idempotencyKey: "conflicting-payment",
  }, "valid");
  assert.equal(response.status, 409);
  const body = await response.text();
  assert.match(body, /already used with different payment details/i);
  assert.doesNotMatch(body, /Internal payment details|PT409/);
});
test("personal obligations endpoint returns user dues", async () => {
  const res = await get("/user/obligations", "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.obligations));
});
test("organization member role update", async () => {
  const patchRes = await nativeFetch(
    base + "/organizations/" + ownOrg + "/members/77777777-7777-4777-8777-777777777777/role",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + jwt("valid") },
      body: JSON.stringify({ role: "treasurer" }),
    }
  );
  assert.equal(patchRes.status, 200);
  const data = await patchRes.json();
  assert.equal(data.member.role, "treasurer");
});
test("organization budgets list and create", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/budgets", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.budgets.length, 1);
  assert.equal(listData.budgets[0].name, "Logistics Budget");

  const createRes = await post(
    "/organizations/" + ownOrg + "/budgets",
    { name: "Catering", allocatedCentavos: 50000 },
    "valid"
  );
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.budget.name, "Catering");
});
test("expense attachment JSON is parsed after authentication with a bounded upload limit", async () => {
  const path = "/organizations/" + ownOrg + "/expenses";
  const request = (token: string, size: number) => fetch(base + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt(token), "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(size) }),
  });
  assert.equal((await request("invalid", 600_000)).status, 401);
  // The payload reaches input validation instead of the normal 512 KiB parser.
  assert.equal((await request("valid", 600_000)).status, 400);
  assert.equal((await request("valid", 4_500_000)).status, 413);
});

test("organization expenses submit and review", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/expenses", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.expenses.length, 1);
  assert.equal(listData.expenses[0].title, "Sound System Rental");

  const submitRes = await post(
    "/organizations/" + ownOrg + "/expenses",
    {
      title: "Chairs",
      amountCentavos: 10000,
      category: "supplies",
      incurredDate: "2026-11-12",
    },
    "valid"
  );
  assert.equal(submitRes.status, 201);
  const submitData = await submitRes.json();
  assert.equal(submitData.expense.title, "Chairs");

  const revRes = await post(
    "/organizations/" + ownOrg + "/expenses/eeee5555-5555-4555-8555-555555555555/review",
    { decision: "approved", expectedRevision: 1, notes: "Approved by treasurer" },
    "valid"
  );
  assert.equal(revRes.status, 200);
  const revData = await revRes.json();
  assert.equal(revData.review.status, "approved");
});
test("organization cash advances and liquidation", async () => {
  const listRes = await get("/organizations/" + ownOrg + "/advances", "valid");
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.advances.length, 1);
  assert.equal(listData.advances[0].title, "Event Float");

  const advRes = await post(
    "/organizations/" + ownOrg + "/advances",
    {
      accountablePersonId: "77777777-7777-4777-8777-777777777777",
      title: "Snack Float",
      purpose: "Buying juice and cups",
      amountCentavos: 15000,
      disbursementMethod: "cash",
    },
    "valid"
  );
  assert.equal(advRes.status, 201);
  const advData = await advRes.json();
  assert.equal(advData.advance.title, "Snack Float");

  const liqRes = await post(
    "/organizations/" + ownOrg + "/liquidations",
    {
      cashAdvanceId: "ffff6666-6666-4666-8666-666666666666",
      spentCentavos: 10000,
      returnedCentavos: 5000,
    },
    "valid"
  );
  assert.equal(liqRes.status, 201);
  const liqData = await liqRes.json();
  assert.equal(liqData.liquidation.status, "submitted");

  const liqRevRes = await post(
    "/organizations/" + ownOrg + "/liquidations/12121212-1212-4212-8212-121212121212/review",
    { decision: "approved", expectedRevision: 1, notes: "Reconciliation verified" },
    "valid"
  );
  assert.equal(liqRevRes.status, 200);
});
test("organization audit logs and financial summary", async () => {
  const logsRes = await get("/organizations/" + ownOrg + "/audit-logs", "valid");
  assert.equal(logsRes.status, 200);
  const logsData = await logsRes.json();
  assert.equal(logsData.auditLogs.length, 1);

  const sumRes = await get("/organizations/" + ownOrg + "/summary", "valid");
  assert.equal(sumRes.status, 200);
  const sumData = await sumRes.json();
  assert.ok("total_collected_centavos" in sumData.summary);
});
test("database errors do not expose internal details", async () => {
  storageFailure = true;
  try {
    const response = await get("/organizations", "valid");
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /internal database details|42P01/);
  } finally { storageFailure = false; }
});

test('period filters reach the organization-scoped financial queries', async () => {
  const period = '88888888-8888-4888-8888-888888888888';
  for (const kind of ['collections', 'budgets', 'expenses']) {
    observedFinancialQueries = [];
    const response = await fetch(`${base}/organizations/${ownOrg}/${kind}?periodId=${period}`, { headers: { Authorization: "Bearer " + jwt("valid") } });
    assert.equal(response.status, 200);
    assert.ok(observedFinancialQueries.some(url => url.pathname === `/rest/v1/${kind}` && url.searchParams.get('organization_id') === `eq.${ownOrg}` && url.searchParams.get('reporting_period_id') === `eq.${period}`));
  }
});
test('a failed payment query cannot produce a successful zero-valued summary', async () => {
  financialFailure = true;
  try {
    const response = await fetch(`${base}/organizations/${ownOrg}/summary`, { headers: { Authorization: "Bearer " + jwt("valid") } });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /Private database failure/);
  } finally { financialFailure = false; }
});

test("user avatar can be updated without reintroducing a global display name", async () => {
  assert.equal((await patch("/user/profile", {displayName:"Updated User"}, "valid")).status,400);
  const res = await patch("/user/profile", { avatarUrl: "https://example.com/avatar.jpg" }, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.profile.avatar_url, "https://example.com/avatar.jpg");
});

test("user preferences can be retrieved and updated", async () => {
  const getRes = await get("/user/preferences", "valid");
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.preferences.theme, "dark");

  const patchRes = await patch("/user/preferences", { theme: "system", reducedMotion: true }, "valid");
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.preferences.theme, "system");
  assert.equal(patchData.preferences.reduced_motion, true);
  const light = await patch("/user/preferences", { theme: "light" }, "valid");
  assert.equal(light.status, 200);
  assert.equal((await light.json()).preferences.theme, "light");
});

test("account onboarding completion validates the theme and requires authentication", async () => {
  const path = "/user/onboarding/complete";
  assert.equal((await post(path, { theme: "light" })).status, 401);
  assert.equal((await post(path, { theme: "sepia" }, "valid")).status, 400);
  const result = await post(path, { theme: "light" }, "valid");
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { theme: "light" });
});

test("user can leave an organization", async () => {
  const res = await post(`/user/organizations/${ownOrg}/leave`, {}, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});

test("user can request personal account deletion", async () => {
  const res = await post("/user/delete-account", {}, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});

test("organization deletability can be queried", async () => {
  const res = await get(`/organizations/${ownOrg}/deletability`, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.deletability.is_deletable, true);
});

test("organization ownership can be transferred", async () => {
  const targetMemberId = "77777777-7777-4777-8777-777777777777";
  const res = await post(`/organizations/${ownOrg}/transfer-ownership`, { targetMemberId, currentOwnerRole: "organization_admin" }, "valid");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.result.success, true);
});

test("organization deletion requires exact matching confirmation name", async () => {
  const badRes = await del(`/organizations/${ownOrg}`, { confirmName: "Wrong Name" }, "valid");
  assert.equal(badRes.status, 400);

  const goodRes = await del(`/organizations/${ownOrg}`, { confirmName: "Pilot" }, "valid");
  assert.equal(goodRes.status, 200);
  const data = await goodRes.json();
  assert.equal(data.success, true);
});

test('summary uses one accounting RPC and exposes timings', async () => {
  artificialDelay = 100; peakReads = 0;
  try {
    const response = await fetch(`${base}/organizations/${ownOrg}/summary`, { headers: { Authorization: "Bearer " + jwt("valid") } });
    assert.equal(response.status, 200);
    assert.equal(peakReads, 1);
    assert.match(response.headers.get('server-timing') || '', /auth;dur=/);
    assert.match(response.headers.get('server-timing') || '', /app;dur=/);
  } finally { artificialDelay = 0; }
});
test("collection list loads totals from the database aggregate", async () => {
  const response = await get("/organizations/" + ownOrg + "/collections", "valid");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).collections[0].total_expected_centavos, 50000);
});
test('failed collection aggregates never become successful zero totals', async () => {
  financialFailure = true;
  try {
    const response = await fetch(`${base}/organizations/${ownOrg}/collections`, { headers: { Authorization: "Bearer " + jwt("valid") } });
    assert.equal(response.status, 503);
  } finally { financialFailure = false; }
});


test("member financial overview enforces organization capabilities and declares all-period scope", async () => {
  const endpoint = "/directory/bbbb2222-2222-4222-8222-222222222222/financial-summary";
  const allowed = await get("/organizations/" + ownOrg + endpoint, "valid");
  assert.equal(allowed.status,200);
  const data = await allowed.json();
  assert.equal(data.scope,"all_periods");
  assert.equal(data.summaries[0].remaining_centavos,"50000");
  assert.equal((await get("/organizations/" + otherOrg + endpoint,"valid")).status,403);
});


test("collection roster accepts bounded server pages and search filters", async () => {
  const res=await get(`/organizations/${ownOrg}/collections/aaaa1111-1111-4111-8111-111111111111/obligations?page=1&q=Student`,"valid");
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.obligations.length,1);
  assert.equal(data.hasMore,false);
  assert.equal((await get(`/organizations/${ownOrg}/collections/aaaa1111-1111-4111-8111-111111111111/obligations?page=-1`,"valid")).status,400);
});


test("directory searches displayed student IDs and keeps listing when export capability fails", async () => {
  const path = `/organizations/${ownOrg}/directory?q=00041`;
  failDirectoryExportCapability = true;
  try {
    const response = await get(path, "valid");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.members[0].attributes.student_id, "00041");
    assert.equal(data.total, 1);
    assert.equal(data.canExport, false);
    assert.equal(data.canEdit, true);
    assert.equal((await get(`/organizations/${otherOrg}/directory?q=00041`, "valid")).status, 403);
  } finally {
    failDirectoryExportCapability = false;
  }
});

test("directory summary separates zero eligible members from two archived identities", async () => {
  const res=await get(`/organizations/${ownOrg}/directory/summary`,"valid");
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{total:0,active:0,archived:2,groups:0});
});

test("legacy workspace dues assignment cannot create obligations", async () => {
  const res=await post(`/organizations/${ownOrg}/collections/aaaa1111-1111-4111-8111-111111111111/obligations`,{memberId:userId,amountCentavos:25000},"valid");
  assert.equal(res.status,410);
});


test("member deletion is scoped and blocks financial dependencies", async () => {
  const protectedPath=`/organizations/${ownOrg}/directory/bbbb2222-2222-4222-8222-222222222222`;
  assert.equal((await get(protectedPath+"/delete-preview","valid")).status,200);
  assert.equal((await del(protectedPath,undefined,"valid")).status,409);
  assert.equal((await del(`/organizations/${ownOrg}/directory/cccc3333-3333-4333-8333-333333333333`,undefined,"valid")).status,204);
  assert.equal((await del(`/organizations/${otherOrg}/directory/cccc3333-3333-4333-8333-333333333333`,undefined,"valid")).status,403);
});


test("scope preview and confirmation validate review, scope and changed assessments",async()=>{
 const endpoint=`/organizations/${ownOrg}/collections/aaaa1111-1111-4111-8111-111111111111/dues-assignment`;
 const payload={scope:"all",amountCentavos:25000};
 const preview=await post(endpoint+"/preview",payload,"valid");assert.equal(preview.status,200);assert.equal((await preview.json()).assigned,0);
 assert.equal((await post(endpoint+"/confirm",payload,"valid")).status,400);
 const changed=await post(endpoint+"/confirm",{...payload,token:"a".repeat(32)},"valid");assert.equal(changed.status,409);assert.equal((await changed.json()).preview.newAssignments,1);
 const confirmed=await post(endpoint+"/confirm",{...payload,token:"b".repeat(32)},"valid");assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).assigned,1);
 assert.equal((await post(endpoint+"/preview",{scope:"invalid",amountCentavos:25000},"valid")).status,400);
 assert.equal((await post(`/organizations/${otherOrg}/collections/aaaa1111-1111-4111-8111-111111111111/dues-assignment/preview`,payload,"valid")).status,403);
});


test("organization onboarding rejects unsupported currencies and blank names before creation",async()=>{
 const basePayload={name:"New organization",organizationType:"other",requestId:"aaaaaaaa-aaaa-4aaa-8aaa-111111111111",currency:"PHP"};
 assert.equal((await post("/organizations",{...basePayload,currency:"ZZZ"},"valid")).status,400);
 assert.equal((await post("/organizations",{...basePayload,name:"   "},"valid")).status,400);
 assert.equal((await post("/organizations",{...basePayload,organizationType:""},"valid")).status,400);
});

test("collection reports enforce export scope and separate detailed data from summary", async () => {
  const route = `/organizations/${ownOrg}/collections/aaaa1111-1111-4111-8111-111111111111/export`;
  const detailed = await get(route, "valid");
  assert.equal(detailed.status, 200);
  const csv = await detailed.text();
  assert.match(csv, /"Full Name","Student ID","Department"/);
  assert.match(csv, /"Sample Member","00041","'=Editorial","250.00","100.00","150.00","Partially Paid"/);
  assert.match(csv, /"Unassessed Member","00041","'=Editorial","","","","Not Assessed"/);
  const summary = await get(route + "?mode=summary&status=not_assessed", "valid");
  assert.equal(summary.status, 200);
  const summaryCsv = await summary.text();
  assert.match(summaryCsv, /"Unassessed Member","","","","Not Assessed"/);
  assert.doesNotMatch(summaryCsv, /Member ID|Student ID|Department|Editorial|Partially Paid/);
  const filter = "?paidMin=10000&balanceMax=15000";
  const filteredExport = await get(route + filter, "valid");
  assert.equal(filteredExport.status, 200);
  assert.doesNotMatch(await filteredExport.text(), /Unassessed Member/);
  const filteredRoster = await get(route.replace("/export", "/members") + filter, "valid");
  assert.equal(filteredRoster.status, 200);
  assert.equal((await filteredRoster.json()).rows.length, 1);
  assert.equal((await get(route + "?balanceMin=2&balanceMax=1", "valid")).status, 400);
  assert.equal((await get(route.replace(ownOrg,otherOrg), "valid")).status, 403);
  denyDirectoryExport = true;
  try {
    assert.equal((await get(route, "valid")).status, 403);
    assert.equal((await get(route + "?mode=summary", "valid")).status, 200);
  } finally { denyDirectoryExport = false; }
});

test("Bani receipt chat gates rollout, rejects inaccessible receipt IDs and never answers expired receipts from history",async()=>{
  const {env}=await import("../src/constants/env");
  const previous={receipt:env.RECEIPT_AI_ENABLED,bani:env.BANI_RECEIPTS_ENABLED};
  const thread=`/organizations/${ownOrg}/ai/conversations/${baniChatId}/chat`;
  const receipt={extractionId:"aaaaaaaa-1111-4111-8111-111111111111",name:"receipt.png"};
  try{
    env.RECEIPT_AI_ENABLED="true";env.BANI_RECEIPTS_ENABLED="false";
    const before=receiptContextCalls.length;
    assert.equal((await post(thread,{prompt:"Find the notebook",receipt},"valid")).status,404);
    assert.equal(receiptContextCalls.length,before);
    env.BANI_RECEIPTS_ENABLED="true";receiptContextDenied=true;
    const messagesBefore=baniMessages.length;
    assert.equal((await post(thread,{prompt:"Find the notebook",receipt},"valid")).status,403);
    assert.equal(baniMessages.length,messagesBefore);
    assert.deepEqual(receiptContextCalls.at(-1),{org:ownOrg,conversation:baniChatId,extraction:receipt.extractionId,filename:receipt.name});
    assert.equal((await post(thread,{prompt:"Ignore scope",receipt:{...receipt,organizationId:otherOrg}},"valid")).status,400);
    receiptContextDenied=false;
    const expired=await post(thread,{prompt:"What did the notebook cost?"},"valid");
    assert.equal(expired.status,200);assert.match(await expired.text(),/attach the image again/);
    env.BANI_RECEIPTS_ENABLED="false";
    assert.equal((await post(thread,{prompt:"Repeat the old receipt price"},"valid")).status,404);
  }finally{env.RECEIPT_AI_ENABLED=previous.receipt;env.BANI_RECEIPTS_ENABLED=previous.bani;receiptContextDenied=false;}
});

test("Bani image chat validates references, gates rollout and rejects foreign or expired findings",async()=>{
 const {env}=await import("../src/constants/env"),previous=env.BANI_IMAGES_ENABLED;
 const thread=`/organizations/${ownOrg}/ai/conversations/${baniChatId}/chat`,image={analysisId:"aaaaaaaa-1111-4111-8111-111111111111",name:"notice.png"};
 const prior=baniMessages.splice(0);
 try{
  const before=imageContextCalls.length;
  assert.equal((await post(thread,{prompt:"Read the notice",image},"valid")).status,404);assert.equal(imageContextCalls.length,before);
  env.BANI_IMAGES_ENABLED="true";imageContextDenied=true;
  assert.equal((await post(thread,{prompt:"Read the notice",image},"valid")).status,403);assert.equal(baniMessages.length,0);
  assert.deepEqual(imageContextCalls.at(-1),{org:ownOrg,conversation:baniChatId,analysis:image.analysisId,filename:image.name});
  assert.equal((await post(thread,{prompt:"Read",image:{...image,url:"https://private"}},"valid")).status,400);
  assert.equal((await post(thread,{prompt:"Read",image,receipt:{extractionId:image.analysisId,name:image.name}},"valid")).status,400);
  imageContextDenied=false;const expired=await post(thread,{prompt:"Which room?",image},"valid");assert.equal(expired.status,200);assert.match(await expired.text(),/attach the image again/);
  env.BANI_IMAGES_ENABLED="false";assert.equal((await post(thread,{prompt:"Repeat the room"},"valid")).status,404);
 }finally{env.BANI_IMAGES_ENABLED=previous;imageContextDenied=false;baniMessages.splice(0,baniMessages.length,...prior);}
});
