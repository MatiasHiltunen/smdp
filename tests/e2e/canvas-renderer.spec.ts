import { expect, test } from '@playwright/test';

test.describe('Canvas renderer', () => {
  test('virtual scrolling keeps the canvas pinned while content scrolls', async ({ page }) => {
    await page.goto('/canvas');
    const canvasLocator = page.locator('canvas.md-canvas');
    await page.waitForSelector('canvas.md-canvas[data-render-ready="ready"]');

    await expect(canvasLocator).toHaveAttribute('data-virtualized', 'true');

    const metrics = await page.evaluate(() => {
      const scroll = document.querySelector('.canvas-scroll') as HTMLElement;
      const canvas = scroll.querySelector('canvas.md-canvas') as HTMLCanvasElement;
      const spacer = document.getElementById('canvas-spacer');
      return {
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        canvasHeight: parseFloat(getComputedStyle(canvas).height),
        spacerHeight: spacer ? parseFloat(getComputedStyle(spacer).height) : 0,
      };
    });

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.canvasHeight).toBeLessThan(metrics.scrollHeight);
    expect(metrics.spacerHeight).toBeGreaterThan(metrics.canvasHeight);

    const before = await canvasLocator.boundingBox();
    await page.locator('.canvas-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });
    await page.waitForTimeout(100);
    const after = await canvasLocator.boundingBox();

    expect(before && after).toBeTruthy();
    if (before && after) {
      expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    }
  });
});
