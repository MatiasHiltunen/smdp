# Theme

## Overview
- Encapsulates dynamic theming: CSS variable management, customization UI, and compact serialization for shareable URLs.
- Themes drive both DOM and canvas renderers via CSS custom properties; everything flows through `ThemeBuilder`.

## Components
- `theme-builder.ts`
  - Declares the canonical token set (`ThemeTokenKey`) covering backgrounds, borders, typography accents, code highlight colors, and semantic backgrounds (info/warning/error/success).
  - `ThemeBuilder` maintains mutable `meta`, `tokens`, and arbitrary `customProperties`, offering fluent `withMeta`, `withTokens`, `withCustomProperties`.
  - `apply()` writes CSS variables onto a target element (defaults to `document.documentElement`), while `buildCss()`/`buildStyleElement()` support SSR or document fragment embedding.
  - Ships ready-to-use presets: `defaultTheme` (dark) and `lightTheme`.
- `theme-editor.ts`
  - Runtime overlay that lets users tweak theme tokens safely:
    - Auto-loads overrides from URL parameters (`d` for dark, `l` for light) back into a supplied `ThemeBuilder`.
    - Builds an accessible dialog with focus trapping, keyboard escape, and inert background handling.
    - Synchronizes form controls with builder state, supporting both color pickers and freeform text values.
    - Persists adjustments to the URL using compact serialization (`serializeTheme`).
    - Exposes a `ThemeEditorHandle` consumed by `main.ts`/`client/ui.ts` to toggle the editor, refresh values, and listen for visibility changes.
- `theme-serializer.ts`
  - Encodes theme diffs relative to presets:
    - Token keys reduced to short identifiers (`bgBase` → `bb`, `warningBg` → `wg`).
    - Fonts, sizes, weights, line heights stored as preset indexes when possible for shorter URLs.
    - Arbitrary custom properties stored with `x_{name}` keys.
  - `serializeThemes` / `deserializeThemes` packages both light and dark modes for sharing or embedding.
- `index.ts`
  - Re-exports builder, serializer, and config types for ergonomic imports throughout the repo.

## Runtime Flow
1. App bootstraps a singleton `ThemeBuilder` via `client/theme.ts`.
2. `loadThemeFromUrl()` (theme editor) hydrates builder state from query parameters before any rendering occurs.
3. `applyTheme()` writes preset tokens for light/dark and triggers builder `.apply()` so CSS variables update immediately.
4. When users open the editor (`initializeThemeEditor`), the UI reflects current builder state, and each change calls `builder.apply()` + `saveThemeToUrl()`.
5. The FAB theme toggle preserves customizations by switching presets, then reloading overrides for the newly active mode.

## Extending Theme Tokens
- Add new tokens in `ThemeTokenKey`, map them to CSS variables in `CSS_VARIABLES`, and update both `defaultTheme`/`lightTheme` token maps.
- Expose inputs within the editor by appending to the appropriate `TOKEN_GROUPS` entry.
- Update `theme-serializer.ts` with compact keys so customizations remain shareable.

## Integration Notes
- Canvas renderer reads colors via `getComputedStyle` (`canvas-renderer.ts:68`), so any CSS variable you add will automatically propagate to canvas output.
- Exported HTML (`client/ui.ts:66`) serializes theme overrides from the current URL; keep serializer/deserializer symmetrical to guarantee round-tripping.

## Improvement Notes
- Store theme overrides in `localStorage` alongside URL params so users retain their custom palette when navigating directly (bookmark to `/canvas`, opening a new tab, etc.).
- Provide an import/export dialog in the editor that surfaces the serialized payload, letting users copy JSON or upload `.smdptheme` files instead of manually editing the URL.
- Add validation rules to the editor inputs (e.g., regex for CSS color syntax, number ranges for line height) to prevent invalid values from producing broken themes.
- Consider packaging a handful of curated presets (e.g., “Nord”, “Solarized Light”) to demonstrate the theming API and make the editor friendlier to first-time users.
