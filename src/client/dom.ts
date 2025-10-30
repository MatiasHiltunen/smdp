/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ultra-light DOM + reactive utilities used across the client UI.
 *
 * The goal of this module is to provide a composable foundation for
 * building small interactive widgets (such as floating menus) without
 * pulling an entire UI framework. It combines a minimal signal-based
 * reactive system with pragmatic helpers for working with DOM elements.
 */

// ---------------------------------------------------------------------------
// Reactive primitives
// ---------------------------------------------------------------------------

type EffectRunner = {
  fn: () => void;
  deps: Set<SignalBase<any>>;
  scheduled: boolean;
};

class SignalBase<T> {
  private value: T;
  private readonly effects = new Set<EffectRunner>();
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    if (activeEffect) {
      this.effects.add(activeEffect);
      activeEffect.deps.add(this);
    }
    return this.value;
  }

  peek(): T {
    return this.value;
  }

  set(next: T | ((prev: T) => T)): void {
    const nextValue = typeof next === "function" ? (next as (prev: T) => T)(this.value) : next;
    if (Object.is(nextValue, this.value)) {
      return;
    }
    this.value = nextValue;
    this.listeners.forEach((listener) => listener(this.value));
    this.effects.forEach((effect) => scheduleEffect(effect));
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.value);
    return () => {
      this.listeners.delete(listener);
    };
  }

  detach(effect: EffectRunner): void {
    this.effects.delete(effect);
  }
}

let activeEffect: EffectRunner | null = null;
const effectQueue = new Set<EffectRunner>();
let flushingEffects = false;

function runEffect(effect: EffectRunner): void {
  cleanupEffect(effect);
  activeEffect = effect;
  try {
    effect.fn();
  } finally {
    activeEffect = null;
    effect.scheduled = false;
  }
}

function scheduleEffect(effect: EffectRunner): void {
  if (effect.scheduled) {
    return;
  }
  effect.scheduled = true;
  effectQueue.add(effect);
  if (!flushingEffects) {
    flushingEffects = true;
    queueMicrotask(() => {
      effectQueue.forEach((runner) => {
        effectQueue.delete(runner);
        runEffect(runner);
      });
      flushingEffects = false;
    });
  }
}

function cleanupEffect(effect: EffectRunner): void {
  effect.deps.forEach((signal) => signal.detach(effect));
  effect.deps.clear();
}

export interface ReadonlySignal<T> {
  readonly value: T;
  get(): T;
  peek(): T;
  subscribe(listener: (value: T) => void): () => void;
}

export interface Signal<T> extends ReadonlySignal<T> {
  set(next: T | ((prev: T) => T)): void;
}

function createSignalWrapper<T>(base: SignalBase<T>): Signal<T> {
  return {
    get value() {
      return base.peek();
    },
    get(): T {
      return base.get();
    },
    peek(): T {
      return base.peek();
    },
    set(next: T | ((prev: T) => T)): void {
      base.set(next);
    },
    subscribe(listener: (value: T) => void): () => void {
      return base.subscribe(listener);
    },
  };
}

function createReadonlyWrapper<T>(base: SignalBase<T>): ReadonlySignal<T> {
  return {
    get value() {
      return base.peek();
    },
    get(): T {
      return base.get();
    },
    peek(): T {
      return base.peek();
    },
    subscribe(listener: (value: T) => void): () => void {
      return base.subscribe(listener);
    },
  };
}

/**
 * Create a mutable signal with an initial value.
 */
export function signal<T>(initial: T): Signal<T> {
  return createSignalWrapper(new SignalBase(initial));
}

/**
 * Create a derived (read-only) signal from a computation.
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const base = new SignalBase(fn());
  effect(() => {
    base.set(fn());
  });
  return createReadonlyWrapper(base);
}

/**
 * Run an effect whenever any of the accessed signals change.
 */
export function effect(fn: () => void): () => void {
  const runner: EffectRunner = {
    fn,
    deps: new Set<SignalBase<any>>(),
    scheduled: false,
  };
  runEffect(runner);
  return () => {
    cleanupEffect(runner);
  };
}

/**
 * Basic proxy-based state container.
 */
export type Store<T extends object> = {
  readonly state: T;
  set(patch: Partial<T>): void;
  update(mutator: (draft: T) => void): void;
  subscribe(listener: (state: T) => void): () => void;
  signal<K extends keyof T>(key: K): Signal<T[K]>;
};

export function store<T extends object>(initial: T): Store<T> {
  const base = { ...initial } as T;
  const signals = new Map<keyof T, Signal<any>>();
  const listeners = new Set<(state: T) => void>();

  const ensureSignal = <K extends keyof T>(key: K): Signal<T[K]> => {
    let sig = signals.get(key) as Signal<T[K]> | undefined;
    if (!sig) {
      const created = signal(base[key] as T[K]);
      let initialized = false;
      created.subscribe((value) => {
        base[key] = value as T[K];
        if (initialized) {
          listeners.forEach((listener) => listener(proxy));
        } else {
          initialized = true;
        }
      });
      signals.set(key, created as Signal<any>);
      sig = created;
    }
    return sig;
  };

  const proxy = new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key)) {
        return ensureSignal(key as keyof T).get();
      }
      return Reflect.get(target, key, receiver);
    },
    set(_target, key, value) {
      if (typeof key === 'string') {
        ensureSignal(key as keyof T).set(value as T[keyof T]);
        return true;
      }
      return Reflect.set(_target, key, value);
    },
  });

  const set = (patch: Partial<T>) => {
    for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
      ensureSignal(key).set(value);
    }
  };

  const update = (mutator: (draft: T) => void) => {
    const draft = { ...proxy } as T;
    mutator(draft);
    set(draft);
  };

  const subscribe = (listener: (state: T) => void) => {
    listeners.add(listener);
    listener(proxy);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    state: proxy,
    set,
    update,
    subscribe,
    signal: ensureSignal,
  };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

