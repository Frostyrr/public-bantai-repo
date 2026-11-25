"""Run against a fresh, disposable local PostgreSQL cluster on port 55439.

Requires psycopg 3. Creates roles and applies all migrations to the pilot database.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from time import sleep

import psycopg

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", default="postgres", help="Empty database in the disposable cluster")
args = parser.parse_args()
OWNER = "91000000-0000-4000-8000-000000000001"
ADMIN = "91000000-0000-4000-8000-000000000002"
ORG = "91000000-0000-4000-8000-000000000003"
MEMBER = "91000000-0000-4000-8000-000000000004"
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def new_session():
    return psycopg.connect(host="127.0.0.1", port=55439, user="postgres", dbname=args.database, autocommit=True)


def actor(conn, user):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub',%s,false)", (user,))


def race(first, second):
    barrier = Barrier(2)

    def run(job):
        sql, args = job
        with new_session() as conn:
            actor(conn, OWNER)
            conn.execute("set statement_timeout = '8s'")
            barrier.wait(timeout=10)
            try:
                conn.execute(sql, args)
            except psycopg.Error as error:
                return error.sqlstate
            return "ok"

    with ThreadPoolExecutor(2) as pool:
        return sorted(pool.map(run, (first, second)))


with new_session() as db:
    db.execute("""do $$begin
        if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
        if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
        end$$; create schema auth;
        create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
        create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;""")
    migrations = sorted(MIGRATIONS.glob("*.sql"))
    accounting = next(i for i, file in enumerate(migrations) if "liquidation_accounting" in file.name)
    for file in migrations[:accounting]:
        db.execute(file.read_text(encoding="utf-8"))

    def scalar(sql, *args):
        return db.execute(sql, args).fetchone()[0]

    db.execute("insert into auth.users(id) values (%s),(%s),(%s)", (OWNER, ADMIN, MEMBER))
    db.execute("insert into organizations(id,name) values (%s,'Isolated Phase 1 pilot')", (ORG,))
    db.execute("""insert into organization_members(organization_id,profile_id,role)
        values (%s,%s,'owner'),(%s,%s,'member')""", (ORG, OWNER, ORG, MEMBER))
    membership = scalar("""insert into organization_members(organization_id,profile_id,role)
        values (%s,%s,'organization_admin') returning id""", ORG, ADMIN)

    actor(db, OWNER)
    budget = scalar("select create_budget(%s,'Pilot budget',1000000)->>'id'", ORG)
    actor(db, ADMIN)
    expense = scalar("""select submit_expense(%s,'Pilot spending',170000,'events','2026-11-15',
        p_budget_id=>%s)->>'id'""", ORG, budget)
    actor(db, OWNER)
    for action in ("verified", "approved"):
        db.execute("select review_expense(%s,%s,%s,'Pilot review',1)", (ORG, expense, action))

    def advance(spent, returned):
        actor(db, OWNER)
        advance_id = scalar("""select create_cash_advance(%s,%s,'Pilot advance','Logistics',100000,'cash',
            p_budget_id=>%s)->>'id'""", ORG, membership, budget)
        actor(db, ADMIN)
        liquidation = scalar("select submit_liquidation(%s,%s,%s,%s,'Pilot settlement')->>'id'",
                             ORG, advance_id, spent, returned)
        return advance_id, liquidation

    pilot, liquidation = advance(60000, 40000)
    historical, historic_liquidation = advance(60000, 20000)
    review = "select review_liquidation(%s,%s,'approved','Independent review')"
    actor(db, OWNER)
    db.execute(review, (ORG, historic_liquidation))
    before = db.execute("select * from liquidations order by id").fetchall()
    db.execute("reset role")
    for file in migrations[accounting:]:
        db.execute(file.read_text(encoding="utf-8"))
    actor(db, OWNER)
    assert before == db.execute("select * from liquidations order by id").fetchall()
    def inspect_accounting(sql, params):
        with new_session() as inspector:
            return inspector.execute(sql, params).fetchone()

    assert inspect_accounting("select provisional, discrepancy from advance_accounting where id=%s", (historical,)) == (True, 20000)

    def totals():
        spent, returned, released, committed = inspect_accounting(
            "select spent, returned, released, unsettled from advance_accounting where id=%s", (pilot,)
        )
        return 210000 - 170000 - released + returned, 170000 + spent, committed

    assert totals() == (-60000, 170000, 100000)
    actor(db, MEMBER)
    try:
        db.execute(review, (ORG, liquidation))
        raise AssertionError("member approval accepted")
    except psycopg.errors.RaiseException:
        pass
    assert totals() == (-60000, 170000, 100000)
    assert race((review, (ORG, liquidation)), (review, (ORG, liquidation))) == ["P0001", "ok"]
    actor(db, OWNER)
    assert totals() == (-20000, 230000, 0)
    assert scalar("select count(*) from approvals where entity_id=%s and decision='approved'", liquidation) == 1

    confirm = "select confirm_liquidation_reconciliation(%s,%s,%s::jsonb,%s)"
    invalid = ('[{"expense_id":"' + expense + '","amount_centavos":60001}]')
    try:
        db.execute(confirm, (ORG, liquidation, invalid, "Over allocation"))
        raise AssertionError("invalid allocation accepted")
    except psycopg.errors.CheckViolation:
        pass
    assert inspect_accounting("select count(*) from liquidation_reconciliations where liquidation_id=%s", (liquidation,))[0] == 0
    actor(db, MEMBER)
    try:
        db.execute(confirm, (ORG, liquidation, "[]", "Unauthorized confirmation"))
        raise AssertionError("member reconciliation accepted")
    except psycopg.errors.InsufficientPrivilege:
        pass
    job = (confirm, (ORG, liquidation, "[]", "No expense overlap"))
    assert race(job, job) == ["ok", "ok"]
    assert inspect_accounting("select count(*) from liquidation_reconciliations where liquidation_id=%s", (liquidation,))[0] == 1
    db.execute("reset role")
    assert scalar("select count(*) from audit_logs where entity_id=%s and action='liquidation_reconciliation_confirmed'", liquidation) == 1

    actor(db, OWNER)
    with new_session() as rolled_back:
        actor(rolled_back, OWNER)
        rolled_back.execute("begin")
        rolled_back.execute(confirm, (ORG, historic_liquidation, "[]", "Rolled back review"))
        rolled_back.execute("rollback")
    assert not inspect_accounting("select exists(select 1 from liquidation_reconciliations where liquidation_id=%s)", (historic_liquidation,))[0]
    assert not scalar("select (check_org_deletability(%s)->>'is_deletable')::boolean", ORG)
    try:
        db.execute("select delete_organization(%s)", (ORG,))
        raise AssertionError("organization with unresolved shortage closed")
    except psycopg.errors.CheckViolation:
        pass

    cash = "select record_liquidation_resolution(%s,%s,%s,'recovery',%s,'Cash received')"
    first = "91000000-0000-4000-8000-000000000010"
    second = "91000000-0000-4000-8000-000000000011"
    job = (cash, (ORG, historic_liquidation, first, 12000))
    assert race(job, job) == ["ok", "ok"]
    job = (cash, (ORG, historic_liquidation, second, 8000))
    third = "91000000-0000-4000-8000-000000000012"
    assert race(job, (cash, (ORG, historic_liquidation, third, 8000))) == ["23514", "ok"]
    actor(db, OWNER)
    assert inspect_accounting("select returned, discrepancy from advance_accounting where id=%s", (historical,)) == (40000, 0)
    assert inspect_accounting("select count(*) from liquidation_resolution_entries where liquidation_id=%s", (historic_liquidation,))[0] == 2
    assert inspect_accounting("select spent, committed from budget_accounting where id=%s", (budget,)) == (290000, 0)
    db.execute("reset role")
    assert scalar("select count(*) from audit_logs where entity_id=%s and action='liquidation_resolution_recorded'", historic_liquidation) == 2
    db.execute("reset role")
    excess_advance, excess_liquidation = advance(10000, 110000)
    actor(db, OWNER)
    db.execute(review, (ORG, excess_liquidation))
    assert inspect_accounting("select returned, discrepancy from advance_accounting where id=%s",
                      (excess_advance,)) == (100000, 0)
    excess = cash.replace("'recovery'", "'excess_return'")
    assert race((excess, (ORG, excess_liquidation, first[:-2] + "30", 10000)),
                (excess, (ORG, excess_liquidation, second[:-2] + "31", 10000))) == ["23514", "ok"]
    assert inspect_accounting("select returned from advance_accounting where id=%s", (excess_advance,))[0] == 110000

    competing, competing_liquidation = advance(120000, 0)
    actor(db, OWNER)
    db.execute(review, (ORG, competing_liquidation))
    link = '[{"expense_id":"' + expense + '","amount_centavos":100000}]'
    assert race((confirm, (ORG, excess_liquidation, "[]", "First review")),
                (confirm, (ORG, excess_liquidation, "[]", "Competing review"))) == ["23514", "ok"]
    assert inspect_accounting("select overlap from advance_accounting where id=%s", (competing,))[0] == 0
    db.execute(confirm, (ORG, competing_liquidation, link, "Documented historical overlap"))
    assert inspect_accounting("select overlap from advance_accounting where id=%s", (competing,))[0] == 100000
    db.execute("reset role")
    db.execute("update organizations set suspended_at=now() where id=%s", (ORG,))
    actor(db, OWNER)
    try:
        db.execute(confirm, (ORG, historic_liquidation, "[]", "Suspended workspace"))
        raise AssertionError("suspended workspace reconciliation accepted")
    except psycopg.errors.InsufficientPrivilege:
        pass
    print("PASS: pre-migration history, independent approvals, duplicate submissions, atomic rollback, role gate, competing returns, pilot reserve and budget")

    db.execute("reset role")
    db.execute("update organizations set suspended_at=null where id=%s", (ORG,))
    actor(db, OWNER)
    space = scalar("select create_space(%s,'Archive race',null)->>'id'", ORG)
    create = "select create_collection(%s,'Concurrent dues',p_space_id=>%s)"
    archive = "select update_space(%s,%s,'Archive race',null,'archived')"
    with new_session() as archivist, new_session() as writer:
        actor(archivist, OWNER)
        actor(writer, OWNER)
        archivist.execute("begin")
        archivist.execute(archive, (ORG, space))
        with ThreadPoolExecutor(1) as pool:
            write = pool.submit(writer.execute, create, (ORG, space))
            with new_session() as monitor:
                for _ in range(100):
                    blocked = monitor.execute("select cardinality(pg_blocking_pids(%s))",
                                              (writer.info.backend_pid,)).fetchone()[0]
                    if blocked:
                        break
                    sleep(0.02)
            archivist.execute("commit")
            assert blocked, "writer did not wait for the space archive transaction"
            try:
                write.result(timeout=5)
                raise AssertionError("assignment committed after archive")
            except psycopg.errors.CheckViolation:
                pass
    assert scalar("select count(*) from collections where space_id=%s", space) == 0
    print("PASS: archived space rejects a concurrent assignment after waiting for the archive transaction")

    close_org = "91000000-0000-4000-8000-000000000099"
    db.execute("reset role")
    db.execute("insert into organizations(id,name) values (%s,'Closure race')", (close_org,))
    db.execute("insert into organization_members(organization_id,profile_id,role) values (%s,%s,'owner')",
               (close_org, OWNER))
    with new_session() as closer, new_session() as writer:
        actor(closer, OWNER)
        actor(writer, OWNER)
        closer.execute("begin")
        closer.execute("select delete_organization(%s)", (close_org,))
        with ThreadPoolExecutor(1) as pool:
            write = pool.submit(writer.execute, "select create_collection(%s,'Late collection')", (close_org,))
            with new_session() as monitor:
                for _ in range(100):
                    blocked = monitor.execute("select cardinality(pg_blocking_pids(%s))",
                                              (writer.info.backend_pid,)).fetchone()[0]
                    if blocked:
                        break
                    sleep(0.02)
            closer.execute("commit")
            assert blocked, "writer did not wait for the workspace closure"
            try:
                write.result(timeout=5)
                raise AssertionError("collection committed after workspace closure")
            except psycopg.errors.InsufficientPrivilege:
                pass
    assert scalar("select count(*) from collections where organization_id=%s", close_org) == 0
    print("PASS: workspace closure blocks an in-flight financial write")

    membership_org = "91000000-0000-4000-8000-000000000098"
    db.execute("insert into organizations(id,name) values (%s,'Membership closure race')", (membership_org,))
    db.execute("""insert into organization_members(organization_id,profile_id,role)
                  values (%s,%s,'owner'),(%s,%s,'member')""",
               (membership_org, OWNER, membership_org, ADMIN))
    with new_session() as closer, new_session() as writer:
        actor(closer, OWNER)
        closer.execute("begin")
        closer.execute("select delete_organization(%s)", (membership_org,))
        with ThreadPoolExecutor(1) as pool:
            write = pool.submit(writer.execute, """update organization_members set role='treasurer'
                where organization_id=%s and profile_id=%s""", (membership_org, ADMIN))
            with new_session() as monitor:
                blocked = 0
                for _ in range(100):
                    blocked = monitor.execute("select cardinality(pg_blocking_pids(%s))",
                                              (writer.info.backend_pid,)).fetchone()[0]
                    if blocked:
                        break
                    sleep(0.02)
            closer.execute("commit")
            assert blocked, "membership update did not wait for closure"
            try:
                write.result(timeout=5)
                raise AssertionError("membership change committed after closure")
            except psycopg.errors.InsufficientPrivilege:
                pass
    assert scalar("select closure_role from workspace_history_entitlements where organization_id=%s and profile_id=%s",
                  membership_org, ADMIN) == "member"
    print("PASS: closure captures the existing role and rejects a waiting membership change")

    prior_org = "91000000-0000-4000-8000-000000000097"
    db.execute("insert into organizations(id,name) values (%s,'Departure before closure')", (prior_org,))
    db.execute("""insert into organization_members(organization_id,profile_id,role)
                  values (%s,%s,'owner'),(%s,%s,'member')""",
               (prior_org, OWNER, prior_org, ADMIN))
    with new_session() as closer, new_session() as writer:
        actor(closer, OWNER)
        writer.execute("begin")
        writer.execute("""update organization_members set status='left'
            where organization_id=%s and profile_id=%s""", (prior_org, ADMIN))
        with ThreadPoolExecutor(1) as pool:
            closing = pool.submit(closer.execute, "select delete_organization(%s)", (prior_org,))
            with new_session() as monitor:
                blocked = 0
                for _ in range(100):
                    blocked = monitor.execute("select cardinality(pg_blocking_pids(%s))",
                                              (closer.info.backend_pid,)).fetchone()[0]
                    if blocked:
                        break
                    sleep(0.02)
            writer.execute("commit")
            assert blocked, "closure did not wait for the in-flight departure"
            closing.result(timeout=5)
    assert not scalar("select exists(select 1 from workspace_history_entitlements where organization_id=%s and profile_id=%s)",
                      prior_org, ADMIN)
    print("PASS: closure waits for prior departure and excludes the departed member")
