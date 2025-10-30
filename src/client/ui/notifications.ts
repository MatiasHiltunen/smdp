import { createElement, raf } from "../dom";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) {
    return container;
  }
  container = createElement("div", {
    className: "toast-stack",
    attrs: {
      role: "status",
      "aria-live": "polite",
    },
  });
  document.body.appendChild(container);
  return container;
}

export function displayError(message: string): void {
  const host = ensureContainer();
  const toast = createElement("div", {
    className: "toast toast--error",
    text: message,
    attrs: {
      role: "alert",
    },
  });

  host.appendChild(toast);

  // Trigger animation frame to allow transition from initial state
  raf(() => toast.classList.add("is-visible"));

  const hide = () => {
    toast.classList.remove("is-visible");
    toast.addEventListener(
      "transitionend",
      () => {
        toast.remove();
        if (host.childElementCount === 0) {
          host.remove();
          container = null;
        }
      },
      { once: true },
    );
  };

  setTimeout(hide, 4200);
}
