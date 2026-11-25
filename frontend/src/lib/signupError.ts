const signupMessages = new Map([
  ["email_address_invalid", "Please enter a valid email address."],
  ["weak_password", "Choose a stronger password and try again."],
  ["captcha_failed", "Please complete the security verification and try again."],
  ["over_email_send_rate_limit", "Too many requests. Please wait before trying again."],
  ["over_request_rate_limit", "Too many requests. Please wait before trying again."],
]);

export function formatSignupError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  return signupMessages.get(code) ?? "Unable to create an account right now. Please try again.";
}
