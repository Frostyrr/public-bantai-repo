import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  setPreviewTheme: (theme: ThemePreference | null) => void;
}

const STORAGE_KEY = "bantai-theme";
const DARK_SCHEME = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Storage may be unavailable
  }
  return "dark";
}

function getSystemDark(): boolean {
  return window.matchMedia(DARK_SCHEME).matches;
}

function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_SCHEME);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const getServerSystemDark = () => true;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [previewTheme, setPreviewTheme] = useState<ThemePreference | null>(null);
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, getSystemDark, getServerSystemDark);

  const activeTheme = previewTheme ?? theme;
  const resolvedTheme: ResolvedTheme =
    activeTheme === "system" ? (systemDark ? "dark" : "light") : activeTheme;

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, setPreviewTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
