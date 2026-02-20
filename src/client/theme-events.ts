export type ThemeChangeSource =
  | "init"
  | "toggle"
  | "url"
  | "editor"
  | "reset";

export type ThemeChangeDetail = {
  source: ThemeChangeSource;
  theme: "light" | "dark";
};

const THEME_CHANGE_EVENT = "smdp:theme-change";

function resolveCurrentTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

export function emitThemeChange(
  source: ThemeChangeSource,
  theme: "light" | "dark" = resolveCurrentTheme(),
): void {
  window.dispatchEvent(
    new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
      detail: { source, theme },
    }),
  );
}

export function onThemeChange(
  listener: (detail: ThemeChangeDetail) => void,
): () => void {
  const handler = (event: Event): void => {
    const custom = event as CustomEvent<ThemeChangeDetail>;
    if (!custom.detail) return;
    listener(custom.detail);
  };
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}
