/* Usage: node supabase/scripts/phase4a-live-read-matrix.cjs fixture.json */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(new URL(fixture.url).origin, "http://127.0.0.1:55321");
const foreignOrg = "71000000-0000-4000-8000-000000000099";
const probes = [
  ["member_expense_transactions", org => ({ org })],
  ["member_advance_transactions", org => ({ org })],
  ["member_ledger_totals", org => ({ org })],
  ["workspace_financial_summary", org => ({ org })],
  ["workspace_budget_totals", org => ({ org, budgets: [] })],
  ["redacted_transaction_details", org => ({ org, kind: "expense" })],
  ["closed_transaction_history", org => ({ org, kind: "expense" })],
  ["get_organization_audit_logs", org => ({ p_org_id: org, p_limit: 2 })],
];
const empty = value => value === null || Array.isArray(value) && value.length === 0;
const restricted = /"(receipt_url|reference_number|review_notes|reconciliation_notes|accountable_person_id|vendor_name|profile_id)"\s*:/;

async function main() {
  let failures = 0;
  for (const [role, identity] of [...Object.entries(fixture.users), ["anonymous", null]]) {
    const headers = { apikey: fixture.key, "Content-Type": "application/json" };
    if (identity) {
      const response = await fetch(fixture.url + "/auth/v1/token?grant_type=password", {
        method: "POST", headers, body: JSON.stringify(identity),
      });
      assert.equal(response.status, 200);
      const { access_token } = await response.json();
      assert.ok(access_token);
      headers.Authorization = "Bearer " + access_token;
    }
    for (const scope of ["same", "foreign"]) {
      for (const [name, params] of probes) {
        try {
          const response = await fetch(fixture.url + "/rest/v1/rpc/" + name, {
            method: "POST", headers, body: JSON.stringify(params(scope === "same" ? fixture.org : foreignOrg)),
          });
          const data = await response.json();
          if (role === "anonymous") assert.ok(!response.ok);
          else if (scope === "foreign" || ["suspended", "departed"].includes(role)) {
            assert.ok(!response.ok || empty(data));
          } else if (name === "get_organization_audit_logs" && role === "member") {
            assert.ok(!response.ok);
          } else {
            assert.ok(response.ok);
            if (name === "closed_transaction_history") assert.ok(empty(data));
            if (name === "get_organization_audit_logs" && role === "admin") {
              assert.ok(data.every(row => row.before_value === null && row.after_value === null));
            }
            if (name !== "get_organization_audit_logs") assert.doesNotMatch(JSON.stringify(data), restricted);
            if (["member_ledger_totals", "workspace_financial_summary"].includes(name)) assert.ok(!empty(data));
          }
          console.log(JSON.stringify({ role, scope, name, status: response.status, outcome: "PASS" }));
        } catch {
          failures++;
          console.log(JSON.stringify({ role, scope, name, outcome: "FAIL" }));
        }
      }
    }
  }
  if (failures) process.exitCode = 1;
}
main().catch(() => { console.error("Matrix setup failed."); process.exitCode = 1; });
