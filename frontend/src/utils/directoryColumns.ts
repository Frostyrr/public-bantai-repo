const genericColumns = ["identifier", "groups", "status"];
const recommendedColumns: Record<string, string[]> = {
  student: ["custom:student_id", "custom:program", "custom:year_level", "custom:section", "status"],
  workplace: ["custom:employee_id", "custom:department", "custom:job_title", "status"],
  club: ["custom:membership_id", "custom:membership_type", "custom:chapter", "status"],
  nonprofit: ["custom:member_id", "custom:team", "custom:role", "status"],
};

export function recommendedDirectoryColumns(type: string | null, available: string[]) {
  return (recommendedColumns[type ?? ""] ?? genericColumns).filter(key => available.includes(key));
}

export function resolveDirectoryColumns(type: string | null | undefined, available: string[] | undefined, preference: unknown, defaults?: string[]) {
  if (type === undefined || available === undefined) return null;
  const recommended = defaults ?? recommendedDirectoryColumns(type, available);
  const explicit = typeof preference === "object" && preference !== null && "version" in preference &&
    preference.version === 1 && "keys" in preference;
  const keys = explicit ? preference.keys : preference;
  if (!Array.isArray(keys) || !keys.every(key => typeof key === "string")) return recommended;
  // Legacy empty/invalid arrays are not evidence of a saved customization.
  if (!explicit && (!keys.length || !keys.some(key => available.includes(key)))) return recommended;
  return [...new Set(keys)].filter(key => available.includes(key));
}
