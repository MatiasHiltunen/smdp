export const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T) =>
  document.createElement(tag) as HTMLElementTagNameMap[T];
