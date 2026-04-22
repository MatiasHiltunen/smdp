import type {
  EditorDocumentSnapshot,
  EditorPatch,
  EditorStateController,
} from "./editor-model";

type EditorSyncMessage =
  | { type: "request-state"; sourceId: string }
  | {
      type: "snapshot";
      sourceId: string;
      snapshot: EditorDocumentSnapshot;
    }
  | {
      type: "patch";
      sourceId: string;
      patch: EditorPatch;
    };

type BridgeMode = "host" | "guest";

const STORAGE_PREFIX = "smdp-editor-session:";

function getStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function createEditorSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `editor-${Math.random().toString(36).slice(2, 10)}`;
}

export function readPersistedEditorSession(
  sessionId: string,
): EditorDocumentSnapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(getStorageKey(sessionId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as EditorDocumentSnapshot;
  } catch (error) {
    console.warn("Unable to read persisted editor session", error);
    return null;
  }
}

function writePersistedEditorSession(
  sessionId: string,
  snapshot: EditorDocumentSnapshot,
): void {
  try {
    globalThis.localStorage?.setItem(
      getStorageKey(sessionId),
      JSON.stringify(snapshot),
    );
  } catch (error) {
    console.warn("Unable to persist editor session", error);
  }
}

export type EditorSessionBridge = {
  sessionId: string;
  sourceId: string;
  requestLatestSnapshot(): void;
  flushSnapshot(): void;
  destroy(): void;
};

export function connectEditorSessionBridge(options: {
  sessionId: string;
  mode: BridgeMode;
  controller: EditorStateController;
}): EditorSessionBridge {
  const sourceId = createEditorSessionId();
  const channelName = `smdp-editor:${options.sessionId}`;
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName)
      : null;

  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writePersistedEditorSession(options.sessionId, options.controller.getSnapshot());
    }, 120);
  };

  const handleMessage = (message: EditorSyncMessage): void => {
    if (!message || message.sourceId === sourceId) {
      return;
    }

    switch (message.type) {
      case "request-state": {
        if (options.mode === "host") {
          const reply: EditorSyncMessage = {
            type: "snapshot",
            sourceId,
            snapshot: options.controller.getSnapshot(),
          };
          channel?.postMessage(reply);
        }
        break;
      }
      case "snapshot": {
        options.controller.replaceSnapshot(message.snapshot);
        schedulePersist();
        break;
      }
      case "patch": {
        options.controller.applyRemotePatch(message.patch);
        schedulePersist();
        break;
      }
      default:
        break;
    }
  };

  channel?.addEventListener("message", (event: MessageEvent<EditorSyncMessage>) => {
    handleMessage(event.data);
  });

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== getStorageKey(options.sessionId) || !event.newValue) {
      return;
    }
    try {
      const snapshot = JSON.parse(event.newValue) as EditorDocumentSnapshot;
      options.controller.replaceSnapshot(snapshot);
    } catch (error) {
      console.warn("Unable to process editor session storage update", error);
    }
  };
  window.addEventListener("storage", onStorage);

  const stopPatchForwarding = options.controller.onPatch((patch) => {
    const message: EditorSyncMessage = {
      type: "patch",
      sourceId,
      patch,
    };
    channel?.postMessage(message);
    schedulePersist();
  });

  writePersistedEditorSession(options.sessionId, options.controller.getSnapshot());

  const requestLatestSnapshot = (): void => {
    const message: EditorSyncMessage = { type: "request-state", sourceId };
    channel?.postMessage(message);
  };

  if (options.mode === "guest") {
    requestLatestSnapshot();
  }

  return {
    sessionId: options.sessionId,
    sourceId,
    requestLatestSnapshot,
    flushSnapshot() {
      writePersistedEditorSession(options.sessionId, options.controller.getSnapshot());
      const message: EditorSyncMessage = {
        type: "snapshot",
        sourceId,
        snapshot: options.controller.getSnapshot(),
      };
      channel?.postMessage(message);
    },
    destroy() {
      stopPatchForwarding();
      window.removeEventListener("storage", onStorage);
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      channel?.close();
    },
  };
}
