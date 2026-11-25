/** Only known public routes can become a legal document's return destination. */
export function legalReturnPath(search: string, pathname = "/") {
  if (pathname === "/login" || pathname === "/register") return pathname;
  const origin = new URLSearchParams(search).get("returnTo");
  return origin === "/login" || origin === "/register" ? origin : "/";
}

export function legalDocumentPath(path: "/terms" | "/privacy", returnTo: string) {
  return returnTo === "/login" || returnTo === "/register"
    ? `${path}?returnTo=${encodeURIComponent(returnTo)}`
    : path;
}

export function legalReturnLabel(path: string) {
  return path === "/login" ? "Back to sign in" : path === "/register" ? "Back to sign up" : "Back to home";
}
