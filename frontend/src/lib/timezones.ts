export interface TimeZoneOption {
  value: string;
  label: string;
  location: string;
  city: string;
  offsetLabel: string;
  offsetMinutes: number;
  searchText: string;
}

const COUNTRY_BY_ZONE: Record<string, string> = {
  "Asia/Manila": "Philippines",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Japan",
  "Asia/Seoul": "South Korea",
  "Asia/Hong_Kong": "Hong Kong",
  "Asia/Taipei": "Taiwan",
  "Asia/Shanghai": "China",
  "Asia/Bangkok": "Thailand",
  "Asia/Jakarta": "Indonesia",
  "Asia/Makassar": "Indonesia",
  "Asia/Jayapura": "Indonesia",
  "Asia/Kuala_Lumpur": "Malaysia",
  "Asia/Ho_Chi_Minh": "Vietnam",
  "Asia/Saigon": "Vietnam",
  "Asia/Kolkata": "India",
  "Asia/Calcutta": "India",
  "Asia/Dubai": "United Arab Emirates",
  "Asia/Riyadh": "Saudi Arabia",
  "Asia/Qatar": "Qatar",
  "Asia/Jerusalem": "Israel",
  "Asia/Karachi": "Pakistan",
  "Asia/Dhaka": "Bangladesh",
  "Asia/Kathmandu": "Nepal",
  "Asia/Colombo": "Sri Lanka",
  "Asia/Yangon": "Myanmar",
  "Asia/Phnom_Penh": "Cambodia",
  "America/New_York": "United States",
  "America/Chicago": "United States",
  "America/Denver": "United States",
  "America/Los_Angeles": "United States",
  "America/Phoenix": "United States",
  "America/Anchorage": "United States",
  "Pacific/Honolulu": "United States",
  "America/Toronto": "Canada",
  "America/Vancouver": "Canada",
  "America/Edmonton": "Canada",
  "America/Winnipeg": "Canada",
  "America/Halifax": "Canada",
  "America/St_Johns": "Canada",
  "America/Mexico_City": "Mexico",
  "America/Sao_Paulo": "Brazil",
  "America/Argentina/Buenos_Aires": "Argentina",
  "America/Bogota": "Colombia",
  "America/Lima": "Peru",
  "America/Santiago": "Chile",
  "Europe/London": "United Kingdom",
  "Europe/Dublin": "Ireland",
  "Europe/Paris": "France",
  "Europe/Berlin": "Germany",
  "Europe/Madrid": "Spain",
  "Europe/Rome": "Italy",
  "Europe/Amsterdam": "Netherlands",
  "Europe/Brussels": "Belgium",
  "Europe/Zurich": "Switzerland",
  "Europe/Vienna": "Austria",
  "Europe/Stockholm": "Sweden",
  "Europe/Oslo": "Norway",
  "Europe/Copenhagen": "Denmark",
  "Europe/Helsinki": "Finland",
  "Europe/Warsaw": "Poland",
  "Europe/Prague": "Czechia",
  "Europe/Athens": "Greece",
  "Europe/Lisbon": "Portugal",
  "Europe/Istanbul": "Turkey",
  "Europe/Moscow": "Russia",
  "Australia/Sydney": "Australia",
  "Australia/Melbourne": "Australia",
  "Australia/Brisbane": "Australia",
  "Australia/Perth": "Australia",
  "Australia/Adelaide": "Australia",
  "Pacific/Auckland": "New Zealand",
  "Africa/Cairo": "Egypt",
  "Africa/Johannesburg": "South Africa",
  "Africa/Lagos": "Nigeria",
  "Africa/Nairobi": "Kenya",
  "Africa/Casablanca": "Morocco",
};

const FALLBACK_TIME_ZONES = [
  "UTC",
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Kuala_Lumpur",
  "Asia/Ho_Chi_Minh",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Africa/Johannesburg",
];

export function isValidIanaTimeZone(zone: string): boolean {
  const trimmed = zone.trim();
  if (!trimmed || (trimmed !== "UTC" && !trimmed.includes("/"))) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTimeZone(): string | null {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && isValidIanaTimeZone(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export function getUtcOffsetMinutes(timeZone: string, date: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tzName === "GMT" || tzName === "UTC") return 0;
    const match = tzName.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (match) {
      const sign = match[1] === "-" ? -1 : 1;
      return sign * (Number(match[2]) * 60 + Number(match[3]));
    }
  } catch {
    // Fall through to wall-clock calculation
  }

  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const map: Record<string, string> = {};
    for (const part of dtf.formatToParts(date)) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    const hour = map.hour === "24" ? 0 : Number(map.hour);
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      hour,
      Number(map.minute),
      Number(map.second)
    );
    const utcNow = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    );
    return Math.round((asUtc - utcNow) / 60000);
  } catch {
    return 0;
  }
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function parseZoneParts(iana: string): { location: string; city: string } {
  if (iana === "UTC") {
    return { location: "Coordinated Universal Time", city: "UTC" };
  }
  const segments = iana.split("/");
  const region = segments[0]?.replace(/_/g, " ") ?? "";
  const cityRaw = segments[segments.length - 1] ?? iana;
  const city = cityRaw.replace(/_/g, " ");
  const location = COUNTRY_BY_ZONE[iana] ?? region;
  return { location, city };
}

export function buildTimeZoneOption(iana: string, date: Date = new Date()): TimeZoneOption {
  const offsetMinutes = getUtcOffsetMinutes(iana, date);
  const offsetLabel = formatUtcOffset(offsetMinutes);
  const { location, city } = parseZoneParts(iana);
  const label =
    iana === "UTC"
      ? `Coordinated Universal Time (${offsetLabel})`
      : `${location} — ${city} (${offsetLabel})`;
  const shortOffset = offsetLabel.replace("UTC", "GMT");
  const compactOffset = offsetLabel.replace(":00", "").replace("UTC", "");
  return {
    value: iana,
    label,
    location,
    city,
    offsetLabel,
    offsetMinutes,
    searchText: `${iana} ${location} ${city} ${offsetLabel} ${shortOffset} ${compactOffset}`.toLowerCase(),
  };
}

export function getTimeZoneOptions(date: Date = new Date()): TimeZoneOption[] {
  let supported: string[] = [];
  try {
    const intlWithSupported = Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    };
    if (typeof intlWithSupported.supportedValuesOf === "function") {
      supported = intlWithSupported.supportedValuesOf("timeZone");
    }
  } catch {
    supported = [];
  }

  const uniqueZones = Array.from(new Set(["UTC", ...(supported.length ? supported : FALLBACK_TIME_ZONES)])).filter(
    (z) => z === "UTC" || z.includes("/")
  );

  return uniqueZones
    .map((z) => buildTimeZoneOption(z, date))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));
}
