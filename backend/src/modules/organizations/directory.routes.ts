import { quoteDirectoryCsvCell } from "../../utils/directoryCsv";
import { Router } from "express";
import { z } from "zod";
import { createUserClient } from "../../config/supabase";
import AppError from "../../utils/AppError";
import catchErrors from "../../utils/catchErrors";

const router = Router();
const path = "/:organizationId/directory";
const uuid = z.string().uuid();
const fields = "id,display_name,member_code,email,phone,status,attributes";
const schemaFields = "key,label,kind,options,display_order,template_version,import_aliases,default_visible";
const definition = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["text", "number", "date", "checkbox", "select"]),
  options: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
}).strict();
const input = z.object({
  display_name: z.string().trim().min(1).max(150),
  member_code: z.string().trim().min(1).max(100).nullable(),
  email: z.string().trim().email().max(254).nullable(),
  phone: z.string().trim().min(1).max(40).nullable(),
  attributes: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
}).strict();
const filters = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["active", "archived", "all"]).default("active"),
  group: uuid.optional(),
  attributeKey: definition.shape.key.optional(),
  attributeValue: z.string().max(500).optional(),
  sort: z.enum(["name","identifier","status","recent"]).default("name"),
  direction: z.enum(["asc","desc"]).default("asc"),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});

async function checkCapability(client: ReturnType<typeof createUserClient>, orgId: string, capability: string) {
  const result = await client.rpc("has_directory_capability", { target_org: orgId, capability });
  if (result.error) throw new AppError(503, "Member directory is temporarily unavailable.");
  return result.data === true;
}

function directoryError(error: { code: string }) {
  if (error.code === "23505") return new AppError(409, "That member identifier is already in use.");
  if (error.code === "42501") return new AppError(403, "You do not have permission for this directory action.");
  if (["23514", "22007", "22008"].includes(error.code)) return new AppError(400, "Check the custom field values and try again.");
  return new AppError(503, "Member directory is temporarily unavailable.");
}

async function validateMemberAttributes(client: ReturnType<typeof createUserClient>, orgId: string,
  attributes: Record<string, string | number | boolean> | undefined,
  loadedDefinitions?: { key: string; kind: string; options: string[] }[]) {
  if (!attributes || !Object.keys(attributes).length) return [];
  let definitions = loadedDefinitions;
  if (!definitions) {
    const result = await client.from("directory_field_definitions").select("key,kind,options")
      .eq("organization_id", orgId).eq("active", true);
    if (result.error) throw directoryError(result.error);
    definitions = result.data;
  }
  const byKey = new Map(definitions.map(field => [field.key, field]));
  return Object.entries(attributes).flatMap(([key, value]) => {
    const field = byKey.get(key);
    const date = field?.kind === "date" && typeof value === "string" ? new Date(value + "T00:00:00Z") : null;
    const valid = field?.kind === "text" ? typeof value === "string"
      : field?.kind === "number" ? typeof value === "number" && Number.isFinite(value)
      : field?.kind === "checkbox" ? typeof value === "boolean"
      : field?.kind === "select" ? typeof value === "string" && field.options.includes(value)
      : date && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !value.startsWith("0000") && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    return valid ? [] : [{
      field: "attributes." + key,
      message: field ? "Use a value that matches the configured field type." : "This field is no longer active.",
    }];
  });
}

router.get(path + "/fields", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You do not have access to this directory.");
  const result = await client.from("directory_field_definitions").select(schemaFields)
    .eq("organization_id", orgId).eq("active", true).order("display_order").order("label").order("key");
  if (result.error && ["42703", "PGRST204"].includes(result.error.code) &&
      /display_order|template_version|import_aliases|default_visible/.test(result.error.message)) {
    const legacy = await client.from("directory_field_definitions").select("key,label,kind,options")
      .eq("organization_id", orgId).eq("active", true).order("label").order("key");
    if (legacy.error) {
      console.warn("[directory fields] Legacy query failed", { code: legacy.error.code });
      throw directoryError(legacy.error);
    }
    res.json({ fields: legacy.data });
    return;
  }
  if (result.error) console.warn("[directory fields] Query failed", { code: result.error.code });
  if (result.error) throw directoryError(result.error);
  res.json({ fields: result.data });
}));

