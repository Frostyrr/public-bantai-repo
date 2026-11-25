import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionRequest, QuestionStatus } from "./securityQuestions";

export const recoveryCodePattern = "[0-9]{6,10}";
const recoveryCodeFormat = new RegExp(`^${recoveryCodePattern}$`);
export const isRecoveryCode = (code: string) => recoveryCodeFormat.test(code);

export function recoveryFlow(auth: SupabaseClient["auth"], questionApi?: QuestionRequest, verifyRecovery?: (email:string,token:string)=>ReturnType<SupabaseClient["auth"]["verifyOtp"]>) {
  let verifiedEmail: string | null = null;
  let factorId: string | null = null;
  let chosenMethod: "authenticator" | "questions" | null = null;
  let disposed = false;
  let updating = false;
  let verificationGeneration = 0;
  let passwordAuthorizationExpiresAt = 0;
  const questionRequest: QuestionRequest = async <T,>(path: string, method?: string, body?: unknown) => {
    if (!verifiedEmail || (factorId && chosenMethod !== "questions") || disposed || passwordAuthorizationExpiresAt <= Date.now() || !questionApi) {
      throw new Error("Verify your email code and authenticator before continuing.");
    }
    return questionApi<T>(path, method, body);
  };
  return {
    questionRequest,
    chooseRecoveryQuestions() {
      chosenMethod = "questions";
    },
    async peekMethods() {
      if (!verifiedEmail || disposed || passwordAuthorizationExpiresAt <= Date.now() || !questionApi) {
        throw new Error("Verify your email code before continuing.");
      }
      return questionApi<QuestionStatus>("");
    },
    async getQuestions() {
      return questionRequest<QuestionStatus>("");
    },
    async request(email: string, captchaToken?: string) {
      const { error } = await auth.resetPasswordForEmail(
        email,
        captchaToken ? { captchaToken } : undefined
      );
      if (error) throw new Error("Unable to request a code right now. Please wait and try again.");
    },
    async verify(email: string, token: string) {
      if (updating || disposed) throw new Error("Recovery is unavailable. Request a new code.");
      const generation = ++verificationGeneration;
      verifiedEmail = null;
      factorId = null;
      passwordAuthorizationExpiresAt = 0;
      if (!isRecoveryCode(token)) throw new Error("Enter the full numeric code from your recovery email.");
      const { data, error } = await (verifyRecovery ? verifyRecovery(email,token) : auth.verifyOtp({ email, token, type: "recovery" }));
      if (disposed) {
        await auth.signOut({ scope: "local" });
        throw new Error("Recovery cancelled. Request a new code.");
      }
      if (error?.code === "otp_expired") {
        throw new Error("Invalid or expired code. Use the newest password reset email, or request a new code.");
      }
      if (error?.status === 429) throw new Error("Too many verification attempts. Wait a few minutes and try again.");
      if (error || !data.session) throw new Error("Couldn’t verify the recovery code right now. Please try again.");
      const result = await auth.mfa.listFactors();
      if (disposed || generation !== verificationGeneration) throw new Error("Recovery cancelled. Request a new code.");
      if (result.error) throw new Error("Couldn’t check your verification methods. Request a new recovery code.");
      factorId = result.data.totp[0]?.id ?? null;
      if (result.data.all.some(factor => factor.status === "verified") && !factorId) {
        throw new Error("This account uses a verification method that the reset page does not support.");
      }
      verifiedEmail = email.toLowerCase();
      chosenMethod = null;
      passwordAuthorizationExpiresAt = Date.now() + 5 * 60_000;
      return { requiresAuthenticator: factorId !== null };
    },
    async verifyAuthenticator(code: string) {
      if (!verifiedEmail || !factorId || disposed) throw new Error("Request a new recovery code.");
      const { error } = await auth.mfa.challengeAndVerify({ factorId, code });
      if (disposed) {
        await auth.signOut({ scope: "local" });
        throw new Error("Recovery cancelled. Request a new code.");
      }
      if (error) throw new Error("Couldn’t verify that code. Try a fresh code from your authenticator app.");
      factorId = null;
      chosenMethod = "authenticator";
    },
    async update(password: string) {
      if (!verifiedEmail) throw new Error("Verify a recovery code first.");
      if (factorId && chosenMethod !== "questions") throw new Error("Verify your authenticator first.");
      if (updating) throw new Error("A password reset is already in progress.");
      if (passwordAuthorizationExpiresAt <= Date.now()) {
        throw new Error("Recovery session expired. Request a new code.");
      }
      updating = true;
      const email = verifiedEmail;
      try {
        const { data, error } = await auth.getUser();
        if (disposed || passwordAuthorizationExpiresAt <= Date.now() ||
            error || data.user?.email?.toLowerCase() !== email) {
          throw new Error("Recovery session expired. Request a new code.");
        }
        if (questionApi) {
          await questionRequest("/password", "POST", { password });
        } else {
          const result = await auth.updateUser({ password });
          if (result.error) throw new Error("Unable to update password. Check password requirements or request a new code.");
        }
        verifiedEmail = null;
        passwordAuthorizationExpiresAt = 0;
        await auth.signOut({ scope: "local" });
      } finally {
        updating = false;
      }
    },
    dispose() {
      disposed = true;
      verificationGeneration++;
      passwordAuthorizationExpiresAt = 0;
      verifiedEmail = null;
      factorId = null;
      void auth.signOut({ scope: "local" }).catch(() => undefined);
    },
  };
}
