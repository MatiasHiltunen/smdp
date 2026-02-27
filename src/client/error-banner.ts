import { createElement } from "./dom";

export function displayError(message: string): void {
  const alert = createElement("div");
  alert.className = "error-banner";
  alert.role = "alert";
  alert.setAttribute("aria-live", "polite");
  alert.textContent = message;
  document.body.appendChild(alert);
}