router.post(path + "/fields", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot add directory fields.");
  const entries = z.array(definition).min(1).max(10).parse(req.body);
  const result = await client.from("directory_field_definitions").insert(
    entries.map(entry => ({ ...entry, organization_id: orgId })),
  );
  if (result.error?.code === "23505") throw new AppError(409, "A field with that key already exists.");
  if (result.error) throw directoryError(result.error);
  res.sendStatus(201);
}));

router.patch(path + "/fields/:key", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const key = definition.shape.key.parse(req.params.key);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot rename directory fields.");
  const { label } = definition.pick({ label: true }).parse(req.body);
  const result = await client.from("directory_field_definitions").update({ label })
    .eq("organization_id", orgId).eq("active", true).eq("key", key).select("key").maybeSingle();
  if (result.error) throw directoryError(result.error);
  if (!result.data) throw new AppError(404, "Directory field not found.");
  res.sendStatus(204);
}));

router.post(path + "/fields/change-set", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const change = z.discriminatedUnion("action", [
    z.object({ action: z.literal("remove"), key: definition.shape.key, expected: z.array(definition) }),
    z.object({ action: z.literal("replace"), fields: z.array(definition).max(500), expected: z.array(definition), confirmValueLoss: z.boolean().default(false) }),
  ]).parse(req.body);
  const client = createUserClient(req.auth!.accessToken);
  const result = await client.rpc("change_directory_field_set", {
    target_org: orgId,
    expected_fields: change.expected,
    replacement: change.action === "replace" ? change.fields : null,
    remove_key: change.action === "remove" ? change.key : null,
    confirm_value_loss: change.action === "remove" || change.confirmValueLoss,
  });
  if (result.error?.code === "P0001") {
    res.status(409).json({ message: "Confirm deletion of saved member values.", code: "FIELD_VALUES_EXIST" });
    return;
  }
  if (result.error?.code === "23505" || result.error?.code === "21000") throw new AppError(400, "Field keys must be unique.");
  if (result.error?.code === "40001") throw new AppError(409, "The field list changed. Review the latest fields and try again.");
  if (result.error?.code === "P0002") throw new AppError(404, "Directory field not found.");
  if (result.error) throw directoryError(result.error);
  res.sendStatus(204);
}));

router.get(path, catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const { q, status, page, group, attributeKey, attributeValue, sort, direction } = filters.parse(req.query);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You do not have access to this directory.");
  const query = client.from("organization_directory_members").select(group ? fields + ",matching_groups:directory_group_members!inner(group_id),directory_group_members(directory_groups(name))" : fields + ",directory_group_members(directory_groups(name))", { count: "exact" })
    .eq("organization_id", orgId).order(({name:"display_name",identifier:"member_code",status:"status",recent:"created_at"})[sort],{ascending:sort !== "recent" && direction==="asc"}).order("id")
    .range(page * 25, page * 25 + 24);
  if (status !== "all") query.eq("status", status);
  if (group) query.eq("matching_groups.group_id", group);
  if (attributeKey && attributeValue !== undefined) {
    const field = await client.from("directory_field_definitions").select("kind")
      .eq("organization_id", orgId).eq("active", true).eq("key", attributeKey).maybeSingle();
    if (field.error) throw directoryError(field.error);
    if (!field.data) throw new AppError(400, "Choose an existing custom field.");
    const kind = field.data.kind;
    const value = kind === "number" ? Number(attributeValue) : kind === "checkbox" ? attributeValue === "true" : attributeValue;
    if (kind === "number" && (!attributeValue.trim() || !Number.isFinite(value)) ||
        kind === "checkbox" && !["true", "false"].includes(attributeValue)) {
      throw new AppError(400, "Enter a valid filter value.");
    }
    query.contains("attributes", { [attributeKey]: value });
  }
  if (q) {
    const literal = q.replace(/[\\%_*]/g, "\\$&").replace(/[\\"]/g, "\\$&");
    const searchableFields = ["display_name", "member_code", "attributes->>student_id",
      "attributes->>employee_id", "attributes->>membership_id", "attributes->>member_id"];
    query.or(searchableFields.map(field => `${field}.ilike."%${literal}%"`).join(","));
  }
  const [result, ...permissions] = await Promise.allSettled([
    query, checkCapability(client, orgId, "edit"), checkCapability(client, orgId, "import"),
    checkCapability(client, orgId, "export"), checkCapability(client, orgId, "financial_view"),
  ] as const);
  if (result.status === "rejected") throw result.reason;
  if (result.value.error) throw directoryError(result.value.error);
  const [canEdit, canImport, canExport, canViewFinances] = permissions.map(
    permission => permission.status === "fulfilled" && permission.value,
  );
  res.json({ members: result.value.data, total: result.value.count ?? 0, canEdit, canImport, canExport, canViewFinances });
}));

