type Filters = { periodId?: string; spaceId?: string; status?: string };
export function financialKey(kind: string, orgId: string, filters: Filters = {}) {
  const normalized = Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== 'all').sort(([a], [b]) => a.localeCompare(b)));
  return Object.keys(normalized).length ? [kind, orgId, normalized] : [kind, orgId];
}
