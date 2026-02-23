export type FrameMode = "full" | "minimal" | "none";
export type BackgroundMode = "full" | "soft" | "none";

export const DEFAULT_FRAME_MODE: FrameMode = "full";
export const FRAME_MODE_QUERY_KEY = "fm";
export const DEFAULT_BACKGROUND_MODE: BackgroundMode = "full";
export const BACKGROUND_MODE_QUERY_KEY = "bg";

const FRAME_MODE_VALUES: readonly FrameMode[] = ["full", "minimal", "none"] as const;
const FRAME_MODE_CLASSES: readonly string[] = FRAME_MODE_VALUES.map(
  (mode) => `frame-mode-${mode}`,
);
const BACKGROUND_MODE_VALUES: readonly BackgroundMode[] = [
  "full",
  "soft",
  "none",
] as const;
const BACKGROUND_MODE_CLASSES: readonly string[] = BACKGROUND_MODE_VALUES.map(
  (mode) => `background-mode-${mode}`,
);

export function parseFrameMode(value: string | null | undefined): FrameMode {
  if (!value) return DEFAULT_FRAME_MODE;
  const normalized = value.toLowerCase();
  return FRAME_MODE_VALUES.includes(normalized as FrameMode)
    ? (normalized as FrameMode)
    : DEFAULT_FRAME_MODE;
}

export function getFrameModeFromSearch(search: string): FrameMode {
  const params = new URLSearchParams(search);
  return parseFrameMode(params.get(FRAME_MODE_QUERY_KEY));
}

export function parseBackgroundMode(
  value: string | null | undefined,
): BackgroundMode {
  if (!value) return DEFAULT_BACKGROUND_MODE;
  const normalized = value.toLowerCase();
  return BACKGROUND_MODE_VALUES.includes(normalized as BackgroundMode)
    ? (normalized as BackgroundMode)
    : DEFAULT_BACKGROUND_MODE;
}

export function getBackgroundModeFromSearch(search: string): BackgroundMode {
  const params = new URLSearchParams(search);
  return parseBackgroundMode(params.get(BACKGROUND_MODE_QUERY_KEY));
}

export function setFrameModeSearchParam(
  params: URLSearchParams,
  mode: FrameMode,
): void {
  if (mode === DEFAULT_FRAME_MODE) {
    params.delete(FRAME_MODE_QUERY_KEY);
    return;
  }
  params.set(FRAME_MODE_QUERY_KEY, mode);
}

export function setBackgroundModeSearchParam(
  params: URLSearchParams,
  mode: BackgroundMode,
): void {
  if (mode === DEFAULT_BACKGROUND_MODE) {
    params.delete(BACKGROUND_MODE_QUERY_KEY);
    return;
  }
  params.set(BACKGROUND_MODE_QUERY_KEY, mode);
}

export function applyFrameMode(mode: FrameMode): void {
  if (typeof document === "undefined") return;
  document.body.classList.remove(...FRAME_MODE_CLASSES);
  document.body.classList.add(`frame-mode-${mode}`);
}

export function applyBackgroundMode(mode: BackgroundMode): void {
  if (typeof document === "undefined") return;
  document.body.classList.remove(...BACKGROUND_MODE_CLASSES);
  document.body.classList.add(`background-mode-${mode}`);
}

export function applyFrameModeFromUrl(): FrameMode {
  const mode =
    typeof window === "undefined"
      ? DEFAULT_FRAME_MODE
      : getFrameModeFromSearch(window.location.search);
  applyFrameMode(mode);
  return mode;
}

export function applyBackgroundModeFromUrl(): BackgroundMode {
  const mode =
    typeof window === "undefined"
      ? DEFAULT_BACKGROUND_MODE
      : getBackgroundModeFromSearch(window.location.search);
  applyBackgroundMode(mode);
  return mode;
}

export function saveFrameModeToUrl(mode: FrameMode): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  setFrameModeSearchParam(params, mode);
  const query = params.toString();
  const path = window.location.pathname;
  const hash = window.location.hash || "";
  const nextUrl = query ? `${path}?${query}${hash}` : `${path}${hash}`;
  window.history.replaceState({}, "", nextUrl);
}

export function saveBackgroundModeToUrl(mode: BackgroundMode): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  setBackgroundModeSearchParam(params, mode);
  const query = params.toString();
  const path = window.location.pathname;
  const hash = window.location.hash || "";
  const nextUrl = query ? `${path}?${query}${hash}` : `${path}${hash}`;
  window.history.replaceState({}, "", nextUrl);
}