type ElementChild = Node | string | number | boolean | null | undefined;

type ElementOptions = {
  className?: string;
  classes?: string | string[];
  attrs?: Record<string, string | number | null | undefined>;
  dataset?: Record<string, string | number | null | undefined>;
  style?: Partial<CSSStyleDeclaration>;
  text?: string;
  html?: string;
  children?: ElementChild[];
  on?: Record<string, EventListenerOrEventListenerObject>;
};

/**
 * Create an HTMLElement with convenience options for attributes, listeners,
 * and children. The function keeps backwards compatibility with the previous
 * implementation by allowing invocation without the options argument.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (!options) {
    return element;
  }

  if (options.className) {
    element.className = options.className;
  }
  if (options.classes) {
    const classes = Array.isArray(options.classes) ? options.classes : [options.classes];
    element.classList.add(...classes.filter(Boolean));
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      setAttribute(element, key, value);
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value == null) {
        delete element.dataset[key];
      } else {
        element.dataset[key] = String(value);
      }
    }
  }
  if (options.style) {
    Object.assign(element.style, options.style);
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  } else if (options.html !== undefined) {
    element.innerHTML = options.html;
  }
  if (options.children) {
    appendChildren(element, options.children);
  }
  if (options.on) {
    for (const [key, handler] of Object.entries(options.on)) {
      element.addEventListener(key, handler);
    }
  }
  return element;
}

export function text(content: string): Text {
  return document.createTextNode(content);
}

export function fragment(children: ElementChild[] = []): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  return frag;
}

export function appendChildren(target: Node, children: ElementChild[]): void {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (typeof child === "string" || typeof child === "number") {
      target.appendChild(text(String(child)));
    } else {
      target.appendChild(child);
    }
  }
}

export function setAttribute(
  element: Element,
  name: string,
  value: string | number | null | undefined,
): void {
  if (value == null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, String(value));
  }
}

type Source<T> = ReadonlySignal<T> | (() => T);

function readSource<T>(source: Source<T>): T {
  return typeof source === "function" ? (source as () => T)() : source.get();
}

function asEffect<T>(source: Source<T>, run: (value: T) => void): () => void {
  return effect(() => {
    run(readSource(source));
  });
}

export function bindAttribute(
  element: Element,
  name: string,
  source: Source<string | number | null | undefined>,
): () => void {
  return asEffect(source, (value) => setAttribute(element, name, value));
}

export function bindClass(element: Element, className: string, source: Source<boolean>): () => void {
  return asEffect(source, (value) => {
    element.classList.toggle(className, Boolean(value));
  });
}

export function bindStyle(
  element: HTMLElement,
  property: keyof CSSStyleDeclaration,
  source: Source<string | null | undefined>,
): () => void {
  return asEffect(source, (value) => {
    const propName = property as string;
    if (value == null) {
      element.style.removeProperty(propName);
    } else {
      element.style.setProperty(propName, value);
    }
  });
}

export function bindText(element: HTMLElement, source: Source<string | number>): () => void {
  return asEffect(source, (value) => {
    element.textContent = String(value);
  });
}

export function bindDisabled(element: HTMLButtonElement | HTMLInputElement, source: Source<boolean>): () => void {
  return asEffect(source, (value) => {
    element.disabled = Boolean(value);
  });
}

/**
 * Register an event listener returning a disposer for convenience.
 */
export function on(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * Run handler whenever a pointer event happens outside the provided element.
 */
export function onClickOutside(
  element: HTMLElement,
  handler: (event: PointerEvent) => void,
  options?: { capture?: boolean },
): () => void {
  return on(document, "pointerdown", (event) => {
    const target = event.target as Node | null;
    if (target && !element.contains(target)) {
      handler(event as PointerEvent);
    }
  }, options?.capture ?? false);
}

/**
 * Observe attribute mutations on an element and invoke the callback whenever
 * the attribute changes.
 */
export function watchAttribute(
  element: Element,
  attributeName: string,
  callback: (value: string | null) => void,
): () => void {
  const observer = new MutationObserver(() => {
    callback(element.getAttribute(attributeName));
  });
  observer.observe(element, { attributes: true, attributeFilter: [attributeName] });
  callback(element.getAttribute(attributeName));
  return () => observer.disconnect();
}

/**
 * Utility to compose multiple disposer functions into a single disposer.
 */
export function composeDisposers(...disposers: Array<() => void | undefined>): () => void {
  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch (error) {
        console.error("Error while disposing", error);
      }
    }
  };
}

/**
 * Request an animation frame and return a disposer that cancels it.
 */
export function raf(callback: FrameRequestCallback): () => void {
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
}

// Ensure the module itself has no top-level side effects that depend on DOM.