router.get(path + "/summary", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You do not have access to this directory.");
  const members = () => client.from("organization_directory_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  const [active, archived, groups] = await Promise.all([
    members().eq("status", "active"), members().eq("status", "archived"),
    client.from("directory_groups").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
  ]);
  const error = active.error ?? archived.error ?? groups.error;
  if (error) throw directoryError(error);
  res.json({ total: active.count, active: active.count, archived: archived.count, groups: groups.count });
}));

router.post(path, catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot add directory members.");
  const parsed = input.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Check the member fields.", issues: parsed.error.issues.map(issue => ({
      field: issue.path.join("."), message: issue.message,
    })) });
    return;
  }
  const issues = await validateMemberAttributes(client, orgId, parsed.data.attributes);
  if (issues.length) { res.status(400).json({ message: "Check the custom field values.", issues }); return; }
  const result = await client.from("organization_directory_members")
    .insert({ ...parsed.data, organization_id: orgId }).select(fields).single();
  if (result.error?.code === "23505") {
    res.status(409).json({ message: "That member identifier is already in use.",
      issues: [{ field: "member_code", message: "Choose a unique member identifier." }] });
    return;
  }
  if (result.error) throw directoryError(result.error);
  res.status(201).json({ member: result.data });
}));

for (const method of ["get", "delete"] as const) {
  router[method](path + "/:memberId" + (method === "get" ? "/delete-preview" : ""), catchErrors(async (req,res) => {
    const orgId=uuid.parse(req.params.organizationId);
    const memberId=uuid.parse(req.params.memberId);
    const client=createUserClient(req.auth!.accessToken);
    if (!await checkCapability(client,orgId,"edit")) throw new AppError(403,"You cannot manage directory members.");
    const result=await client.rpc(method === "get" ? "directory_member_delete_preview" : "delete_directory_member", {target_org:orgId,target_member:memberId});
    if (result.error?.code === "23503") throw new AppError(409,"This member has protected dependencies. Archive the member instead.");
    if (result.error?.code === "P0002") throw new AppError(404,"Directory member not found.");
    if (result.error) throw directoryError(result.error);
    if (method === "get") res.json(result.data);
    else res.sendStatus(204);
  }));
}

router.patch(path + "/:memberId", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const memberId = uuid.parse(req.params.memberId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot edit directory members.");
  const parsed = input.partial().extend({ status: z.enum(["active", "archived"]).optional() })
    .refine(value => Object.keys(value).length > 0, "Provide at least one change.").safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Check the member fields.", issues: parsed.error.issues.map(issue => ({
      field: issue.path.join("."), message: issue.message,
    })) });
    return;
  }
  const patch = parsed.data;
  const issues = await validateMemberAttributes(client, orgId, patch.attributes);
  if (issues.length) { res.status(400).json({ message: "Check the custom field values.", issues }); return; }
  const result = await client.from("organization_directory_members").update(patch)
    .eq("organization_id", orgId).eq("id", memberId).select(fields).maybeSingle();
  if (result.error?.code === "23505") {
    res.status(409).json({ message: "That member identifier is already in use.",
      issues: [{ field: "member_code", message: "Choose a unique member identifier." }] });
    return;
  }
  if (result.error) throw directoryError(result.error);
  if (!result.data) throw new AppError(404, "Directory member not found.");
  res.json({ member: result.data });
}));

router.get(path + "/groups", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You do not have access to this directory.");
  const result = await client.from("directory_groups").select("id,name,directory_group_members(count)").eq("organization_id", orgId).order("name");
  if (result.error) throw directoryError(result.error);
  res.json({ groups: result.data });
}));

