import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import { createUserClient } from "../config/supabase";
import AppError from "./AppError";

export type IdentityLabel = {
  id: string;
  username: string | null;
  display_name: string;
  organization_display_name?: string | null;
};
export const organizationIdentities = new AsyncLocalStorage<
  Map<string, IdentityLabel>
>();
// Explicit profile objects only. Directory records and historical audit snapshots
// are deliberately excluded; immutable attribution IDs are never changed.
const profileKeys = new Set([
  "profiles",
  "creator_profile",
  "verifier_profile",
  "approver_profile",
  "released_by_profile",
  "archive_actor",
  "profile",
]);
const adminUserKeys = new Set(["users", "user", "details"]);
const directoryKeys = new Set([
  "organization_directory_members",
  "directory_member",
  "directory_members",
]);
const historicalKeys = new Set([
  "before_value",
  "after_value",
  "metadata",
  "snapshot",
]);
function isDirectoryMemberRow(row: Record<string, unknown>, key: string): boolean {
  return (
    directoryKeys.has(key) ||
    "member_code" in row ||
    "attributes" in row
  );
}
export function resolveIdentityPayload(
  value: unknown,
  labels: Map<string, IdentityLabel>,
  key = "",
): unknown {
  if (historicalKeys.has(key) || directoryKeys.has(key)) return value;
  if (Array.isArray(value))
    return value.map((item) => resolveIdentityPayload(item, labels, key));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const row = value as Record<string, unknown>;
  const output = { ...row };
  if (
    !isDirectoryMemberRow(row, key) &&
    (profileKeys.has(key) || (adminUserKeys.has(key) && "email" in row && "display_name" in row)) &&
    typeof row.id === "string"
  ) {
    const identity = labels.get(row.id);
    output.display_name = identity?.display_name ?? "Member";
    output.username = identity?.username ?? null;
  }
  for (const [field, idKey] of [
    ["actor_name", "actor_id"],
    ["creator_name", "created_by"],
    ["creator_name", "creator_id"],
    ["submitter_name", "submitted_by"],
  ]) {
    if (field in row && typeof row[idKey] === "string")
      output[field] =
        labels.get(row[idKey] as string)?.display_name ?? "Member";
  }
  for (const [child, item] of Object.entries(output))
    output[child] = resolveIdentityPayload(item, labels, child);
  return output;
}
const skipIdentityLookupSubpaths = /\/(?:receipt-extractions(?:\/config)?|ai\/image-analyses|ai\/images\/config|ai\/navigation\/resolve|export|type|my-profile|expense-policy|approval-preset)\/?$/i;

export const organizationIdentityContext: RequestHandler = async (
  req,
  res,
  next,
) => {
  const org = req.path.match(/^\/([a-f0-9-]{36})(?:\/|$)/i)?.[1];
  if (
    !org ||
    req.method === "OPTIONS" ||
    req.method === "HEAD" ||
    req.method === "DELETE" ||
    skipIdentityLookupSubpaths.test(req.path) ||
    (req.path.endsWith("/evidence") && Boolean(req.query.attachment))
  ) {
    next();
    return;
  }
  try {
    const { data, error } = await createUserClient(req.auth!.accessToken).rpc(
      "organization_identity_labels",
      { p_org: org },
    );
    if (error)
      throw new AppError(
        503,
        "Workspace identities are temporarily unavailable.",
      );
    const labels = new Map<string, IdentityLabel>(
      (data ?? []).map((row: IdentityLabel) => [row.id, row]),
    );
    const json = res.json.bind(res);
    res.json = (body) => json(resolveIdentityPayload(body, labels));
    organizationIdentities.run(labels, () => next());
  } catch (error) {
    next(error);
  }
};

export const globalIdentityContext: RequestHandler = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    const ids = new Set<string>();
    const collect = (value: unknown, key = "") => {
      if (historicalKeys.has(key) || directoryKeys.has(key) || !value || typeof value !== "object" || value instanceof Date)
        return;
      if (Array.isArray(value)) {
        value.forEach((item) => collect(item, key));
        return;
      }
      const row = value as Record<string, unknown>;
      if (
        (profileKeys.has(key) || (adminUserKeys.has(key) && "email" in row && "display_name" in row)) &&
        typeof row.id === "string" &&
        /^[a-f0-9-]{36}$/i.test(row.id)
      ) {
        ids.add(row.id);
      }
      for (const field of [
        "actor_id",
        "created_by",
        "creator_id",
        "submitted_by",
      ]) {
        if (
          typeof row[field] === "string" &&
          /^[a-f0-9-]{36}$/i.test(row[field] as string)
        )
          ids.add(row[field] as string);
      }
      Object.entries(row).forEach(([child, item]) => collect(item, child));
    };
    collect(body);
    if (!ids.size) return json(body);
    void createUserClient(req.auth!.accessToken)
      .rpc("account_identity_labels", { p_ids: [...ids] })
      .then(
        ({ data, error }) => {
          if (error) {
            next(
              new AppError(
                503,
                "Account identities are temporarily unavailable.",
              ),
            );
            return;
          }
          const labels = new Map<string, IdentityLabel>(
            (data ?? []).map((row: IdentityLabel) => [row.id, row]),
          );
          json(resolveIdentityPayload(body, labels));
        },
        () =>
          next(
            new AppError(
              503,
              "Account identities are temporarily unavailable.",
            ),
          ),
      );
    return res;
  };
  next();
};
