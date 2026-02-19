import { normalizeGitHubUrlToRaw } from "./github-url";

export type MarkdownFetchResult = {
  bytes: Uint8Array;
  baseUrl: string;
};

const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const headerBytes = parsePositiveInt(response.headers.get("content-length"));
  if (headerBytes !== null && headerBytes > maxBytes) {
    throw new Error(`Markdown exceeds size limit (${describeBytes(maxBytes)})`);
  }

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel("markdown payload too large");
        } catch {
          // Ignore cancel errors and fail with the size-limit error below.
        }
        throw new Error(`Markdown exceeds size limit (${describeBytes(maxBytes)})`);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  const bytesMethod = (response as Response & { bytes?: () => Promise<Uint8Array> }).bytes;
  const bytes =
    typeof bytesMethod === "function"
      ? await bytesMethod.call(response)
      : new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > maxBytes) {
    throw new Error(`Markdown exceeds size limit (${describeBytes(maxBytes)})`);
  }

  return bytes;
}

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

  const bytes = await readResponseBytesWithLimit(response, MAX_MARKDOWN_BYTES);
  const baseUrl = new URL(target, window.location.href).toString();
  return { bytes, baseUrl };
}
