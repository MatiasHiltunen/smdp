export type DomChild = Node | string | number | boolean | null | undefined | DomChild[];

type EventListenerMap = { [event: string]: EventListenerOrEventListenerObject };

type DomProps<T extends HTMLElement> = Partial<Omit<T, "style">> & {
  className?: string;
  classList?: (string | false | null | undefined)[];
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration> | string;
  on?: EventListenerMap;
  attrs?: Record<string, string>;
};

const isNode = (value: DomChild): value is Node =>
  value instanceof Node;

const toNode = (value: DomChild): Node | null => {
  if (value == null || typeof value === "boolean") {
    return null;
  }

  if (isNode(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment();
    for (const child of value) {
      const node = toNode(child);
      if (node) fragment.append(node);
    }
    return fragment;
  }

  return document.createTextNode(String(value));
};

const applyClassList = (element: Element, classes?: DomProps<HTMLElement>["classList"], className?: string) => {
  if (className) {
    element.className = className;
  }
  if (!classes) return;
  for (const token of classes) {
    if (!token) continue;
    element.classList.add(token);
  }
};

const applyDataset = (element: HTMLElement, dataset?: Record<string, string>) => {
  if (!dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    element.dataset[key] = value;
  }
};

const applyAttributes = (element: HTMLElement, attrs?: Record<string, string>) => {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
};

const applyStyle = (element: HTMLElement, style?: DomProps<HTMLElement>["style"]) => {
  if (!style) return;
  if (typeof style === "string") {
    element.setAttribute("style", style);
    return;
  }
  for (const [prop, value] of Object.entries(style)) {
    if (value == null) continue;
    element.style.setProperty(prop, String(value));
  }
};

const applyEvents = (element: HTMLElement, events?: EventListenerMap) => {
  if (!events) return;
  for (const [event, handler] of Object.entries(events)) {
    element.addEventListener(event, handler);
  }
};

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: DomProps<HTMLElementTagNameMap[K]>,
  ...children: DomChild[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag) as HTMLElementTagNameMap[K];

  if (props) {
    applyClassList(element, props.classList, props.className);
    applyDataset(element, props.dataset);
    applyStyle(element, props.style);
    applyAttributes(element, props.attrs);
    applyEvents(element, props.on);

    for (const [key, value] of Object.entries(props)) {
      if (key in element || key.startsWith("aria") || key.startsWith("data")) {
        if (value === undefined || key === "className" || key === "classList" || key === "style" || key === "dataset" || key === "on" || key === "attrs") {
          continue;
        }
        try {
          (element as never)[key] = value as never;
        } catch {
          if (typeof value === "string") {
            element.setAttribute(key, value);
          }
        }
      }
    }
  }

  for (const child of children) {
    const node = toNode(child);
    if (node) element.append(node);
  }

  return element;
};

export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: DomProps<HTMLElementTagNameMap[K]>,
  ...children: DomChild[]
) => h(tag, props, ...children);

type Listener = () => void;

type StoreOptions = {
  schedule?: (fn: () => void) => void;
};

export type Store<T extends object> = {
  readonly state: T;
  effect(effect: Listener): () => void;
  subscribe(listener: Listener): () => void;
  destroy(): void;
};

const scheduleMicrotask = (fn: () => void) => {
  let called = false;
  queueMicrotask(() => {
    if (!called) fn();
  });
  return () => {
    called = true;
  };
};

export function createStore<T extends object>(initialState: T, options: StoreOptions = {}): Store<T> {
  const listeners = new Set<Listener>();
  let disposeScheduler: (() => void) | null = null;

  const schedule = options.schedule ?? ((fn: () => void) => {
    disposeScheduler?.();
    disposeScheduler = scheduleMicrotask(() => {
      disposeScheduler = null;
      fn();
    });
  });

  const notify = () => {
    schedule(() => {
      for (const listener of listeners) {
        listener();
      }
    });
  };

  const proxy = new Proxy(initialState, {
    set(target, key, value) {
      const current = Reflect.get(target, key);
      if (Object.is(current, value)) {
        return true;
      }
      const result = Reflect.set(target, key, value);
      notify();
      return result;
    },
  });

  return {
    state: proxy,
    effect(effect) {
      effect();
      listeners.add(effect);
      return () => listeners.delete(effect);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
      disposeScheduler?.();
      disposeScheduler = null;
    },
  };
}

export function assignState<T extends object>(store: Store<T>, patch: Partial<T>): void {
  Object.assign(store.state, patch);
}

export function toggleState<T extends object>(store: Store<T>, key: keyof T): void {
  const value = store.state[key];
  if (typeof value === "boolean") {
    store.state[key] = (!value as unknown) as T[typeof key];
  }
}

export const mount = (parent: Node, child: Node): Node => parent.appendChild(child);

export const replaceChildren = (parent: Element, ...children: DomChild[]): void => {
  parent.replaceChildren(...children.map((child) => toNode(child)).filter((node): node is Node => node !== null));
};
