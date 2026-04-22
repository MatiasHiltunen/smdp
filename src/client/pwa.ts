type InstallAvailabilityListener = (available: boolean) => void;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PwaController = {
  canInstall(): boolean;
  promptInstall(): Promise<boolean>;
  subscribe(listener: InstallAvailabilityListener): () => void;
};

function emitAvailability(
  listeners: Set<InstallAvailabilityListener>,
  available: boolean,
): void {
  for (const listener of listeners) {
    listener(available);
  }
}

export function initializePwaController(): PwaController {
  const listeners = new Set<InstallAvailabilityListener>();
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  if (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    window.isSecureContext
  ) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("Service worker registration failed", error);
      });
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitAvailability(listeners, true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emitAvailability(listeners, false);
  });

  return {
    canInstall(): boolean {
      return deferredPrompt !== null;
    },
    async promptInstall(): Promise<boolean> {
      if (!deferredPrompt) {
        return false;
      }
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      emitAvailability(listeners, false);
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return choice.outcome === "accepted";
    },
    subscribe(listener: InstallAvailabilityListener): () => void {
      listeners.add(listener);
      listener(deferredPrompt !== null);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
