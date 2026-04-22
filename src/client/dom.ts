import {
  defaultUrlAllowlist,
  resolveUrlRelativeToBase,
} from "../parser/utils";

const SVG_NS = "http://www.w3.org/2000/svg";
const BLOCKED_HTML_TAGS = new Set([
  "base",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);
const URL_ATTR_NAMES = new Set(["href", "src", "xlink:href"]);
const TARGET_VALUES = new Set(["_blank", "_parent", "_self", "_top"]);

export const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T) =>
  document.createElement(tag) as HTMLElementTagNameMap[T];

function parseDetachedHtml(
  activeDocument: Document,
  html: string,
): Document | null {
  const ParserCtor =
    activeDocument.defaultView?.DOMParser ??
    (typeof DOMParser !== "undefined" ? DOMParser : undefined);
  if (ParserCtor) {
    return new ParserCtor().parseFromString(html, "text/html");
  }

  const detached = activeDocument.implementation?.createHTMLDocument("") ?? null;
  if (!detached) {
    return null;
  }

  if (detached.body) {
    detached.body.innerHTML = html;
    return detached;
  }

  return null;
}

function normalizeUrlAttribute(
  attrName: string,
  rawValue: string,
  baseUrl?: string,
): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  if (attrName === "href" && trimmed.startsWith("#")) {
    return trimmed;
  }
  const resolved = resolveUrlRelativeToBase(trimmed, baseUrl);
  return defaultUrlAllowlist(resolved) ? resolved : null;
}

function enforceAnchorSafety(element: Element): void {
  const rawTarget = element.getAttribute("target");
  if (!rawTarget) {
    return;
  }

  const normalizedTarget = rawTarget.trim().toLowerCase();
  if (!TARGET_VALUES.has(normalizedTarget)) {
    element.removeAttribute("target");
    element.removeAttribute("rel");
    return;
  }

  element.setAttribute("target", normalizedTarget);
  if (normalizedTarget !== "_blank") {
    return;
  }

  const relTokens = new Set(
    (element.getAttribute("rel") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toLowerCase()),
  );
  relTokens.delete("opener");
  relTokens.add("noopener");
  relTokens.add("noreferrer");
  element.setAttribute("rel", Array.from(relTokens).join(" "));
}

function sanitizeElementTree(element: Element, baseUrl?: string): void {
  const tagName = element.tagName.toLowerCase();
  if (BLOCKED_HTML_TAGS.has(tagName)) {
    element.remove();
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase();
    if (
      attrName === "style" ||
      attrName === "srcdoc" ||
      attrName.startsWith("on")
    ) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTR_NAMES.has(attrName)) {
      const normalized = normalizeUrlAttribute(attrName, attr.value, baseUrl);
      if (normalized) {
        element.setAttribute(attr.name, normalized);
      } else {
        element.removeAttribute(attr.name);
      }
    }
  }

  if (tagName === "a") {
    enforceAnchorSafety(element);
  }

  for (const child of Array.from(element.children)) {
    sanitizeElementTree(child, baseUrl);
  }
}

function sanitizeDetachedDocument(
  detached: Document,
  baseUrl?: string,
): void {
  const body = detached.body;
  if (!body) {
    return;
  }
  for (const child of Array.from(body.children)) {
    sanitizeElementTree(child, baseUrl);
  }
}

export function replaceElementHtml(
  target: Element,
  html: string,
  options: { baseUrl?: string } = {},
): void {
  const activeDocument = target.ownerDocument;
  if (!activeDocument) {
    target.textContent = html;
    return;
  }

  const detached = parseDetachedHtml(activeDocument, html);
  if (!detached?.body) {
    target.textContent = html;
    return;
  }

  sanitizeDetachedDocument(detached, options.baseUrl);
  const fragment = activeDocument.createDocumentFragment();
  while (detached.body.firstChild) {
    fragment.append(detached.body.firstChild);
  }
  target.replaceChildren(fragment);
}

export function sanitizeHtmlString(
  html: string,
  options: { baseUrl?: string } = {},
): string {
  if (typeof document === "undefined") {
    return html;
  }

  const detached = parseDetachedHtml(document, html);
  if (!detached?.body) {
    return html;
  }

  sanitizeDetachedDocument(detached, options.baseUrl);
  return detached.body.innerHTML;
}

export function createSvgIcon(
  pathData: string,
  options: { viewBox?: string; className?: string } = {},
): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", options.viewBox ?? "0 0 24 24");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("class", options.className ?? "icon");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "currentColor");

  icon.appendChild(path);
  return icon;
}

export function replaceWithIcon(
  target: Element,
  pathData: string,
  options: { viewBox?: string; className?: string } = {},
): void {
  target.replaceChildren(createSvgIcon(pathData, options));
}
