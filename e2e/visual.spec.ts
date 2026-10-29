import { expect, test, type Page } from '@playwright/test';
import { mockGitHub, openPR } from './fake-github.ts';

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  // Entry transitions shift layout mid-flight, so finite animations must finish before measuring or scrolling.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ),
  );
  await page.mouse.move(0, 0);
}
async function setTheme(page: Page, theme: string) {
  await page.addInitScript(value => localStorage.setItem('review.preferences:reviewer', JSON.stringify({ theme: value })), theme);
}

for (const theme of ['paper', 'pierre-light', 'solarized-light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme);
      await mockGitHub(page);
    });

    test('inbox', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: /Improve worker retries/ }).waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`inbox-${theme}.png`);
    });

    test('workspace with both panels', async ({ page }) => {
      await openPR(page);
      await page.getByRole('button', { name: 'Show file sidebar' }).click();
      await page.getByRole('button', { name: 'Show comments panel' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`workspace-${theme}.png`);
    });

    test('split diff with filtered sidebar', async ({ page }) => {
      await openPR(page);
      await page.getByRole('button', { name: 'Split diff' }).click();
      await page.getByRole('button', { name: 'Show file sidebar' }).click();
      await page.getByRole('button', { name: 'Filter files by Git status' }).click();
      await page
        .getByRole('dialog', { name: 'Filter by Git status' })
        .getByRole('button', { name: /Modified/ })
        .click();
      await settle(page);
      await expect(page).toHaveScreenshot(`split-filtered-${theme}.png`);
    });

    test('inline composer and gutter plus', async ({ page }) => {
      await openPR(page);
      const gutter = page.locator('article').first().locator('[data-column-number="11"]').first();
      await gutter.click();
      const composer = page.getByRole('textbox', { name: /^Comment on / });
      await composer.waitFor();
      await settle(page);
      await composer.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.locator('article').first().locator('[data-column-number="12"]').first().hover();
      await expect(page).toHaveScreenshot(`composer-${theme}.png`);
    });

    test('conversation and reviews', async ({ page }) => {
      await openPR(page);
      await page.getByRole('button', { name: /^Conversation/ }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`conversation-${theme}.png`, { fullPage: true });
    });

    for (const option of ['Approve', 'Request changes']) {
      test(`review dialog (${option})`, async ({ page }) => {
        await openPR(page);
        await page.getByRole('button', { name: 'Review changes' }).click();
        await page.getByRole('radio', { name: new RegExp(`^${option}`) }).check();
        await settle(page);
        await expect(page.getByRole('dialog', { name: 'Submit your review' })).toHaveScreenshot(
          `review-${option.toLowerCase().replace(' ', '-')}-${theme}.png`,
        );
      });
    }

    test('commits', async ({ page }) => {
      await openPR(page);
      await page.getByRole('button', { name: /^Commits 2/ }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`commits-${theme}.png`);
    });
  });
}
