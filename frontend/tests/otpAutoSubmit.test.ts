import assert from "node:assert/strict";
import { test } from "node:test";
import { canAutoSubmitOtp } from "../src/lib/otpAutoSubmit";

test("auto-submit triggers only for complete 6-digit codes", () => {
  assert.equal(
    canAutoSubmitOtp({ code: "", enabled: true, busy: false, lastAttemptedCode: null }),
    false,
  );
  assert.equal(
    canAutoSubmitOtp({ code: "12345", enabled: true, busy: false, lastAttemptedCode: null }),
    false,
  );
  assert.equal(
    canAutoSubmitOtp({ code: "12345a", enabled: true, busy: false, lastAttemptedCode: null }),
    false,
  );
  assert.equal(
    canAutoSubmitOtp({ code: "123456", enabled: true, busy: false, lastAttemptedCode: null }),
    true,
  );
});

test("auto-submit prevents concurrent requests and blocks retrying the same failed code", () => {
  assert.equal(
    canAutoSubmitOtp({ code: "123456", enabled: true, busy: true, lastAttemptedCode: null }),
    false,
  );
  assert.equal(
    canAutoSubmitOtp({ code: "123456", enabled: true, busy: false, lastAttemptedCode: "123456" }),
    false,
  );
  // Once edited to a different 6-digit code, auto-submit is allowed again.
  assert.equal(
    canAutoSubmitOtp({ code: "123457", enabled: true, busy: false, lastAttemptedCode: "123456" }),
    true,
  );
});

test("auto-submit respects enabled flag (expired code, missing email, or inactive method)", () => {
  assert.equal(
    canAutoSubmitOtp({ code: "123456", enabled: false, busy: false, lastAttemptedCode: null }),
    false,
  );
});
