import type { ThemeBuilder } from "./theme-builder";
import { deserializeTheme } from "./theme-serializer";

function getCurrentThemeMode(): "light" | "dark" {
  const mode = document.documentElement.getAttribute("data-theme");
  return mode === "light" ? "light" : "dark";
}

export function loadThemeFromUrl(builder: ThemeBuilder): boolean {
  const params = new URLSearchParams(window.location.search);
  const mode = getCurrentThemeMode();
  const modeKey = mode === "light" ? "l" : "d";
  const serialized = params.get(modeKey);
  if (!serialized) return false;

  const config = deserializeTheme(serialized, mode);
  if (config.meta) {
    builder.withMeta(config.meta);
  }
  if (config.tokens) {
    builder.withTokens(config.tokens);
  }
  if (config.customProperties) {
    builder.withCustomProperties(config.customProperties);
  }
  return true;
}
