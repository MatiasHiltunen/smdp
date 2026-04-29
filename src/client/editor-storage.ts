import type {
  EditorDocumentMode,
  EditorDocumentSnapshot,
  EditorPage,
} from "./editor-model";

type DraftRecord = {
  id: string;
  sourceKey: string;
  updatedAt: number;
  mode: EditorDocumentMode;
  entryUrl: string | null;
  currentPageId: string;
  removedUrls: string[];
  pageIds: string[];
};

type DraftPageRecord = {
  id: string;
  draftId: string;
  page: EditorPage;
  updatedAt: number;
};

const DB_NAME = "smdp-editor-drafts";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const PAGE_STORE = "pages";

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openEditorDraftDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
        drafts.createIndex("sourceKey", "sourceKey", { unique: true });
        drafts.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        const pages = db.createObjectStore(PAGE_STORE, { keyPath: "id" });
        pages.createIndex("draftId", "draftId");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(
        request.error ?? new Error("Unable to open editor draft database"),
      );
  });

  return dbPromise;
}

function buildDraftId(sourceKey: string): string {
  return `draft:${sourceKey}`;
}

function buildPageRecordId(draftId: string, pageId: string): string {
  return `${draftId}:page:${pageId}`;
}

function cloneSnapshot(snapshot: EditorDocumentSnapshot): EditorDocumentSnapshot {
  return {
    mode: snapshot.mode,
    entryUrl: snapshot.entryUrl,
    currentPageId: snapshot.currentPageId,
    pages: snapshot.pages.map((page) => ({ ...page })),
    removedUrls: [...snapshot.removedUrls],
  };
}

export function buildEditorDraftSourceKey(options: {
  mode: string;
  sourceUrl: string | null;
  bookEntryUrl: string | null;
  dataPayload: string | null;
  locationHref: string;
}): string {
  if (options.bookEntryUrl) {
    return `book:${options.bookEntryUrl}`;
  }
  if (options.sourceUrl) {
    return `doc:${options.sourceUrl}`;
  }
  if (options.dataPayload) {
    return `data:${options.dataPayload.slice(0, 256)}`;
  }
  const url = new URL(options.locationHref);
  url.hash = "";
  return `${options.mode}:${url.toString()}`;
}

export async function loadEditorDraftSnapshot(
  sourceKey: string,
): Promise<EditorDocumentSnapshot | null> {
  if (!hasIndexedDb()) {
    return null;
  }

  const db = await openEditorDraftDb();
  const transaction = db.transaction([DRAFT_STORE, PAGE_STORE], "readonly");
  const draftStore = transaction.objectStore(DRAFT_STORE);
  const pageStore = transaction.objectStore(PAGE_STORE);
  const draft = await requestResult(
    draftStore.index("sourceKey").get(sourceKey) as IDBRequest<
      DraftRecord | undefined
    >,
  );
  if (!draft) {
    return null;
  }

  const pages = await Promise.all(
    draft.pageIds.map(async (pageId) => {
      const record = await requestResult(
        pageStore.get(buildPageRecordId(draft.id, pageId)) as IDBRequest<
          DraftPageRecord | undefined
        >,
      );
      return record?.page ?? null;
    }),
  );
  await transactionDone(transaction);

  const restoredPages = pages.filter((page): page is EditorPage => page !== null);
  if (restoredPages.length === 0) {
    return null;
  }

  return {
    mode: draft.mode,
    entryUrl: draft.entryUrl,
    currentPageId: restoredPages.some((page) => page.id === draft.currentPageId)
      ? draft.currentPageId
      : restoredPages[0].id,
    pages: restoredPages,
    removedUrls: [...draft.removedUrls],
  };
}

export async function saveEditorDraftSnapshot(
  sourceKey: string,
  snapshot: EditorDocumentSnapshot,
): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }

  const db = await openEditorDraftDb();
  const transaction = db.transaction([DRAFT_STORE, PAGE_STORE], "readwrite");
  const draftStore = transaction.objectStore(DRAFT_STORE);
  const pageStore = transaction.objectStore(PAGE_STORE);
  const draftId = buildDraftId(sourceKey);
  const updatedAt = Date.now();
  const pageIds = snapshot.pages.map((page) => page.id);

  draftStore.put({
    id: draftId,
    sourceKey,
    updatedAt,
    mode: snapshot.mode,
    entryUrl: snapshot.entryUrl,
    currentPageId: snapshot.currentPageId,
    removedUrls: [...snapshot.removedUrls],
    pageIds,
  } satisfies DraftRecord);

  const existingPages = await requestResult(
    pageStore.index("draftId").getAll(IDBKeyRange.only(draftId)) as IDBRequest<
      DraftPageRecord[]
    >,
  );
  const nextRecordIds = new Set(
    snapshot.pages.map((page) => buildPageRecordId(draftId, page.id)),
  );

  for (const record of existingPages) {
    if (!nextRecordIds.has(record.id)) {
      pageStore.delete(record.id);
    }
  }

  for (const page of cloneSnapshot(snapshot).pages) {
    pageStore.put({
      id: buildPageRecordId(draftId, page.id),
      draftId,
      page,
      updatedAt,
    } satisfies DraftPageRecord);
  }

  await transactionDone(transaction);
}
