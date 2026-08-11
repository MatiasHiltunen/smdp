import {
  createBookEditorDocumentSnapshot,
  createSingleEditorDocumentSnapshot,
  getCurrentEditorPage,
  slugifyEditorPageTitle,
  type EditorDocumentMode,
  type EditorDocumentSnapshot,
  type EditorPathMode,
  type EditorTitleMode,
} from "./editor-model";

const ARCHIVE_FORMAT = "smdp-markdown-book";
const ARCHIVE_VERSION = 1;
const MANIFEST_PATH = "smdp-book.json";
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_HEADER = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;
const MAX_ARCHIVE_FILES = 512;
const MAX_ARCHIVE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024;
export const MAX_EDITOR_ARCHIVE_IMPORT_BYTES = 160 * 1024 * 1024;
const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdown|mdx)$/i;
const TE = new TextEncoder();
const TD = new TextDecoder("utf-8", { fatal: true });

type ArchivePageManifest = {
  path: string;
  title: string;
  titleMode: EditorTitleMode;
  pathMode: EditorPathMode;
};

type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  mode: EditorDocumentMode;
  entryPath: string | null;
  currentPath: string;
  pages: ArchivePageManifest[];
};

type ZipInputFile = {
  path: string;
  bytes: Uint8Array;
};

type ParsedZipEntry = {
  path: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type EditorArchive = {
  bytes: Uint8Array;
  filename: string;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(parts: readonly Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toDosTimestamp(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2)) & 0x1f),
    date:
      (((year - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f),
  };
}

function createStoredZip(files: readonly ZipInputFile[]): Uint8Array {
  if (files.length > MAX_ARCHIVE_FILES) {
    throw new Error(`Archive exceeds the ${MAX_ARCHIVE_FILES}-file limit`);
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { time, date } = toDosTimestamp();
  let localOffset = 0;
  let totalUncompressed = 0;

  for (const file of files) {
    const name = TE.encode(file.path);
    if (name.length > 0xffff) {
      throw new Error(`Archive path is too long: ${file.path}`);
    }
    if (file.bytes.length > MAX_ARCHIVE_FILE_BYTES) {
      throw new Error(`Archive file is too large: ${file.path}`);
    }
    totalUncompressed += file.bytes.length;
    if (totalUncompressed > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new Error("Archive content is too large");
    }

    const checksum = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, ZIP_LOCAL_HEADER);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, ZIP_UTF8_FLAG);
    writeU16(localView, 8, ZIP_METHOD_STORED);
    writeU16(localView, 10, time);
    writeU16(localView, 12, date);
    writeU32(localView, 14, checksum);
    writeU32(localView, 18, file.bytes.length);
    writeU32(localView, 22, file.bytes.length);
    writeU16(localView, 26, name.length);
    writeU16(localView, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, ZIP_CENTRAL_HEADER);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, ZIP_UTF8_FLAG);
    writeU16(centralView, 10, ZIP_METHOD_STORED);
    writeU16(centralView, 12, time);
    writeU16(centralView, 14, date);
    writeU32(centralView, 16, checksum);
    writeU32(centralView, 20, file.bytes.length);
    writeU32(centralView, 24, file.bytes.length);
    writeU16(centralView, 28, name.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + file.bytes.length;
  }

  const centralLength = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, ZIP_END_HEADER);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralLength);
  writeU32(endView, 16, localOffset);
  writeU16(endView, 20, 0);

  return concatBytes(
    [...localParts, ...centralParts, end],
    localOffset + centralLength + end.length,
  );
}

function decodeUrlPathname(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function normalizeExportPath(value: string, fallback: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(/[\u0000-\u001f:]/g, "-").trim())
    .filter(Boolean);
  let path = segments.join("/") || fallback;
  if (!MARKDOWN_EXTENSION_RE.test(path)) {
    path += ".md";
  }
  return path;
}

