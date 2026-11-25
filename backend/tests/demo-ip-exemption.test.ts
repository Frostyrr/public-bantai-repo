import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { createEnforceSourceRestriction } from "../src/middleware/requestTiming";

test("known IP blocks require verified identity and live exemption; failures remain blocked", async () => {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const token = encode({ alg: "HS256" }) + "." + encode({ exp: Math.floor(Date.now()/1000)+600, session_id: "00000000-0000-4000-8000-000000000001" }) + ".signature";
  for (const mode of ["allowed", "ordinary", "forged", "outage", "anonymous"] as const) {
    let next = false;
    let status = 200;
    const client = {
      auth: { getUser: async () => {
        if (mode === "outage") throw new Error("unavailable");
        return mode === "forged" ? { data: { user: null }, error: new Error("invalid") } : { data: { user: { id: "verified" } }, error: null };
      } },
      rpc: async (name: string) => ({ data: name === "check_source_restriction" ? { restricted: true } : mode === "allowed", error: null }),
    };
    const middleware = createEnforceSourceRestriction({ createClient: (() => client) as never, shouldEnforce: () => true });
    const req = { ip: "192.0.2.10", path: "/admin/settings", method: "GET", headers: mode === "anonymous" ? {} : { authorization: "Bearer " + token } } as Request;
    const res = { locals: {}, setHeader() {}, status(code: number) { status = code; return this; }, json() {} } as unknown as Response;
    await middleware(req, res, () => { next = true; });
    assert.equal(next, mode === "allowed", mode);
    assert.equal(status, mode === "allowed" ? 200 : 429, mode);
  }
});
