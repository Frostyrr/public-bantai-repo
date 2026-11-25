import { downloadSpreadsheet, type ExportFormat } from "../../utils/downloadSpreadsheet";
import AnimatedNumber from "../../components/ui/AnimatedNumber";
import Badge from "../../components/ui/Badge";
import { toast } from "../../lib/toast";
import { isAxiosError } from "axios";
import { recommendedDirectoryColumns, resolveDirectoryColumns } from "../../utils/directoryColumns";
import { directoryDisplayIdentifier, directoryFormHeading, directoryFieldPlaceholder, organizationTypes } from "../../lib/organizationTypes";
import useAuth from "../../hooks/useAuth";
import { UserPlus, Upload, Download, Columns3, Search, Check, ChevronDown, Ellipsis, SlidersHorizontal, Users, Eye, Pencil, Archive, RotateCcw, Trash2, Layers, GraduationCap, Briefcase, Plus } from "lucide-react";
import FloatingMenu from "../../components/ui/FloatingMenu";
import DirectoryObligations from "../../components/org/directory/DirectoryObligations";
import DirectoryImport from "../../components/org/directory/DirectoryImport";
import { useCallback, useDeferredValue, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import API from "../../config/apiClient";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Select from "../../components/ui/Select";
import DetailInspector, {
  InspectorField,
  InspectorGrid,
  InspectorSection,
} from "../../components/ui/DetailInspector";
import { useInspectorSelection } from "../../hooks/useInspectorSelection";
import { formatErrorMessage } from "../../utils/formatError";
import type { OrganizationDetails } from "../../lib/api";

type Status = "active" | "archived";
type FieldKind = "text" | "number" | "date" | "checkbox" | "select";
const fieldKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "").slice(0, 38).replace(/^(?=[0-9]|$)/, "f_");
type Field = { key: string; label: string; kind: FieldKind; options: string[]; display_order?: number; default_visible?: boolean; template_version?: number | null; import_aliases?: string[] };
type Attributes = Record<string, string | number | boolean>;
const presets: Record<string, readonly string[]> = {
  Student: organizationTypes[0].fields,
  Workplace: organizationTypes[1].fields,
  Association: organizationTypes[2].fields,
  Nonprofit: organizationTypes[3].fields,
};
type Member = {
  id: string;
  display_name: string;
  member_code: string | null;
  email: string | null;
  phone: string | null;
  status: Status;
  directory_group_members?: { directory_groups: { name: string } | null }[];
  attributes: Attributes;
};
const blank = { display_name: "", member_code: "", email: "", phone: "" };

