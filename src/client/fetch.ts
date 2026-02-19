import { normalizeGitHubUrlToRaw } from "./github-url";

export type MarkdownFetchResult = {
  bytes: Uint8Array;
  baseUrl: string;
};

export async function fetchMarkdown(
  externalUrl: URL | null,
): Promise<MarkdownFetchResult> {
  const target = externalUrl
    ? normalizeGitHubUrlToRaw(externalUrl.toString())
    : "/test.md";
  const response = await fetch(target);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch markdown: ${response.status} ${response.statusText}`,
    );
  }

  const bytes = await response.bytes();


  // const bytes = new Uint8Array(buffer);
  const baseUrl = new URL(target, window.location.href).toString();
  return { bytes, baseUrl };
}
