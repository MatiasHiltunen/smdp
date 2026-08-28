import {
  createBookEditorDocumentSnapshot,
  createSingleEditorDocumentSnapshot,
  type EditorDocumentSnapshot,
} from "./editor-model";

export const MAX_MARKDOWN_IMPORT_FILES = 128;
export const MAX_MARKDOWN_IMPORT_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_MARKDOWN_IMPORT_TOTAL_BYTES = 128 * 1024 * 1024;

const MARKDOWN_FILE_RE = /\.md$/i;

export type MarkdownFileSource = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ImportedMarkdownFile = {
  name: string;
  markdown: string;
};

function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function normalizeFileName(name: string): string {
  const normalized = name.trim().replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).pop() ?? "untitled.md";
}

function requireMarkdownFileName(name: string): string {
  const normalized = normalizeFileName(name);
  if (!MARKDOWN_FILE_RE.test(normalized)) {
    throw new Error(`Only .md files can be uploaded (${normalized})`);
  }
  return normalized;
}

function uniqueMarkdownFileName(name: string, usedNames: Set<string>): string {
  const normalized = requireMarkdownFileName(name);
  let candidate = normalized;
  let suffix = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${normalized.slice(0, -3)}-${suffix}.md`;
    suffix += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function createImportRoot(baseUrl: string): URL {
  const root = new URL(baseUrl);
  root.pathname = "/__smdp_upload__/";
  root.search = "";
  root.hash = "";
  return root;
}

function createImportedFileUrl(root: URL, name: string): string {
  return new URL(encodeURIComponent(name), root).toString();
}

export async function readMarkdownFiles(
  files: readonly MarkdownFileSource[],
): Promise<ImportedMarkdownFile[]> {
  if (files.length === 0) {
    throw new Error("Select at least one .md file");
  }
  if (files.length > MAX_MARKDOWN_IMPORT_FILES) {
    throw new Error(
      `Select at most ${MAX_MARKDOWN_IMPORT_FILES} Markdown files at once`,
    );
  }

  let declaredTotal = 0;
  for (const file of files) {
    requireMarkdownFileName(file.name);
    if (!Number.isFinite(file.size) || file.size < 0) {
      throw new Error(
        `Unable to determine the size of ${normalizeFileName(file.name)}`,
      );
    }
    if (file.size > MAX_MARKDOWN_IMPORT_FILE_BYTES) {
      throw new Error(
        `${normalizeFileName(file.name)} exceeds the ${describeBytes(MAX_MARKDOWN_IMPORT_FILE_BYTES)} file limit`,
      );
    }
    declaredTotal += file.size;
    if (declaredTotal > MAX_MARKDOWN_IMPORT_TOTAL_BYTES) {
      throw new Error(
        `Selected Markdown files exceed the ${describeBytes(MAX_MARKDOWN_IMPORT_TOTAL_BYTES)} total limit`,
      );
    }
  }

  const imported: ImportedMarkdownFile[] = [];
  let actualTotal = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_MARKDOWN_IMPORT_FILE_BYTES) {
      throw new Error(
        `${normalizeFileName(file.name)} exceeds the ${describeBytes(MAX_MARKDOWN_IMPORT_FILE_BYTES)} file limit`,
      );
    }
    actualTotal += bytes.byteLength;
    if (actualTotal > MAX_MARKDOWN_IMPORT_TOTAL_BYTES) {
      throw new Error(
        `Selected Markdown files exceed the ${describeBytes(MAX_MARKDOWN_IMPORT_TOTAL_BYTES)} total limit`,
      );
    }

    const decoded = new TextDecoder().decode(bytes);
    imported.push({
      name: requireMarkdownFileName(file.name),
      markdown: decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded,
    });
  }

  return imported;
}

export function createImportedMarkdownSnapshot(
  files: readonly ImportedMarkdownFile[],
  baseUrl: string,
): EditorDocumentSnapshot {
  if (files.length === 0) {
    throw new Error("Select at least one .md file");
  }

  const root = createImportRoot(baseUrl);
  const usedNames = new Set<string>();
  const parts = files.map((file) => {
    const name = uniqueMarkdownFileName(file.name, usedNames);
    const url = createImportedFileUrl(root, name);
    return {
      url,
      baseUrl: url,
      markdown: file.markdown,
    };
  });

  if (parts.length === 1) {
    return createSingleEditorDocumentSnapshot({
      markdown: parts[0].markdown,
      baseUrl: parts[0].baseUrl,
      sourceUrl: null,
    });
  }

  const snapshot = createBookEditorDocumentSnapshot({
    entryUrl: parts[0].url,
    currentPartUrl: parts[0].url,
    parts,
  });
  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => ({
      ...page,
      sourceUrl: null,
    })),
  };
}

export async function importMarkdownFiles(
  files: readonly MarkdownFileSource[],
  baseUrl: string,
): Promise<EditorDocumentSnapshot> {
  return createImportedMarkdownSnapshot(await readMarkdownFiles(files), baseUrl);
}
