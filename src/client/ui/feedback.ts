import { createElement } from "../dom";

export function displayError(message: string): void {
  const alert = createElement("div", {
    className: "error-banner",
    attrs: { role: "alert", "aria-live": "polite" },
  });
  alert.textContent = message;
  document.body.append(alert);
}
