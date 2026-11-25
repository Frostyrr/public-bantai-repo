import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryFlow } from "../../frontend/src/lib/recoveryFlow";
import { isLegacyRecoveryCallback, legacyRecoveryPath } from "../../frontend/src/lib/recoveryRedirect";

test("legacy recovery callbacks have a clean code-request destination", () => {
  assert.equal(isLegacyRecoveryCallback("#access_token=example&refresh_token=example&type=recovery"), true);
  assert.equal(legacyRecoveryPath, "/password/reset?from=legacy-link");
});

test("other callback types and ordinary anchors stay untouched", () => {
  assert.equal(isLegacyRecoveryCallback("#access_token=example&type=signup"), false);
  assert.equal(isLegacyRecoveryCallback("#security"), false);
  assert.equal(isLegacyRecoveryCallback(""), false);
});

type Auth = Parameters<typeof recoveryFlow>[0];
function setup(enrolled = false, questionApi?: Parameters<typeof recoveryFlow>[1], verifyRecovery?: Parameters<typeof recoveryFlow>[2]) {
  let valid = true;
  let otpValid = true;
  let updates = 0;
  let signedOut = 0;
  const flow = recoveryFlow({
    resetPasswordForEmail: async () => ({ error: null }),
    verifyOtp: async (args: { type: string }) => {
      assert.equal(args.type, "recovery");
      return { data: { session: otpValid ? {} : null }, error: otpValid ? null : { code: "otp_expired" } };
    },
    getUser: async () => ({ data: { user: valid ? { email: "user@example.test" } : null }, error: valid ? null : {} }),
    mfa: {
      listFactors: async () => {
        const factors = enrolled ? [{ id: "factor", factor_type: "totp", status: "verified" }] : [];
        return { data: { totp: factors, all: factors }, error: null };
      },
      challengeAndVerify: async ({ factorId, code }: { factorId: string; code: string }) => {
        assert.equal(factorId, "factor");
        return { error: code === "654321" ? null : {} };
      },
    },
    updateUser: async () => { updates++; return { error: null }; },
    signOut: async () => { signedOut++; return { error: null }; },
  } as unknown as Auth, questionApi, verifyRecovery);
  return { flow, expire: () => { valid = false; }, rejectOtp: () => { otpValid = false; }, updates: () => updates, signedOut: () => signedOut };
}
test("authenticator-enrolled accounts require the second factor during recovery", async () => {
  const s = setup(true);
  await assert.rejects(s.flow.verifyAuthenticator("654321"), /Request a new recovery code/);
  assert.deepEqual(await s.flow.verify("user@example.test", "123456"), { requiresAuthenticator: true });
  await assert.rejects(s.flow.update("new-password"), /Verify your authenticator first/);
  await assert.rejects(s.flow.verifyAuthenticator("000000"), /Couldn’t verify/);
  assert.equal(s.updates(), 0);
  await s.flow.verifyAuthenticator("654321");
  await s.flow.update("new-password");
  assert.equal(s.updates(), 1);
});
test("password update requires successful recovery verification", async () => {
  const s = setup();
  await assert.rejects(s.flow.update("new-password"), /Verify a recovery code/);
  assert.equal(s.updates(), 0);
});

test("question recovery transport stays behind email and TOTP verification and owns the password write",async()=>{
  const calls:string[]=[];
  const s=setup(true,async<T,>(path:string)=>{
    calls.push(path);
    return (path===""?{enabled:true,questions:[1,2,3]}:undefined) as T;
  });
  await assert.rejects(s.flow.getQuestions(),/Verify your email/);
  await s.flow.verify("user@example.test","123456");
  await assert.rejects(s.flow.getQuestions(),/Verify your email/);
  await s.flow.verifyAuthenticator("654321");
  assert.deepEqual(await s.flow.getQuestions(),{enabled:true,questions:[1,2,3]});
  await s.flow.questionRequest("/verify","POST",{answers:["one","two","three"]});
  await s.flow.update("new-password");
  assert.deepEqual(calls,["","/verify","/password"]);
  assert.equal(s.updates(),0);
  assert.equal(s.signedOut(),1);
  await assert.rejects(s.flow.questionRequest("/verify","POST",{}),/Verify your email/);
});
test("invalid or expired OTP cannot authorize a reset", async () => {
  const s = setup(); s.rejectOtp();
  await assert.rejects(s.flow.verify("user@example.test", "123456"), /Invalid or expired/);
  await assert.rejects(s.flow.update("new-password"));
  assert.equal(s.updates(), 0);
});

