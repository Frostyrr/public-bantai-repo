import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const expenseEvidenceBucket = "expense-evidence";
export const evidenceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function createEvidenceStorageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.EXPENSE_EVIDENCE_STORAGE_SECRET;
  if (!url || !key) throw new Error("Expense evidence Storage is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