function getRelativePagePath(
  snapshot: EditorDocumentSnapshot,
  pageUrl: string,
  fallback: string,
): string {
  if (snapshot.entryUrl) {
    try {
      const entry = new URL(snapshot.entryUrl);
      const page = new URL(pageUrl);
      const entryDirectory = entry.pathname.replace(/[^/]*$/, "");
      if (entry.origin === page.origin && page.pathname.startsWith(entryDirectory)) {
        return normalizeExportPath(
          decodeUrlPathname(page.pathname.slice(entryDirectory.length)),
          fallback,
        );
      }
    } catch {
      // Fall through to the page filename.
    }
  }

  try {
    const page = new URL(pageUrl);
    const filename = decodeUrlPathname(page.pathname).split("/").pop() ?? "";
    return normalizeExportPath(filename, fallback);
  } catch {
    return normalizeExportPath(pageUrl, fallback);
  }
}

function makeUniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const extension = path.match(MARKDOWN_EXTENSION_RE)?.[0] ?? ".md";
  const stem = path.slice(0, path.length - extension.length);
  let index = 2;
  while (usedPaths.has(`${stem}-${index}${extension}`)) {
    index += 1;
  }
  const unique = `${stem}-${index}${extension}`;
  usedPaths.add(unique);
  return unique;
}

export function createEditorArchive(
  snapshot: EditorDocumentSnapshot,
): EditorArchive {
  if (snapshot.pages.length === 0) {
    throw new Error("There are no Markdown pages to export");
  }

  const usedPaths = new Set<string>();
  const pathByPageId = new Map<string, string>();
  const pageFiles: ZipInputFile[] = [];
  const manifestPages: ArchivePageManifest[] = [];

  snapshot.pages.forEach((page, index) => {
    const fallback = `${slugifyEditorPageTitle(page.title) || `page-${index + 1}`}.md`;
    const path = makeUniquePath(
      getRelativePagePath(snapshot, page.url, fallback),
      usedPaths,
    );
    pathByPageId.set(page.id, path);
    pageFiles.push({ path, bytes: TE.encode(page.markdown) });
    manifestPages.push({
      path,
      title: page.title,
      titleMode: page.titleMode,
      pathMode: page.pathMode,
    });
  });

  const entryPage = snapshot.entryUrl
    ? snapshot.pages.find((page) => page.url === snapshot.entryUrl)
    : snapshot.pages[0];
  const currentPage = getCurrentEditorPage(snapshot) ?? snapshot.pages[0];
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    mode: snapshot.mode,
    entryPath: entryPage ? pathByPageId.get(entryPage.id) ?? null : null,
    currentPath: pathByPageId.get(currentPage.id) ?? manifestPages[0].path,
    pages: manifestPages,
  };
  const manifestBytes = TE.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const archiveTitle =
    (entryPage?.title || currentPage.title || "markdown-book").trim();
  const filename = `${slugifyEditorPageTitle(archiveTitle) || "markdown-book"}.zip`;

  return {
    bytes: createStoredZip([
      { path: MANIFEST_PATH, bytes: manifestBytes },
      ...pageFiles,
    ]),
    filename,
  };
}

function assertRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Invalid ZIP ${label}`);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    throw new Error("ZIP file is incomplete");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      view.getUint32(offset, true) === ZIP_END_HEADER &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      return offset;
    }
  }
  throw new Error("ZIP central directory was not found");
}

function normalizeImportedPath(value: string): string {
  if (!value || value.includes("\0")) {
    throw new Error("ZIP contains an invalid path");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`ZIP contains an absolute path: ${value}`);
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`ZIP contains an unsafe path: ${value}`);
  }
  return segments.join("/");
}

function parseCentralDirectory(bytes: Uint8Array): ParsedZipEntry[] {
  const endOffset = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntryCount = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0) {
    throw new Error("Multi-disk ZIP archives are not supported");
  }
  if (diskEntryCount !== entryCount) {
    throw new Error("ZIP entry counts are inconsistent");
  }
  if (entryCount > MAX_ARCHIVE_FILES) {
    throw new Error(`ZIP exceeds the ${MAX_ARCHIVE_FILES}-file limit`);
  }
  assertRange(bytes, centralOffset, centralSize, "central directory");
  if (centralOffset + centralSize > endOffset) {
    throw new Error("ZIP central directory overlaps its end record");
  }

  const entries: ParsedZipEntry[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(bytes, offset, 46, "central entry");
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_HEADER) {
      throw new Error("ZIP central entry is invalid");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    assertRange(bytes, offset, entryLength, "central entry data");
    if (flags & 0x0001) {
      throw new Error("Encrypted ZIP archives are not supported");
    }
    if (method !== ZIP_METHOD_STORED && method !== ZIP_METHOD_DEFLATE) {
      throw new Error(`ZIP compression method ${method} is not supported`);
    }
    if (uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
      throw new Error("ZIP contains a file that is too large");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new Error("ZIP expands beyond the archive size limit");
    }

    const pathBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const rawPath = TD.decode(pathBytes);
    const isDirectory = rawPath.endsWith("/") || rawPath.endsWith("\\");
    const path = normalizeImportedPath(rawPath);
    if (path && !isDirectory) {
      entries.push({
        path,
        method,
        crc32: checksum,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    offset += entryLength;
  }

  if (offset > centralOffset + centralSize) {
    throw new Error("ZIP central directory size is invalid");
  }
  return entries;
}

async function inflateRaw(
  bytes: Uint8Array,
  expectedSize: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot import compressed ZIP entries");
  }
  const owned = Uint8Array.from(bytes);
  const input = new Blob([owned.buffer]).stream();
  const output = input.pipeThrough(
    new DecompressionStream("deflate-raw" as CompressionFormat),
  );
  const reader = output.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalLength += chunk.length;
    if (
      totalLength > expectedSize ||
      totalLength > MAX_ARCHIVE_FILE_BYTES
    ) {
      await reader.cancel();
      throw new Error("ZIP entry expands beyond its declared size");
    }
    chunks.push(chunk);
  }
  return concatBytes(chunks, totalLength);
}

async function readZipFiles(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = parseCentralDirectory(bytes);
  const files = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (files.has(entry.path)) {
      throw new Error(`ZIP contains a duplicate path: ${entry.path}`);
    }
    assertRange(bytes, entry.localHeaderOffset, 30, "local entry");
    if (view.getUint32(entry.localHeaderOffset, true) !== ZIP_LOCAL_HEADER) {
      throw new Error(`ZIP local entry is invalid: ${entry.path}`);
    }
    const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
    const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    assertRange(bytes, dataOffset, entry.compressedSize, "file data");
    const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const content =
      entry.method === ZIP_METHOD_STORED
        ? Uint8Array.from(compressed)
        : await inflateRaw(compressed, entry.uncompressedSize);
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc32) {
      throw new Error(`ZIP checksum failed: ${entry.path}`);
    }
    files.set(entry.path, content);
  }

  return files;
}

function isArchiveManifest(value: unknown): value is ArchiveManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ArchiveManifest>;
  return (
    manifest.format === ARCHIVE_FORMAT &&
    manifest.version === ARCHIVE_VERSION &&
    (manifest.mode === "single" || manifest.mode === "book") &&
    (manifest.entryPath === null || typeof manifest.entryPath === "string") &&
    typeof manifest.currentPath === "string" &&
    Array.isArray(manifest.pages) &&
    manifest.pages.every((page) => {
      if (!page || typeof page !== "object") return false;
      const candidate = page as Partial<ArchivePageManifest>;
      return (
        typeof candidate.path === "string" &&
        typeof candidate.title === "string" &&
        (candidate.titleMode === "derived" || candidate.titleMode === "manual") &&
        (candidate.pathMode === "derived" || candidate.pathMode === "manual")
      );
    })
  );
}

function findDefaultEntryPath(paths: readonly string[]): string {
  return (
    [...paths]
      .sort((left, right) => left.split("/").length - right.split("/").length)
      .find((path) => /(^|\/)readme\.(md|markdown|mdown|mdx)$/i.test(path)) ??
    paths[0]
  );
}

function buildImportedRootUrl(filename: string): string {
  const name = filename.replace(/\.zip$/i, "");
  const slug = slugifyEditorPageTitle(name) || "imported-book";
  return `https://editor.smdp.app/imported/${slug}/`;
}

