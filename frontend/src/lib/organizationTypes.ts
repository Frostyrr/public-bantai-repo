export const organizationTypes = [
  { value: "student", label: "Student Organization", description: "Student councils, academic organizations, and campus clubs.", fields: ["Student ID", "College", "Program", "Year Level", "Section"] },
  { value: "workplace", label: "Workplace or Team", description: "Departments, professional teams, and workplace groups.", fields: ["Employee ID", "Department", "Position", "Employment Status"] },
  { value: "club", label: "Club or Association", description: "Membership clubs, associations, and societies.", fields: ["Membership Type", "Join Date"] },
  { value: "nonprofit", label: "Nonprofit or Community Group", description: "Volunteer organizations, nonprofits, and community groups.", fields: ["Volunteer Role", "Join Date"] },
  { value: "other", label: "Other", description: "A general-purpose organization.", fields: [] },
] as const;
export type OrganizationType = typeof organizationTypes[number]["value"];


const formHeadings: Record<string, string> = {
  student: "Student information", workplace: "Employee information", club: "Membership information",
};
export const directoryFormHeading = (type: string | null | undefined) => formHeadings[type ?? ""] ?? "Organization information";

/** Template keys determine priority; custom fields keep their configured relative order. */
export function orderDirectoryFields<T extends { key: string }>(fields: readonly T[], type: string | null | undefined): T[] {
  const template = organizationTypes.find(item => item.value === type);
  const keys: string[] = template?.fields.map(label => label === "Position" ? "job_title" : label.toLowerCase().replace(/[^a-z0-9]+/g, "_")) ?? [];
  if (type === "club") keys.unshift("membership_id");
  if (type === "club") keys.push("chapter");
  if (type === "nonprofit") keys.unshift("member_id");
  const rank = (key: string) => { const index = keys.indexOf(key); return index < 0 ? keys.length : index; };
  return [...fields].sort((a, b) => rank(a.key) - rank(b.key));
}

const fieldExamples: Record<string, string> = {
  student_id: "e.g. 2026-00123", college: "e.g. College of Engineering", program: "e.g. BS Computer Science",
  year_level: "e.g. 3", section: "e.g. A", employee_id: "e.g. EMP-001", department: "e.g. Operations",
  job_title: "e.g. Coordinator", membership_id: "e.g. CLUB-001", member_id: "e.g. M-001",
};
export function directoryFieldPlaceholder(field: { key: string; label: string; kind: string }): string | undefined {
  if (field.kind !== "text" && field.kind !== "number") return undefined;
  if (field.kind === "number") return "Enter a number";
  return fieldExamples[field.key] ?? `Enter ${field.label.toLowerCase()}`;
}


/** Presentation only: never link identities or rewrite the generic directory code. */
export function directoryDisplayIdentifier(type: string | null | undefined, fields: readonly { key: string; label: string }[], member: { member_code: string | null; attributes: Record<string, unknown> }): { label: string; value: string } | null {
  const primaryKey = ({student:"student_id",workplace:"employee_id",club:"membership_id",nonprofit:"member_id"} as Record<string,string>)[type ?? ""];
  const field = fields.find(item => item.key === primaryKey);
  const value = field ? member.attributes[field.key] : null;
  if (field && value != null && String(value).trim()) return { label: field.label, value: String(value) };
  return member.member_code ? { label: "Member identifier", value: member.member_code } : null;
}
