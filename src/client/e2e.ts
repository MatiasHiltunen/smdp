import { createElement, replaceElementHtml } from "./dom";
import { fetchMarkdown } from "./fetch";
import { MDParser } from "../parser/index";
import { TD } from "../parser/constants";
import { exportCanvasAsImageBlob } from "../parser/canvas-renderer";

type StepStatus = "pass" | "fail";

type StepResult = {
  name: string;
  status: StepStatus;
  durationMs: number;
  details: string[];
};

type E2EContext = {
  parser: MDParser;
  target: URL | null;
  bytes: Uint8Array;
  baseUrl: string;
  htmlContainer: HTMLElement;
  canvasHost: HTMLElement;
  canvas: HTMLCanvasElement;
};

function formatMs(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function waitForCanvasReady(canvas: HTMLCanvasElement, timeoutMs = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = performance.now();
    const tick = (): void => {
      const status = canvas.dataset.renderReady;
      if (status === "ready") {
        resolve();
        return;
      }
      if (status === "error") {
        reject(new Error("canvas renderer reported an error"));
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error("canvas render timeout"));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function mountE2ETestRunner(initialTarget: URL | null): void {
  const shell = createElement("main");
  shell.className = "e2e-shell";

  const card = createElement("section");
  card.className = "e2e-card";

  const heading = createElement("h1");
  heading.textContent = "In-Browser E2E Runner";

  const intro = createElement("p");
  intro.className = "e2e-intro";
  intro.textContent =
    "Runs HTML and canvas rendering checks directly in this browser session. Enter a markdown URL or run against the local sample.";

  const controls = createElement("form");
  controls.className = "e2e-controls";

  const targetInput = createElement("input");
  targetInput.type = "url";
  targetInput.className = "e2e-target";
  targetInput.placeholder = "https://raw.githubusercontent.com/owner/repo/main/README.md";
  targetInput.value = initialTarget?.toString() ?? "";

  const runButton = createElement("button");
  runButton.type = "submit";
  runButton.className = "e2e-run";
  runButton.textContent = "Run E2E Suite";

  const summary = createElement("div");
  summary.className = "e2e-summary";
  summary.textContent = "Ready.";

  const results = createElement("ol");
  results.className = "e2e-results";

  const preview = createElement("section");
  preview.className = "e2e-preview";

  const htmlPreview = createElement("article");
  htmlPreview.className = "markdown-viewer";

  const canvasHost = createElement("div");
  canvasHost.className = "e2e-canvas-host";
  const canvas = createElement("canvas");
  canvas.className = "md-canvas";
  canvasHost.appendChild(canvas);

  preview.append(htmlPreview, canvasHost);
  controls.append(targetInput, runButton);
  card.append(heading, intro, controls, summary, results, preview);
  shell.appendChild(card);
  document.body.replaceChildren(shell);

  const parser = new MDParser({
    allowRawHtml: false,
  });

  const runStep = async (
    name: string,
    work: (details: string[]) => Promise<void>,
  ): Promise<StepResult> => {
    const item = createElement("li");
    item.className = "e2e-step is-running";
    item.textContent = `${name} …`;
    results.appendChild(item);

    const details: string[] = [];
    const startedAt = performance.now();
    try {
      await work(details);
      const durationMs = performance.now() - startedAt;
      item.className = "e2e-step is-pass";
      item.textContent = `PASS ${name} (${formatMs(durationMs)})`;
      if (details.length > 0) {
        const detail = createElement("pre");
        detail.className = "e2e-detail";
        detail.textContent = details.join("\n");
        item.appendChild(detail);
      }
      return { name, status: "pass", durationMs, details };
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      details.push(`error: ${message}`);
      item.className = "e2e-step is-fail";
      item.textContent = `FAIL ${name} (${formatMs(durationMs)})`;
      const detail = createElement("pre");
      detail.className = "e2e-detail";
      detail.textContent = details.join("\n");
      item.appendChild(detail);
      return { name, status: "fail", durationMs, details };
    }
  };

  const execute = async (): Promise<void> => {
    runButton.disabled = true;
    runButton.setAttribute("aria-busy", "true");
    results.replaceChildren();
    summary.textContent = "Running…";
    htmlPreview.replaceChildren();
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.width = "1px";
    canvas.style.height = "1px";
    canvasHost.style.width = "min(100%, 920px)";

    const targetText = targetInput.value.trim();
    let targetUrl: URL | null = null;
    if (targetText) {
      try {
        targetUrl = new URL(targetText);
      } catch {
        summary.textContent = "Invalid URL. Provide a full URL or leave empty for local sample.";
        runButton.disabled = false;
        runButton.removeAttribute("aria-busy");
        return;
      }
    }

    const ctx: E2EContext = {
      parser,
      target: targetUrl,
      bytes: new Uint8Array(0),
      baseUrl: "",
      htmlContainer: htmlPreview,
      canvasHost,
      canvas,
    };

    const steps: Array<() => Promise<StepResult>> = [
      () =>
        runStep("Fetch markdown payload", async (details) => {
          const resolved = await fetchMarkdown(ctx.target);
          ctx.bytes = resolved.bytes;
          ctx.baseUrl = resolved.baseUrl;
          const markdownText = TD.decode(resolved.bytes);
          details.push(`source: ${ctx.target ? ctx.target.toString() : "/test.md"}`);
          details.push(`baseUrl: ${ctx.baseUrl}`);
          details.push(`payload: ${formatBytes(ctx.bytes.byteLength)}`);
          details.push(`characters: ${markdownText.length}`);
          assertCondition(ctx.bytes.byteLength > 0, "empty markdown payload");
        }),

      () =>
        runStep("HTML render: default mode", async (details) => {
          const html = await ctx.parser.parse(ctx.bytes, { baseUrl: ctx.baseUrl });
          assertCondition(html.length > 0, "empty html output");
          assertCondition(!/<script\b/i.test(html), "unsafe <script> tag found in output");
          details.push(`html bytes: ${formatBytes(html.length)}`);
          details.push(`contains script tag: ${/<script\b/i.test(html)}`);
        }),

      () =>
        runStep("HTML render: safe raw HTML mode", async (details) => {
          const html = await ctx.parser.parse(ctx.bytes, {
            allowRawHtml: true,
            baseUrl: ctx.baseUrl,
          });
          replaceElementHtml(ctx.htmlContainer, html, {
            baseUrl: ctx.baseUrl,
          });
          const textLength = (ctx.htmlContainer.textContent ?? "").trim().length;
          assertCondition(textLength > 0, "rendered html has no text content");
          assertCondition(
            !ctx.htmlContainer.querySelector("script"),
            "sanitizer allowed a script element",
          );
          details.push(`rendered text chars: ${textLength}`);
          details.push(`elements: ${ctx.htmlContainer.querySelectorAll("*").length}`);
        }),

      () =>
        runStep("Canvas render and readiness", async (details) => {
          ctx.canvasHost.style.width = "min(100%, 920px)";
          ctx.parser.renderToCanvas(ctx.bytes, ctx.canvas, {
            allowRawHtml: true,
            baseUrl: ctx.baseUrl,
          });
          await waitForCanvasReady(ctx.canvas);
          assertCondition(ctx.canvas.width > 0, "canvas width is zero");
          assertCondition(ctx.canvas.height > 0, "canvas height is zero");
          details.push(`canvas bitmap: ${ctx.canvas.width}x${ctx.canvas.height}`);
          details.push(`canvas style: ${ctx.canvas.style.width} x ${ctx.canvas.style.height}`);
          details.push(`virtualized: ${ctx.canvas.dataset.virtualized ?? "false"}`);
        }),

      () =>
        runStep("Canvas rerender after width change", async (details) => {
          ctx.canvasHost.style.width = "100%";
          ctx.parser.renderToCanvas(ctx.bytes, ctx.canvas, {
            allowRawHtml: true,
            baseUrl: ctx.baseUrl,
          });
          await waitForCanvasReady(ctx.canvas);
          const wideWidth = ctx.canvas.width;

          ctx.canvasHost.style.width = "55%";
          ctx.parser.renderToCanvas(ctx.bytes, ctx.canvas, {
            allowRawHtml: true,
            baseUrl: ctx.baseUrl,
          });
          window.dispatchEvent(new Event("resize"));
          await waitForCanvasReady(ctx.canvas);
          const narrowWidth = ctx.canvas.width;
          assertCondition(
            narrowWidth < wideWidth,
            "canvas width did not shrink after resize",
          );
          details.push(`wide bitmap width: ${wideWidth}`);
          details.push(`narrow bitmap width: ${narrowWidth}`);
        }),

      () =>
        runStep("Canvas export as PNG", async (details) => {
          const blob = await exportCanvasAsImageBlob(ctx.canvas);
          assertCondition(blob.type === "image/png", `unexpected blob type: ${blob.type}`);
          assertCondition(blob.size > 0, "exported blob is empty");
          details.push(`blob type: ${blob.type}`);
          details.push(`blob size: ${formatBytes(blob.size)}`);
        }),

      () =>
        runStep("Theme mutation and rerender stability", async (details) => {
          const root = document.documentElement;
          const previousAccent = root.style.getPropertyValue("--accent");
          root.style.setProperty("--accent", "#ef4444");
          try {
            ctx.parser.renderToCanvas(ctx.bytes, ctx.canvas, {
              allowRawHtml: true,
              baseUrl: ctx.baseUrl,
            });
            await waitForCanvasReady(ctx.canvas);
            assertCondition(ctx.canvas.dataset.renderReady === "ready", "canvas did not recover after theme change");
            details.push("theme token changed: --accent => #ef4444");
            details.push(`renderReady: ${ctx.canvas.dataset.renderReady ?? "unset"}`);
          } finally {
            if (previousAccent) {
              root.style.setProperty("--accent", previousAccent);
            } else {
              root.style.removeProperty("--accent");
            }
          }
        }),
    ];

    try {
      const startedAt = performance.now();
      const stepResults: StepResult[] = [];
      for (const step of steps) {
        stepResults.push(await step());
      }

      const passCount = stepResults.filter((s) => s.status === "pass").length;
      const failCount = stepResults.length - passCount;
      const durationMs = performance.now() - startedAt;
      summary.textContent = `Completed ${stepResults.length} checks in ${formatMs(durationMs)}: ${passCount} pass, ${failCount} fail.`;
    } finally {
      runButton.disabled = false;
      runButton.removeAttribute("aria-busy");
    }
  };

  controls.addEventListener("submit", (event) => {
    event.preventDefault();
    void execute();
  });

  void execute();
}