test("recovery forwards the entire email code and distinguishes service errors from expired codes", async () => {
  const submitted: string[] = [];
  let failure = { status: 500 };
  const flow = recoveryFlow({
    verifyOtp: async ({ token }: { token: string }) => {
      submitted.push(token);
      return { data: { session: null }, error: failure };
    },
  } as unknown as Auth);
  await assert.rejects(flow.verify("user@example.test", "01234567890"), /full numeric code/);
  await assert.rejects(flow.verify("user@example.test", "01234567"), /Couldn’t verify/);
  failure = { status: 429 };
  await assert.rejects(flow.verify("user@example.test", "0123456789"), /Too many verification attempts/);
  assert.deepEqual(submitted, ["01234567", "0123456789"]);
});
test("expired recovery session fails authoritative user check", async () => {
  const s = setup();
  await s.flow.verify("user@example.test", "123456"); s.expire();
  await assert.rejects(s.flow.update("new-password"), /Recovery session expired/);
  assert.equal(s.updates(), 0);
});
test("successful reset clears recovery authorization and signs out", async () => {
  const s = setup();
  await s.flow.verify("user@example.test", "123456");
  await s.flow.update("new-password");
  assert.equal(s.updates(), 1); assert.equal(s.signedOut(), 1);
  await assert.rejects(s.flow.update("another-password"));
});
test("leaving recovery clears authorization", async () => {
  const s = setup();
  await s.flow.verify("user@example.test", "123456"); s.flow.dispose();
  await assert.rejects(s.flow.update("new-password"));
  assert.equal(s.updates(), 0);
});

test("Auth SMTP failures produce a generic recovery error without retry or recovery authorization", async () => {
  for (const providerError of [
    { message: "SMTP settings missing", status: 500 },
    { message: "SMTP authentication rejected (535)", status: 500 },
    { message: "SMTP dial timeout", status: 504 },
  ]) {
    let requests = 0;
    const flow = recoveryFlow({
      resetPasswordForEmail: async (_email: string, options: { captchaToken: string }) => {
        requests++;
        assert.deepEqual(options, { captchaToken: "mock-captcha" });
        return { error: providerError };
      },
    } as unknown as Auth);
    await assert.rejects(flow.request("user@example.test", "mock-captcha"),
      { message: "Unable to request a code right now. Please wait and try again." });
    assert.equal(requests, 1);
    await assert.rejects(flow.update("new-password"), /Verify a recovery code first/);
  }
});

test("concurrent recovery submissions perform one password write", async () => {
  const { flow, updates } = setup();
  await flow.verify("user@example.test", "123456");
  const first = flow.update("new-password");
  await assert.rejects(flow.update("different-password"), /already in progress/);
  await first;
  assert.equal(updates(), 1);
  await assert.rejects(flow.update("another-password"));
});

test("managed recovery verifier preserves TOTP and transport ordering without falling back",async()=>{
  let verifications=0,writes=0;
  const s=setup(true,async<T,>(path:string)=>{if(path==="/password")writes++;return undefined as T;},async(email,token)=>{
    assert.equal(email,"user@example.test");assert.equal(token,"123456");verifications++;
    return {data:{session:{}},error:null} as Awaited<ReturnType<Auth["verifyOtp"]>>;
  });
  // An injected managed verifier owns verification even if native OTP rejects.
  s.rejectOtp();await s.flow.verify("user@example.test","123456");
  await assert.rejects(s.flow.update("new-password"),/authenticator/);
  await s.flow.verifyAuthenticator("654321");await s.flow.update("new-password");
  assert.equal(verifications,1);assert.equal(writes,1);assert.equal(s.updates(),0);
  const unavailable=setup(false,undefined,async()=>{throw new Error("managed verification unavailable");});
  await assert.rejects(unavailable.flow.verify("user@example.test","123456"),/unavailable/);
  await assert.rejects(unavailable.flow.update("new-password"),/Verify a recovery code/);
});
