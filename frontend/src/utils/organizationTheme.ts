export interface CoverTheme {
  id: string;
  name: string;
  gradient: string;
  ambientGlow: string;
  ambientGlow2: string;
  avatarBg: string;
  previewBg: string;
}

export const COVER_THEMES: CoverTheme[] = [
  {
    id: "emerald",
    name: "Emerald Reserve",
    gradient: "from-emerald-950 via-teal-950/70 to-zinc-950",
    ambientGlow: "bg-emerald-500/20",
    ambientGlow2: "bg-teal-500/20",
    avatarBg: "bg-gradient-to-br from-emerald-600 to-teal-800 text-emerald-100",
    previewBg: "bg-emerald-600",
  },
  {
    id: "sapphire",
    name: "Sapphire Trust",
    gradient: "from-blue-950 via-indigo-950/70 to-zinc-950",
    ambientGlow: "bg-blue-500/20",
    ambientGlow2: "bg-indigo-500/20",
    avatarBg: "bg-gradient-to-br from-blue-600 to-indigo-800 text-blue-100",
    previewBg: "bg-blue-600",
  },
  {
    id: "violet",
    name: "Obsidian Violet",
    gradient: "from-purple-950 via-violet-950/70 to-zinc-950",
    ambientGlow: "bg-purple-500/20",
    ambientGlow2: "bg-violet-500/20",
    avatarBg: "bg-gradient-to-br from-purple-600 to-violet-800 text-purple-100",
    previewBg: "bg-purple-600",
  },
  {
    id: "amber",
    name: "Sunset Vault",
    gradient: "from-amber-950 via-orange-950/70 to-zinc-950",
    ambientGlow: "bg-amber-500/20",
    ambientGlow2: "bg-orange-500/20",
    avatarBg: "bg-gradient-to-br from-amber-600 to-orange-800 text-amber-100",
    previewBg: "bg-amber-600",
  },
  {
    id: "rose",
    name: "Rose Quartz",
    gradient: "from-rose-950 via-pink-950/70 to-zinc-950",
    ambientGlow: "bg-rose-500/20",
    ambientGlow2: "bg-pink-500/20",
    avatarBg: "bg-gradient-to-br from-rose-600 to-pink-800 text-rose-100",
    previewBg: "bg-rose-600",
  },
  {
    id: "slate",
    name: "Cyber Slate",
    gradient: "from-zinc-900 via-neutral-900 to-zinc-950",
    ambientGlow: "bg-zinc-400/10",
    ambientGlow2: "bg-zinc-600/10",
    avatarBg: "bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-100",
    previewBg: "bg-zinc-700",
  },
];

export function getDeterministicTheme(orgName = ""): CoverTheme {
  let hash = 0;
  for (let i = 0; i < orgName.length; i++) {
    hash = (hash << 5) - hash + orgName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COVER_THEMES.length;
  return COVER_THEMES[index];
}

export function getOrgInitials(name = ""): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "OR";
}

export function getOrgCoverAndLogo(
  orgId: string,
  orgName: string,
  backendLogoUrl?: string | null,
  backendCoverImageUrl?: string | null,
  backendCoverTheme?: string | null
) {
  const customLogoUrl =
    backendLogoUrl !== undefined
      ? backendLogoUrl || ""
      : orgId
        ? localStorage.getItem(`bantai_logo_${orgId}`) || ""
        : "";
  const customImageUrl =
    backendCoverImageUrl !== undefined
      ? backendCoverImageUrl || ""
      : orgId
        ? localStorage.getItem(`bantai_cover_${orgId}_image`) || ""
        : "";
  const selectedThemeId =
    backendCoverTheme !== undefined
      ? backendCoverTheme || ""
      : orgId
        ? localStorage.getItem(`bantai_cover_${orgId}_theme`) || ""
        : "";
  const theme =
    COVER_THEMES.find((t) => t.id === selectedThemeId) ||
    getDeterministicTheme(orgName);

  return {
    customLogoUrl,
    customImageUrl,
    theme,
    initials: getOrgInitials(orgName),
  };
}
