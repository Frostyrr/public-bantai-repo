export function formatCategoryLabel(value: string): string {
  return value.trim().replace(/[_-]+/g, " ").split(/\s+/).map(word =>
    word.toLowerCase() === "and" ? "&" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(" ");
}
