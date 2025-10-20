import { expect, test } from '@playwright/test';

const expectedColors: Record<string, string> = {
  'tok-kw': 'rgb(56, 189, 248)',
  'tok-str': 'rgb(74, 222, 128)',
  'tok-com': 'rgba(148, 163, 184, 0.65)',
};

test.describe('HTML renderer', () => {
  test('applies syntax highlighting styles', async ({ page }) => {
    await page.goto('/html');

    await page.waitForSelector('.markdown-viewer pre code .tok-kw');

    for (const [className, expected] of Object.entries(expectedColors)) {
      const locator = page.locator(`.markdown-viewer pre code .${className}`).first();
      await expect(locator).toHaveCount(1);
      const color = await locator.evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe(expected);
    }

    const inlineCodeBackground = await page
      .locator('.markdown-viewer :not(pre) > code')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(inlineCodeBackground).toBe('rgba(15, 23, 42, 0.85)');
  });

  test('lets readers switch into editing mode', async ({ page }) => {
    await page.goto('/html');

    const toggle = page.getByRole('button', { name: /toggle editor/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/is-editing/);

    const editor = page.locator('.editor');
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
  });
});