router.post(path + "/groups", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot manage groups.");
  const result = await client.from("directory_groups").insert({ organization_id: orgId, name });
  if (result.error?.code === "23505") throw new AppError(409, "A group with that name already exists.");
  if (result.error) throw directoryError(result.error);
  res.sendStatus(201);
}));

router.get(path + "/:memberId/groups", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const memberId = uuid.parse(req.params.memberId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You do not have access to this directory.");
  const result = await client.from("directory_group_members").select("group_id")
    .eq("organization_id", orgId).eq("member_id", memberId);
  if (result.error) throw directoryError(result.error);
  res.json({ groupIds: result.data.map(row => row.group_id) });
}));

router.put(path + "/:memberId/groups/:groupId", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const memberId = uuid.parse(req.params.memberId);
  const groupId = uuid.parse(req.params.groupId);
  const { included } = z.object({ included: z.boolean() }).parse(req.body);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "edit")) throw new AppError(403, "You cannot manage groups.");
  const result = included
    ? await client.from("directory_group_members").upsert({ organization_id: orgId, member_id: memberId, group_id: groupId }, { ignoreDuplicates: true })
    : await client.from("directory_group_members").delete().eq("organization_id", orgId).eq("member_id", memberId).eq("group_id", groupId);
  if (result.error?.code === "23503") throw new AppError(404, "Member or group not found in this organization.");
  if (result.error) throw directoryError(result.error);
  res.sendStatus(204);
}));

router.post([path + "/import", path + "/import/preview"], catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "import")) throw new AppError(403, "You cannot import directory members.");
  const { requestId, rows, newFields } = z.object({
    requestId: uuid,
    rows: z.array(z.unknown()).min(1).max(500),
    newFields: z.array(definition.pick({ key: true, label: true }).extend({
      kind: z.enum(["text", "number", "date", "checkbox"]),
    })).max(10).default([]),
  }).parse(req.body);
  const preview = req.path.endsWith("/preview");
  if (newFields.length && !await checkCapability(client, orgId, "edit")) {
    throw new AppError(403, "You cannot add directory fields.");
  }
  const parsed = rows.map(row => input.safeParse(row));
  const issues = parsed.flatMap((row, index) => row.success ? [] : row.error.issues.map(issue => ({
    row: index + 2, field: issue.path.join(".") || "Record", message: issue.message,
  })));
  const definitions = await client.from("directory_field_definitions").select("key,label,kind,options")
    .eq("organization_id", orgId).eq("active", true);
  if (definitions.error) throw directoryError(definitions.error);
  const proposedLabels = newFields.map(field => field.label.toLowerCase());
  const proposedKeys = newFields.map(field => field.key);
  if (preview && newFields.length && (new Set(proposedLabels).size !== newFields.length ||
    new Set(proposedKeys).size !== newFields.length ||
    definitions.data.some(field => proposedLabels.includes(field.label?.trim().toLowerCase()) || proposedKeys.includes(field.key)))) {
    throw new AppError(409, "A proposed field matches an existing directory field. Edit columns and use the existing field.");
  }
  const importDefinitions = [...definitions.data, ...newFields.map(field => ({ ...field, options: [] }))];
  const attributeIssues = await Promise.all(parsed.map(async (row, index) => row.success
    ? (await validateMemberAttributes(client, orgId, row.data.attributes, importDefinitions)).map(issue => ({ ...issue, row: index + 2 }))
    : []));
  issues.push(...attributeIssues.flat());
  if (issues.length) {
    res.status(400).json({ message: "Correct the invalid import rows and try again.", issues });
    return;
  }
  const roster = parsed.flatMap(row => row.success ? [row.data] : []);
  const result = preview
    ? await client.rpc("preview_directory_import", { target_org: orgId, roster })
    : newFields.length
      ? await client.rpc("commit_directory_import_with_fields", {
        target_org: orgId, request_key: requestId, roster, proposed_fields: newFields,
      })
      : await client.rpc("commit_directory_import", { target_org: orgId, request_key: requestId, roster });
  if (newFields.length && result.error?.code === "23505") {
    throw new AppError(409, "Directory fields or members changed during import. Edit columns and review the file again.");
  }
  if (result.error) throw directoryError(result.error);
  res.json(preview ? { rows: result.data } : result.data);
}));

