import { chromium, type FullConfig } from '@playwright/test';
import { mockGitHub, openPR } from './fake-github.ts';

// The dev server compiles modules on first request, which can outlast the first test's expect timeout on a cold CI runner.
export default async function warmup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: config.projects[0]!.use.baseURL });
  await mockGitHub(page);
  await page.goto('/');
  await page.locator('[data-section="requested"] .pr-row').first().waitFor({ timeout: 120_000 });
  await openPR(page);
  await browser.close();
}
