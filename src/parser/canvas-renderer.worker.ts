/// <reference lib="webworker" />

import { MARGIN } from './constants';
import type { ParserOptions } from './index';
import type {
  CanvasDiagramBlock,
  CanvasHighlightedCodeBlock,
  CanvasThemeColors,
} from './canvas-renderer';
import {
  renderCanvasToContext,
  setCanvasImageLoadHook,
  setCanvasThemeColorsOverride,
} from './canvas-renderer';

type WorkerRenderParserOptions = Pick<ParserOptions, 'allowRawHtml' | 'baseUrl' | 'diagram'>;

type InitMessage = {
  type: 'init';
  canvas: OffscreenCanvas;
};

type RenderMessage = {
  type: 'render';
  requestId: number;
  markdownBuffer: ArrayBufferLike;
  width: number;
  minHeight: number;
  dpr: number;
  parserOptions: WorkerRenderParserOptions;
  themeColors: CanvasThemeColors;
};

type ExportMessage = {
  type: 'export';
  requestId: number;
};

type InputMessage = InitMessage | RenderMessage | ExportMessage;

type RenderedMessage = {
  type: 'rendered';
  requestId: number;
  width: number;
  height: number;
};

type ErrorMessage = {
  type: 'error';
  requestId?: number;
  message: string;
};

type ExportedMessage = {
  type: 'exported';
  requestId: number;
  blob: Blob;
};

type OutputMessage = RenderedMessage | ErrorMessage | ExportedMessage;

type ActiveRender = {
  requestId: number;
  bytes: Uint8Array;
  width: number;
  minHeight: number;
  dpr: number;
  parserOptions: WorkerRenderParserOptions;
  themeColors: CanvasThemeColors;
};

declare const self: DedicatedWorkerGlobalScope;
const scope = self;

let offscreenCanvas: OffscreenCanvas | null = null;
let measureCanvas: OffscreenCanvas | null = null;
let latestRender: ActiveRender | null = null;
let renderQueued = false;
let renderInFlight = false;
let rerenderPending = false;

setCanvasImageLoadHook((src, onResolve, onReject) => {
  void (async () => {
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) {
        onReject();
        return;
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      onResolve(bitmap, bitmap.width, bitmap.height);
    } catch {
      onReject();
    }
  })();
});

function scheduleRender(): void {
  if (renderInFlight) {
    rerenderPending = true;
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (!latestRender || !offscreenCanvas) return;
    if (renderInFlight) {
      rerenderPending = true;
      return;
    }
    void performRender(latestRender);
  });
}

function scheduleImageRerender(): void {
  rerenderPending = true;
  if (renderInFlight) return;
  scheduleRender();
}

async function performRender(request: ActiveRender): Promise<void> {
  if (!offscreenCanvas) return;

  renderInFlight = true;
  rerenderPending = false;
  setCanvasThemeColorsOverride(request.themeColors);

  try {
    if (!measureCanvas) {
      measureCanvas = new OffscreenCanvas(1, 1);
    }

    measureCanvas.width = Math.max(1, Math.ceil(request.width * request.dpr));
    measureCanvas.height = 1;
    const measureCtx = measureCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false,
    });

    if (!measureCtx) {
      scope.postMessage({ type: 'error', requestId: request.requestId, message: 'Failed to get measure context' } satisfies ErrorMessage);
      return;
    }

    measureCtx.setTransform(1, 0, 0, 1, 0, 0);
    measureCtx.scale(request.dpr, request.dpr);
    const codeHighlightCache: CanvasHighlightedCodeBlock[] = [];
    const diagramCache: Array<CanvasDiagramBlock | undefined> = [];
    const totalHeight = renderCanvasToContext(request.bytes, measureCtx as unknown as CanvasRenderingContext2D, true, {
      parserOptions: request.parserOptions,
      onImageLoad: scheduleImageRerender,
      dpr: request.dpr,
      themeColors: request.themeColors,
      codeHighlightCache,
      diagramCache,
    }) + MARGIN * 2;
    const renderHeight = Math.max(totalHeight, request.minHeight);

    offscreenCanvas.width = Math.max(1, Math.ceil(request.width * request.dpr));
    offscreenCanvas.height = Math.max(1, Math.ceil(renderHeight * request.dpr));

    const drawCtx = offscreenCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false,
    });
    if (!drawCtx) {
      scope.postMessage({ type: 'error', requestId: request.requestId, message: 'Failed to get draw context' } satisfies ErrorMessage);
      return;
    }

    if ('fontKerning' in drawCtx) {
      (drawCtx as any).fontKerning = 'normal';
    }
    if ('textRendering' in drawCtx) {
      (drawCtx as any).textRendering = 'optimizeLegibility';
    }

    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.scale(request.dpr, request.dpr);
    renderCanvasToContext(request.bytes, drawCtx as unknown as CanvasRenderingContext2D, false, {
      parserOptions: request.parserOptions,
      onImageLoad: scheduleImageRerender,
      dpr: request.dpr,
      themeColors: request.themeColors,
      codeHighlightCache,
      reuseCodeHighlightCache: true,
      diagramCache,
      reuseDiagramCache: true,
    });

    scope.postMessage({
      type: 'rendered',
      requestId: request.requestId,
      width: request.width,
      height: renderHeight,
    } satisfies OutputMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ type: 'error', requestId: request.requestId, message } satisfies ErrorMessage);
  } finally {
    renderInFlight = false;
    setCanvasThemeColorsOverride(null);
    if (rerenderPending && latestRender) {
      scheduleRender();
    }
  }
}

scope.onmessage = (event: MessageEvent<InputMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    offscreenCanvas = message.canvas;
    return;
  }

  if (message.type === 'export') {
    void (async () => {
      if (!offscreenCanvas) {
        scope.postMessage({
          type: 'error',
          requestId: message.requestId,
          message: 'Canvas worker not initialized',
        } satisfies ErrorMessage);
        return;
      }
      try {
        const blob = await offscreenCanvas.convertToBlob({ type: 'image/png' });
        scope.postMessage({
          type: 'exported',
          requestId: message.requestId,
          blob,
        } satisfies ExportedMessage);
      } catch (error) {
        const exportMessage = error instanceof Error ? error.message : String(error);
        scope.postMessage({
          type: 'error',
          requestId: message.requestId,
          message: exportMessage,
        } satisfies ErrorMessage);
      }
    })();
    return;
  }

  if (message.type === 'render') {
    latestRender = {
      requestId: message.requestId,
      bytes: new Uint8Array(message.markdownBuffer),
      width: message.width,
      minHeight: message.minHeight,
      dpr: message.dpr,
      parserOptions: message.parserOptions,
      themeColors: message.themeColors,
    };
    scheduleRender();
  }
};