export default function OrgDirectory() {
  const { organization } = useOutletContext<{ organization: OrganizationDetails }>();
  const { user } = useAuth();
  const columnStorageKey = `bantai_directory_columns_${user?.id ?? "user"}_${organization.id}`;
  const [columnPreferences, setColumnPreferences] = useState<{ storageKey: string; keys: string[] } | null>(null);
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const [financialMember, setFinancialMember] = useState<Member | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [group, setGroup] = useState("");
  const [groupName, setGroupName] = useState("");
  const [filterKey, setFilterKey] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [choiceText, setChoiceText] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState<Status | "all">("active");
  const [sort,setSort]=useState<"name"|"recent">("name");
  const [direction,setDirection]=useState<"asc"|"desc">("asc");
  const [page, setPage] = useState(0);
  const [lifecycle, setLifecycle] = useState<{member:Member;action:"archive"|"restore"|"delete"}|null>(null);
  const [editor, setEditor] = useState<Member | "new" | null>(null);
  const [draft, setDraft] = useState(blank);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const [attributes, setAttributes] = useState<Attributes>({});
  const [template, setTemplate] = useState<string | null>(null);
  const [reviewedFields, setReviewedFields] = useState<Field[]>([]);
  const [draftFields, setDraftFields] = useState<Field[]>([]);
  const [confirmation, setConfirmation] = useState<"discard" | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [fieldEditor, setFieldEditor] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldKind, setFieldKind] = useState<FieldKind>("text");
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const client = useQueryClient();
  const path = `/organizations/${organization.id}/directory`;
  const queryKey = ["directory", organization.id];
  const directory = useQuery({
    queryKey: [...queryKey, q, status, page, group, filterKey, filterValue, sort, direction],
    queryFn: async ({ signal }) => (await API.get<{ members: Member[]; total: number; canEdit: boolean; canImport: boolean; canExport: boolean; canViewFinances: boolean }>(
      path, { params: { q, status, page, sort, direction, group: group || undefined, attributeKey: filterKey || undefined, attributeValue: filterValue || undefined }, signal },
    )).data,
  });
  const organizationType = useQuery({
    queryKey: ["organization-type", organization.id],
    queryFn: async () => (await API.get<{ organizationType: string | null }>(`/organizations/${organization.id}/type`)).data.organizationType,
  });
  const summary = useQuery({
    queryKey: [...queryKey, "summary"],
    queryFn: async () => (await API.get<{ total: number; active: number; archived: number; groups: number }>(path + "/summary")).data,
  });
  const fields = useQuery({
    queryKey: [...queryKey, "fields"],
    enabled: directory.isSuccess,
    queryFn: async () => (await API.get<{ fields: Field[] }>(path + "/fields")).data.fields,
  });
  const groups = useQuery({
    queryKey: [...queryKey, "groups"],
    enabled: directory.isSuccess,
    queryFn: async () => (await API.get<{ groups: { id: string; name: string; directory_group_members?: { count: number }[] }[] }>(path + "/groups")).data.groups,
  });
  const memberGroups = useQuery({
    queryKey: [...queryKey, "member-groups", editor && editor !== "new" ? editor.id : null],
    enabled: Boolean(editor && editor !== "new"),
    queryFn: async () => editor && editor !== "new"
      ? (await API.get<{ groupIds: string[] }>(path + "/" + editor.id + "/groups")).data.groupIds : [],
  });
  const changeGroup = useMutation({
    mutationFn: async ({ id, included }: { id: string; included: boolean }) => {
      if (editor && editor !== "new") await API.put(path + "/" + editor.id + "/groups/" + id, { included });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey }); void client.invalidateQueries({queryKey:["obligations",organization.id]}); void client.invalidateQueries({queryKey:["dues-assignment-preview",organization.id]}); },
  });
  const createGroup = useMutation({
    mutationFn: async () => { await API.post(path + "/groups", { name: groupName.trim() }); },
    onSuccess: () => {
      setGroupName("");
      void client.invalidateQueries({ queryKey });
    },
  });
  const saveFields = useMutation({
    mutationFn: async () => {
      await API.post(path + "/fields/change-set", {
        action: "replace", fields: draftFields.map(({key,label,kind,options}) => ({key,label,kind,options})), expected: reviewedFields.map(({key,label,kind,options}) => ({key,label,kind,options})), confirmValueLoss: false,
      });
    },
    onSuccess: async () => {
      await fields.refetch();
      if (!draftFields.some(field => field.key === filterKey)) {
        setFilterKey("");
        setFilterValue("");
      }
      setPage(0);
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ["directory-assignment-filters", organization.id] }),
        client.invalidateQueries({ queryKey: ["directory-assignment", organization.id] }),
      ]);
      setConfirmation(null);
      setShowFields(false);
    },

  });
  const fieldsBusy = saveFields.isPending;
  const exportDirectory = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const response = await API.get<Blob>(path + "/export", { responseType: "blob" });
      await downloadSpreadsheet(response.data, "member-directory", format);
    },
  });
  const deletePreview = useQuery({
    queryKey:[...queryKey,"delete-preview",lifecycle?.member.id],
    enabled:lifecycle?.action === "delete",
    queryFn:async ({signal}) => (await API.get<{canDelete:boolean;obligations:number;groupMemberships:number;frozenCollections?:number}>(`${path}/${lifecycle!.member.id}/delete-preview`,{signal})).data,
  });
  const lifecycleMutation=useMutation({
    mutationFn:async () => {
      if (!lifecycle) return;
      if (lifecycle.action === "delete") await API.delete(`${path}/${lifecycle.member.id}`);
      else await API.patch(`${path}/${lifecycle.member.id}`,{status:lifecycle.action === "archive" ? "archived" : "active"});
    },
    onSuccess:async () => {
      toast.success(lifecycle?.action === "delete" ? "Member permanently deleted." : lifecycle?.action === "archive" ? "Member archived." : "Member restored.");
      setLifecycle(null);
      await Promise.all([client.invalidateQueries({queryKey}),client.invalidateQueries({queryKey:["directory-assignment",organization.id]}),
        client.invalidateQueries({queryKey:["obligations",organization.id]})]);
    },
  });
  const [inlineDraft, setInlineDraft] = useState<Member | null>(null);
  const [inlineGroups, setInlineGroups] = useState<string[]>([]);
  const [profileMenu, setProfileMenu] = useState(false);
  const inlineSave = useMutation({
    mutationFn: async () => {
      if (!inlineDraft) throw new Error("Select a member first.");
      const { display_name, member_code, email, phone, status } = inlineDraft;
      const response = await API.patch<{ member: Member }>(path + "/" + inlineDraft.id, {
        display_name: display_name.trim(), member_code: member_code?.trim() || null,
        email: email?.trim() || null, phone: phone?.trim() || null, status,
      });
      for (const group of groups.data ?? []) {
        await API.put(path + "/" + inlineDraft.id + "/groups/" + group.id, { included: inlineGroups.includes(group.id) });
      }
      return { ...response.data.member, directory_group_members: (groups.data ?? []).filter(group => inlineGroups.includes(group.id)).map(group => ({ directory_groups: { name: group.name } })) };
    },
    onSuccess: () => {
      setInlineDraft(null);
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: ["directory-assignment", organization.id] });
      toast.success("Member changes saved.");
    },
  });
  const membersList = directory.data?.members ?? [];
  const getMemberId = useCallback((m: Member) => m.id, []);
  const {
    selectedItem: profileMember,
    selectItem: setProfileMember,
    close: clearProfileSelection,
    navigate: navigateProfile,
  } = useInspectorSelection(membersList, getMemberId);

  const closeProfile = () => {
    if (inlineSave.isPending) return;
    setInlineDraft(null);
    setProfileMenu(false);
    clearProfileSelection();
  };
  const openLifecycle=(member:Member,action:"archive"|"restore"|"delete") => {
    lifecycleMutation.reset();setMenu(null);setProfileMember(null);setLifecycle({member,action});
    void client.invalidateQueries({queryKey:[...queryKey,"delete-preview",member.id]});
  };
  const save = useMutation({
    mutationFn: async (action: "save" | "archive" | "restore") => {
      if (!editor) return;
      const payload = {
        display_name: draft.display_name.trim(),
        member_code: draft.member_code.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        attributes: Object.fromEntries(Object.entries(attributes).filter(([key]) => fields.data?.some(field => field.key === key))),
      };
      if (editor === "new") await API.post(path, payload);
      else await API.patch(`${path}/${editor.id}`, action === "save" ? payload : {
        status: action === "archive" ? "archived" : "active",
      });
    },
    onSuccess: (_result, action) => {
      toast.success(action === "save" ? (editor === "new" ? "Member added." : "Member changes saved.") : action === "archive" ? "Member archived." : "Member restored.");
      setEditor(null);
      void Promise.all([
        client.invalidateQueries({queryKey}),
        client.invalidateQueries({queryKey:["directory-assignment",organization.id]}),
        client.invalidateQueries({queryKey:["obligations",organization.id]}),
        client.invalidateQueries({queryKey:["payments",organization.id]}),
      ]);
    },
    onError: error => {
      if (isAxiosError<{ issues?: { field: string; message: string }[] }>(error)) {
        const issues = error.response?.data?.issues ?? [];
        setMemberErrors(Object.fromEntries(issues.map(issue => [issue.field, issue.message])));
        if (issues.some(issue => ["member_code", "email", "phone"].includes(issue.field))) setAdditionalOpen(true);
      }
    },
  });
  const openEditor = (member: Member | "new") => {
    save.reset();
    setMemberErrors({});
    void fields.refetch();
    changeGroup.reset();
    setAttributes(member === "new" ? {} : member.attributes ?? {});
    setDraft(member === "new" ? blank : {
      display_name: member.display_name,
      member_code: member.member_code ?? "",
      email: member.email ?? "",
      phone: member.phone ?? "",
    });
    setAdditionalOpen(member !== "new" && Boolean(member.member_code || member.email || member.phone));
    setEditor(member);
  };
  const closeEditor = () => { if (!save.isPending && !changeGroup.isPending) setEditor(null); };
  const clearAdvancedFilters = () => { setGroup(""); setFilterKey(""); setFilterValue(""); setPage(0); };
  const fieldsChanged = JSON.stringify(draftFields) !== JSON.stringify(reviewedFields);
  const openFields = () => {
    if (!fields.isSuccess) return;
    saveFields.reset();
    setReviewedFields(fields.data);
    setDraftFields(fields.data);
    setConfirmation(null);
    setFieldError("");
    setFieldEditor(false);
    setRenameKey(null);
    setTemplate(null);
    setShowFields(true);
  };
  const closeFields = () => {
    if (fieldsBusy) return;
    setMenu(null);
    if (confirmation) setConfirmation(null);
    else if (fieldsChanged || fieldEditor || template) setConfirmation("discard");
    else setShowFields(false);
  };
  const openFieldEditor = (field?: Field) => {
    saveFields.reset();
    setFieldError("");
    setTemplate(null);
    setRenameKey(field?.key ?? null);
    setFieldLabel(field?.label ?? "");
    setFieldKind(field?.kind ?? "text");
    setChoiceText("");
    setFieldEditor(true);
  };
  const previewFields: Field[] = (template ? presets[template] : []).map(label => {
    const key = label === "Position" ? "job_title" : fieldKey(label);
    return (fields.data ?? []).find(field => field.key === key) ?? {
      key, label, kind: label === "Join Date" ? "date" : label === "Employment Status" ? "select" : "text",
      options: label === "Employment Status" ? ["Active", "On leave", "Inactive"] : [],
    };
  });
  const availableColumns = [
    { key: "identifier", label: "Identifier" }, { key: "groups", label: "Groups" }, { key: "status", label: "Status" },
    ...(fields.data ?? []).map(field => ({ key: "custom:" + field.key, label: field.label })),
  ];
  let storedPreference: unknown;
  if (columnPreferences?.storageKey === columnStorageKey) {
    storedPreference = { version: 1, keys: columnPreferences.keys };
  } else {
    try { storedPreference = JSON.parse(localStorage.getItem(columnStorageKey) ?? "null"); }
    catch { /* Invalid preferences fall back to the recommendation. */ }
  }
  const availableKeys = availableColumns.map(column => column.key);
  const schemaDefaults = fields.data?.some(field => field.display_order !== undefined)
    ? [...(fields.data?.some(field => field.display_order === 10) ? [] : ["identifier"]), ...(fields.data ?? []).filter(field => field.default_visible).map(field => "custom:" + field.key), "status"]
    : undefined;
  const preferredKeys = resolveDirectoryColumns(
    schemaDefaults || organizationType.isError ? organizationType.data ?? null : organizationType.data,
    fields.isSuccess ? availableKeys : undefined, storedPreference, schemaDefaults,
  );
  const columnsReady = preferredKeys !== null;
  const visibleColumns = (preferredKeys ?? ["identifier", "status"]).flatMap(key => {
    const column = availableColumns.find(item => item.key === key);
    return column ? [column] : [];
  });
  const recommendedKeys = schemaDefaults ?? recommendedDirectoryColumns(organizationType.data ?? null, availableKeys);
  const columnDraftChanged = (preferredKeys ?? []).length !== draftColumns.length ||
    (preferredKeys ?? []).some((key, index) => draftColumns[index] !== key);
  const applyColumns = () => {
    setColumnPreferences({ storageKey: columnStorageKey, keys: draftColumns });
    try { localStorage.setItem(columnStorageKey, JSON.stringify({ version: 1, keys: draftColumns })); } catch { /* Keep the session preference. */ }
    setShowColumns(false);
  };
  const members = directory.data?.members ?? [];

  return (
    <div className="page-shell workspace-page">
      <header data-tour="directory-header" className="flex flex-col gap-4 border-b border-subtle pb-6 xl:flex-row xl:flex-wrap xl:items-end xl:justify-between">
        <div>
          <Badge variant="context" className="page-header-eyebrow">Directory</Badge>
          <h1 className="page-title"><span className="text-display-gradient">Member Directory</span></h1>
          <p className="page-subtitle">Manage explicitly added or imported members. Workspace access is managed separately.</p>
        </div>
        <div data-tour="directory-actions" role="group" aria-label="Directory actions" className="flex flex-wrap items-center gap-2">
          {directory.data?.canEdit && (
            <Button className="min-h-11" icon={<UserPlus size={16} />} onClick={() => openEditor("new")}>Add member</Button>
          )}
          {directory.data?.canImport && (
            <Button variant="outline" className="min-h-11" icon={<Upload size={16} />}
              disabled={!fields.isSuccess || !organizationType.isSuccess}
              onClick={() => { setMenu(null); setShowImport(true); }}>Import members</Button>
          )}
          {directory.data?.canExport && (
            <div className="relative">
              <Button variant="outline" className="min-h-11" icon={<Download size={16} />} iconRight={<ChevronDown size={16} />}
                isLoading={exportDirectory.isPending}
                aria-expanded={menu === "export"} aria-controls={menu === "export" ? "directory-export" : undefined}
                onKeyDown={event => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setMenu("export");
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#directory-export button")?.focus());
                }}
                onClick={() => setMenu(menu === "export" ? null : "export")}>Export</Button>
              {menu === "export" && (
                <FloatingMenu id="directory-export" aria-label="Export format" align="left" mobileSpacing
                  className="w-48 rounded-xl border border-subtle bg-surface p-1 shadow-xl" onClose={() => setMenu(null)}
                  onKeyDown={event => {
                    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                    const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
                    const first = buttons[0];
                    const last = buttons.at(-1);
                    event.preventDefault();
                    if (event.key === "Home") first?.focus();
                    else if (event.key === "End") last?.focus();
                    else (event.target === first ? last : first)?.focus();
                  }}>
                  <Button variant="ghost" className="min-h-11 w-full justify-start!"
                    onClick={() => { setMenu(null); exportDirectory.mutate("xlsx"); }}>Excel (.xlsx)</Button>
                  <Button variant="ghost" className="min-h-11 w-full justify-start!"
                    onClick={() => { setMenu(null); exportDirectory.mutate("csv"); }}>CSV (.csv)</Button>
                </FloatingMenu>
              )}
            </div>
          )}
          {directory.data?.canEdit && (
            <>
              <Button variant="outline" className="min-h-11" icon={<Users size={16} />}
                onClick={() => { setMenu(null); setShowGroups(true); }}>Manage groups</Button>
              <Button variant="outline" className="min-h-11" icon={<SlidersHorizontal size={16} />}
                onClick={() => { setMenu(null); openFields(); }}>Directory fields</Button>
            </>
          )}
        </div>
      </header>
      <section aria-label="Directory summary" className="grid grid-cols-2 gap-2 sm:gap-3">
        {[
          { label: "Eligible members", value: summary.data?.active, Icon: Users },
          { label: "Groups", value: summary.data?.groups, Icon: Layers },
        ].map(({ label, value, Icon }) => <div key={label} className="card-specular rounded-xl border border-subtle bg-surface shadow-xs dark:shadow-none p-3 sm:p-4">
          <p className="flex items-center gap-2 text-xs text-secondary sm:text-sm"><Icon size={16} aria-hidden="true" />{label}</p>
          <p className="mt-1 metric-value text-primary">{value !== undefined ? <AnimatedNumber value={value} /> : "—"}</p>
        </div>)}
      </section>
      {summary.isError && <p role="status" className="text-sm text-secondary">Directory counts are temporarily unavailable.</p>}
      {exportDirectory.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(exportDirectory.error)}</p>}
      {showImport && <DirectoryImport path={path} fields={fields.data ?? []} isStudent={organizationType.data === "student"} canEditFields={directory.data?.canEdit === true} onClose={() => setShowImport(false)}
        onImported={() => { void client.invalidateQueries({queryKey:["obligations",organization.id]}); void client.invalidateQueries({queryKey:["dues-assignment-preview",organization.id]}); void client.invalidateQueries({ queryKey }); void client.invalidateQueries({queryKey:["directory-assignment",organization.id]}); }} />}
      <div data-tour="directory-list" className="filter-toolbar">
        <div className="toolbar-search toolbar-search min-w-0"><Input icon={<Search size={16} />} className="py-2.5!" aria-label="Search by name or identifier"
          placeholder="Search by name or identifier..." value={search}
          maxLength={100} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
        <div className="min-w-32 shrink-0"><Select buttonClassName="min-h-11" ariaLabel="Member status" value={status} onChange={event => { setStatus(event.target.value as Status | "all"); setPage(0); }}
          options={[{ value: "active", label: "Active" }, { value: "archived", label: "Inactive" }, { value: "all", label: "All" }]} /></div>
        <div className="min-w-36 shrink-0">
          <Select ariaLabel="Sort members" buttonClassName="min-h-11"
            value={sort === "recent" ? "recent" : direction}
            options={[{ value: "asc", label: "Sort: Name A–Z" }, { value: "desc", label: "Sort: Name Z–A" }, { value: "recent", label: "Sort: Recently Added" }]}
            onChange={event => {
              setSort(event.target.value === "recent" ? "recent" : "name");
              setDirection(event.target.value === "asc" ? "asc" : "desc");
              setPage(0);
            }} />
        </div>
        <div className="min-w-32 shrink-0">
          <Select ariaLabel="Group" buttonClassName="min-h-11" value={group}
            onChange={event => { setGroup(event.target.value); setPage(0); }}
            options={[{ value: "", label: "All Groups" }, ...(groups.data ?? []).map(item => ({ value: item.id, label: item.name }))]} />
        </div>
        <div className="relative">
          <Button variant="outline" className="min-h-11" icon={<Columns3 size={16} />} disabled={!columnsReady} aria-expanded={showColumns}
            aria-controls={showColumns ? "directory-columns" : undefined}
            onClick={() => { setDraftColumns(preferredKeys ?? []); setShowColumns(!showColumns); }}>Columns</Button>
          {showColumns && <FloatingMenu id="directory-columns" role="dialog" aria-labelledby="directory-columns-title"
            align="right" mobileSpacing onClose={() => setShowColumns(false)}
            className="flex max-h-[75dvh] w-80 flex-col rounded-2xl border border-subtle bg-surface p-4 shadow-xl">
            <h2 id="directory-columns-title" className="text-sm font-semibold text-primary section-title">Customize columns</h2>
            <p className="mt-1 text-xs text-secondary">Choose which fields appear in your directory table.</p>
            <div className="my-3 min-h-0 overflow-y-auto overscroll-contain">
              {["Standard fields", "Custom fields"].map((section, index) => <fieldset key={section} className="mb-3">
                <legend className="mb-1 text-xs font-medium text-secondary">{section}</legend>
                {index === 0 && ["Member", "Actions"].map(label => <label key={label} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-secondary">
                  <input type="checkbox" className="peer sr-only" checked disabled />
                  <span className="grid size-4 place-items-center rounded border border-strong bg-elevated text-secondary"><Check size={12} aria-hidden="true" /></span>
                  {label}<span className="ml-auto text-xs">Required</span>
                </label>)}
                {availableColumns.filter(column => column.key.startsWith("custom:") === (index === 1)).map(column => {
                  const checked = draftColumns.includes(column.key);
                  return <label key={column.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-primary hover:bg-elevated">
                    <input type="checkbox" className="peer sr-only" checked={checked} onChange={() =>
                      setDraftColumns(checked ? draftColumns.filter(key => key !== column.key) : [...draftColumns, column.key])} />
                    <span className={`grid size-4 shrink-0 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-strong ${checked ? "border-action bg-action text-action-fg" : "border-strong bg-elevated"}`}>
                      {checked && <Check size={12} aria-hidden="true" />}
                    </span>
                    <span className="break-words">{column.label}</span>
                  </label>;
                })}
                {index === 1 && !fields.data?.length && <p className="px-2 py-2 text-xs text-secondary">No active custom fields.</p>}
              </fieldset>)}
              <p className="px-2 text-xs text-secondary">Identifier is the member code. Custom fields such as Student ID are stored separately.</p>
            </div>
            <footer className="flex shrink-0 justify-between gap-2 border-t border-subtle pt-3">
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setDraftColumns(recommendedKeys)}>Reset to Recommended</Button>
              <Button size="sm" className="min-h-11" disabled={!columnDraftChanged} onClick={applyColumns}>Apply</Button>
            </footer>
          </FloatingMenu>}
        </div>
      </div>
      <Modal isOpen={showGroups} labelledBy="directory-groups" onClose={() => { if (!createGroup.isPending) setShowGroups(false); }}>
        <h2 id="directory-groups" className="font-semibold text-primary section-title">Manage groups</h2>
        <ul className="my-4 divide-y divide-subtle">
          {groups.data?.map(item => <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
            <span className="break-all text-primary">{item.name}</span>
            <span className="shrink-0 text-secondary">{item.directory_group_members?.[0]?.count ?? 0} members</span>
          </li>)}
          {groups.isSuccess && !groups.data.length && <li className="py-3 text-sm text-secondary">No groups yet.</li>}
        </ul>
        {groups.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(groups.error)}</p>}
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (groupName.trim() && !createGroup.isPending) createGroup.mutate();
        }}>
          <Input label="Group name" placeholder="e.g. Editorial Board" maxLength={100} value={groupName} onChange={event => setGroupName(event.target.value)} />
          {createGroup.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(createGroup.error)}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={createGroup.isPending} onClick={() => setShowGroups(false)}>Close</Button>
            <Button type="submit" disabled={!groupName.trim()} isLoading={createGroup.isPending}>Add group</Button></div>
        </form>
      </Modal>
      {directory.isSuccess && !columnsReady && fields.isError && <p role="status" className="text-sm text-secondary">
        Directory fields are unavailable. Showing basic columns.
        {(fields.isError || organizationType.isError) && <Button variant="ghost" onClick={() => { void fields.refetch(); void organizationType.refetch(); }}>Try again</Button>}
      </p>}
      {directory.isPending && (
        <div role="status" aria-label="Loading members" className="space-y-2 rounded-2xl border border-subtle bg-surface p-4 animate-pulse motion-reduce:animate-none">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between gap-4 rounded-xl bg-elevated px-4 py-3.5">
              <div className="space-y-1.5">
                <div className="h-3.5 w-36 rounded bg-skeleton" />
                <div className="h-2.5 w-24 rounded bg-skeleton" />
              </div>
              <div className="h-3 w-20 rounded bg-skeleton" />
            </div>
          ))}
        </div>
      )}
      {directory.isError && <div className="space-y-3"><p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(directory.error)}</p>
        <Button variant="outline" onClick={() => void directory.refetch()}>Try again</Button></div>}
      {directory.isSuccess && (() => {
        const isDense = visibleColumns.length >= 6;
        const isCompact = visibleColumns.length >= 4 && !isDense;
        const cellPad = isDense ? "sm:px-2.5 sm:py-2.5" : isCompact ? "sm:px-3 sm:py-3" : "sm:px-4 sm:py-3.5";
        const firstCellPad = isDense ? "sm:pl-5 sm:pr-2.5 sm:py-2.5" : isCompact ? "sm:pl-5 sm:pr-3 sm:py-3" : "sm:pl-5 sm:pr-4 sm:py-3.5";
        const lastCellPad = isDense ? "sm:pl-2.5 sm:pr-5 sm:py-2.5" : isCompact ? "sm:pl-3 sm:pr-5 sm:py-3" : "sm:pl-4 sm:pr-5 sm:py-3.5";
        const headPad = isDense ? "px-2.5 py-3 text-[10px]" : isCompact ? "px-3 py-3 text-[10.5px]" : "px-4 py-3.5 text-[11px]";
        const firstHeadPad = isDense ? "pl-5 pr-2.5 py-3 text-[10px]" : isCompact ? "pl-5 pr-3 py-3 text-[10.5px]" : "pl-5 pr-4 py-3.5 text-[11px]";
        const lastHeadPad = isDense ? "pl-2.5 pr-5 py-3 text-[10px]" : isCompact ? "pl-3 pr-5 py-3 text-[10.5px]" : "pl-4 pr-5 py-3.5 text-[11px]";
        const cellText = isDense || isCompact ? "text-xs" : "text-sm";
        const subText = isDense ? "text-[11px]" : "text-xs";
        const hasIdentifierColumn = visibleColumns.some(column => column.key === "identifier");
        return (
        <div className="table-specular overflow-x-auto rounded-2xl border border-subtle bg-surface shadow-xs dark:shadow-none">
          <table className={`block w-full text-left ${cellText} sm:table`}>
            <thead className="sr-only sm:not-sr-only sm:table-header-group">
              <tr className="border-b border-subtle bg-elevated font-mono font-normal uppercase tracking-wider text-muted">
                <th scope="col" className={`font-normal ${firstHeadPad}`}>Full Name</th>
                {visibleColumns.map(column => <th key={column.key} scope="col" className={`whitespace-nowrap font-normal ${headPad}`}>{column.label}</th>)}
                <th scope="col" className={`font-normal ${lastHeadPad} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-subtle sm:table-row-group">
              {members.map(member => {
                const isSelected = profileMember?.id === member.id;
                return (
                <tr
                  key={member.id}
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a")) return;
                    setInlineDraft(null);
                    setProfileMember(member);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setInlineDraft(null);
                      setProfileMember(member);
                    }
                  }}
                  className={`relative block p-4 pr-16 transition-colors cursor-pointer sm:table-row sm:p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/30 ${
                    isSelected ? "bg-selected-surface" : "hover:bg-elevated"
                  }`}
                >
                  <th scope="row" className={`block break-all text-left font-medium text-primary sm:table-cell ${firstCellPad}`}>
                    {member.display_name?.trim() || String(member.attributes?.full_name || member.attributes?.name || "—")}
                    {!hasIdentifierColumn && (() => { const identifier = directoryDisplayIdentifier(organizationType.data, fields.data ?? [], member);
                      return identifier ? <span className={`block ${subText} font-normal text-secondary`}>{identifier.label}: {identifier.value}</span> : null; })()}
                    {(member.email || member.phone) && <span className={`block ${subText} font-normal text-secondary`}>{[member.email, member.phone].filter(Boolean).join(" · ")}</span>}
                  </th>
                  {visibleColumns.map((column, index) => {
                    const value = column.key === "identifier" ? member.member_code
                      : column.key === "groups" ? member.directory_group_members?.map(link => link.directory_groups?.name).filter(Boolean).join(", ")
                      : column.key === "status" ? (member.status === "active" ? "Active" : "Archived")
                      : member.attributes[column.key.slice(7)];
                    return <td key={column.key} className={`max-w-52 break-words py-1 ${cellText} text-primary sm:table-cell ${cellPad} ${index < 2 || column.key === "status" ? "block" : "hidden"}`}>
                      <span className="mr-2 text-secondary sm:hidden">{column.label}</span>
                      {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—") || "—"}
                    </td>;
                  })}
                  <td className={`absolute right-3 top-3 block sm:static sm:table-cell ${lastCellPad} sm:text-right`}>
                    <div className="relative inline-block">
                      <button type="button" aria-label={`Actions for ${member.display_name}`} aria-expanded={menu === member.id}
                        className={`grid cursor-pointer place-items-center rounded-xl text-secondary hover:bg-elevated hover:text-primary focus-visible:ring-2 focus-visible:ring-strong ${isDense ? "size-11 sm:size-8" : "size-11 sm:size-9"}`}
                        onClick={() => setMenu(menu === member.id ? null : member.id)}><Ellipsis size={isDense ? 16 : 18} /></button>
                      {menu === member.id && <FloatingMenu align="right" onClose={() => setMenu(null)}
                        className="w-56 rounded-xl border border-subtle bg-surface p-1 shadow-xl">
                        <Button variant="ghost" className="min-h-11 w-full justify-start!" icon={<Eye size={16}/>} onClick={() => { setMenu(null); setProfileMember(member); }}>View details</Button>
                        {directory.data.canEdit && <Button variant="ghost" className="min-h-11 w-full justify-start!" icon={<Pencil size={16}/>} onClick={() => { setMenu(null); openEditor(member); }}>Edit member</Button>}
                        {directory.data.canEdit && <>
                          <Button variant="ghost" className="min-h-11 w-full justify-start!" icon={member.status === "active" ? <Archive size={16}/> : <RotateCcw size={16}/>}
                            onClick={() => openLifecycle(member,member.status === "active" ? "archive" : "restore")}>{member.status === "active" ? "Archive member" : "Restore member"}</Button>
                          <Button variant="ghost" className="min-h-11 w-full justify-start! text-rose-600! dark:text-rose-400!" icon={<Trash2 size={16}/>} onClick={() => openLifecycle(member,"delete")}>Delete member</Button>
                        </>}
                        {directory.data.canViewFinances && <Button variant="ghost" className="min-h-11 w-full justify-start!" onClick={() => { setMenu(null); setFinancialMember(member); }}>Financial history</Button>}
                      </FloatingMenu>}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {!members.length && <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
            <Users size={20} className="text-secondary" aria-hidden="true" />
            <h2 className="font-semibold text-primary section-title">{summary.data?.total === 0 ? "No members yet" : "No matching members"}</h2>
            <p className="text-secondary">{summary.data?.total === 0 ? "Members added or imported into this directory will appear here." : "Try a different search or adjust your filters."}</p>
            {summary.data?.total !== 0 && <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); clearAdvancedFilters(); }}>Clear filters</Button>}
          </div>}
          {(page > 0 || directory.data.total > 25) && <div className="flex items-center justify-between gap-2 border-t border-subtle p-3">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-sm text-secondary">Page {page + 1}</span>
            <Button variant="outline" size="sm" disabled={(page + 1) * 25 >= directory.data.total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>}
        </div>
        );
      })()}
      <DetailInspector
        isOpen={profileMember !== null}
        onClose={closeProfile}
        onNavigate={inlineDraft ? undefined : (dir) => {
          setInlineDraft(null);
          setProfileMenu(false);
          navigateProfile(dir);
        }}
        defaultWidth={540}
        maxWidth={860}
        storageKey="bantai_directory_inspector_width"
        categoryLabel="Member Profile"
        title={
          profileMember ? (
            inlineDraft ? (
              <Input
                aria-label="Full Name"
                required
                maxLength={150}
                value={inlineDraft.display_name}
                onChange={(event) =>
                  setInlineDraft({
                    ...inlineDraft,
                    display_name: event.target.value,
                  })
                }
              />
            ) : (
              profileMember.display_name
            )
          ) : (
            ""
          )
        }
        subtitle={
          profileMember ? <Badge>{profileMember.status}</Badge> : undefined
        }
        headerActions={
          profileMember && directory.data?.canEdit && !inlineDraft ? (
            <div className="relative">
              <button
                type="button"
                aria-label="Member actions"
                aria-expanded={profileMenu}
                onClick={() => setProfileMenu(!profileMenu)}
                className="p-1.5 rounded-lg text-secondary hover:bg-elevated hover:text-primary cursor-pointer"
              >
                <Ellipsis size={18} />
              </button>
              {profileMenu && (
                <FloatingMenu
                  align="right"
                  onClose={() => setProfileMenu(false)}
                  className="w-40 rounded-xl border border-subtle bg-surface p-1 shadow-xl"
                >
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-primary hover:bg-elevated"
                    onClick={() => {
                      setProfileMenu(false);
                      openLifecycle(
                        profileMember,
                        profileMember.status === "active" ? "archive" : "restore"
                      );
                    }}
                  >
                    {profileMember.status === "active" ? "Archive" : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-rose-600 dark:text-rose-400 hover:bg-elevated"
                    onClick={() => {
                      setProfileMenu(false);
                      openLifecycle(profileMember, "delete");
                    }}
                  >
                    Delete
                  </button>
                </FloatingMenu>
              )}
            </div>
          ) : undefined
        }
        footer={
          profileMember ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={inlineSave.isPending}
                onClick={() =>
                  inlineDraft ? setInlineDraft(null) : closeProfile()
                }
              >
                {inlineDraft ? "Cancel" : "Close"}
              </Button>
              {directory.data?.canEdit &&
                (inlineDraft ? (
                  <Button
                    size="sm"
                    className="rounded-full"
                    isLoading={inlineSave.isPending}
                    disabled={!inlineDraft.display_name.trim()}
                    onClick={() => {
                      const form = document.getElementById(
                        "inline-member-form"
                      ) as HTMLFormElement | null;
                      if (form?.reportValidity()) inlineSave.mutate();
                    }}
                  >
                    Save changes
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      inlineSave.reset();
                      setInlineGroups(
                        (groups.data ?? [])
                          .filter((group) =>
                            profileMember.directory_group_members?.some(
                              (link) => link.directory_groups?.name === group.name
                            )
                          )
                          .map((group) => group.id)
                      );
                      setInlineDraft({ ...profileMember });
                    }}
                  >
                    Edit member
                  </Button>
                ))}
            </div>
          ) : undefined
        }
      >
        {profileMember && (
          <div className="space-y-5">
            {inlineDraft ? (
              <form
                id="inline-member-form"
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  inlineSave.mutate();
                }}
              >
                {(["member_code", "email", "phone"] as const).filter(key => key !== "member_code" || organizationType.data !== "student").map((key) => (
                  <Input
                    key={key}
                    label={
                      {
                        member_code: "Member identifier",
                        email: "Email",
                        phone: "Phone",
                      }[key]
                    }
                    type={
                      key === "email"
                        ? "email"
                        : key === "phone"
                        ? "tel"
                        : "text"
                    }
                    value={inlineDraft[key] ?? ""}
                    onChange={(event) =>
                      setInlineDraft({
                        ...inlineDraft,
                        [key]: event.target.value,
                      })
                    }
                  />
                ))}
                <Select
                  label="Status"
                  value={inlineDraft.status}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "archived", label: "Archived" },
                  ]}
                  onChange={(event) =>
                    setInlineDraft({
                      ...inlineDraft,
                      status: event.target.value as Status,
                    })
                  }
                />
                <p className="text-xs text-secondary">Groups</p>
                <div className="space-y-2">
                  {groups.data?.map((group) => (
                    <label
                      key={group.id}
                      className="flex items-center gap-2 text-sm text-primary"
                    >
                      <input
                        type="checkbox"
                        checked={inlineGroups.includes(group.id)}
                        onChange={(event) =>
                          setInlineGroups((previous) =>
                            event.target.checked
                              ? [...previous, group.id]
                              : previous.filter((id) => id !== group.id)
                          )
                        }
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
                {inlineSave.isError && (
                  <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                    {formatErrorMessage(inlineSave.error)}
                  </p>
                )}
              </form>
            ) : (
              <InspectorGrid>
                {[
                  ...(directoryDisplayIdentifier(
                    organizationType.data,
                    fields.data ?? [],
                    profileMember
                  )
                    ? [
                        [
                          "Primary identifier",
                          directoryDisplayIdentifier(
                            organizationType.data,
                            fields.data ?? [],
                            profileMember
                          )!.value,
                        ],
                      ]
                    : []),
                  ["Member identifier", profileMember.member_code],
                  ["Email", profileMember.email],
                  ["Phone", profileMember.phone],
                  [
                    "Groups",
                    profileMember.directory_group_members
                      ?.map((link) => link.directory_groups?.name)
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ...(fields.data ?? []).map((field) => [
                    field.label,
                    profileMember.attributes?.[field.key],
                  ]),
                ].map(([label, value], index) => (
                  <InspectorField
                    key={index}
                    label={String(label)}
                    value={
                      value === true
                        ? "Yes"
                        : value === false
                        ? "No"
                        : value || (value === 0 ? "0" : "—")
                    }
                  />
                ))}
              </InspectorGrid>
            )}

            {directory.data?.canViewFinances && (
              <InspectorSection title="Financial Obligations">
                <div className="rounded-xl border border-subtle dark:border-white/[0.08] bg-elevated/40 dark:bg-white/[0.02] p-4">
                  <DirectoryObligations
                    inline
                    path={`${path}/${profileMember.id}`}
                    name={profileMember.display_name}
                    onClose={closeProfile}
                  />
                </div>
              </InspectorSection>
            )}
          </div>
        )}
      </DetailInspector>
      {financialMember && <DirectoryObligations key={financialMember.id}
        path={path + "/" + financialMember.id} name={financialMember.display_name}
        onClose={() => setFinancialMember(null)} />}
      <Modal isOpen={lifecycle !== null} labelledBy="directory-lifecycle-title" onClose={() => {if (!lifecycleMutation.isPending) setLifecycle(null);}}>
        {lifecycle && <>
          <h2 id="directory-lifecycle-title" className="font-semibold section-title">{lifecycle.action === "delete" ? "Delete member permanently?" : lifecycle.action === "archive" ? "Archive member?" : "Restore member?"}</h2>
          <p className="mt-3 break-words font-medium">{lifecycle.member.display_name}</p>
          <p className="mt-2 text-sm text-secondary">{lifecycle.action === "delete" ? "Deletion is permanent. Members with collection obligations cannot be deleted. Existing audit records are retained." : lifecycle.action === "archive" ? "The member will no longer be available for new dues. Their information, obligations, payments and receipts will be preserved." : "The member will become eligible for new dues. This does not grant workspace access or assign obligations."}</p>
          {lifecycle.action === "delete" && <div className="mt-4 text-sm">
            {deletePreview.isPending && <p role="status">Checking protected dependencies…</p>}
            {deletePreview.isError && <p role="alert" className="text-rose-700 dark:text-rose-300">{formatErrorMessage(deletePreview.error)} <Button variant="ghost" onClick={() => void deletePreview.refetch()}>Try again</Button></p>}
            {deletePreview.data && (deletePreview.data.canDelete ? <p>{deletePreview.data.groupMemberships} group memberships will also be removed. Financial dependencies: none.</p> : <p role="alert" className="text-amber-700 dark:text-amber-400">{deletePreview.data.frozenCollections ? "This member belongs to a closed or archived collection roster. Archive them to preserve that roster." : `This member has ${deletePreview.data.obligations} collection obligations. Archive them to preserve financial history.`}</p>)}
          </div>}
          {lifecycleMutation.isError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(lifecycleMutation.error)}</p>}
          <footer className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={lifecycleMutation.isPending} onClick={() => setLifecycle(null)}>Cancel</Button>
            {lifecycle.action === "delete" && deletePreview.data?.canDelete === false && lifecycle.member.status === "active" && <Button variant="outline" onClick={() => {lifecycleMutation.reset();setLifecycle({...lifecycle,action:"archive"});}}>Archive instead</Button>}
            <Button variant={lifecycle.action === "delete" ? "danger" : "primary"} isLoading={lifecycleMutation.isPending}
              disabled={lifecycle.action === "delete" && (!deletePreview.data?.canDelete || deletePreview.isFetching || deletePreview.isError)} onClick={() => lifecycleMutation.mutate()}>
              {lifecycle.action === "delete" ? "Delete permanently" : lifecycle.action === "archive" ? "Archive member" : "Restore member"}
            </Button>
          </footer>
        </>}
      </Modal>
      <Modal isOpen={editor !== null} onClose={closeEditor} labelledBy="directory-editor-title" maxWidth="max-w-[800px]"
        className="flex max-h-[88dvh]! flex-col overflow-hidden! p-0!">
        <header className="shrink-0 border-b border-subtle px-5 py-4 sm:px-7"><h2 id="directory-editor-title" className="font-semibold text-primary section-title">{editor === "new" ? "Add member" : "Edit member"}</h2>
          <p className="mt-1 text-sm text-secondary">{editor === "new" ? "Add a new member to your organization." : "Update this member's information."}</p></header>
        <form id="directory-member-form" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7" onSubmit={event => {
          event.preventDefault();
          if (!save.isPending && !changeGroup.isPending && fields.isSuccess && !fields.isFetching && draft.display_name.trim()) { setMemberErrors({}); save.mutate("save"); }
        }} onInvalidCapture={event => {
          const target = event.target as HTMLInputElement;
          if (["member_code", "email", "phone"].includes(target.name)) setAdditionalOpen(true);
          setMemberErrors(previous => ({ ...previous, [target.name]: target.validationMessage }));
        }}>
          <fieldset disabled={save.isPending || changeGroup.isPending} className="min-w-0">
          <legend className="sr-only">Full Name</legend>
          <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Full Name" placeholder="e.g. Juan Dela Cruz" name="display_name" error={memberErrors["display_name"]} aria-invalid={Boolean(memberErrors["display_name"])} required maxLength={150} value={draft.display_name}
            onChange={event => { setMemberErrors({ ...memberErrors, display_name: "" }); setDraft({ ...draft, display_name: event.target.value }); }} /></div>
          </div>
          </fieldset>
          {(fields.isPending || fields.isError || Boolean(fields.data?.length)) && <fieldset disabled={save.isPending || changeGroup.isPending} className="mt-6 min-w-0">
          <legend className="mb-4 text-sm font-semibold">{directoryFormHeading(organizationType.data)}</legend>
          {fields.isPending && (
            <div role="status" aria-label="Loading directory fields" className="grid gap-4 sm:grid-cols-2 animate-pulse motion-reduce:animate-none">
              {[0, 1].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-20 rounded bg-skeleton" />
                  <div className="h-10 rounded-xl border border-subtle bg-skeleton" />
                </div>
              ))}
            </div>
          )}
          {fields.isError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(fields.error)} <Button variant="ghost" onClick={() => void fields.refetch()}>Try again</Button></p>}
          <div className="grid gap-4 sm:grid-cols-2">
          {(fields.data ?? []).map(field => field.kind === "checkbox" ? (
            <label key={field.key} className="flex min-h-11 items-center gap-3 text-sm text-primary">
              <input className="size-4 appearance-auto! accent-emerald-500" type="checkbox" checked={attributes[field.key] === true} onChange={event => {
                setAttributes({ ...attributes, [field.key]: event.target.checked });
              }} />
              {field.label}
            </label>
          ) : field.kind === "select" ? (
            <Select key={field.key} label={field.label} value={String(attributes[field.key] ?? "")}
              error={memberErrors["attributes." + field.key]}
              options={[{ value: "", label: "Select " + field.label.toLowerCase() }, ...field.options.map(value => ({ value, label: value }))]}
              onChange={event => {
                const next = { ...attributes };
                if (event.target.value) next[field.key] = event.target.value;
                else delete next[field.key];
                setAttributes(next);
                setMemberErrors({ ...memberErrors, ["attributes." + field.key]: "" });
              }} />
          ) : (
            <Input key={field.key} id={`directory-field-${field.key}`} label={field.label} placeholder={directoryFieldPlaceholder(field)} type={field.kind} name={"attributes." + field.key}
              error={memberErrors["attributes." + field.key]} aria-invalid={Boolean(memberErrors["attributes." + field.key])}
              step={field.kind === "number" ? "any" : undefined} maxLength={500} value={String(attributes[field.key] ?? "")}
              onChange={event => {
                setMemberErrors({ ...memberErrors, ["attributes." + field.key]: "" });
                const next = { ...attributes };
                const value = event.target.value;
                if (value === "") delete next[field.key];
                else next[field.key] = field.kind === "number" ? Number(value) : value;
                setAttributes(next);
              }} />
          ))}
          </div></fieldset>}
          <section className="mt-6 border-t border-subtle pt-4">
            <button type="button" aria-expanded={additionalOpen} aria-controls="directory-additional-information"
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-emerald-400"
              onClick={() => setAdditionalOpen(value => !value)}>
              <span>{organizationType.data === "student" ? "Contact details" : "Additional information"} <span className="font-normal text-secondary">(optional)</span></span>
              <ChevronDown size={16} className={additionalOpen ? "rotate-180" : ""} />
            </button>
            <fieldset id="directory-additional-information" hidden={!additionalOpen} disabled={save.isPending || changeGroup.isPending} className="min-w-0 pt-3">
              <legend className="sr-only">Additional information</legend>
              <div className="grid gap-4 sm:grid-cols-2">
          {organizationType.data !== "student" && <Input label="Member identifier" placeholder="e.g. MEM-001" name="member_code" error={memberErrors["member_code"]} aria-invalid={Boolean(memberErrors["member_code"])} maxLength={100} value={draft.member_code}
            onChange={event => setDraft({ ...draft, member_code: event.target.value })} />}
          <Input label="Email" placeholder="name@example.com" name="email" error={memberErrors["email"]} aria-invalid={Boolean(memberErrors["email"])} type="email" maxLength={254} value={draft.email}
            onChange={event => setDraft({ ...draft, email: event.target.value })} />
          <Input label="Phone" placeholder="e.g. 0912 345 6789" name="phone" error={memberErrors["phone"]} aria-invalid={Boolean(memberErrors["phone"])} type="tel" maxLength={40} value={draft.phone}
            onChange={event => setDraft({ ...draft, phone: event.target.value })} />
              </div>
              <p className="mt-3 text-xs text-secondary">{organizationType.data !== "student" && "The member identifier is an optional directory code, separate from organization-specific IDs. "}Contact details do not grant workspace access.</p>
            </fieldset>
          </section>
          {editor && editor !== "new" && Boolean(groups.data?.length) && <fieldset className="mt-6 space-y-2">
            <legend className="text-sm text-secondary">Groups</legend>
            {groups.data?.map(item => <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input className="size-4 appearance-auto! accent-emerald-500" type="checkbox" checked={memberGroups.data?.includes(item.id) ?? false}
                disabled={!memberGroups.isSuccess || memberGroups.isFetching || changeGroup.isPending || save.isPending}
                onChange={event => changeGroup.mutate({ id: item.id, included: event.target.checked })} />
              {item.name}
            </label>)}
            {(changeGroup.isError || memberGroups.isError) && <p role="alert" className="text-rose-700 dark:text-rose-300">
              {formatErrorMessage(changeGroup.error ?? memberGroups.error)}
            </p>}
          </fieldset>}
          {save.isError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(save.error)}</p>}
          </form>
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-subtle px-5 py-4 sm:px-7">
            {editor && editor !== "new" && <Button variant="ghost" className="mr-auto" disabled={save.isPending || changeGroup.isPending}
              onClick={() => save.mutate(editor.status === "active" ? "archive" : "restore")}>
              {editor.status === "active" ? "Archive member" : "Restore member"}
            </Button>}
            <Button variant="outline" disabled={save.isPending || changeGroup.isPending} onClick={closeEditor}>Cancel</Button>
            <Button type="submit" form="directory-member-form" isLoading={save.isPending}
              disabled={!draft.display_name.trim() || !fields.isSuccess || fields.isFetching || changeGroup.isPending}>
              {editor === "new" ? "Add member" : "Save changes"}
            </Button>
          </footer>
      </Modal>
      <Modal isOpen={showFields} maxWidth="max-w-[880px]" labelledBy="directory-fields-title"
        className="flex max-h-[85dvh]! flex-col overflow-hidden! p-0!"
        onClose={closeFields}>
        <header className="shrink-0 border-b border-subtle px-5 py-4 sm:px-8">
          <h2 id="directory-fields-title" className="font-semibold text-primary section-title">Directory fields</h2>
          <p className="mt-1 text-sm text-secondary">Customize the information stored for your organization's members.</p>
        </header>
        <div inert={Boolean(confirmation) || fieldsBusy} className="min-h-0 overflow-y-auto px-5 py-5 sm:px-8">
          {fields.isError && <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(fields.error)}</p>}
          <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="space-y-2">
              <h3 className="mb-3 text-sm font-semibold text-primary">Field templates</h3>
              {[
                { key: "Student", title: "Student Organization", description: "Organize students by program and section.", Icon: GraduationCap },
                { key: "Workplace", title: "Workplace", description: "Track departments and employee roles.", Icon: Briefcase },
                { key: "Nonprofit", title: "Nonprofit or Community Group", description: "Track community teams and roles.", Icon: Users },
                { key: "Association", title: "Association", description: "Track chapters and membership types.", Icon: Users },
              ].map(({ key, title, description, Icon }) => <button type="button" key={key}
                disabled={!fields.isSuccess || fieldsBusy} aria-pressed={template === key}
                className="flex w-full cursor-pointer gap-2 rounded-xl border border-subtle p-3 text-left hover:bg-elevated focus-visible:ring-2 focus-visible:ring-strong aria-pressed:border-strong disabled:opacity-60"
                onClick={() => {
                  saveFields.reset(); setFieldEditor(false); setRenameKey(null); setTemplate(key);
                  setFieldError("");
                }}>
                <Icon size={16} className="mt-0.5 shrink-0 text-secondary" aria-hidden="true" />
                <span className="min-w-0"><strong className="block text-sm text-primary">{title}</strong>
                  <span className="block text-xs text-secondary">{description}</span>
                  <span className="mt-1 block text-xs text-muted">{presets[key].join(", ")}</span></span>
              </button>)}
              <Button variant="ghost" className="min-h-11" icon={<Plus size={16} />} disabled={fieldsBusy}
                onClick={() => openFieldEditor()}>Start from scratch</Button>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold">Existing fields</h3>
              {fields.isPending && (
                <div role="status" aria-label="Loading fields" className="grid gap-2 lg:grid-cols-2 animate-pulse motion-reduce:animate-none">
                  {[0, 1].map(i => (
                    <div key={i} className="h-14 rounded-xl border border-subtle bg-skeleton" />
                  ))}
                </div>
              )}
              {fields.isSuccess && !draftFields.length && <p className="text-sm text-secondary">No custom fields yet.</p>}
              <ul className="grid gap-2 lg:grid-cols-2">
                {draftFields.map(field => <li key={field.key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-subtle px-3 py-1">
                  <div className="min-w-0 break-all text-sm text-primary">{field.label}<span className="block text-xs text-secondary">{field.kind === "select" ? "Single select" : field.kind}</span></div>
                  <div className="relative shrink-0">
                    <button type="button" aria-label={`Actions for ${field.label}`} aria-expanded={menu === "field:" + field.key}
                      className="grid size-11 cursor-pointer place-items-center rounded-xl text-secondary hover:bg-elevated hover:text-primary focus-visible:ring-2 focus-visible:ring-strong"
                      disabled={fieldsBusy} onClick={() => setMenu(menu === "field:" + field.key ? null : "field:" + field.key)}><Ellipsis size={16} /></button>
                    {menu === "field:" + field.key && <FloatingMenu align="right" onClose={() => setMenu(null)}
                      className="rounded-xl border border-subtle bg-surface p-1 shadow-xl">
                      <Button variant="ghost" className="min-h-11" onClick={() => { setMenu(null); openFieldEditor(field); }}>Rename field</Button>
                      <Button variant="ghost" className="min-h-11 w-full text-rose-600 dark:text-rose-300" onClick={() => {
                        setMenu(null); setTemplate(null); setFieldEditor(false); setFieldError(""); saveFields.reset();
                        setDraftFields(draftFields.filter(item => item.key !== field.key));
                      }}>Remove field</Button>
                    </FloatingMenu>}
                  </div>
                </li>)}
              </ul>
              {!fieldEditor && <Button variant="outline" className="mt-3 min-h-11 w-full border-dashed" icon={<Plus size={16} />}
                disabled={fieldsBusy} onClick={() => openFieldEditor()}>Add field</Button>}
              {template && <div className="mt-4 space-y-3 rounded-xl border border-subtle bg-elevated p-3">
                <h4 className="text-sm font-semibold text-primary">Replace fields in this draft?</h4>
                <p className="text-sm text-secondary">{previewFields.map(field => field.label).join(", ")}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setTemplate(null)}>Cancel</Button>
                  <Button onClick={() => { setDraftFields([...draftFields, ...previewFields.filter(field => !draftFields.some(existing => existing.key === field.key))]); setTemplate(null); }}>Use template</Button>
                </div>
              </div>}
              {fieldEditor && <form className="mt-4 space-y-3 rounded-xl border border-subtle bg-elevated p-3" onSubmit={event => {
                event.preventDefault();
                const label = fieldLabel.trim();
                if (!label || fieldsBusy) return;
                const key = renameKey ?? fieldKey(label);
                const options = fieldKind === "select" ? [...new Set(choiceText.split(",").map(value => value.trim()).filter(Boolean))] : [];
                if (!renameKey && draftFields.some(field => field.key === key)) {
                  setFieldError("A field with that key already exists.");
                  return;
                }
                if (!renameKey && fieldKind === "select" && (!options.length || options.length > 30 || options.some(value => value.length > 100))) {
                  setFieldError("Enter 1–30 choices of up to 100 characters each.");
                  return;
                }
                setDraftFields(renameKey ? draftFields.map(field => field.key === renameKey ? { ...field, label } : field)
                  : [...draftFields, { key, label, kind: fieldKind, options }]);
                setFieldError("");
                setFieldEditor(false);
              }}>
                <h4 className="text-sm font-semibold">{renameKey ? "Rename field" : "Add field"}</h4>
                <Input label="Field label" placeholder="e.g. Membership category" autoFocus value={fieldLabel} maxLength={80} required onChange={event => setFieldLabel(event.target.value)} />
                {!renameKey && <Select label="Field type" value={fieldKind} onChange={event => setFieldKind(event.target.value as FieldKind)}
                  options={[{ value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "date", label: "Date" }, { value: "checkbox", label: "Checkbox" }, { value: "select", label: "Single select" }]} />}
                {!renameKey && fieldKind === "select" && <Input label="Choices separated by commas" placeholder="e.g. Regular, Associate, Honorary" required maxLength={1000}
                  value={choiceText} onChange={event => setChoiceText(event.target.value)} />}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" disabled={fieldsBusy} onClick={() => { saveFields.reset(); setFieldEditor(false); }}>Cancel</Button>
                  <Button type="submit" isLoading={saveFields.isPending} disabled={!fieldLabel.trim()}>{renameKey ? "Update draft" : "Add to draft"}</Button>
                </div>
              </form>}
              {fieldError && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{fieldError}</p>}
              {saveFields.isError && !confirmation && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{formatErrorMessage(saveFields.error)}</p>}
            </section>
          </div>
        </div>
        {confirmation && <div role="alert" className="max-h-[30dvh] shrink-0 overflow-y-auto border-t border-subtle px-5 py-3 text-sm sm:px-8">
          <p className="font-semibold text-primary">Discard unsaved changes?</p>
          <p className="mt-1 text-secondary">Your draft edits will be lost.</p>
        </div>}
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-subtle px-5 py-4 sm:px-8">
          {confirmation ? <>
            <Button variant="outline" disabled={fieldsBusy} onClick={() => setConfirmation(null)}>Keep editing</Button>
            <Button variant="danger" onClick={() => setShowFields(false)}>Discard changes</Button>
          </> : <>
            <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={fieldsBusy} onClick={closeFields}>Cancel</Button>
            <Button className="min-h-11 flex-1 sm:flex-none" disabled={!fieldsChanged || fieldEditor || Boolean(template)}
              isLoading={fieldsBusy} onClick={() => saveFields.mutate()}>Save Changes</Button>
          </>}
        </footer>
      </Modal>
    </div>
  );
}
