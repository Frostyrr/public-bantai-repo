import { pathToFileURL } from "node:url";

const {
  SECURITY_ALERT_SUPABASE_URL,
  SECURITY_ALERT_SERVICE_KEY,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
  APP_ORIGIN,
} = process.env;

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid HTTPS origin.");
  return url.origin;
}

export async function sendSecurityAlert(fetcher, options) {
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", options);
    if (response.ok) return "sent";
    if (response.status === 429) return "retry";
    if (response.status >= 500 || response.status === 408) return "unconfirmed";
    return "failed";
  } catch {
    // The provider may have accepted the request before the connection failed.
    return "unconfirmed";
  }
}

async function main() {
  if (!SECURITY_ALERT_SUPABASE_URL || !SECURITY_ALERT_SERVICE_KEY || !BREVO_API_KEY || !BREVO_SENDER_EMAIL || !APP_ORIGIN) {
    throw new Error("Set the Supabase, Brevo, and application settings for security alerts.");
  }
  const origin = httpsOrigin(SECURITY_ALERT_SUPABASE_URL);
  const recoveryUrl = new URL("/password/forgot", httpsOrigin(APP_ORIGIN));
  const key = SECURITY_ALERT_SERVICE_KEY;
  async function rpc(name, body = {}) {
    const response = await fetch(new URL("/rest/v1/rpc/" + name, origin), {
      method: "POST",
      headers: {
        apikey: key,
        ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Security-alert database call failed.");
    return response.json();
  }

  const jobs = await rpc("bantai_claim_security_alerts");
  if (!Array.isArray(jobs)) throw new Error("Invalid security-alert queue response.");
  let failures = 0;
  for (const job of jobs) {
    let result = "skipped";
    if (job.email) {
      const localTime = new Date(job.metadata.occurred_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
      const details = [
        "Bantai", job.subject, localTime + " (Philippine time)",
        ...(Number.isInteger(job.metadata.failures) ? ["Failed sign-ins: " + job.metadata.failures] : []),
        ...(job.metadata.source_ip ? ["Source IP: " + job.metadata.source_ip] : []),
        ...(job.metadata.user_agent ? ["Browser or device: " + job.metadata.user_agent] : []),
        "If this was not you, reset your password: " + recoveryUrl.href,
      ];
      result = await sendSecurityAlert(fetch, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Bantai", email: BREVO_SENDER_EMAIL },
            to: [{ email: job.email }],
            subject: job.subject,
            textContent: details.join("\n\n"),
          }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
      });
    }
    if (!await rpc("bantai_finish_security_alert", {
      p_id: job.id, p_attempt: job.attempt, p_result: result,
    })) throw new Error("Could not acknowledge a claimed security alert.");
    if (["retry", "failed", "unconfirmed"].includes(result)) failures++;
  }
  console.log("Security alerts processed:", jobs.length, "· Delivery failures:", retries);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Security-alert processing failed. Check server settings and queue status.");
  process.exitCode = 1;
});
