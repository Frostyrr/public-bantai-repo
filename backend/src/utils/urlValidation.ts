const SAFE_IMAGE_DATA_URI_RE =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Validates that a URL uses https: (or http: for localhost in local dev). */
export function isSafeHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Validates image inputs (https URLs or base64 PNG/JPEG/WebP data URIs; rejects SVG/HTML/JS). */
export function isSafeImageInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:")) {
    return SAFE_IMAGE_DATA_URI_RE.test(trimmed);
  }
  return isSafeHttpUrl(trimmed);
}
