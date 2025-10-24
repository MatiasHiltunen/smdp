export type MarkdownFetchResult = {
  bytes: Uint8Array;
  baseUrl: string;
  blocks?: Uint8Array | null;
};

export async function fetchMarkdown(
  externalUrl: URL | null,
): Promise<MarkdownFetchResult> {
  const target = externalUrl?.toString() ?? "/test.md";
  const response = await fetch(target);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch markdown: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const baseUrl =
    externalUrl?.toString() ?? new URL(target, window.location.href).toString();
  return { bytes, baseUrl };
}