router.get(path + "/export", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "export")) throw new AppError(403, "You cannot export directory records.");
  const schema = await client.from("directory_field_definitions").select(schemaFields)
    .eq("organization_id", orgId).eq("active", true).order("display_order").order("label").order("key");
  if (schema.error) throw directoryError(schema.error);

  // Labels are editable and need not be unique. Qualify collisions with stable keys.
  const normalize = (value: string) => value.trim().toLowerCase();
  const fixed = ["Member ID", "Full Name", "Email", "Phone", "Status"];
  const used = new Set(fixed.map(normalize));
  const custom = schema.data.map(field => {
    let label = field.label;
    while (used.has(normalize(label))) label += ` [${field.key}]`;
    used.add(normalize(label));
    return { ...field, exportLabel: label };
  });
  const headers = ["Full Name", ...custom.map(field => field.exportLabel),
    "Email", "Phone", "Status [Bantai CSV]"];
  const getPage = (after?: string) => {
    const page = client.from("organization_directory_members").select(fields)
      .eq("organization_id", orgId).order("id").limit(250);
    return after ? page.gt("id", after) : page;
  };
  let page = await getPage();
  if (page.error) throw directoryError(page.error);
  res.attachment("member-directory.csv").type("text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  const write = async (line: string) => {
    if (!res.write(line)) await new Promise<void>(resolve => {
      const finish = () => { res.off("drain", finish); res.off("close", finish); resolve(); };
      res.once("drain", finish);
      res.once("close", finish);
    });
  };
  await write(headers.map(quoteDirectoryCsvCell).join(",") + "\r\n");
  while (!res.destroyed) {
    if (page.error) { res.destroy(); return; }
    const rows = page.data;
    for (const row of rows) {
      if (res.destroyed) return;
      const values = [row.display_name, ...custom.map(field => row.attributes[field.key]),
        row.email, row.phone, row.status];
      await write(values.map(quoteDirectoryCsvCell).join(",") + "\r\n");
    }
    if (rows.length < 250) break;
    page = await getPage(rows[rows.length - 1].id);
  }
  res.end();
}));

router.get(path + "/:memberId/financial-summary", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const memberId = uuid.parse(req.params.memberId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "financial_view")) throw new AppError(403, "You cannot view member finances.");
  const result = await client.rpc("directory_member_financial_summary", { target_org: orgId, target_member: memberId });
  if (result.error) throw directoryError(result.error);
  res.json({ summaries: result.data, scope: "all_periods" });
}));

for (const [resource, rpc] of [
  ["obligations", "directory_member_obligations"],
  ["payments", "directory_member_payments"],
] as const) {
  router.get(path + "/:memberId/" + resource, catchErrors(async (req, res) => {
    const orgId = uuid.parse(req.params.organizationId);
    const memberId = uuid.parse(req.params.memberId);
    const page = filters.shape.page.parse(req.query.page);
    const client = createUserClient(req.auth!.accessToken);
    if (!await checkCapability(client, orgId, "financial_view")) throw new AppError(403, "You cannot view member finances.");
    const result = await client.rpc(rpc, {
      target_org: orgId, target_member: memberId, page_offset: page * 25,
    });
    if (result.error) throw directoryError(result.error);
    res.json({ [resource]: result.data.slice(0, 25), hasMore: result.data.length > 25 });
  }));
}

router.get(path + "/time-zone", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const client = createUserClient(req.auth!.accessToken);
  if (!await checkCapability(client, orgId, "view")) throw new AppError(403, "You cannot view the directory.");
  const result = await client.from("organizations").select("time_zone").eq("id", orgId).single();
  if (result.error) throw directoryError(result.error);
  res.json({ timeZone: result.data.time_zone });
}));

router.put(path + "/time-zone", catchErrors(async (req, res) => {
  const orgId = uuid.parse(req.params.organizationId);
  const { timeZone } = z.object({ timeZone: z.string().trim().min(1).max(100) }).parse(req.body);
  const result = await createUserClient(req.auth!.accessToken).rpc("set_organization_time_zone", {
    target_org: orgId, zone: timeZone,
  });
  if (result.error?.code === "23514") throw new AppError(400, "Choose a valid time zone, such as Asia/Manila.");
  if (result.error) throw directoryError(result.error);
  res.sendStatus(204);
}));

export default router;
