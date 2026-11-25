import { createEvidenceStorageClient, evidenceHash, expenseEvidenceBucket } from "../src/config/evidenceStorage";

type PendingCopy = { id: string; object_path: string; mime: string; data: string; sha256: string };

async function migrateBatch() {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Receipt copy runner is restricted to isolated loopback environments.");
  }
  const client = createEvidenceStorageClient();
  const bucket = client.storage.from(expenseEvidenceBucket);
  const pending = await client.rpc("pending_expense_storage_copies", { batch_size: 20 });
  if (pending.error || !Array.isArray(pending.data)) throw new Error("Unable to list pending receipt copies.");
  let verified = 0;
  let failed = 0;
  for (const row of pending.data as PendingCopy[]) {
    const bytes = Buffer.from(row.data, "base64");
    if (bytes.length > 1048576 || evidenceHash(bytes) !== row.sha256) { failed++; continue; }
    // Never overwrite an object. A retry verifies an existing object before marking it.
    await bucket.upload(row.object_path, bytes, { contentType: row.mime, upsert: false });
    const { data, error } = await bucket.download(row.object_path);
    if (error || !data || data.size !== bytes.length || data.type !== row.mime ||
        evidenceHash(new Uint8Array(await data.arrayBuffer())) !== row.sha256) { failed++; continue; }
    const result = await client.rpc("confirm_expense_storage_copy", {
      attachment: row.id, expected_path: row.object_path, expected_hash: row.sha256,
    });
    if (result.error || result.data !== true) failed++;
    else verified++;
  }
  console.log(JSON.stringify({ attempted: pending.data.length, verified, failed }));
  if (failed) process.exitCode = 1;
}

migrateBatch().catch(() => { console.error("Receipt copy batch failed."); process.exitCode = 1; });