function buildImportedPageUrl(rootUrl: string, path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedPath, rootUrl).toString();
}

export async function importEditorArchive(
  input: Uint8Array | ArrayBuffer,
  filename = "imported-book.zip",
): Promise<EditorDocumentSnapshot> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_EDITOR_ARCHIVE_IMPORT_BYTES) {
    throw new Error("ZIP file is too large to import");
  }
  const files = await readZipFiles(bytes);
  const manifestBytes = files.get(MANIFEST_PATH);
  let manifest: ArchiveManifest | null = null;
  if (manifestBytes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(TD.decode(manifestBytes));
    } catch {
      throw new Error("The SMDP archive manifest is invalid");
    }
    if (!isArchiveManifest(parsed)) {
      throw new Error("The SMDP archive manifest version is not supported");
    }
    manifest = parsed;
  }

  const manifestPages = manifest?.pages ?? [];
  const markdownPaths = manifest
    ? manifestPages.map((page) => normalizeImportedPath(page.path))
    : Array.from(files.keys()).filter(
        (path) =>
          MARKDOWN_EXTENSION_RE.test(path) &&
          !path.startsWith("__MACOSX/") &&
          !path.split("/").some((segment) => segment.startsWith(".")),
      );
  if (markdownPaths.length === 0) {
    throw new Error("ZIP does not contain any Markdown pages");
  }

  const seenPaths = new Set<string>();
  for (const path of markdownPaths) {
    if (seenPaths.has(path)) {
      throw new Error(`Archive manifest repeats a page path: ${path}`);
    }
    seenPaths.add(path);
    if (!files.has(path)) {
      throw new Error(`Archive page is missing: ${path}`);
    }
  }

  const entryPath = normalizeImportedPath(
    manifest?.entryPath ?? findDefaultEntryPath(markdownPaths),
  );
  const currentPath = normalizeImportedPath(
    manifest?.currentPath ?? entryPath,
  );
  if (!seenPaths.has(entryPath) || !seenPaths.has(currentPath)) {
    throw new Error("Archive entry or current page is missing");
  }

  const rootUrl = buildImportedRootUrl(filename);
  const pageData = markdownPaths.map((path, index) => {
    const bytesForPage = files.get(path)!;
    const meta = manifestPages[index];
    const url = buildImportedPageUrl(rootUrl, path);
    return {
      path,
      url,
      markdown: TD.decode(bytesForPage),
      title: meta?.title,
      titleMode: meta?.titleMode,
      pathMode: meta?.pathMode,
    };
  });
  const mode = manifest?.mode ?? (pageData.length > 1 ? "book" : "single");

  if (mode === "single" && pageData.length !== 1) {
    throw new Error("Single-page archives must contain exactly one Markdown page");
  }

  if (mode === "single") {
    const source = pageData.find((page) => page.path === currentPath) ?? pageData[0];
    const snapshot = createSingleEditorDocumentSnapshot({
      markdown: source.markdown,
      baseUrl: source.url,
      sourceUrl: null,
    });
    snapshot.pages[0] = {
      ...snapshot.pages[0],
      ...(source.title ? { title: source.title } : {}),
      titleMode: source.titleMode === "manual" ? "manual" : "derived",
      synthetic: true,
      pathMode: source.pathMode === "derived" ? "derived" : "manual",
    };
    return snapshot;
  }

  const entryUrl = buildImportedPageUrl(rootUrl, entryPath);
  const currentUrl = buildImportedPageUrl(rootUrl, currentPath);
  const snapshot = createBookEditorDocumentSnapshot({
    entryUrl,
    currentPartUrl: currentUrl,
    parts: pageData.map((page) => ({
      url: page.url,
      baseUrl: page.url,
      markdown: page.markdown,
    })),
  });
  snapshot.pages = snapshot.pages.map((page, index) => ({
    ...page,
    ...(pageData[index].title ? { title: pageData[index].title } : {}),
    titleMode: pageData[index].titleMode === "manual" ? "manual" : "derived",
    sourceUrl: null,
    synthetic: true,
    pathMode: pageData[index].pathMode === "derived" ? "derived" : "manual",
  }));
  return snapshot;
}
