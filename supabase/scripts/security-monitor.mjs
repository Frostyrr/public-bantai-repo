const { SECURITY_MONITOR_SUPABASE_URL: url, SECURITY_MONITOR_SERVICE_KEY: key } = process.env;

async function main() {
  if (!url || !key) throw new Error("Set the monitor's Supabase URL and service credential.");
  const origin = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) {
    throw new Error("The monitor requires HTTPS outside a local stack.");
  }

  const result = await fetch(new URL("/rest/v1/rpc/bantai_run_security_monitor", origin), {
    method: "POST",
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.ok) throw new Error("Monitor RPC failed with HTTP " + result.status + ".");
  const summary = await result.json();
  console.log("Bantai security monitor · Last 24 hours");
  console.log("Events scanned:", summary.scanned);
  console.log("New flags:", summary.inserted, "· Existing flags:", summary.findings - summary.inserted);
  for (const [pattern, count] of Object.entries(summary.byPattern)) console.log(pattern, count);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
