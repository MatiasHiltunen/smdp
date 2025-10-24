import assert from "node:assert/strict";
import test from "node:test";

import { MDParser, u8 } from "../src/parser";
import { encodeBlockSection } from "../src/parser/block-serializer";

test("parseFromBlocks matches parse output for paragraphs with blank lines", async () => {
  const parser = new MDParser();
  const markdown = [
    "# Heading",
    "",
    "First paragraph with **bold** text.",
    "",
    "Second paragraph after a blank line.",
    "",
    "Third paragraph to confirm multiple breaks.",
  ].join("\n");

  const bytes = u8(markdown);
  const blockBytes = encodeBlockSection(bytes);

  const html = await parser.parse(bytes);
  const htmlFromBlocks = await parser.parseFromBlocks(bytes, blockBytes);

  assert.equal(htmlFromBlocks, html);
  assert.ok(
    !html.includes("<br>"),
    "blank lines between paragraphs should not render <br> separators",
  );
  assert.match(
    html,
    /<p>First paragraph with <strong>bold<\/strong> text.<\/p>\s*<p>Second paragraph after a blank line.<\/p>\s*<p>Third paragraph to confirm multiple breaks.<\/p>/,
  );
});

test("renderToCanvasFromBlocksPayload consumes serialized block data", async () => {
  const parser = new MDParser();
  const markdown = [
    "# Canvas Heading",
    "",
    "Canvas paragraph rendered from structured payload.",
  ].join("\n");

  const bytes = u8(markdown);
  const blockBytes = encodeBlockSection(bytes);

  await withCanvasEnvironment(async () => {
    const canvas = new StubCanvas();
    parser.renderToCanvasFromBlocksPayload(bytes, blockBytes, canvas as unknown as HTMLCanvasElement);

    assert.equal(canvas.dataset.renderReady, "ready");
    assert.equal(canvas.dataset.virtualized, "false");
    assert.ok(canvas.width > 0, "canvas width should be configured during render");
    assert.ok(canvas.height > 0, "canvas height should be configured during render");
  });
});

class StubCanvas {
  public width = 0;
  public height = 0;
  public readonly style: Record<string, string> = {
    width: "",
    height: "",
    position: "",
    top: "",
    left: "",
  };
  public readonly dataset: Record<string, string> = {};
  public parentElement: null = null;

  constructor(private readonly logicalWidth = 800, private readonly logicalHeight = 600) {}

  getContext(_type: "2d", _opts?: CanvasRenderingContext2DSettings): StubCanvasRenderingContext2D | null {
    return new StubCanvasRenderingContext2D(this);
  }

  getBoundingClientRect(): DOMRect {
    return {
      width: this.logicalWidth,
      height: this.logicalHeight,
      top: 0,
      left: 0,
      bottom: this.logicalHeight,
      right: this.logicalWidth,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
  }

  toDataURL(): string {
    return "";
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

class StubCanvasRenderingContext2D implements Partial<CanvasRenderingContext2D> {
  public font = "";
  public fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  public strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  public lineWidth = 1;
  public textBaseline: CanvasTextBaseline = "alphabetic";
  public imageSmoothingEnabled = true;
  public imageSmoothingQuality: CanvasImageSmoothingQuality = "high";
  public globalCompositeOperation: GlobalCompositeOperation = "source-over";

  constructor(public readonly canvas: StubCanvas) {}

  measureText(text: string): TextMetrics {
    return {
      width: text.length * 6,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      alphabeticBaseline: 0,
      emHeightAscent: 0,
      emHeightDescent: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
      hangingBaseline: 0,
      ideographicBaseline: 0,
    } as TextMetrics;
  }

  // Drawing operations are stubbed out; we only need the renderer to run without throwing.
  fillText(): void {}
  strokeText(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  quadraticCurveTo(): void {}
  stroke(): void {}
  fill(): void {}
  save(): void {}
  restore(): void {}
  clip(): void {}
  scale(_x: number, _y: number): void {}
  setTransform(): void {}
  drawImage(): void {}
  createLinearGradient(): CanvasGradient {
    return {} as CanvasGradient;
  }
  createPattern(): CanvasPattern | null {
    return null;
  }
  createRadialGradient(): CanvasGradient {
    return {} as CanvasGradient;
  }
}

async function withCanvasEnvironment(run: () => void | Promise<void>): Promise<void> {
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  const originalGetComputedStyle = (globalThis as any).getComputedStyle;

  const stubWindow = {
    devicePixelRatio: 1,
    location: { href: "http://localhost/" },
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const stubDocument = {
    documentElement: {
      style: {},
      getAttribute: () => "dark",
      setAttribute: () => {},
    },
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return new StubCanvas();
      }
      return {
        style: {},
        dataset: {},
        appendChild: () => {},
        remove: () => {},
        setAttribute: () => {},
        classList: { add: () => {}, remove: () => {} },
      };
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };

  const stubGetComputedStyle = () => ({
    getPropertyValue: () => "",
  });

  try {
    (globalThis as any).window = stubWindow;
    (globalThis as any).document = stubDocument;
    (globalThis as any).getComputedStyle = stubGetComputedStyle;

    await run();
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    if (originalGetComputedStyle) {
      (globalThis as any).getComputedStyle = originalGetComputedStyle;
    } else {
      delete (globalThis as any).getComputedStyle;
    }
  }
}
