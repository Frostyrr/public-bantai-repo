import type { Response } from "express";
import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import { quoteDirectoryCsvCell } from "../../utils/directoryCsv";
import { collectionMemberRpc } from "./collections.repository";

type DirectoryField = { key: string; label: string; display_order: number };
type RosterRow = {
  name: string;
  status: string;
  obligation_id: string | null;
  amount_centavos: number | string | null;
  paid_centavos: number | string | null;
  remaining_centavos: number | string | null;
  organization_directory_members?: { attributes: Record<string, unknown> } | null;
};

function decimalAmount(value: number | string | null) {
  if (value === null) return "";
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new AppError(503, "A report amount exceeds the supported range.");
  }
  const cents = BigInt(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export async function exportCollection(
  res: Response, token: string, org: string, collection: string,
  options: { mode: "detailed" | "summary"; status: string; q: string; obligationId?: string; amounts?: Record<string, number | boolean | undefined> },
) {
  const client = createUserClient(token);
  const capability = async (name: string) => {
    const result = await client.rpc("has_directory_capability", {target_org: org, capability: name});
    if (result.error) throw new AppError(503, "Could not check report permissions.");
    if (result.data !== true) throw new AppError(403, "You do not have permission to export this report.");
  };
  const { data: { user }, error: identityError } = await client.auth.getUser(token);
  if (identityError || !user) throw new AppError(401, "Authentication required.");
  const membership = await client.from("organization_members").select("role")
    .eq("organization_id", org).eq("status", "active")
    .eq("profile_id", user.id).maybeSingle();
  if (membership.error) throw new AppError(503, "Could not check report permissions.");
  if (!["owner", "treasurer"].includes(membership.data?.role ?? "")) {
    throw new AppError(403, "You do not have permission to export this report.");
  }
  await capability("financial_view");
  if (options.mode === "detailed") await capability("export");
  const [settings, schema] = await Promise.all([
    client.from("collections").select("currency").eq("organization_id", org).eq("id", collection).maybeSingle(),
    client.from("directory_field_definitions").select("key,label,display_order")
      .eq("organization_id", org).eq("active", true).order("display_order").order("label").order("key"),
  ]);
  if (settings.error || (schema.error && options.mode === "detailed")) throw new AppError(503, "Could not load the report schema.");
  if (!settings.data) throw new AppError(404, "Collection not found.");
  const fields: DirectoryField[] = schema.data ?? [];
  const custom = options.mode === "detailed" ? fields : [];
  const currency = settings.data.currency;
  const headers = ["Full Name", ...custom.map(field => field.label),
    `Assessed Dues (${currency})`, `Amount Paid (${currency})`, `Outstanding Balance (${currency})`, "Payment Status"];
  const statusLabels: Record<string, string> = {not_assessed:"Not Assessed",pending:"Unpaid",partially_paid:"Partially Paid",paid:"Paid",waived:"Waived"};
  const readPage = async (offset: number): Promise<RosterRow[]> => {
    const result = await collectionMemberRpc(token, "collection_members_page", {
      org, collection, page_offset: offset, search_text: options.q, filter_status: options.status, target_obligation: options.obligationId ?? null,
      ...(options.amounts ? { amounts: options.amounts } : {}),
    });
    return result.rows;
  };
  const write = async (values: unknown[]) => {
    if (!res.write(values.map(quoteDirectoryCsvCell).join(",") + "\r\n")) {
      await new Promise<void>(resolve => {
        const done = () => { res.off("drain", done); res.off("close", done); resolve(); };
        res.once("drain", done);
        res.once("close", done);
      });
    }
  };
  let rows = await readPage(0);
  res.attachment(`collection-${options.mode}.csv`).type("text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await write(headers);
    for (let offset = 0; !res.destroyed; offset += 25) {
      for (const row of rows.slice(0, 25)) {
        if (res.destroyed) return;
        const member = row.organization_directory_members;
        await write([row.name, ...custom.map(field => member?.attributes[field.key]),
          ...[row.amount_centavos, row.paid_centavos, row.remaining_centavos].map(amount => row.obligation_id ? decimalAmount(amount) : ""),
          statusLabels[row.status] ?? row.status]);
      }
      if (rows.length <= 25) break;
      rows = await readPage(offset + 25);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    res.destroy();
  }
}
