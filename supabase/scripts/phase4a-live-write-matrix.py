"""Run only against the dedicated disposable Bantai Supabase stack.

Usage: python phase4a-live-write-matrix.py <local-status.json>
Dependencies: psycopg 3, local fixture PostgreSQL password via PGPASSWORD.
Creates fresh synthetic users and workspaces per run and retains all records.
"""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

import psycopg

cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
base = cfg["API_URL"]
assert base == "http://127.0.0.1:55321", "Expected dedicated isolated API"
assert cfg["DB_URL"].split("@")[-1] == "127.0.0.1:55322/postgres", "Unexpected database"
key = cfg["PUBLISHABLE_KEY"]
secret = cfg["SECRET_KEY"]
run = uuid4().hex
roles = {"owner": "owner", "treasurer": "treasurer", "admin": "organization_admin",
         "member": "member", "suspended": "organization_admin", "departed": "organization_admin",
         "foreign": "owner"}
ids = {}
tokens = {}
org, foreign_org = (str(uuid4()), str(uuid4()))


def request(path, body, token=None, admin=False):
    headers = {"apikey": secret if admin else key, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(base + path, json.dumps(body).encode(), headers, method="POST")
    try:
        with urlopen(req, timeout=12) as response:
            data = response.read()
            return response.status, json.loads(data) if data else None
    except HTTPError as error:
        return error.code, None


def rpc(name, role, args, allowed):
    before = ledger()
    status, data = request("/rest/v1/rpc/" + name, args, tokens.get(role))
    unchanged = ledger() == before
    ok = (200 <= status < 300) if allowed else (400 <= status < 500 and unchanged)
    print(json.dumps({"rpc": name, "role": role, "http": status, "allowed": allowed,
                      "unchanged": unchanged, "result": "PASS" if ok else "FAIL"}), flush=True)
    assert ok, f"{name} {role}: unexpected status or database side effect"
    return data


# Snapshot both tenants' complete records on each denied attempt.
relation_names = ("organizations", "organization_members", "budgets", "expenses", "approvals",
                  "cash_advances", "liquidations", "liquidation_reconciliations",
                  "liquidation_expense_allocations", "liquidation_resolution_entries",
                  "workspace_history_entitlements", "workspace_history_revocations", "audit_logs",
                  "collections", "obligations", "payments", "cash_advance_requests",
                  "budget_amendments", "organization_invitations", "receipt_counters", "expense_submission_requests")


def ledger():
    snapshots = [db.execute(
        f"select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') "
        f"from public.{table} t where {'id' if table == 'organizations' else 'organization_id'} in (%s,%s)",
        (org, foreign_org)).fetchone()[0] for table in relation_names]
    snapshots.append(db.execute("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.profiles p where id=any(%s::uuid[])",
                                (list(ids.values()),)).fetchone()[0])
    return snapshots


def blocked(name, args, extra=()):
    for role in ("anonymous", "foreign", "departed", "suspended", *extra):
        rpc(name, role, args, False)


with psycopg.connect(cfg["DB_URL"], autocommit=True) as db:
    assert db.execute("select to_regclass('public.workspace_history_entitlements') is not null").fetchone()[0]
    for actor, role in roles.items():
        email = f"batch-{run}-{actor}@pilot.example.com"
        password = f"Isolated-{run}!9"
        status, user = request("/auth/v1/admin/users", {"email": email, "password": password, "email_confirm": True}, admin=True)
        assert status in (200, 201), f"Could not create synthetic {actor}: {status}"
        ids[actor] = user["id"]
        status, login = request("/auth/v1/token?grant_type=password", {"email": email, "password": password})
        assert status == 200
        tokens[actor] = login["access_token"]
    with db.transaction():
        db.execute("insert into organizations(id,name) values (%s,%s),(%s,%s)",
                   (org, f"Authorization pilot {run}", foreign_org, f"Foreign pilot {run}"))
        for actor, role in roles.items():
            db.execute("""insert into organization_members(organization_id,profile_id,role,status,can_submit_expenses)
                values (%s,%s,%s,%s,%s)""", (foreign_org if actor == "foreign" else org, ids[actor], role,
                                            "left" if actor == "departed" else "active", actor == "member"))
        db.execute("update profiles set suspended_at=now() where id=%s", (ids["suspended"],))
    membership = db.execute("select id from organization_members where organization_id=%s and profile_id=%s",
                            (org, ids["member"])).fetchone()[0]

    rpc("create_budget", "foreign", {
        "p_org_id": foreign_org, "p_name": "Foreign synthetic budget", "p_allocated_centavos": 10000,
    }, True)
    admin_membership = db.execute("select id from organization_members where organization_id=%s and profile_id=%s",
                                  (org, ids["admin"])).fetchone()[0]
    escalation = {"p_membership_id": str(admin_membership), "p_new_role": "owner"}
    blocked("update_member_role", escalation, ("member", "treasurer", "admin"))
    ordinary_change = {"p_membership_id": str(membership), "p_new_role": "auditor"}
    rpc("update_member_role", "owner", ordinary_change, True)
    rpc("update_member_role", "owner", {**ordinary_change, "p_new_role": "member"}, True)

    def check_fields(result):
        assert isinstance(result, dict)
        assert not {"review_notes", "reviewed_by", "approved_by", "verified_by", "receipt_url"} & result.keys()

    submit = {"p_org_id": org, "p_title": "Synthetic expense", "p_amount_centavos": 170000,
              "p_category": "supplies", "p_incurred_date": "2026-11-15"}
    blocked("submit_expense", submit)
    expense = rpc("submit_expense", "member", submit, True)["id"]
    reviewed_submit = {"org": org, "request_id": str(uuid4()), "draft": {
        "title": "Replay permission fixture", "amountCentavos": 100, "category": "supplies",
        "incurredDate": "2026-11-15",
    }}
    blocked("submit_reviewed_expense", reviewed_submit)
    own_submission = rpc("submit_reviewed_expense", "member", reviewed_submit, True)
    before = ledger()
    assert rpc("submit_reviewed_expense", "member", reviewed_submit, True) == own_submission
    assert ledger() == before
    submission_permission = {"p_org_id": org, "p_member_id": str(membership), "p_allowed": False}
    blocked("set_member_expense_submission", submission_permission, ("member", "treasurer"))
    rpc("set_member_expense_submission", "owner", submission_permission, True)
    rpc("submit_reviewed_expense", "member", reviewed_submit, False)
    rpc("set_member_expense_submission", "owner", {**submission_permission, "p_allowed": True}, True)
    for decision in ("verified", "approved"):
        args = {"p_org_id": org, "p_expense_id": expense, "p_decision": decision,
                "p_notes": "Synthetic review", "p_expected_revision": 1}
        blocked("review_expense", args, ("member",))
        check_fields(rpc("review_expense", "admin", args, True))

    advance_args = {"p_org_id": org, "p_accountable_person_id": str(membership),
                    "p_title": "Synthetic cash advance", "p_purpose": "Pilot logistics",
                    "p_amount_centavos": 100000, "p_disbursement_method": "cash"}
    blocked("create_cash_advance", advance_args, ("member",))
    advance = rpc("create_cash_advance", "treasurer", advance_args, True)["id"]
    liquidation_args = {"p_org_id": org, "p_cash_advance_id": advance, "p_spent_centavos": 60000,
                        "p_returned_centavos": 30000, "p_notes": "Synthetic shortage"}
    blocked("submit_liquidation", liquidation_args)
    settlement = rpc("submit_liquidation", "member", liquidation_args, True)["id"]
    review = {"p_org_id": org, "p_liquidation_id": settlement, "p_decision": "approved", "p_notes": "Approved synthetic shortage"}
    blocked("review_liquidation", review, ("member",))
    check_fields(rpc("review_liquidation", "admin", review, True))
    reconcile = {"org": org, "settlement": settlement, "links": [], "reason": "No overlapping expense"}
    blocked("confirm_liquidation_reconciliation", reconcile, ("member", "treasurer"))
    rpc("confirm_liquidation_reconciliation", "admin", reconcile, True)
    resolve = {"org": org, "settlement": settlement, "request_id": str(uuid4()),
               "entry_kind": "recovery", "amount": 10000, "reason": "Synthetic return"}
    blocked("record_liquidation_resolution", resolve, ("member", "treasurer"))
    rpc("record_liquidation_resolution", "owner", resolve, True)
    assert db.execute("""select spent,returned,unsettled,discrepancy,overlap
                        from advance_accounting where id=%s""", (advance,)).fetchone() == (60000, 40000, 0, 0, 0)

    collection = rpc("create_collection", "owner", {"p_org_id": org, "p_title": "Payment fixture"}, True)["id"]
    directory_id = db.execute("insert into organization_directory_members(organization_id,display_name) values (%s,'Synthetic payer') returning id", (org,)).fetchone()[0]
    assign = {"target_org": org, "target_collection": collection, "target_members": [str(directory_id)],
              "assessed_centavos": 1000}
    blocked("assign_directory_obligations", assign, ("member",))
    rpc("assign_directory_obligations", "treasurer", assign, True)
    obligation = str(db.execute("select id from obligations where organization_id=%s and collection_id=%s",
                                (org, collection)).fetchone()[0])
    payment = {"p_org_id": org, "p_obligation_id": obligation, "p_amount_centavos": 400,
               "p_payment_method": "cash", "p_idempotency_key": str(uuid4())}
    blocked("record_payment", payment, ("member",))
    first_payment = rpc("record_payment", "treasurer", payment, True)
    before_replay = ledger()
    replay = rpc("record_payment", "treasurer", payment, True)
    assert replay["id"] == first_payment["id"] and replay["is_duplicate_replay"] is True
    assert ledger() == before_replay
    blocked("record_payment", payment, ("member",))
    treasurer_membership = str(db.execute(
        "select id from organization_members where organization_id=%s and profile_id=%s",
        (org, ids["treasurer"])).fetchone()[0])
    downgrade = {"p_membership_id": treasurer_membership, "p_new_role": "member"}
    rpc("update_member_role", "owner", downgrade, True)
    rpc("record_payment", "treasurer", payment, False)
    rpc("update_member_role", "owner", {**downgrade, "p_new_role": "treasurer"}, True)
    payment_id = str(db.execute("select id from payments where organization_id=%s and obligation_id=%s", (org, obligation)).fetchone()[0])
    assert db.execute("select status from obligations where id=%s", (obligation,)).fetchone()[0] == "partially_paid"
    reversal = {"p_org_id": org, "p_payment_id": payment_id, "p_reason": "Synthetic correction"}
    blocked("reverse_payment", reversal, ("member",))
    rpc("reverse_payment", "admin", reversal, True)
    assert db.execute("select status from payments where id=%s", (payment_id,)).fetchone()[0] == "reversed"
    assert db.execute("select status from obligations where id=%s", (obligation,)).fetchone()[0] == "pending"

    def cash_args(action, request_id=None, **draft):
        return {"org": org, "request_id": request_id, "action": action, "draft": draft}
    create_request = cash_args("create", title="Synthetic request", purpose="Pilot", amountCentavos=250)
    blocked("manage_cash_advance_request", create_request)
    cash_request = rpc("manage_cash_advance_request", "member", create_request, True)
    unused = rpc("manage_cash_advance_request", "member", create_request, True)["id"]
    unused_cancel = {"org": org, "request_id": unused}
    blocked("delete_unused_cash_request", unused_cancel, ("treasurer",))
    rpc("delete_unused_cash_request", "member", unused_cancel, True)
    assert not db.execute("select exists(select 1 from cash_advance_requests where id=%s)", (unused,)).fetchone()[0]
    assert db.execute("select count(*) from audit_logs where entity_id=%s and action='cash_advance_requests.delete'",
                      (unused,)).fetchone()[0] == 1
    request_id = cash_request["id"]
    reject = cash_args("reject", request_id, revision=1)
    blocked("manage_cash_advance_request", reject, ("member", "treasurer"))
    assert rpc("manage_cash_advance_request", "admin", reject, True)["status"] == "rejected"
    revise = cash_args("revise", request_id, revision=2, title="Revised request", purpose="Pilot", amountCentavos=250)
    blocked("manage_cash_advance_request", revise, ("admin",))
    assert rpc("manage_cash_advance_request", "member", revise, True)["status"] == "pending"
    approve = cash_args("approve", request_id, revision=3)
    blocked("manage_cash_advance_request", approve, ("member", "treasurer"))
    assert rpc("manage_cash_advance_request", "owner", approve, True)["status"] == "approved"
    release = cash_args("release", request_id, revision=4, method="cash")
    blocked("manage_cash_advance_request", release, ("member",))
    released = rpc("manage_cash_advance_request", "treasurer", release, True)
    assert released["status"] == "released"
    rpc("manage_cash_advance_request", "treasurer", cash_args("release", request_id, revision=5, method="cash"), False)
    cancellation = {"org": org, "request_id": request_id}
    blocked("delete_unused_cash_request", cancellation, ("member", "owner"))
    return_request = rpc("submit_liquidation", "member", {
        **liquidation_args, "p_cash_advance_id": released["advance_id"],
        "p_spent_centavos": 0, "p_returned_centavos": 250,
    }, True)
    rpc("review_liquidation", "owner", {**review, "p_liquidation_id": return_request["id"]}, True)
    assert db.execute("select released,spent,returned,unsettled from advance_accounting where id=%s",
                      (released["advance_id"],)).fetchone() == (250, 0, 250, 0)

    budget = rpc("create_budget", "owner", {"p_org_id": org, "p_name": "Amendment fixture",
                                           "p_allocated_centavos": 10000}, True)["id"]
    db.execute("update organizations set approval_preset='balanced' where id=%s", (org,))
    amendment = {"org": org, "budget": budget, "expected": 10000, "proposed": 12000,
                 "explanation": "Synthetic allocation", "amendment": None, "decision": None}
    blocked("manage_budget_amendment", amendment, ("member",))
    change = rpc("manage_budget_amendment", "treasurer", amendment, True)
    assert change["status"] == "pending"
    decide = {**amendment, "amendment": change["id"], "decision": "approved"}
    blocked("manage_budget_amendment", decide, ("member", "treasurer"))
    assert rpc("manage_budget_amendment", "admin", decide, True)["status"] == "approved"
    assert db.execute("select allocated_amount_centavos from budgets where id=%s", (budget,)).fetchone()[0] == 12000

    invitation = {"p_org_id": org, "p_invited_email": f"invite-{run}@pilot.example.com", "p_role": "member"}
    blocked("create_organization_invitation", invitation, ("member", "treasurer"))
    rpc("create_organization_invitation", "admin", {**invitation, "p_role": "owner"}, False)
    rpc("create_organization_invitation", "admin", invitation, True)
    transfer = {"p_org_id": org, "p_target_member_id": str(admin_membership), "p_current_owner_role": "member"}
    blocked("transfer_organization_ownership", transfer, ("member", "treasurer", "admin"))
    owner_membership = str(db.execute("select id from organization_members where organization_id=%s and profile_id=%s",
                                      (org, ids["owner"])).fetchone()[0])
    rpc("update_member_role", "admin", {"p_membership_id": owner_membership, "p_new_role": "member"}, False)

    close = {"p_org_id": org}
    blocked("delete_organization", close, ("member", "admin", "treasurer"))
    rpc("delete_organization", "owner", close, True)
    assert db.execute("""select count(*) from workspace_history_entitlements
        where organization_id=%s and profile_id in (%s,%s)""", (org, ids["departed"], ids["foreign"])).fetchone()[0] == 0
    assert db.execute("select count(*) from audit_logs where organization_id=%s and action='organization_closed'", (org,)).fetchone()[0] == 1

    revoke = {"org": org, "subject": ids["member"]}
    blocked("revoke_workspace_history", revoke, ("member", "admin", "treasurer"))
    assert rpc("revoke_workspace_history", "owner", revoke, True) is True
    history = {"org": org, "kind": "expense"}
    assert rpc("closed_transaction_history", "member", history, True) == []



    # The main workspace is closed now. Exercise invitation and transfer on
    # the second populated workspace without changing earlier caller scopes.
    second_invitation = {"p_org_id": foreign_org,
                         "p_invited_email": f"batch-{run}-member@pilot.example.com",
                         "p_role": "member"}
    rpc("create_organization_invitation", "foreign", second_invitation, True)
    invitation_id = str(db.execute("select id from organization_invitations where organization_id=%s",
                                   (foreign_org,)).fetchone()[0])
    accept = {"p_invitation_id": invitation_id, "p_accept": True}
    for actor in ("anonymous", "owner", "treasurer", "admin", "departed", "suspended", "foreign"):
        rpc("respond_organization_invitation", actor, accept, False)
    assert rpc("respond_organization_invitation", "member", accept, True)["status"] == "accepted"
    rpc("respond_organization_invitation", "member", accept, False)
    target = str(db.execute("select id from organization_members where organization_id=%s and profile_id=%s",
                            (foreign_org, ids["member"])).fetchone()[0])
    change_owner = {"p_org_id": foreign_org, "p_target_member_id": target, "p_current_owner_role": "member"}
    for actor in ("anonymous", "owner", "treasurer", "admin", "departed", "suspended", "member"):
        rpc("transfer_organization_ownership", actor, change_owner, False)
    rpc("transfer_organization_ownership", "foreign", change_owner, True)
    assert db.execute("select profile_id::text from organization_members where organization_id=%s and role='owner' and status='active'",
                      (foreign_org,)).fetchall() == [(ids["member"],)]
    rpc("transfer_organization_ownership", "foreign", change_owner, False)
    for actor in ("anonymous", "owner", "treasurer", "admin", "member", "departed", "suspended", "foreign"):
        rpc("platform_admin_set_user_suspension", actor, {
            "p_target_user_id": ids["member"], "p_suspended": True, "p_reason": "Synthetic unauthorized probe",
        }, False)
