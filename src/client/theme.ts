import {
  createThemeBuilder,
  defaultTheme,
  lightTheme,
  type ThemeBuilder,
} from "../theme";
import type { ThemeEditorHandle } from "../theme/theme-editor";
import { loadThemeFromUrl } from "../theme/theme-editor";
import { emitThemeChange, type ThemeChangeSource } from "./theme-events";

let themeBuilder: ThemeBuilder | null = null;

function getThemeBuilder(): ThemeBuilder {
  if (!themeBuilder) {
    themeBuilder = createThemeBuilder();
  }
  return themeBuilder;
}

export function getCurrentTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage?.getItem("smdp-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

export function applyTheme(
  theme: "light" | "dark",
  themeEditorHandle: ThemeEditorHandle | null,
  preserveCustomizations: boolean = false,
  emitChange: boolean = true,
  source: ThemeChangeSource = "toggle",
): void {
  const builder = getThemeBuilder();
  const config = theme === "light" ? lightTheme : defaultTheme;

  if (preserveCustomizations) {
    // Only update theme-specific meta, keep existing tokens
    builder.withMeta({ colorScheme: config.meta.colorScheme }).apply();
  } else {
    // Full theme replacement (initial load)
    builder
      .withMeta(config.meta)
      .withTokens(config.tokens)
      .withCustomProperties(config.customProperties)
      .apply();
  }

  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("smdp-theme", theme);
    }
  } catch {
    // ignore storage errors
  }
  themeEditorHandle?.refresh();
  if (emitChange) {
    emitThemeChange(source, theme);
  }
}

export function applyThemeUrlOverrides(
  themeEditorHandle: ThemeEditorHandle | null = null,
): boolean {
  const builder = getThemeBuilder();
  const hasUrlTheme = loadThemeFromUrl(builder);
  if (!hasUrlTheme) return false;
  builder.apply();
  themeEditorHandle?.refresh();
  emitThemeChange("url");
  return true;
}

export { getThemeBuilder };
