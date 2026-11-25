import { createServiceClient } from "../src/config/supabase";
import { env } from "../src/constants/env";

const DEFAULT_POLICY = {
  account_failures_per_tier: 3,
  account_tier_seconds: [15, 30, 60],
  ip_failure_threshold: 10,
  ip_window_seconds: 600,
  ip_block_seconds: 600,
  edge_failure_threshold: 10,
  edge_window_seconds: 900,
  edge_block_seconds: 900,
};

const DEMO_POLICY = {
  account_failures_per_tier: 3,
  account_tier_seconds: [10, 20, 30],
  ip_failure_threshold: 8,
  ip_window_seconds: 300,
  ip_block_seconds: 60,
  edge_failure_threshold: 8,
  edge_window_seconds: 300,
  edge_block_seconds: 60,
};

const PASSWORDS = [
  "password123",
  "12345678",
  "qwerty123",
  "letmein",
  "admin123",
  "welcome1",
  "monkey123",
  "dragon99",
  "baseball1",
  "football1",
  "iloveyou",
  "trustno1",
  "sunshine1",
  "princess1",
  "superman1",
];

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function requireService() {
  const service = createServiceClient();
  if (!service) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required in backend/.env to run demo scripts.");
  }
  return service;
}

async function clearActiveLocks() {
  const service = requireService();
  const now = new Date().toISOString();
  const { error: ipErr } = await service
    .from("source_restrictions")
    .update({ status: "cleared", updated_at: now })
    .in("status", ["restricted", "monitoring"]);
  if (ipErr) throw new Error(`Failed clearing source_restrictions: ${ipErr.message}`);

  const { error: profErr } = await service
    .from("profiles")
    .update({ locked_until: null })
    .gt("locked_until", now);
  if (profErr) throw new Error(`Failed clearing profile locks: ${profErr.message}`);
}

async function setPolicy(policy: typeof DEFAULT_POLICY, reason: string) {
  const service = requireService();
  const { error } = await service
    .from("platform_settings")
    .upsert({
      key: "login_lockout",
      value: policy,
      updated_reason: reason,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Failed updating login_lockout policy: ${error.message}`);
}

async function setupDemo() {
  await clearActiveLocks();
  await setPolicy(DEMO_POLICY, "Live demo shortened lockout settings");
  console.log("Demo setup complete:");
  console.log("  - Cleared active IP restrictions and profile locks");
  console.log("  - Applied short demo policy:", JSON.stringify(DEMO_POLICY));
  console.log("  - Remember to run `npm run demo:reset` after the demo.");
}

async function resetDemo() {
  await clearActiveLocks();
  await setPolicy(DEFAULT_POLICY, "Restored default lockout policy after demo");
  console.log("Demo reset complete:");
  console.log("  - Cleared active IP restrictions and profile locks");
  console.log("  - Restored default policy:", JSON.stringify(DEFAULT_POLICY));
}

async function showStatus() {
  const service = requireService();
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [policyRes, ipRes, lockRes, eventsRes] = await Promise.all([
    service.from("platform_settings").select("value, updated_reason, updated_at").eq("key", "login_lockout").maybeSingle(),
    service.from("source_restrictions").select("source_ip, status, reason, attempts_count, expires_at").in("status", ["restricted", "monitoring"]),
    service.from("profiles").select("id, email, locked_until").gt("locked_until", now),
    service
      .from("security_events")
      .select("occurred_at, action, outcome, http_status, source_ip")
      .gte("occurred_at", since)
      .in("action", ["LOGIN_FAILED", "LOCKOUT_TIER_1", "LOCKOUT_TIER_2", "LOCKOUT_TIER_3", "ACCOUNT_LOCKED", "IP_BLOCKED"])
      .order("occurred_at", { ascending: false })
      .limit(15),
  ]);

  console.log("\n=== Lockout Policy ===");
  console.log(JSON.stringify(policyRes.data?.value ?? DEFAULT_POLICY, null, 2));

  console.log("\n=== Active IP Restrictions / Monitoring ===");
  if (!ipRes.data?.length) console.log("(none)");
  else console.table(ipRes.data);

  console.log("\n=== Locked Accounts ===");
  if (!lockRes.data?.length) console.log("(none)");
  else console.table(lockRes.data);

  console.log("\n=== Recent Auth Security Events (last 15m) ===");
  if (!eventsRes.data?.length) console.log("(none)");
  else console.table(eventsRes.data);
}

async function runAttack() {
  const baseUrl = getArg("--url") ?? process.env.DEMO_API_URL ?? `http://localhost:${env.PORT}`;
  const parsed = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`Refusing to run attack script against non-local host "${parsed.hostname}". Use localhost only.`);
  }

  const identifier = getArg("--identifier") ?? process.env.DEMO_ATTACK_IDENTIFIER ?? "demo@bantai.test";
  const attempts = Math.max(1, Math.min(30, Number(getArg("--attempts") ?? 12)));
  const delayMs = Math.max(0, Number(getArg("--delay") ?? 400));
  const captchaToken = getArg("--captcha") ?? process.env.DEMO_CAPTCHA_TOKEN ?? "XXXX.DUMMY.TOKEN.XXXX";
  const realPassword = getArg("--password") ?? process.env.DEMO_REAL_PASSWORD;
  const endpoint = `${parsed.origin}/auth/login`;

  console.log(`\nSimulated brute-force attack -> ${endpoint}`);
  console.log(`Target identifier: ${identifier} | Attempts: ${attempts}\n`);

  let firstAccountLockAt: number | null = null;
  let ipBlockedAt: number | null = null;

  for (let i = 1; i <= attempts; i++) {
    const guess = PASSWORDS[(i - 1) % PASSWORDS.length];
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: guess, captchaToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    const retryAfter = res.headers.get("retry-after");
    const msg = body.message ?? "(no message)";

    if (res.status === 429) {
      if (body.code === "login_restricted" && firstAccountLockAt === null) firstAccountLockAt = i;
      if (!body.code && ipBlockedAt === null) ipBlockedAt = i;
    }

    const extra = retryAfter ? ` [Retry-After: ${retryAfter}s]` : "";
    console.log(`#${String(i).padStart(2, "0")}  HTTP ${res.status}  ${msg}${extra}`);

    if (delayMs > 0 && i < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (realPassword) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: realPassword, captchaToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    console.log(`\n[Real password test] HTTP ${res.status}  ${body.message ?? ""}`);
  }

  console.log("\nSummary:");
  console.log(`  - Account lock triggered at attempt: ${firstAccountLockAt ?? "not triggered"}`);
  console.log(`  - Network IP block triggered at attempt: ${ipBlockedAt ?? "not triggered"}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "setup") await setupDemo();
  else if (command === "status") await showStatus();
  else if (command === "reset") await resetDemo();
  else if (command === "attack") await runAttack();
  else {
    console.error("Usage: tsx scripts/lockoutDemo.ts <setup|status|reset|attack> [--identifier email] [--attempts 12] [--delay 400]");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
