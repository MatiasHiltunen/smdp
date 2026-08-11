export type PreviewSourceAnchor = {
  line: number;
  element: HTMLElement;
};

export class PreviewCursorSyncState {
  private enabled = true;
  private pendingLine: number | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.pendingLine = null;
  }

  request(line: number): boolean {
    if (!this.enabled) return false;
    this.pendingLine = Math.max(1, line);
    return true;
  }

  getPendingLine(): number | null {
    return this.enabled ? this.pendingLine : null;
  }

  consumePendingLine(): number | null {
    const line = this.getPendingLine();
    this.pendingLine = null;
    return line;
  }
}

export function getSourceLineAtTextOffset(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 0x0a) line += 1;
  }
  return line;
}

export function collectPreviewSourceAnchors(
  root: ParentNode,
): PreviewSourceAnchor[] {
  const anchors: PreviewSourceAnchor[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-md-source-line]",
  )) {
    const line = Number.parseInt(element.dataset.mdSourceLine ?? "", 10);
    if (Number.isFinite(line) && line > 0) {
      anchors.push({ line, element });
    }
  }
  anchors.sort((left, right) => left.line - right.line);
  return anchors;
}

export function findPreviewSourceAnchor(
  anchors: readonly PreviewSourceAnchor[],
  sourceLine: number,
): HTMLElement | null {
  if (anchors.length === 0) return null;
  const targetLine = Math.max(1, sourceLine);
  let low = 0;
  let high = anchors.length - 1;
  let match = 0;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].line <= targetLine) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  while (match > 0 && anchors[match - 1].line === anchors[match].line) {
    match -= 1;
  }
  return anchors[match].element;
}
