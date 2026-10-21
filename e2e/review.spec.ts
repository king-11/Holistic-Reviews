import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIRST, HEAD, mockGitHub, openPR } from './fake-github.ts';

type Fake = Awaited<ReturnType<typeof mockGitHub>>;
const card = (page: Page, path: string) => page.locator('article').filter({ has: page.getByRole('button', { name: path, exact: true }) });
const lineNumber = (page: Page, path: string, line: number, kind = '') =>
  card(page, path)
    .locator(`[data-column-number="${line}"]${kind ? `[data-line-type*="${kind}"]` : ''}`)
    .first();
const composer = (page: Page) => page.getByRole('textbox', { name: /^Comment on / });
const writes = (fake: Fake, path: string | RegExp) =>
  fake.writes.filter(write => (typeof path === 'string' ? write.path === path || write.operation === path : path.test(write.path)));
const lastWrite = (fake: Fake, path: string | RegExp) => writes(fake, path).at(-1)?.body;
const groupButton = (page: Page, name: RegExp) => page.getByRole('main').locator('button[aria-expanded]').filter({ hasText: name });

async function drag(page: Page, from: Locator, to: Locator) {
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
}

async function startLineReview(page: Page, body: string) {
  await lineNumber(page, 'src/worker.py', 10, 'addition').click();
  await composer(page).fill(body);
  await page.getByRole('group', { name: 'Line comment' }).getByRole('button', { name: 'Start a review' }).click();
  await expect(page.getByRole('button', { name: 'Discard pending', exact: true })).toBeVisible();
}

// Inbox repositories default to the most-used one, so tests that need every repository seed an explicit choice.
async function seedInbox(page: Page, preferences: { repos?: string[]; sorts?: Record<string, string>; merged?: string }) {
  await page.addInitScript(saved => {
    if (!localStorage.getItem('review.inbox')) localStorage.setItem('review.inbox', JSON.stringify(saved));
  }, preferences);
}

test.describe('inbox', () => {
  test('shows every section, keeps drafts out of review requests, and includes reviewed drafts', async ({ page }) => {
    await mockGitHub(page);
    await seedInbox(page, { repos: [] });
    await page.goto('/');
    const group = (name: RegExp) => groupButton(page, name);
    for (const name of [
      /Needs your review\s*3/,
      /Returned to you\s*1/,
      /Approved\s*1/,
      /Waiting for review\s*1/,
      /Drafts\s*1/,
      /Reviewed by you\s*1/,
      /Recently merged\s*1/,
    ])
      await expect(group(name)).toBeVisible();
    await expect(page.getByRole('link', { name: /Retry the sync backoff/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Tighten cache keys/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Speed up CI cache/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sketch retry dashboard/ })).toBeVisible();
    const pendingRows = [
      ['requested', /Improve worker retries/],
      ['returned', /Retry the sync backoff/],
      ['approved', /Tighten cache keys/],
      ['waiting', /Speed up CI cache/],
      ['drafts', /Sketch retry dashboard/],
      ['reviewed', /Draft reviewed earlier/],
      ['merged', /Ship metrics exporter/],
    ] as const;
    for (const [section, title] of pendingRows) {
      if (section === 'reviewed' || section === 'merged')
        await group(new RegExp(section === 'merged' ? 'Recently merged' : 'Reviewed by you')).click();
      await expect(page.getByRole('main').getByRole('link', { name: title })).toContainText('1 pending');
    }
  });

  test('defaults to priority lanes with reasons for requested reviews', async ({ page }) => {
    await mockGitHub(page);
    await seedInbox(page, { repos: [] });
    await page.goto('/');
    const now = page.locator('[data-priority-lane="now"]');
    await expect(now.locator('strong')).toHaveText('Now');
    await expect(now.getByRole('link', { name: /Improve worker retries/ })).toBeVisible();
    await expect(now).toContainText('1 ready stacked on this');
    await expect(now).toContainText('code owner');
    await expect(now).toContainText('checks green');
    const soon = page.locator('[data-priority-lane="soon"]');
    await expect(soon).toBeVisible();
    await expect(soon.locator('a.pr-row').first()).toHaveAttribute('title', /Rotate infra credentials/);
    await expect(page.locator('[data-priority-lane="later"]')).toBeVisible();
  });

  test('filters pull requests by search text and repository', async ({ page }) => {
    await mockGitHub(page);
    await seedInbox(page, { repos: [] });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search loaded pull requests' }).fill('cache');
    await expect(page.getByRole('link', { name: /Tune cache eviction/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Improve worker retries/ })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search loaded pull requests' }).fill('');
    await page.getByRole('button', { name: 'All repositories' }).click();
    await page.getByRole('checkbox', { name: 'acme/infra' }).check();
    await expect(page.getByRole('link', { name: /Rotate infra credentials/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Tune cache eviction/ })).toHaveCount(0);
  });

  test('a merged filter in the collapsed section bar expands the section and queries all, yours, or review requests', async ({ page }) => {
    const fake = await mockGitHub(page);
    await page.goto('/');
    const merged = groupButton(page, /Recently merged/);
    const radios = page.getByRole('radiogroup', { name: 'Merged pull requests' });
    const row = (title: RegExp) => page.getByRole('link', { name: title });
    // Inbox sections search concurrently, so only the latest merged query reflects the chosen filter.
    const mergedSearch = () => fake.searches.filter(search => search.q.includes('is:merged')).at(-1);
    await expect(merged).toHaveAttribute('aria-expanded', 'false');
    await expect(radios.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    await radios.getByRole('radio', { name: 'By me' }).click();
    await expect(merged).toHaveAttribute('aria-expanded', 'true');
    await expect(radios.getByRole('radio', { name: 'By me' })).toHaveAttribute('aria-checked', 'true');
    await expect(row(/Ship metrics exporter/)).toBeVisible();
    await expect(row(/Clean up scheduler logs/)).toHaveCount(0);
    expect(mergedSearch()).toMatchObject({ advanced: false, q: expect.stringContaining('author:reviewer') });
    await radios.getByRole('radio', { name: 'All' }).click();
    await expect(row(/Clean up scheduler logs/)).toBeVisible();
    await radios.getByRole('radio', { name: 'Review requested' }).click();
    await expect(row(/Tune retry jitter/)).toBeVisible();
    await expect(row(/Ship metrics exporter/)).toHaveCount(0);
    expect(mergedSearch()).toMatchObject({
      advanced: true,
      q: expect.stringContaining('(review-requested:reviewer OR reviewed-by:reviewer)'),
    });
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Review requested' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => mergedSearch()?.q).toContain('(review-requested:reviewer OR reviewed-by:reviewer)');
  });

  test('disables All for recently merged pull requests until a repository is selected', async ({ page }) => {
    await mockGitHub(page);
    await seedInbox(page, { repos: [] });
    await page.goto('/');
    await page
      .getByRole('main')
      .locator('button[aria-expanded]')
      .filter({ hasText: /Recently merged/ })
      .click();
    const radios = page.getByRole('radiogroup', { name: 'Merged pull requests' });
    await expect(radios.getByRole('radio', { name: 'All' })).toBeDisabled();
    await expect(radios.getByRole('radio', { name: 'By me' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('link', { name: /Ship metrics exporter/ })).toBeVisible();
  });

  test('starts on the most-used repository and keeps a later choice across reloads', async ({ page }) => {
    await mockGitHub(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '1 repository' })).toBeVisible();
    await page.getByRole('button', { name: '1 repository' }).click();
    await expect(page.getByRole('checkbox', { name: 'acme/app' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'acme/infra' })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'acme/infra' }).check();
    await page.getByRole('checkbox', { name: 'acme/app' }).uncheck();
    await page.reload();
    await expect(page.getByRole('button', { name: '1 repository' })).toBeVisible();
    await page.getByRole('button', { name: '1 repository' }).click();
    await expect(page.getByRole('checkbox', { name: 'acme/infra' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'acme/app' })).not.toBeChecked();
  });

  test('sorts sections independently without fetching complete results', async ({ page }) => {
    const fake = await mockGitHub(page);
    await seedInbox(page, { repos: ['acme/app', 'acme/infra'] });
    await page.goto('/');
    const requested = page.locator('[data-section="requested"]');
    const returned = page.locator('[data-section="returned"]');
    await expect.poll(() => fake.searches.length).toBe(5);
    await expect(requested.locator('.pr-row')).toHaveCount(3);
    const returnedTitles = await returned.locator('.pr-row-title').allTextContents();
    const searches = fake.searches.length;
    await page.getByRole('button', { name: 'Sort Needs your review' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Priority', exact: true })).toBeVisible();
    const priorityFontSize = await page
      .getByRole('menuitemradio', { name: 'Priority' })
      .locator('[data-sort-label]')
      .evaluate(element => getComputedStyle(element).fontSize);
    const titleFontSize = await page.locator('[data-sort-label="Title"]').evaluate(element => getComputedStyle(element).fontSize);
    expect(priorityFontSize).toBe(titleFontSize);
    await expect(page.getByText('Waiting on you first')).toHaveCount(0);
    await page.getByRole('menuitemradio', { name: 'Title: Z–A' }).click();
    await expect(requested.locator('.pr-row-title').first()).toContainText('Tune cache eviction');
    expect(fake.searches.length).toBe(searches);
    expect(await returned.locator('.pr-row-title').allTextContents()).toEqual(returnedTitles);
    await page.getByRole('button', { name: 'Sort Returned to you' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Priority' })).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Sort Needs your review' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Title: Z–A' })).toHaveAttribute('aria-checked', 'true');
  });

  for (const viewportWidth of [1280, 375, 320]) {
    test(`keeps the sort menu aligned and in the viewport at ${viewportWidth}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewportWidth, height: 900 });
      await mockGitHub(page);
      await seedInbox(page, { repos: ['acme/app'] });
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Sort Needs your review' })).toBeVisible();
      await page.getByRole('button', { name: 'Sort Needs your review' }).click();
      const menu = page.getByRole('menu', { name: 'Sort Needs your review by' });
      const menuBounds = await menu.boundingBox();
      expect(menuBounds).not.toBeNull();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(viewportWidth);
      await expect(menu.locator('[data-sort-label="Size of change"]')).toHaveCSS('white-space', 'nowrap');

      const directions = {
        Title: ['Title: A–Z', 'Title: Z–A'],
        'Size of change': ['Size: Smallest first', 'Size: Largest first'],
        Updated: ['Updated: Oldest first', 'Updated: Latest first'],
        Created: ['Created: Oldest first', 'Created: Latest first'],
      };
      const columns: number[][] = [];
      for (const [field, labels] of Object.entries(directions)) {
        const buttons = menu.getByRole('group', { name: `Sort ${field}` }).getByRole('menuitemradio');
        const actualLabels = await buttons.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
        expect(actualLabels).toEqual(labels);
        columns.push(await buttons.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().x)));
      }
      for (const index of [0, 1]) {
        const positions = columns.map(column => column[index]);
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.5);
      }
    });
  }

  test('refetches only an incomplete section group for a server-ordered sort', async ({ page }) => {
    const fake = await mockGitHub(page, { requestedPRCount: 105 });
    await seedInbox(page, { repos: ['acme/app'] });
    await page.goto('/');
    await expect.poll(() => fake.searches.length).toBe(5);
    const searches = fake.searches.length;
    await page.getByRole('button', { name: 'Sort Needs your review' }).click();
    await page.getByRole('menuitemradio', { name: 'Created: Oldest first' }).click();
    await expect.poll(() => fake.searches.length).toBe(searches + 1);
    expect(fake.searches.slice(searches)).toHaveLength(1);
    expect(fake.searches.at(-1)).toMatchObject({
      q: expect.stringContaining('review-requested:'),
      sort: 'created',
      order: 'asc',
    });
  });

  test('does not refetch Inbox after refreshed team info resolves', async ({ page }) => {
    const fake = await mockGitHub(page, { teamsDelayMs: 2000 });
    await seedInbox(page, { repos: ['acme/app'] });
    const teamsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/user/teams');
    await page.goto('/');
    await expect.poll(() => fake.searches.length).toBe(5);
    await expect(page.getByRole('button', { name: 'Refresh inbox' })).toBeEnabled();
    await teamsResponse;
    await page.waitForTimeout(100);
    expect(fake.searches).toHaveLength(5);
  });

  test('shows changes, checks, and people involved on each inbox row', async ({ page }) => {
    await mockGitHub(page);
    await page.goto('/');
    const row = page.getByRole('link', { name: /Retry the sync backoff/ });
    await expect(row.getByText('+12')).toBeVisible();
    await expect(row.getByText('−3')).toBeVisible();
    await expect(row.getByRole('img', { name: 'Checks passed' })).toBeVisible();
    await expect(row.getByTitle('bob, carol')).toBeVisible();
    await expect(page.getByRole('link', { name: /Tune cache eviction/ }).getByRole('img', { name: 'Checks running' })).toBeVisible();
    const checkGeometry = await page.locator('section.requested .pr-row').evaluateAll(rows =>
      rows.flatMap(row => {
        const time = row.querySelector('.row-time')?.textContent?.trim();
        const icon = row.querySelector('[aria-label^="Checks"] svg');
        if (!time || !icon) return [];
        const rect = icon.getBoundingClientRect();
        return [{ time, centerX: Math.round((rect.left + rect.width / 2) * 1000) / 1000, width: rect.width }];
      }),
    );
    expect(new Set(checkGeometry.map(row => row.time)).size).toBeGreaterThan(1);
    expect(new Set(checkGeometry.map(row => row.centerX)).size).toBe(1);
    expect(checkGeometry.every(row => row.width === 16)).toBe(true);
  });

  test('reveals 10 requested PRs at a time and keeps the viewport steady', async ({ page }) => {
    const fake = await mockGitHub(page, { requestedPRCount: 105 });
    await seedInbox(page, { repos: ['acme/app', 'acme/infra'] });
    await page.goto('/');
    const section = page.locator('section.requested');
    const rows = section.locator('.pr-row');
    const loadMore = section.getByRole('button', { name: /^Load more ·/ });
    await expect(rows).toHaveCount(10);
    await expect(loadMore).toHaveText('Load more · 10 of 105');
    await expect.poll(() => fake.searches.length).toBe(5);
    await loadMore.scrollIntoViewIfNeeded();
    const lastRow = await rows.last().elementHandle();
    if (!lastRow) throw new Error('Expected a requested PR row.');
    const measure = () =>
      page.evaluate(
        row => ({
          scrollY,
          top: row.getBoundingClientRect().top,
        }),
        lastRow,
      );
    const before = await measure();
    const searches = fake.searches.length;

    await loadMore.click();
    await expect(rows).toHaveCount(20);
    expect(fake.searches.length).toBe(searches);
    const after = await measure();
    expect(after.scrollY).toBe(before.scrollY);
    expect(after.top).toBe(before.top);

    for (let visible = 30; visible <= 100; visible += 10) {
      await loadMore.click();
      await expect(rows).toHaveCount(visible);
    }
    expect(fake.searches.length).toBe(searches);

    await loadMore.click();
    await expect(rows).toHaveCount(105);
    await expect.poll(() => fake.searches.length).toBe(searches + 1);
    expect(fake.searches.at(-1)).toMatchObject({
      q: expect.stringContaining('review-requested:'),
      page: 2,
      perPage: 100,
    });
  });
});

test('lists pending comments in the review sheet and reuses comment edit and delete actions', async ({ page }) => {
  const fake = await mockGitHub(page, { stalePendingReadAfterEdit: true });
  await openPR(page);
  await startLineReview(page, 'First pending');
  await expect(page.locator('.pr-title-row .pending-badge')).toHaveText('1 pending');
  await expect(card(page, 'src/worker.py').locator('.diff-file-header .pending-badge')).toHaveText('1 pending');
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Submit your review' });
  const location = dialog.getByRole('button', { name: /src\/worker.py:10/ });
  await expect(location).toBeVisible();
  await expect(location).toHaveText('src/worker.py:10');
  await location.click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Review changes' }).click();
  const reopened = page.getByRole('dialog', { name: 'Submit your review' });
  await expect(reopened.getByText('First pending')).toBeVisible();
  await reopened.getByRole('button', { name: 'Edit comment' }).click();
  await reopened.getByRole('textbox', { name: 'Edit comment' }).fill('Edited pending');
  await reopened.getByRole('button', { name: 'Save' }).click();
  await expect(reopened.getByText('Edited pending')).toBeVisible();
  await expect(reopened.getByText('First pending')).toHaveCount(0);
  await reopened.getByRole('button', { name: 'Close dialog' }).click();
  fake.armStalePendingRead();
  await page.getByRole('button', { name: 'Refresh pull request' }).click();
  await expect(page.locator('.review-layout[aria-busy="false"]')).toBeVisible();
  await expect.poll(() => fake.stalePendingReadServed).toBe(true);
  expect(fake.stalePendingReadBody).toBe('First pending');
  await expect(page.locator('.thread-comment').filter({ hasText: 'Edited pending' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Review changes' }).click();
  const refreshed = page.getByRole('dialog', { name: 'Submit your review' });
  await expect(refreshed.getByText('Edited pending')).toBeVisible();
  await expect(refreshed.getByText('First pending')).toHaveCount(0);
  expect(writes(fake, 'UpdatePullRequestReviewComment')).toHaveLength(1);
  await reopened.getByRole('button', { name: 'Delete comment' }).click();
  await reopened.getByRole('button', { name: 'Delete?', exact: true }).click();
  await expect(reopened.locator('[aria-label="Pending review comments"] section')).toHaveCount(0);
  expect(writes(fake, 'DeletePullRequestReviewComment')).toHaveLength(1);
});

test.describe('inbox after acting on a pull request', () => {
  // Fake search keeps returning the old results, like GitHub's index does for up to a minute after a write.
  const openFromInbox = async (page: Page) => {
    await seedInbox(page, { repos: ['acme/app'] });
    await page.goto('/');
    await page
      .locator('section.requested')
      .getByRole('link', { name: /Improve worker retries/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Improve worker retries', level: 1 })).toBeVisible();
  };
  const backToInbox = async (page: Page) => {
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  };
  const row = (page: Page, section: string) => page.locator(`section.${section}`).getByRole('link', { name: /Improve worker retries/ });

  test('approving moves the PR from review requests to reviewed by you, then refetches in the background', async ({ page }) => {
    const fake = await mockGitHub(page, { viewerRequested: true });
    await openFromInbox(page);
    await page.waitForLoadState('networkidle');
    const searches = fake.searches.length;
    const panel = page.getByRole('complementary', { name: 'Pull request details' });
    await expect(panel.getByRole('button', { name: 'Remove review request from reviewer', exact: true })).toBeVisible();
    await page.keyboard.press('r');
    await page.keyboard.press('y');
    await expect(page.getByRole('status').getByText('Approval submitted to GitHub.')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Remove review request from reviewer', exact: true })).toHaveCount(0);
    await backToInbox(page);
    await expect(row(page, 'requested')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: /Needs your review\s*1/ })).toBeVisible();
    await page
      .getByRole('main')
      .locator('button[aria-expanded]')
      .filter({ hasText: /Reviewed by you/ })
      .click();
    await expect(row(page, 'reviewed')).toBeVisible();
    await expect.poll(() => fake.searches.length).toBeGreaterThan(searches);
    await expect(page.getByRole('link', { name: /Tune cache eviction/ })).toBeVisible();
    await expect(row(page, 'requested')).toHaveCount(0);
  });

  test('merging moves the PR to recently merged', async ({ page }) => {
    await mockGitHub(page);
    await openFromInbox(page);
    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Merge options' });
    await menu.getByRole('menuitem', { name: 'Squash and merge' }).click();
    await menu.getByRole('menuitem', { name: 'Confirm squash and merge' }).click();
    await expect(page.getByRole('img', { name: 'Merged' })).toBeVisible();
    await backToInbox(page);
    await expect(row(page, 'requested')).toHaveCount(0);
    await page
      .getByRole('main')
      .locator('button[aria-expanded]')
      .filter({ hasText: /Recently merged/ })
      .click();
    await expect(row(page, 'merged')).toBeVisible();
  });

  test('removing your review request drops the PR from review requests even when other teams remain, and reopening stays fresh', async ({
    page,
  }) => {
    await mockGitHub(page);
    await openFromInbox(page);
    const panel = page.getByRole('complementary', { name: 'Pull request details' });
    await panel.getByRole('button', { name: 'Request reviewer', exact: true }).click();
    await panel.getByRole('button', { name: 'acme/frontend', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: 'Remove review request from acme/frontend', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Remove review request from acme/backend', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Remove review request from acme/backend', exact: true })).toHaveCount(0);
    await backToInbox(page);
    await expect(row(page, 'requested')).toHaveCount(0);
    await page.goBack();
    await expect(panel.getByRole('button', { name: 'Remove review request from acme/backend', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Remove review request from acme/frontend', exact: true })).toBeVisible();
  });
});

test.describe('routing', () => {
  const prRoute = /\/acme\/app\/pull\/42$/;
  const prHeading = (page: Page) => page.getByRole('heading', { name: 'Improve worker retries', level: 1 });

  test('an inbox row links to its PR page, and back and forward keep the inbox as it was', async ({ page }) => {
    const fake = await mockGitHub(page);
    await seedInbox(page, { repos: [] });
    await page.goto('/');
    await page
      .getByRole('main')
      .locator('button[aria-expanded]')
      .filter({ hasText: /Reviewed by you/ })
      .click();
    await expect(page.getByRole('link', { name: /Draft reviewed earlier/ })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const searches = fake.searches.length;
    const row = page.getByRole('link', { name: /Improve worker retries/ });
    await expect(row).toHaveAttribute('href', '/acme/app/pull/42');
    await row.click();
    await expect(page).toHaveURL(prRoute);
    await expect(prHeading(page)).toBeVisible();
    await expect(page).toHaveTitle('#42 Improve worker retries · acme/app');
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    // toBeVisible ignores opacity, and rows used to stay faded out after returning to the kept-alive inbox.
    await expect(page.getByRole('link', { name: /Draft reviewed earlier/ })).toHaveCSS('opacity', '1');
    await expect(row).toHaveCSS('opacity', '1');
    await expect(page).toHaveTitle('Holistic Reviews - A little more focus');
    expect(fake.searches.length).toBe(searches);
    await page.goForward();
    await expect(page).toHaveURL(prRoute);
    await expect(prHeading(page)).toBeVisible();
  });

  test('opening a PR page directly, then the inbox, shows the inbox rows', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: /Improve worker retries/ })).toHaveCSS('opacity', '1');
  });

  for (const host of ['github.com', 'diffshub.com'])
    test(`a legacy ?pr= link to ${host} redirects to the PR page`, async ({ page }) => {
      await mockGitHub(page);
      await page.goto(`/?pr=${encodeURIComponent(`https://${host}/acme/app/pull/42`)}`);
      await expect(page).toHaveURL(prRoute);
      await expect(prHeading(page)).toBeVisible();
    });

  test('a PR page opened signed out loads after connecting', async ({ page }) => {
    await mockGitHub(page, { signedOut: true });
    await page.goto('/acme/app/pull/42');
    await expect(page.getByRole('heading', { name: 'Connect GitHub to start reviewing' })).toBeVisible();
    await page.getByRole('button', { name: 'Connect GitHub' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Connect to GitHub' });
    await dialog.getByLabel('GitHub access token').fill('ghp_valid');
    await dialog.getByRole('button', { name: 'Connect GitHub' }).click();
    await expect(prHeading(page)).toBeVisible();
    await expect(page).toHaveURL(prRoute);
  });

  test('an invalid PR number shows the load error', async ({ page }) => {
    await mockGitHub(page);
    await page.goto('/acme/app/pull/abc');
    await expect(page.getByRole('alert')).toContainText('does not identify a pull request');
  });
});

test('browser token flow validates scopes and keeps the token in session storage only', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', request => {
    if (!/^(data|blob):/.test(request.url())) hosts.add(new URL(request.url()).host);
  });
  await page.route('https://api.github.com/**', route => {
    const token = route.request().headers().authorization?.replace('Bearer ', '');
    if (new URL(route.request().url()).pathname !== '/user') return route.fulfill({ json: { total_count: 0, items: [] } });
    return route.fulfill({
      json: { id: 700, login: 'reviewer', type: 'User' },
      headers: { 'access-control-expose-headers': 'X-OAuth-Scopes', 'x-oauth-scopes': token === 'ghp_noscope' ? 'read:org' : 'repo' },
    });
  });
  const stored = () => page.evaluate(() => sessionStorage.getItem('review.github-token'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect GitHub' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect to GitHub' });
  for (const [token, connected] of [
    ['ghp_noscope', false],
    ['ghp_valid', true],
  ] as const) {
    await dialog.getByLabel('GitHub access token').fill(token);
    await dialog.getByRole('button', { name: 'Connect GitHub' }).click();
    if (!connected) await expect(dialog.getByRole('alert')).toContainText('repo or public_repo scope');
  }
  await expect(page.getByRole('button', { name: /reviewer/ })).toBeVisible();
  expect(await stored()).toBe('ghp_valid');
  await page.reload();
  await expect(page.getByRole('button', { name: /reviewer/ })).toBeVisible();
  await page.getByRole('button', { name: /reviewer/ }).click();
  await page.getByRole('button', { name: 'Disconnect and clear token' }).click();
  expect(await stored()).toBeNull();
  expect(
    [...hosts].filter(host => !['127.0.0.1:5174', 'api.github.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)),
  ).toEqual([]);
});

test.describe('motion', () => {
  const identity = (transform: string) => transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  // Records the first frames of the element matching `selector` once it appears; start it before the action under test.
  // Diff annotations render in shadow roots, so the search looks inside them too.
  const frames = (page: Page, selector: string, count = 8) =>
    page.evaluate(
      ([selector, count]) =>
        new Promise<{ opacity: string; transform: string }[]>(resolve => {
          const find = (root: ParentNode): Element | null =>
            root.querySelector(selector) ??
            [...root.querySelectorAll('*')].reduce<Element | null>((hit, el) => hit ?? (el.shadowRoot && find(el.shadowRoot)), null);
          const seen: { opacity: string; transform: string }[] = [];
          const tick = () => {
            const node = find(document);
            if (node) seen.push({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform });
            if (seen.length >= count) resolve(seen);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      [selector, count] as const,
    );
  const still = (seen: { opacity: string; transform: string }[]) => seen.every(frame => frame.opacity === '1' && identity(frame.transform));
  const runningEntrances = (page: Page) =>
    page.evaluate(
      () =>
        document.getAnimations().filter(a => a instanceof CSSAnimation && a.animationName.startsWith('reveal') && a.playState === 'running')
          .length,
    );

  for (const [reducedMotion, scales] of [
    ['reduce', false],
    ['no-preference', true],
  ] as const)
    test(`dialogs ${scales ? 'scale in' : 'skip transforms'} and exit with reduced motion ${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await mockGitHub(page);
      await openPR(page);
      const seen = frames(page, '[role="dialog"]');
      await page.getByRole('button', { name: 'Review changes' }).click();
      const dialog = page.getByRole('dialog', { name: 'Submit your review' });
      await expect(dialog).toBeVisible();
      expect((await seen).some(frame => !identity(frame.transform))).toBe(scales);
      await expect(dialog).toHaveCSS('opacity', '1');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

  for (const [key, name] of [
    ['ControlOrMeta+K', 'Command bar'],
    ['?', 'Keyboard shortcuts'],
  ])
    test(`${name} opens and closes from the keyboard without animating`, async ({ page }) => {
      await mockGitHub(page);
      await page.goto('/');
      await expect(groupButton(page, /Needs your review/)).toBeVisible();
      const dialog = frames(page, '[role="dialog"]');
      const backdrop = frames(page, '.modal-backdrop');
      await page.keyboard.press(key);
      await expect(page.getByRole('dialog', { name })).toBeVisible();
      expect(still(await dialog)).toBe(true);
      expect(still(await backdrop)).toBe(true);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.querySelectorAll('.modal-backdrop').length)).toBe(0);
    });

  test('the PR command bar offers approval options, Undo, and PR shorthand navigation', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.keyboard.press('ControlOrMeta+K');
    let dialog = page.getByRole('dialog', { name: 'Command bar' });
    await expect(dialog.getByRole('option', { name: /^Approve/ })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const approve = page.getByRole('dialog', { name: 'Approve' });
    await expect(approve.getByText('Approves #42 as reviewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command bar' })).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(page.getByRole('dialog', { name: 'Command bar' })).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+K');
    dialog = page.getByRole('dialog', { name: 'Command bar' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(approve.getByRole('button', { name: /Undo/ })).toBeVisible();
    await page.keyboard.press('z');
    await expect(approve.getByRole('button', { name: /Undo/ })).toHaveCount(0);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog', { name: 'Submit your review' });
    await expect(review).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(review).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+K');
    dialog = page.getByRole('dialog', { name: 'Command bar' });
    await dialog.getByRole('textbox', { name: 'Search commands' }).fill('acme/app#42');
    await expect(dialog.getByRole('option', { name: 'Open acme/app#42' })).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/acme\/app\/pull\/42$/);

    await page.keyboard.press('ControlOrMeta+K');
    dialog = page.getByRole('dialog', { name: 'Command bar' });
    await dialog.getByRole('textbox', { name: 'Search commands' }).fill('not a pull request');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+K');
    dialog = page.getByRole('dialog', { name: 'Command bar' });
    await dialog.getByRole('option', { name: 'Theme', exact: true }).click();
    const theme = page.getByRole('dialog', { name: 'Theme' });
    await expect(theme.getByRole('option', { name: /^Paper/ })).toHaveAttribute('aria-selected', 'true');
    await expect(theme.getByText('Current', { exact: true })).toBeVisible();
    await theme.getByRole('option', { name: 'Solarized Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'solarized-light');
  });

  test('Escape and empty Backspace leave the disabled Approve page before closing the command bar', async ({ page }) => {
    await mockGitHub(page, { ownPR: true });
    await openPR(page);
    await page.keyboard.press('ControlOrMeta+K');
    const commandBar = page.getByRole('dialog', { name: 'Command bar' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const approve = page.getByRole('dialog', { name: 'Approve' });
    await expect(approve.getByRole('option').first()).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(commandBar).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Approve' })).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(commandBar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commandBar).toHaveCount(0);
  });

  for (const [key, panel] of [
    ['f', 'Changed files'],
    ['Shift+C', 'Pull request comments'],
  ])
    test(`the ${panel} panel toggles from the keyboard without sliding`, async ({ page }) => {
      await mockGitHub(page);
      await openPR(page);
      const seen = frames(page, `aside[aria-label="${panel}"]`);
      await page.keyboard.press(key);
      await expect(page.getByRole('complementary', { name: panel })).toBeVisible();
      expect(still(await seen)).toBe(true);
    });

  test('revisiting a tab shows its content without replaying the entrance', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await expect(card(page, 'src/worker.py')).toBeVisible();
    // Sections that arrive late, like dependent PRs, fade in once; only revisits must stay still.
    await page.waitForLoadState('networkidle');
    await expect.poll(() => runningEntrances(page)).toBe(0);
    for (const [key, content] of [
      ['3', page.locator('.conversation-comment').first()],
      ['5', page.getByRole('list', { name: 'Status checks' })],
      ['1', card(page, 'src/worker.py')],
    ] as const) {
      await page.keyboard.press(key);
      await expect(content).toBeVisible();
      await page.keyboard.press('2');
      await page.keyboard.press(key);
      await expect(content).toBeVisible();
      expect(await runningEntrances(page)).toBe(0);
    }
  });

  test('posting a comment confirms with a toast and grows it in instead of jumping the comment box', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const box = page.getByRole('textbox', { name: 'Leave a comment' });
    await box.fill('Looks good');
    const submit = page.getByRole('button', { name: 'Comment', exact: true });
    await submit.scrollIntoViewIfNeeded();
    const shifts = page.evaluate(
      () =>
        new Promise<number[]>(resolve => {
          const box = document.getElementById('pr-comment')!;
          const start = box.getBoundingClientRect().top;
          const seen: number[] = [];
          const began = performance.now();
          const tick = () => {
            seen.push(Math.round(box.getBoundingClientRect().top - start));
            if (performance.now() - began < 1500) requestAnimationFrame(tick);
            else resolve(seen);
          };
          requestAnimationFrame(tick);
        }),
    );
    await submit.click();
    const toast = page.getByRole('status').filter({ hasText: 'Comment posted to GitHub.' });
    await expect(toast).toBeVisible();
    expect((await toast.boundingBox())!.x).toBeLessThan(32);
    await expect(page.locator('[class*=notice-banner]')).toHaveCount(0);
    const moved = (await shifts).filter(shift => shift !== 0);
    const final = moved.at(-1) ?? 0;
    const added = await page
      .locator('.conversation-comment')
      .filter({ hasText: 'Looks good' })
      .evaluate(node => {
        const style = getComputedStyle(node);
        return node.getBoundingClientRect().height + parseFloat(style.marginBottom);
      });
    expect(Math.abs(final - added)).toBeLessThan(2);
    expect(moved.some(shift => shift > 0 && shift < final - 1)).toBe(true);
  });

  test('a new toast message enters again instead of swapping text in place', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockGitHub(page);
    await openPR(page);
    await page.keyboard.press('c');
    await page.keyboard.press('l');
    await expect(page.getByRole('status').filter({ hasText: 'Copied link to PR' })).toHaveCSS('opacity', '1');
    const opacities = page.evaluate(
      () =>
        new Promise<string[]>(resolve => {
          const seen: string[] = [];
          const tick = () => {
            const toast = [...document.querySelectorAll('[role="status"]')].find(node => node.textContent?.includes('Copied title'));
            if (toast) seen.push(getComputedStyle(toast).opacity);
            if (seen.length >= 4) resolve(seen);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.keyboard.press('c');
    await page.keyboard.press('t');
    expect((await opacities).some(opacity => Number(opacity) < 1)).toBe(true);
  });

  test('reduced motion keeps fades and colour transitions but drops movement', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockGitHub(page);
    await openPR(page);
    await expect(card(page, 'src/worker.py')).toHaveCSS('animation-name', 'reveal-fade');
    await expect(card(page, 'src/worker.py')).toHaveCSS('animation-duration', '0.2s');
    await page.keyboard.press('f');
    await expect(page.getByRole('complementary', { name: 'Changed files' }).locator('.search-input')).toHaveCSS(
      'transition-duration',
      '0.15s, 0.15s, 0.15s',
    );
    const thumb = await page
      .getByRole('switch', { name: 'Auto-merge' })
      .evaluate(node => getComputedStyle(node, '::after').transitionProperty);
    expect(thumb).not.toContain('transform');
  });

  test('popovers scale from their trigger, movement uses the shared curves, and progress grows by transform', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'All commits' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose commits to compare' })).toHaveCSS('transform-origin', /^0px 0px/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await page.getByRole('button', { name: 'Filter files by Git status' }).click();
    await expect(page.getByRole('dialog', { name: 'Filter by Git status' })).toHaveCSS('transform-origin', /^0px 0px/);
    await page.keyboard.press('Escape');
    const strongInOut = 'cubic-bezier(0.77, 0, 0.175, 1)';
    expect(
      await page.getByRole('switch', { name: 'Auto-merge' }).evaluate(node => getComputedStyle(node, '::after').transitionTimingFunction),
    ).toBe(strongInOut);
    const merge = page.getByRole('button', { name: /Merge|Not ready to merge/ }).first();
    await expect(merge).toHaveCSS('transition-property', /color/);
    await expect(merge).toHaveCSS('transition-property', /border-color/);
    await page.keyboard.press('v');
    const progress = page.locator('[class*=progress-track] > div');
    await expect(progress).toHaveCSS('transition-property', 'transform');
    await expect(progress).not.toHaveCSS('transform', 'none');
  });

  test('resolving a thread folds it away smoothly, and reopening unfolds it', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    const thread = card(page, 'src/worker.py').locator('.review-thread').first();
    await expect(thread).toContainText('Please rename this');
    // The diff replaces thread cards when their data changes, so each frame measures whichever card is current.
    const heights = card(page, 'src/worker.py').evaluate(
      article =>
        new Promise<number[]>(resolve => {
          const find = (root: ParentNode): Element | null =>
            root.querySelector('.review-thread') ??
            [...root.querySelectorAll('*')].reduce<Element | null>((hit, el) => hit ?? (el.shadowRoot && find(el.shadowRoot)), null);
          const seen: number[] = [];
          const began = performance.now();
          const tick = () => {
            seen.push(Math.round(find(article)?.getBoundingClientRect().height ?? 0));
            if (performance.now() - began < 1200) requestAnimationFrame(tick);
            else resolve(seen);
          };
          requestAnimationFrame(tick);
        }),
    );
    await thread.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
    const seen = await heights;
    const [start, end] = [seen[0]!, seen.at(-1)!];
    expect(end).toBeLessThan(start);
    expect(seen.filter(height => height < start && height > end).length).toBeGreaterThan(1);
    await expect(thread.locator('[inert]')).toHaveCount(1);
    await thread.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(thread.locator('[inert]')).toHaveCount(0);
    await expect(thread.getByText('Please rename this')).toBeVisible();
  });

  test('reaction pills enter softly and small actions respond to a press', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    const comment = page.locator('.thread-comment').filter({ hasText: 'Please rename this' });
    // Reactions load once their bar scrolls near the viewport.
    await comment.scrollIntoViewIfNeeded();
    const pill = frames(page, '.reaction-pill', 4);
    await comment.getByRole('button', { name: 'Add a reaction' }).click();
    await page.getByRole('group', { name: 'Choose a reaction' }).getByRole('button').first().click();
    expect((await pill).some(frame => Number(frame.opacity) < 1)).toBe(true);
    for (const target of [
      comment.getByRole('button', { name: /: 1\b/ }),
      comment.getByRole('button', { name: 'Add a reaction' }),
      card(page, 'src/worker.py').getByRole('button', { name: 'Resolve', exact: true }).first(),
    ]) {
      await target.hover();
      await page.mouse.down();
      await expect(target).toHaveCSS('transform', /^matrix\(0\.97/);
      await page.mouse.up();
      await page.keyboard.press('Escape');
    }
  });

  test('a mention hover card grows from its mention', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
    await page.getByRole('textbox', { name: 'Leave a comment' }).fill('Thanks @alice');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const card = frames(page, '.mention-card', 4);
    await page.getByRole('link', { name: '@alice', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Alice Liddell');
    expect((await card).some(frame => Number(frame.opacity) < 1 && !identity(frame.transform))).toBe(true);
  });

  test('disclosure chevrons rotate smoothly, except on diff files toggled from the keyboard', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.keyboard.press('f');
    const timing = (target: Locator) => target.evaluate(node => getComputedStyle(node).transition);
    expect(await timing(card(page, 'src/worker.py').locator('.thread-toggle svg').first())).toBe(
      'transform 0.15s cubic-bezier(0.77, 0, 0.175, 1)',
    );
    expect(
      await timing(
        page.getByRole('complementary', { name: 'Changed files' }).getByRole('button', { name: 'src', exact: true }).locator('svg').first(),
      ),
    ).toBe('transform 0.15s cubic-bezier(0.77, 0, 0.175, 1)');
    await expect(card(page, 'src/worker.py').locator('header button[aria-expanded] svg').first()).toHaveCSS('transition-duration', '0s');
  });

  for (const [reducedMotion, bursts] of [
    ['no-preference', true],
    ['reduce', false],
  ] as const)
    test(`merging celebrates ${bursts ? 'with a burst' : 'without movement'} under reduced motion ${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: 'Merge', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Merge options' });
      await menu.getByRole('menuitem', { name: 'Squash and merge' }).click();
      await menu.getByRole('menuitem', { name: 'Confirm squash and merge' }).click();
      const badge = page.getByRole('img', { name: 'Merged' });
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute('data-celebrate', '');
      await expect(page.locator('.merge-burst')).toHaveCount(bursts ? 1 : 0);
      await expect(badge).not.toHaveAttribute('data-celebrate', '', { timeout: 3000 });
      await expect(page.locator('.merge-burst')).toHaveCount(0);
    });

  test('opening an already merged pull request does not celebrate', async ({ page }) => {
    await mockGitHub(page, { prState: 'merged' });
    await openPR(page);
    const badge = page.getByRole('img', { name: 'Merged' });
    await expect(badge).toBeVisible();
    await expect(badge).not.toHaveAttribute('data-celebrate', '');
    await expect(page.locator('.merge-burst')).toHaveCount(0);
  });
});

test.describe('keyboard shortcuts', () => {
  test('opens help from ? and the header, and leaves keys typed into fields alone', async ({ page }) => {
    await mockGitHub(page);
    await page.goto('/');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const search = page.getByRole('textbox', { name: 'Search loaded pull requests' });
    await search.click();
    await page.keyboard.type('j?');
    await expect(search).toHaveValue('j?');
    await expect(help).toHaveCount(0);
    await search.evaluate(node => (node as HTMLElement).blur());
    await page.keyboard.press('?');
    await expect(help.getByText('Next / previous file', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await page.getByRole('button', { name: 'Keyboard shortcuts (?)' }).click();
    await expect(help).toBeVisible();
  });

  test('moves through inbox rows and focuses search', async ({ page }) => {
    await mockGitHub(page);
    await page.goto('/');
    const rows = page.getByRole('main').locator('a[title^="Review "]');
    await expect(rows.first()).toBeVisible();
    // Inbox sections load independently, so later ones can shift row indexes until every request settles.
    await page.waitForLoadState('networkidle');
    for (const [key, row] of [
      ['j', 0],
      ['j', 1],
      ['k', 0],
    ] as const) {
      await page.keyboard.press(key);
      await expect(rows.nth(row)).toBeFocused();
    }
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search loaded pull requests' })).toBeFocused();
  });

  test('drives panels, files, layout, tabs and review from the keyboard', async ({ page }) => {
    await page.context().route('https://github.com/**', route => route.fulfill({ body: '' }));
    await mockGitHub(page);
    await openPR(page);
    for (const [key, panel] of [
      ['f', 'Changed files'],
      ['Shift+C', 'Pull request comments'],
    ]) {
      await page.keyboard.press(key);
      await expect(page.getByRole('complementary', { name: panel })).toBeVisible();
      await page.keyboard.press(key);
      await expect(page.getByRole('complementary', { name: panel })).toHaveCount(0);
    }
    const expanded = (path: string) => card(page, path).locator('button[aria-expanded]').first();
    for (const [move, key, path] of [
      ['j', 'v', 'src/api/Handler.java'],
      ['j', 'x', 'docs/guide.md'],
      ['k', 'x', 'src/api/Handler.java'],
    ]) {
      await page.keyboard.press(move);
      await page.keyboard.press(key);
      await expect(expanded(path)).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press(key);
      await expect(expanded(path)).toHaveAttribute('aria-expanded', 'true');
    }
    await page.keyboard.press('Shift+X');
    await expect(page.getByRole('button', { name: 'Expand all diffs' })).toBeVisible();
    await page.keyboard.press('Shift+X');
    await expect(page.getByRole('button', { name: 'Collapse all diffs' })).toBeVisible();
    for (const [key, layout] of [
      ['s', 'Split diff'],
      ['u', 'Unified diff'],
    ]) {
      await page.keyboard.press(key);
      await expect(page.getByRole('button', { name: layout })).toHaveAttribute('aria-pressed', 'true');
    }
    await page.keyboard.press('3');
    await expect(page.locator('.conversation')).toBeVisible();
    await page.keyboard.press('1');
    await expect(card(page, 'src/worker.py')).toBeVisible();
    const popup = page.waitForEvent('popup');
    await page.keyboard.press('o');
    expect((await popup).url()).toBe('https://github.com/acme/app/pull/42');
    await page.bringToFront();
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    const review = page.getByRole('dialog', { name: 'Submit your review' });
    await expect(review).toBeVisible();
    await expect(review.getByRole('textbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(review).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByRole('dialog', { name: 'Command bar' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search commands' })).toBeFocused();
  });
});

test.describe('sequence shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockGitHub(page);
    await openPR(page);
  });

  for (const [second, expected] of [
    ['t', 'Improve worker retries'],
    ['b', 'alice/worker'],
    ['c', 'gh pr checkout 42 --repo acme/app'],
    ['g', 'https://github.com/acme/app/pull/42'],
    ['p', '[Improve worker retries #42](https://github.com/acme/app/pull/42)'],
  ] as const)
    test(`c then ${second} copies ${expected}`, async ({ page }) => {
      await page.keyboard.press('c');
      await page.keyboard.press(second);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
      await expect(page.getByRole('status').filter({ hasText: /^Copied / })).toBeVisible();
    });

  test('clicking a file name copies its path; clicking the rest of the header collapses the file', async ({ page }) => {
    const header = card(page, 'src/worker.py').locator('header');
    const toggle = header.getByRole('button', { name: /^(Collapse|Expand) worker\.py$/ });
    await header.getByTitle('Copy src/worker.py').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('src/worker.py');
    await expect(page.getByRole('status').filter({ hasText: 'Copied file path' })).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await header.locator('.diff-stats').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('c then l copies the app link to this PR', async ({ page }) => {
    await page.keyboard.press('c');
    await page.keyboard.press('l');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    const toast = page.getByRole('status').filter({ hasText: 'Copied link to PR' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-tone', 'ok');
    expect(await toast.evaluate(node => getComputedStyle(node).color !== getComputedStyle(document.body).backgroundColor)).toBe(true);
    const box = (await toast.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeLessThan(32);
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 32);
    await expect(toast).toHaveCount(0, { timeout: 4000 });
  });

  for (const [second, event] of [
    ['a', 'Approve'],
    ['n', 'Request changes'],
    ['r', 'Comment'],
  ] as const)
    test(`r then ${second} opens the review dialog on ${event}`, async ({ page }) => {
      await page.keyboard.press('r');
      await page.keyboard.press(second);
      const dialog = page.getByRole('dialog', { name: 'Submit your review' });
      await expect(dialog.getByRole('radio', { name: new RegExp(`^${event}`) })).toBeChecked();
      await expect(dialog.getByRole('textbox')).toBeFocused();
    });

  test('r then y approves immediately and holds navigation until GitHub answers', async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>(resolve => (release = resolve));
    await page.route('https://api.github.com/repos/acme/app/pulls/42/reviews', async route => {
      if (route.request().method() === 'POST') await gate;
      await route.fallback();
    });
    await page.keyboard.press('r');
    await page.keyboard.press('y');
    await expect(page.getByRole('button', { name: 'Review home' })).toBeDisabled();
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    release();
    await expect(page.getByRole('status').getByText('Approval submitted to GitHub.')).toBeVisible();
    await expect(page).toHaveURL(/\/acme\/app\/pull\/42$/);
  });

  test('r then c focuses the conversation comment box', async ({ page }) => {
    await page.keyboard.press('r');
    await page.keyboard.press('c');
    await expect(page.getByRole('textbox', { name: 'Leave a comment' })).toBeFocused();
  });

  test('mod arrows move between files and mod enter marks viewed', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(card(page, 'src/api/Handler.java').locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('g then i returns to the inbox', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(page.getByRole('heading', { name: 'Inbox.' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  for (const [direction, number] of [
    ['Up', 43],
    ['Down', 41],
  ] as const)
    test(`shift mod ${direction} opens stacked PR #${number}`, async ({ page }) => {
      const request = page.waitForRequest(new RegExp(`/repos/acme/app/pulls/${number}$`));
      await page.keyboard.press(`Shift+ControlOrMeta+Arrow${direction}`);
      await request;
      await expect(page).toHaveURL(new RegExp(`/acme/app/pull/${number}$`));
    });
});

test('Checks tab lists CI checks failures first and links to each run', async ({ page }) => {
  await mockGitHub(page);
  await openPR(page);
  const tab = page.locator('button[title="See CI status checks for the latest commit and open their runs"]');
  await expect(tab.locator('span[data-state="failure"]')).toHaveText('2/3');
  await tab.click();
  const checks = page.getByRole('list', { name: 'Status checks' });
  await expect(checks.locator('button[aria-expanded]')).toHaveText([/Failed\s*1/, /Running\s*1/, /Passed\s*1/]);
  await expect(checks.getByRole('button', { name: /Passed/ })).toHaveAttribute('aria-expanded', 'false');
  await checks.getByRole('button', { name: /Passed/ }).click();
  const links = checks.getByRole('link');
  await expect(links).toHaveText([/lint.*1 error/, /deploy\/preview.*Building/, /test.*All tests passed/]);
  await expect(links.first()).toHaveAttribute('href', 'https://github.com/acme/app/actions/runs/9/job/2');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://preview.example/42');
});

for (const [button, path] of [
  ['Re-run failed checks', '/repos/acme/app/actions/runs/9/rerun-failed-jobs'],
  ['Re-run all checks', '/repos/acme/app/actions/runs/9/rerun'],
  ['Re-run lint', '/repos/acme/app/actions/jobs/2/rerun'],
] as const)
  test(`${button} posts to GitHub Actions`, async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await page.keyboard.press('5');
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect.poll(() => fake.writes.filter(write => write.path === path).length).toBe(1);
  });

const reviewRequests = '/repos/acme/app/pulls/42/requested_reviewers';

test.describe('details panel', () => {
  test('shows a draft status with a neutral header icon', async ({ page }) => {
    await mockGitHub(page, { draftPR: true });
    await openPR(page);
    const status = page.locator('.pr-title-row .pr-state');
    await expect(status).toHaveAttribute('data-tone', 'draft');
    await expect(status).toHaveAccessibleName('Draft');
  });

  test('merges a team request into the review given on its behalf', async ({ page }) => {
    await page.setViewportSize({ width: 1568, height: 900 });
    await mockGitHub(page, { onBehalf: true });
    await openPR(page);
    const panel = page.getByRole('complementary', { name: 'Pull request details' });
    await expect(panel.getByText('acme/backend', { exact: true })).toHaveCount(1);
    await expect(panel.getByText(/for acme/)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Remove review request from acme/backend' })).toHaveCount(0);
  });

  test('shows reviewers, linked issues and a checks summary', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    const panel = page.getByRole('complementary', { name: 'Pull request details' });
    await expect(panel.getByRole('img', { name: 'Changes requested', exact: true })).toBeVisible();
    await expect(panel.getByText('Open', { exact: true })).toHaveCount(0);
    await expect(page.locator('.pr-title-row').getByRole('img', { name: 'Checks failed' })).toBeVisible();
    await expect(panel.getByRole('img', { name: 'Review requested · code owner' })).toBeVisible();
    await expect(panel.getByRole('link', { name: '#7 Workers drop retries' })).toHaveAttribute(
      'href',
      'https://github.com/acme/app/issues/7',
    );
    await expect(panel.getByRole('button', { name: '1 pending' })).toBeVisible();
    await panel.getByRole('button', { name: '1 pending' }).click();
    await expect(panel.getByRole('dialog', { name: 'Checks pending' }).getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await panel.getByRole('heading', { name: 'Checks' }).getByRole('button', { name: 'Checks' }).click();
    await expect(panel.getByRole('heading', { name: 'Checks' }).getByRole('button', { name: 'Checks' })).toHaveAttribute(
      'title',
      'Open the Checks tab',
    );
    await expect(page.getByRole('list', { name: 'Status checks' })).toBeVisible();
  });

  for (const [button, path, body] of [
    ['Convert to draft', '/graphql', { input: { pullRequestId: 'PR42' } }],
    ['Close pull request', '/repos/acme/app/pulls/42', { state: 'closed' }],
  ] as const)
    test(`${button} sends the state change to GitHub`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: 'More pull request actions' }).click();
      await page.getByRole('menu', { name: 'Pull request actions' }).getByRole('menuitem', { name: button }).click();
      await expect.poll(() => lastWrite(fake, path)).toEqual(body);
    });

  test('merges from the top bar with an allowed method only after confirming', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Merge options' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Squash and merge', 'Create a merge commit', 'Open in GitHub']);
    await expect(menu.getByRole('menuitem', { name: 'Open in GitHub' })).toHaveAttribute('href', 'https://github.com/acme/app/pull/42');
    await menu.getByRole('menuitem', { name: 'Squash and merge' }).click();
    expect(lastWrite(fake, '/repos/acme/app/pulls/42/merge')).toBeUndefined();
    await menu.getByRole('menuitem', { name: 'Confirm squash and merge' }).click();
    await expect.poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/merge')).toMatchObject({ merge_method: 'squash' });
  });

  test('approving a PR blocked on approval refreshes it so Merge appears without a manual refresh', async ({ page }) => {
    const fake = await mockGitHub(page, { blockedUntilApproved: true });
    await openPR(page);
    await expect(page.getByRole('button', { name: /Not ready to merge/ })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const reads = fake.prReads;
    await page.keyboard.press('r');
    await page.keyboard.press('y');
    await expect(page.getByRole('status').getByText('Approval submitted to GitHub.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeVisible();
    expect(fake.prReads).toBeGreaterThan(reads);
  });

  test('a blocked pull request offers no merge methods, only auto-merge from the switch', async ({ page }) => {
    const fake = await mockGitHub(page, { mergeStates: ['blocked'] });
    await openPR(page);
    const notReady = page.getByRole('button', { name: 'Not ready to merge' });
    await expect(notReady).toHaveAttribute('title', 'This PR needs more approvals');
    await notReady.click();
    const menu = page.getByRole('menu', { name: 'Merge options' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Open in GitHub']);
    await expect(menu).toContainText('Turn on auto-merge to merge once requirements pass.');
    await notReady.click();
    const toggle = page.getByRole('switch', { name: 'Auto-merge' });
    const switchEl = await toggle.elementHandle();
    await toggle.click();
    await expect(page.getByRole('status').filter({ hasText: 'Auto-merge enabled' })).toBeVisible();
    await expect
      .poll(() => lastWrite(fake, 'EnablePullRequestAutoMerge'))
      .toEqual({ input: { pullRequestId: 'PR42', mergeMethod: 'SQUASH', expectedHeadOid: HEAD } });
    await expect(toggle).toBeChecked();
    expect(await switchEl!.evaluate(node => node.isConnected)).toBe(true);
    await toggle.click();
    await expect.poll(() => fake.writes.at(-1)?.operation).toBe('DisablePullRequestAutoMerge');
    await expect(toggle).not.toBeChecked();
    expect(lastWrite(fake, '/repos/acme/app/pulls/42/merge')).toBeUndefined();
  });

  for (const approved of [true, false])
    test(`${approved ? 'offers' : 'withholds'} merge methods while GitHub keeps computing mergeability on ${approved ? 'an approved' : 'an unapproved'} PR`, async ({
      page,
    }) => {
      const fake = await mockGitHub(page, { mergeStates: ['unknown'], approved });
      await openPR(page);
      await page.getByRole('button', { name: approved ? 'Merge' : 'Not ready to merge', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Merge options' });
      if (!approved) {
        await expect(menu.getByRole('menuitem')).toHaveText(['Open in GitHub']);
        await expect(menu).toContainText('This PR needs more approvals');
        return;
      }
      await menu.getByRole('menuitem', { name: 'Squash and merge' }).click();
      await menu.getByRole('menuitem', { name: 'Confirm squash and merge' }).click();
      await expect.poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/merge')).toMatchObject({ merge_method: 'squash', sha: HEAD });
    });

  test('offers merge methods once GitHub finishes computing mergeability, without a manual refresh', async ({ page }) => {
    await mockGitHub(page, { mergeStates: ['unknown', 'clean'] });
    await openPR(page);
    await page.getByRole('button', { name: 'Not ready to merge' }).click();
    const menu = page.getByRole('menu', { name: 'Merge options' });
    await expect(menu.getByRole('menuitem', { name: 'Squash and merge' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Merge', exact: true })).toBeVisible();
  });

  test('the auto-merge toggle asks for Merge when the pull request is already clean', async ({ page }) => {
    const fake = await mockGitHub(page, { autoMergeClean: true });
    await openPR(page);
    await page.getByRole('switch', { name: 'Auto-merge' }).click();
    const errorToast = page.getByRole('status').filter({ hasText: 'This pull request is already mergeable. Use Merge.' });
    await expect(errorToast).toHaveAttribute('data-tone', 'error');
    await expect(page.getByRole('switch', { name: 'Auto-merge' })).not.toBeChecked();
    expect(lastWrite(fake, '/repos/acme/app/pulls/42/merge')).toBeUndefined();
  });

  for (const [name, steps, path, method, body] of [
    ['adds a label', ['Edit labels', 'bug'], '/repos/acme/app/issues/42/labels', 'PUT', { labels: ['retry', 'bug'] }],
    ['removes a label', ['Remove label retry'], '/repos/acme/app/issues/42/labels', 'PUT', { labels: [] }],
    ['requests a team', ['Request reviewer', 'acme/frontend'], reviewRequests, 'POST', { reviewers: [], team_reviewers: ['frontend'] }],
    [
      'removes a review request',
      ['Remove review request from carol'],
      reviewRequests,
      'DELETE',
      { reviewers: ['carol'], team_reviewers: [] },
    ],
    [
      'removes a team review request',
      ['Remove review request from acme/backend'],
      reviewRequests,
      'DELETE',
      { reviewers: [], team_reviewers: ['backend'] },
    ],
    ['re-requests one review', ['Re-request review from bob'], reviewRequests, 'POST', { reviewers: ['bob'], team_reviewers: [] }],
    [
      're-requests all reviews',
      ['Re-request all reviews'],
      reviewRequests,
      'POST',
      { reviewers: ['bob', 'carol'], team_reviewers: ['backend'] },
    ],
  ] as const)
    test(`${name} without reloading the PR`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      const panel = page.getByRole('complementary', { name: 'Pull request details' });
      for (const step of steps) await panel.getByRole('button', { name: step, exact: true }).click();
      await expect.poll(() => fake.writes.filter(write => write.path === path).at(-1)).toEqual({ method, path, body });
      await expect(page.getByRole('status').filter({ hasText: /Labels updated|Review request/ })).toBeVisible();
    });

  test('the reviewer picker finds people by name on GitHub, reuses a complete prefix, and requests the match', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    const panel = page.getByRole('complementary', { name: 'Pull request details' });
    await panel.getByRole('button', { name: 'Request reviewer', exact: true }).click();
    const picker = panel.getByRole('dialog', { name: 'Request reviewer' });
    const dave = picker.getByRole('button', { name: 'dave', exact: true });
    await expect(picker.getByRole('button', { name: 'carol', exact: true })).toBeVisible();
    await expect(dave).toHaveCount(0);
    const filter = picker.getByRole('textbox', { name: 'Filter: Request reviewer' });
    await filter.fill('du');
    await expect(dave).toContainText('Dave Dunn');
    await expect(dave).toContainText('dave');
    await filter.fill('dunn');
    await page.waitForTimeout(500);
    await expect(dave).toBeVisible();
    expect(fake.peopleSearches).toEqual([{ kind: 'assignable', query: 'du', first: 20 }]);
    await dave.click();
    await expect.poll(() => lastWrite(fake, reviewRequests)).toEqual({ reviewers: ['dave'], team_reviewers: [] });
  });

  test('remembers people searches across reloads and forgets them on disconnect', async ({ page }) => {
    const fake = await mockGitHub(page);
    const stored = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('review.people.')));
    const search = async () => {
      const panel = page.getByRole('complementary', { name: 'Pull request details' });
      await panel.getByRole('button', { name: 'Request reviewer', exact: true }).click();
      await panel.getByRole('textbox', { name: 'Filter: Request reviewer' }).fill('du');
      await expect(panel.getByRole('button', { name: 'dave', exact: true })).toContainText('Dave Dunn');
    };
    await openPR(page);
    await search();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('review.people.acme/app') ?? '')).toContain('assignable:du');
    await page.reload();
    await page.locator('.review-layout[aria-busy="false"]').waitFor();
    await search();
    await page.waitForTimeout(500);
    expect(fake.peopleSearches).toHaveLength(1);
    await page
      .getByRole('button', { name: /reviewer/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Disconnect and clear token' }).click();
    expect(await stored()).toEqual([]);
  });

  test('shows the succinct Information section when the side panel is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await mockGitHub(page);
    await openPR(page);
    const info = page.getByRole('region', { name: 'Pull request information' });
    await expect(info.getByText('2 waiting on review')).toBeVisible();
    await info.getByRole('button', { name: /1 requested changes/ }).click();
    await expect(page.getByRole('dialog', { name: 'Reviewers who requested changes' }).getByText('bob')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Reviewers who requested changes' })).toBeHidden();
    await info.getByRole('button', { name: /1 pending/ }).click();
    await expect(page.getByRole('dialog', { name: 'Checks pending' }).getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const checksLabel = info.getByRole('button', { name: 'Checks', exact: true });
    await expect(checksLabel).toHaveAttribute('title', 'Open the Checks tab');
    await checksLabel.click();
    await expect(page.getByRole('list', { name: 'Status checks' })).toBeVisible();
    await expect(page.locator('.review-tabs-bar')).toBeInViewport();
  });

  test('resizes the side panels by dragging their edge', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.keyboard.press('f');
    for (const [name, panel, dx] of [
      ['Resize changed files', 'Changed files', 80],
      ['Resize pull request details', 'Pull request details', -80],
      ['Resize comments panel', 'Pull request comments', -80],
    ] as const) {
      const aside = page.getByRole('complementary', { name: panel });
      const separator = page.getByRole('separator', { name });
      const position = async () => JSON.stringify(await separator.boundingBox());
      await expect.poll(async () => (await position()) === (await page.waitForTimeout(100), await position())).toBe(true);
      const before = (await aside.boundingBox())!.width;
      const box = (await separator.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await aside.boundingBox())!.width).toBeCloseTo(before + 80, -1);
      if (panel === 'Pull request details') await page.getByRole('button', { name: 'Show comments panel' }).click();
    }
  });

  test('shows opened, updated and changed-file stats under the branch line', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await expect(page.locator('.pr-meta')).toHaveText(/^Opened \S+ ago·Updated \S+ ago·6 files\+9−7$/);
  });

  for (const branch of ['alice/base', 'alice/worker'])
    test(`clicking ${branch} copies the branch name`, async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: branch, exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(branch);
      await expect(page.getByRole('status').filter({ hasText: 'Copied branch name' })).toBeVisible();
    });

  test('an open popover leaves the page scrollable and closes on an outside click', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'All commits' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose commits to compare' });
    await expect(picker).toBeVisible();
    const scroller = page.locator('[class*=review-scroll]').first();
    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2, height - 80);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.locator('.pr-meta').click();
    await expect(picker).toBeHidden();
  });

  for (const [key, title] of [
    ['Enter', 'Retry workers with backoff'],
    ['Escape', 'Improve worker retries'],
  ] as const)
    test(`editing the title and pressing ${key} ${key === 'Enter' ? 'saves' : 'cancels'}`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: 'Improve worker retries', exact: true }).click();
      await page.getByRole('textbox', { name: 'Pull request title' }).fill('Retry workers with backoff');
      await page.keyboard.press(key);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      expect(lastWrite(fake, '/repos/acme/app/pulls/42')).toEqual(key === 'Enter' ? { title } : undefined);
    });

  test('edits the description from its Edit button', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    const toggle = page.getByRole('button', { name: 'Description', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Description');
    await expect(page.locator('.pr-heading-section').getByText('Adds worker retries 😄')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Pull request description' }).fill('Retries **with** backoff');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => lastWrite(fake, '/repos/acme/app/pulls/42')).toEqual({ body: 'Retries **with** backoff' });
    await expect(page.getByRole('textbox', { name: 'Pull request description' })).toHaveCount(0);
    await expect(page.locator('.pr-heading-section strong').filter({ hasText: 'with' })).toBeVisible();
  });

  test('refreshes in place without the full-page loader', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Refresh pull request' }).click();
    await expect(page.getByRole('heading', { name: 'Improve worker retries', level: 1 })).toBeVisible();
    await expect(page.getByText('Loading pull request…')).toHaveCount(0);
  });
});

test.describe('progressive loading', () => {
  test('shows the PR with refresh disabled while files load, then reveals them', async ({ page }) => {
    const fake = await mockGitHub(page, { hold: /\/pulls\/42\/files$/ });
    await openPR(page, { settled: false });
    const loader = page.getByRole('status').filter({ hasText: 'Loading changed files…' });
    const refresh = page.getByRole('button', { name: 'Refresh pull request' });
    await expect(loader).toBeVisible();
    await expect(refresh).toBeDisabled();
    fake.release();
    await expect(card(page, 'src/worker.py')).toBeVisible();
    await expect(loader).toHaveCount(0);
    await expect(refresh).toBeEnabled();
  });

  test('shows a conversation loader until comments and reviews arrive', async ({ page }) => {
    const fake = await mockGitHub(page, { hold: /\/issues\/42\/comments$|\/pulls\/42\/reviews$/ });
    await openPR(page, { settled: false });
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const loader = page.getByRole('status').filter({ hasText: 'Loading conversation…' });
    await expect(loader).toBeVisible();
    fake.release();
    await expect(page.getByText('Please add retry tests.')).toBeVisible();
    await expect(loader).toHaveCount(0);
  });
});

test.describe('workspace', () => {
  test('starts with both side panels closed and toggles each from a single labelled control', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    for (const [show, hide, panel] of [
      ['Show file sidebar', 'Hide file sidebar', 'Changed files'],
      ['Show comments panel', 'Hide comments panel', 'Pull request comments'],
    ]) {
      await expect(page.getByRole('complementary', { name: panel })).toHaveCount(0);
      await expect(page.getByRole('button', { name: show })).toHaveAttribute('title', /.+/);
      await page.getByRole('button', { name: show }).click();
      await expect(page.getByRole('complementary', { name: panel })).toBeVisible();
      await expect(page.getByRole('button', { name: show })).toHaveCount(0);
      await page.getByRole('button', { name: hide }).click();
      await expect(page.getByRole('complementary', { name: panel })).toHaveCount(0);
    }
  });

  test('offers Review changes but no standalone Start review button', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await expect(page.getByRole('button', { name: 'Review changes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /start (a )?review/i })).toHaveCount(0);
  });

  test('shows branch-linked parent and child PRs and closes the stack panel', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await expect(page.getByRole('button', { name: /#41 Prepare worker base/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dependent pull requests' }).click();
    const parent = page.getByRole('button', { name: /#41 Prepare worker base/ });
    const child = page.getByRole('button', { name: /#43 Use retries in scheduler/ });
    const current = page.locator('.dependency-current');
    await expect(parent).toBeVisible();
    await expect(parent).toHaveAttribute('title', 'Open parent PR #41: Prepare worker base');
    await expect(child).toBeVisible();
    await expect(child).toHaveAttribute('title', 'Open child PR #43: Use retries in scheduler');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.dependency-node')).toHaveCount(0);
    const numberPositions = await Promise.all(
      [parent, current, child].map(async row => (await row.locator('span').first().boundingBox())!.x),
    );
    expect(Math.max(...numberPositions) - Math.min(...numberPositions)).toBeLessThan(0.5);
    await page.getByRole('button', { name: 'Close stack panel' }).click();
    await expect(parent).toHaveCount(0);
  });

  test('renders Markdown emoji, nested read-only checklists, details and review summaries', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const conversation = page.locator('.conversation');
    const description = page.locator('.pr-heading-section');
    await expect(conversation.getByText('Adds worker retries 😄')).toHaveCount(0);
    await expect(description.getByText('Adds worker retries 😄')).toBeVisible();
    const boxes = description.getByRole('checkbox');
    // Ticked boxes used to sit lower than unticked ones because the tick shifted the box's baseline.
    const [unticked, ticked] = await boxes.evaluateAll(inputs =>
      inputs.map(input => {
        const range = document.createRange();
        range.selectNodeContents(input.parentElement!);
        range.setStartAfter(input);
        const text = range.getClientRects()[0];
        const box = input.getBoundingClientRect();
        return box.top + box.height / 2 - (text.top + text.height / 2);
      }),
    );
    expect(Math.abs(ticked - unticked)).toBeLessThan(1);
    await expect(boxes).toHaveCount(2);
    for (const box of await boxes.all()) await expect(box).toBeDisabled();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(description.getByRole('group').filter({ hasText: 'Rollout' })).toBeVisible();
    for (const state of ['Approved', 'Changes requested']) await expect(conversation.getByRole('img', { name: state })).toBeVisible();
    await expect(conversation.getByText(/^(approved|changes requested)$/i)).toHaveCount(0);
    for (const [state, reactions] of [
      ['APPROVED', 0],
      ['CHANGES_REQUESTED', 1],
    ] as const)
      await expect(conversation.locator(`[data-review-state="${state}"] > .comment-reactions`)).toHaveCount(reactions);
    await expect(page.getByText(/no review summary/i)).toHaveCount(0);
    await expect(page.getByText('Please add retry tests.')).toBeVisible();
  });

  test('Conversation interleaves timeline events with comments and links both commits of a force push', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const history = page.getByRole('list', { name: 'Pull request history' });
    const requested = history.locator('[data-event="review_requested"]');
    await expect(requested).toHaveCount(1);
    await expect(requested.locator('.avatar')).toHaveCount(3);
    await expect(requested).toContainText(/alice\s*requested review from\s*carol\s*bob/);
    const push = history.locator('[data-event="head_ref_force_pushed"]').getByRole('link');
    await expect(push).toHaveText([FIRST.slice(0, 7), HEAD.slice(0, 7)]);
    await expect(push.last()).toHaveAttribute('href', `https://github.com/acme/app/commit/${HEAD}`);
    await expect(history.locator('[data-event="committed"]')).toContainText('Add retries');
    await page.getByRole('button', { name: 'Show only comments and reviews' }).click();
    await expect(history.locator('[data-event]')).toHaveCount(0);
    await expect(history.getByText('Ready for review')).toBeVisible();
  });

  test('shows review code comments with their snippet and local times on hover in Conversation', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const conversation = page.locator('.conversation');
    const review = conversation.locator('[data-review-state="CHANGES_REQUESTED"]');
    await expect(review.getByRole('button', { name: /Handler\.java:3/ })).toBeVisible();
    await expect(review.locator('.code-snippet code')).toHaveText([
      'package api;',
      'class Handler {',
      '  void old() {}',
      '  void retry() {}',
    ]);
    await expect(review.getByText('Looks resolved now')).toBeVisible();
    await expect(conversation.locator('.comment-author time').first()).toHaveText(/^\d+[mhd] ago$/);
    await expect(conversation.locator('.comment-author').first().getByRole('img', { name: 'Commented' })).toBeVisible();
    await expect(review.locator('.comment-author time')).toHaveText(/^\d+[mhd] ago$/);
    await expect(review.locator('.comment-author time')).toHaveAttribute('title', /\d{1,2}:\d{2}/);
  });

  for (const [label, theme] of [
    ['Solarized Light', 'solarized-light'],
    ['GitHub Light Default', 'github-light-default'],
    ['Paper', 'paper'],
  ] as const)
    test(`switches to the ${label} theme and remembers it`, async ({ page }) => {
      await mockGitHub(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.getByRole('option', { name: label }).click();
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      }
    });
});

test.describe('changed files sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Show file sidebar' }).click();
  });

  test('colors rows by normalized Git status with a distinct color per status', async ({ page }) => {
    const colors = new Set<string>();
    for (const [row, status] of [
      ['logo.png Added', 'added'],
      ['guide.md Renamed', 'renamed'],
      ['tool.unknownext Modified', 'modified'],
      ['legacy.go Deleted', 'deleted'],
    ]) {
      const button = page.getByRole('button', { name: row });
      await expect(button).toHaveAttribute('data-file-status', status);
      colors.add(await button.evaluate(element => getComputedStyle(element).color));
    }
    expect(colors.size).toBe(4);
  });

  test('combines status filters, isolates one with Alt-click, and clears them', async ({ page }) => {
    const rows = page
      .getByRole('complementary', { name: 'Changed files' })
      .getByRole('button', { name: / (Added|Modified|Renamed|Deleted)$/ });
    const filters = page.getByRole('dialog', { name: 'Filter by Git status' });
    await page.getByRole('button', { name: 'Filter files by Git status' }).click();
    await filters.getByRole('button', { name: /Added/ }).click();
    await expect(rows).toHaveText([/logo\.png/, /Handler\.java/]);
    await filters.getByRole('button', { name: /Deleted/ }).click();
    await expect(rows).toHaveCount(3);
    await filters.getByRole('button', { name: /Renamed/ }).click({ modifiers: ['Alt'] });
    await expect(rows).toHaveText([/guide\.md/]);
    await expect(page.locator('article')).toHaveCount(1);
    await filters.getByRole('button', { name: 'Clear filter' }).click();
    await expect(rows).toHaveCount(6);
  });

  test('searches file names and diff content', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Search file names' }).fill('handler');
    await expect(
      page.getByRole('complementary', { name: 'Changed files' }).getByRole('button', { name: / (Added|Modified|Renamed|Deleted)$/ }),
    ).toHaveText([/Handler\.java/]);
    await page.getByRole('textbox', { name: 'Search file names' }).fill('');
    await page.getByRole('textbox', { name: 'Search diff content' }).fill('Old text');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(card(page, 'docs/guide.md')).toBeVisible();
  });

  test('uses recognized file-type icons with a generic fallback', async ({ page }) => {
    for (const [row, type] of [
      ['worker.py Modified', 'python'],
      ['Handler.java Added', 'java'],
      ['guide.md Renamed', 'markdown'],
      ['logo.png Added', 'image'],
      ['tool.unknownext Modified', 'unknown'],
    ]) {
      await expect(page.getByRole('button', { name: row }).locator('svg[data-file-type]')).toHaveAttribute('data-file-type', type);
    }
  });

  test('collapses and expands folders', async ({ page }) => {
    await page.getByRole('button', { name: 'docs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'guide.md Renamed' })).toHaveCount(0);
    await page.getByRole('button', { name: 'docs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'guide.md Renamed' })).toBeVisible();
  });
});

test.describe('diff view', () => {
  test('Viewed collapses a file and unmarking reopens it', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    const file = card(page, 'src/worker.py');
    const disclosure = file.locator('button[aria-expanded]').first();
    await file.getByRole('button', { name: 'Viewed' }).click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await file.getByRole('button', { name: 'Viewed' }).click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  test('the sidebar eye marks files and folders viewed in sync with the diff header', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Show file sidebar' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Changed files' });
    await sidebar.getByRole('button', { name: 'Mark worker.py viewed' }).click();
    await expect(sidebar.getByRole('button', { name: 'Mark worker.py unviewed' })).toBeVisible();
    await expect(card(page, 'src/worker.py').getByRole('button', { name: 'Viewed' })).toHaveAttribute('aria-pressed', 'true');
    await card(page, 'src/worker.py').getByRole('button', { name: 'Viewed' }).click();
    await expect(sidebar.getByRole('button', { name: 'Mark worker.py viewed' })).toBeAttached();
  });

  test('collapses every diff and expands a file to full width', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Collapse all diffs' }).click();
    for (const disclosure of await page.locator('article button[aria-expanded]').all())
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: /Expand all diffs/ }).click();
    await card(page, 'src/worker.py').getByRole('button', { name: 'Expand worker.py to full width' }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await page.getByRole('button', { name: 'Restore all files' }).click();
    await expect(page.locator('article')).toHaveCount(6);
  });

  for (const layout of ['Unified diff', 'Split diff']) {
    test(`expands context nearest-first and keeps it read-only (${layout})`, async ({ page }) => {
      await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: layout }).click();
      const file = card(page, 'src/worker.py');
      const top = (await lineNumber(page, 'src/worker.py', 13).boundingBox())!.y;
      const bottom = (await lineNumber(page, 'src/worker.py', 57).boundingBox())!.y;
      const gap: Locator[] = [];
      for (const button of await file.locator('[data-expand-button]').all()) {
        const box = await button.boundingBox();
        if (box && box.y > top && box.y < bottom) gap.push(button);
      }
      expect(gap.length).toBeGreaterThan(0);
      await gap[0].click();
      const hidden = () =>
        file
          .locator('[data-line]')
          .evaluateAll(nodes =>
            [...new Set(nodes.map(node => Number(node.getAttribute('data-line'))))]
              .filter(line => line > 13 && line < 57)
              .sort((x, y) => x - y),
          );
      const range = (start: number) => Array.from({ length: 20 }, (_, i) => start + i);
      await expect
        .poll(async () => JSON.stringify(await hidden()))
        .toMatch(new RegExp(`^(${JSON.stringify(range(14))}|${JSON.stringify(range(37))})$`.replace(/[[\]]/g, '\\$&')));
      const revealed = (await hidden())[0];
      await lineNumber(page, 'src/worker.py', revealed).click();
      await expect(composer(page)).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: /read-only/i })).toBeVisible();
    });
  }
});

test.describe('inline comments and reviews', () => {
  test('opening a composer on a visible line keeps the diff still', async ({ page }) => {
    await mockGitHub(page, { prState: 'merged' });
    await openPR(page);
    const line = lineNumber(page, 'src/worker.py', 10, 'addition');
    await line.evaluate(element => {
      const scroller = document.querySelector<HTMLElement>('[class*=review-scroll]')!;
      const viewport = scroller.getBoundingClientRect();
      scroller.scrollTop += element.getBoundingClientRect().top - (viewport.top + scroller.clientHeight * 0.4);
    });
    const before = await line.evaluate(element => {
      const scroller = document.querySelector<HTMLElement>('[class*=review-scroll]')!;
      return {
        scrollTop: scroller.scrollTop,
        lineTop: element.getBoundingClientRect().top,
        viewportTop: scroller.getBoundingClientRect().top,
        clientHeight: scroller.clientHeight,
      };
    });
    expect(before.lineTop).toBeGreaterThan(before.viewportTop + before.clientHeight * 0.3);
    expect(before.lineTop).toBeLessThan(before.viewportTop + before.clientHeight * 0.5);

    await line.click();
    await expect(composer(page)).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const after = await line.evaluate(element => {
      const scroller = document.querySelector<HTMLElement>('[class*=review-scroll]')!;
      return { scrollTop: scroller.scrollTop, lineTop: element.getBoundingClientRect().top };
    });
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.lineTop).toBeCloseTo(before.lineTop, 1);
  });

  test('opening a composer near the bottom reveals only its textarea immediately', async ({ page }) => {
    type InlineRevealRecord = {
      options: boolean | ScrollIntoViewOptions | undefined;
      scrollTop: number;
      textareaBottom: number;
      viewportBottom: number;
      containerBottom: number;
    };
    await mockGitHub(page, { prState: 'merged' });
    await openPR(page);
    const scroller = page.locator('[class*=review-scroll]').first();
    const line = lineNumber(page, 'src/worker.py', 10, 'addition');
    await line.evaluate(element => {
      const scroller = document.querySelector<HTMLElement>('[class*=review-scroll]')!;
      const viewport = scroller.getBoundingClientRect();
      scroller.scrollTop += element.getBoundingClientRect().top - (viewport.bottom - 55);
    });
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        if (this instanceof HTMLTextAreaElement) {
          const scroller = document.querySelector<HTMLElement>('[class*=review-scroll]');
          const container = this.closest<HTMLElement>('.inline-composer');
          if (scroller && container) {
            (window as Window & { __inlineReveal?: InlineRevealRecord }).__inlineReveal = {
              options,
              scrollTop: scroller.scrollTop,
              textareaBottom: this.getBoundingClientRect().bottom,
              viewportBottom: scroller.getBoundingClientRect().bottom,
              containerBottom: container.getBoundingClientRect().bottom,
            };
          }
        }
        return original.call(this, options);
      };
    });

    await line.click();
    const textarea = composer(page);
    await expect(textarea).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const record = await page.evaluate(() => (window as Window & { __inlineReveal?: InlineRevealRecord }).__inlineReveal);
    expect(record).toBeDefined();
    if (!record) throw new Error('Expected the textarea to be revealed.');
    const scrollerBox = await scroller.boundingBox();
    const textareaBox = await textarea.boundingBox();
    if (!scrollerBox || !textareaBox) throw new Error('Expected the textarea and review scroller to be visible.');
    const scrollTop = await scroller.evaluate(element => element.scrollTop);
    const textareaOverflow = record.textareaBottom - record.viewportBottom;
    const containerOverflow = record.containerBottom - record.viewportBottom;
    expect(record.options).toEqual({ block: 'nearest' });
    expect(textareaOverflow).toBeGreaterThan(0);
    expect(containerOverflow).toBeGreaterThan(textareaOverflow);
    expect(scrollTop - record.scrollTop).toBeCloseTo(textareaOverflow, 0);
    expect(scrollTop - record.scrollTop).toBeLessThan(containerOverflow);
    expect(textareaBox.y + textareaBox.height).toBeLessThanOrEqual(scrollerBox.y + scrollerBox.height + 1);
  });

  for (const [layout, kind, side] of [
    ['Unified diff', 'addition', 'RIGHT'],
    ['Split diff', 'deletion', 'LEFT'],
  ] as const) {
    test(`clicking a ${kind} line opens a minimal composer and publishes a single comment (${layout})`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: layout }).click();
      await lineNumber(page, 'src/worker.py', 10, kind).click();
      const form = page.getByRole('group', { name: 'Line comment' });
      await expect(form.getByText('Comment on this line')).toBeVisible();
      await expect(form).not.toContainText('worker.py');
      await expect(form).not.toContainText('Add a single comment to publish');
      await composer(page).fill('Single note');
      await form.getByRole('button', { name: 'Add single comment' }).click();
      await expect
        .poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/comments'))
        .toMatchObject({ body: 'Single note', path: 'src/worker.py', line: 10, side, commit_id: HEAD });
    });
  }

  for (const [from, to] of [
    [11, 13],
    [13, 11],
  ]) {
    test(`dragging line numbers ${from}→${to} opens the composer on release and posts a range`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await drag(page, lineNumber(page, 'src/worker.py', from), lineNumber(page, 'src/worker.py', to));
      await expect(page.getByText('Comment on these lines')).toBeVisible();
      await composer(page).fill('Range note');
      await page.getByRole('button', { name: 'Add single comment' }).click();
      await expect
        .poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/comments'))
        .toMatchObject({ line: 13, side: 'RIGHT', start_line: 11, start_side: 'RIGHT' });
    });
  }

  for (const close of ['Cancel', 'Close line comment']) {
    test(`${close} closes the composer without posting`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await lineNumber(page, 'src/worker.py', 11).click();
      await composer(page).fill('Discard me');
      await page.getByRole('group', { name: 'Line comment' }).getByRole('button', { name: close, exact: true }).click();
      await expect(composer(page)).toHaveCount(0);
      expect(fake.writes).toEqual([]);
    });
  }

  test('a line-started review batches later comments and replies, then submits once', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await startLineReview(page, 'First pending');
    await expect
      .poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/reviews'))
      .toMatchObject({ comments: [{ body: 'First pending', path: 'src/worker.py', line: 10, side: 'RIGHT' }] });
    const review = fake.reviews.find(review => review.state === 'PENDING')!;

    await lineNumber(page, 'src/worker.py', 12).click();
    await expect(page.getByText('Add to your review')).toBeVisible();
    await composer(page).fill('Second pending');
    await page
      .getByRole('group', { name: 'Line comment' })
      .getByRole('button', { name: /review comment/i })
      .click();
    await expect
      .poll(() => lastWrite(fake, 'AddPullRequestReviewThread'))
      .toMatchObject({ input: { pullRequestReviewId: review.node_id, body: 'Second pending', line: 12 } });

    await page.getByRole('textbox', { name: 'Reply to thread on line 60' }).fill('Pending reply');
    await page.getByRole('group', { name: 'Reply actions' }).getByRole('button').last().click();
    await expect
      .poll(() => lastWrite(fake, 'AddPullRequestReviewThreadReply'))
      .toMatchObject({ input: { pullRequestReviewId: review.node_id, pullRequestReviewThreadId: 'T301', body: 'Pending reply' } });
    expect(writes(fake, '/repos/acme/app/pulls/42/comments')).toEqual([]);

    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('radio', { name: /^Approve/ }).check();
    await page.getByRole('button', { name: 'Submit review' }).click();
    await expect.poll(() => lastWrite(fake, `/repos/acme/app/pulls/42/reviews/${review.id}/events`)).toMatchObject({ event: 'APPROVE' });
    expect(writes(fake, '/repos/acme/app/pulls/42/reviews')).toHaveLength(1);
  });

  test('a reply can start the review', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await page.getByRole('textbox', { name: 'Reply to thread on line 10' }).fill('Reply first');
    await page.getByRole('group', { name: 'Reply actions' }).getByRole('button', { name: 'Start a review' }).click();
    await expect
      .poll(() => lastWrite(fake, 'AddPullRequestReviewThreadReply'))
      .toMatchObject({ input: { pullRequestReviewThreadId: 'T101', body: 'Reply first' } });
    expect(lastWrite(fake, '/repos/acme/app/pulls/42/reviews')).toEqual({ commit_id: HEAD });
  });

  for (const [prState, header] of [
    ['merged', 'merged 2 commits into'],
    ['closed', 'wanted to merge 2 commits into'],
  ] as const)
    test(`replies to threads and adds single line comments on a ${prState} pull request`, async ({ page }) => {
      const fake = await mockGitHub(page, { prState });
      await openPR(page);
      await expect(page.locator('.pr-details')).toContainText(header);
      const reply = page.getByRole('textbox', { name: 'Reply to thread on line 10' });
      await expect(reply).toBeEnabled();
      await reply.fill('Reply after close');
      const actions = page.getByRole('group', { name: 'Reply actions' });
      await expect(actions.getByRole('button', { name: 'Start a review' })).toHaveCount(0);
      await actions.getByRole('button', { name: 'Reply', exact: true }).click();
      await expect
        .poll(() => fake.writes.at(-1))
        .toMatchObject({ method: 'POST', path: '/repos/acme/app/pulls/42/comments/101/replies', body: { body: 'Reply after close' } });
      await expect(page.getByText('Reply posted to GitHub.')).toBeVisible();
      await lineNumber(page, 'src/worker.py', 10, 'addition').click();
      const form = page.getByRole('group', { name: 'Line comment' });
      await composer(page).fill('Note after close');
      await expect(form.getByRole('alert')).toHaveCount(0);
      await expect(form.getByRole('button', { name: 'Start a review' })).toHaveCount(0);
      await form.getByRole('button', { name: 'Add single comment' }).click();
      await expect
        .poll(() => lastWrite(fake, '/repos/acme/app/pulls/42/comments'))
        .toMatchObject({ body: 'Note after close', path: 'src/worker.py', line: 10, side: 'RIGHT' });
    });

  test('resolves and reopens threads', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    const file = card(page, 'src/worker.py');
    await file.getByRole('button', { name: 'Resolve', exact: true }).first().click();
    await expect.poll(() => lastWrite(fake, 'ResolveReviewThread')).toEqual({ input: { threadId: 'T101' } });
    await expect(file.getByRole('button', { name: 'Reopen', exact: true }).first()).toBeVisible();
  });

  test('edits a pending review comment through GraphQL and shows the saved text', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await startLineReview(page, 'First pending');
    const pendingId = fake.inline.find(comment => comment.body === 'First pending')!.node_id;
    await page.locator('.thread-comment').filter({ hasText: 'First pending' }).getByRole('button', { name: 'Edit comment' }).click();
    await page.getByRole('textbox', { name: 'Edit comment' }).fill('Edited pending');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(() => lastWrite(fake, 'UpdatePullRequestReviewComment'))
      .toEqual({ input: { pullRequestReviewCommentId: pendingId, body: 'Edited pending' } });
    expect(writes(fake, /^\/repos\/acme\/app\/pulls\/comments\//)).toEqual([]);
    await expect(page.locator('.thread-comment').filter({ hasText: 'Edited pending' })).toHaveCount(1);
  });

  for (const emptyReviewDeletes of [false, true]) {
    test(`deleting the only pending comment then discarding is clean when GitHub ${emptyReviewDeletes ? 'removes' : 'keeps'} the empty review`, async ({
      page,
    }) => {
      const fake = await mockGitHub(page, { emptyReviewDeletes });
      await openPR(page);
      await startLineReview(page, 'Only pending');
      const comment = page.locator('.thread-comment').filter({ hasText: 'Only pending' });
      await comment.getByRole('button', { name: 'Delete comment' }).click();
      await comment.getByRole('button', { name: 'Delete?' }).click();
      await expect.poll(() => fake.writes.at(-1)).toMatchObject({ operation: 'DeletePullRequestReviewComment' });
      if (emptyReviewDeletes) await expect(page.getByText('Comment deleted. GitHub removed the now-empty pending review.')).toBeVisible();
      else {
        await page.getByRole('button', { name: 'Discard pending', exact: true }).click();
        await page.getByRole('button', { name: 'Discard review', exact: true }).click();
        await expect(page.getByText('Pending review discarded.')).toBeVisible();
      }
      await expect(page.getByRole('button', { name: 'Discard pending', exact: true })).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(fake.reviews.some(review => review.state === 'PENDING')).toBe(false);
    });
  }

  test('adds then removes a reaction on a published comment during a pending review', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await startLineReview(page, 'Pending alongside reaction');
    const published = page.locator('.thread-comment').filter({ hasText: 'Please rename this' });
    await published.getByRole('button', { name: 'Add a reaction' }).click();
    await page.getByRole('group', { name: 'Choose a reaction' }).getByRole('button').first().click();
    await expect.poll(() => lastWrite(fake, '/repos/acme/app/pulls/comments/101/reactions')).toEqual({ content: '+1' });
    const confirmed = published.getByRole('button', { name: /: 1\b/ });
    await expect(confirmed).toBeVisible();
    await confirmed.click();
    await expect.poll(() => fake.writes.at(-1)?.path).toMatch(/^\/repos\/acme\/app\/pulls\/comments\/101\/reactions\/\d+$/);
    expect(fake.writes.at(-1)?.method).toBe('DELETE');
    await expect(confirmed).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  for (const [option, expectColor] of [
    ['Approve', 'green'],
    ['Request changes', 'red'],
    ['Comment', 'neutral'],
  ] as const) {
    test(`review dialog submit button is ${expectColor} for ${option}`, async ({ page }) => {
      await mockGitHub(page);
      await openPR(page);
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByRole('radio', { name: new RegExp(`^${option}`) }).check();
      const hue = async () => {
        const [r, g, b] = (
          await page.getByRole('button', { name: 'Submit review' }).evaluate(element => getComputedStyle(element).backgroundColor)
        )
          .match(/\d+/g)!
          .map(Number);
        return g > r + 40 && g > b ? 'green' : r > g + 60 && r > b + 40 ? 'red' : 'neutral';
      };
      await expect.poll(hue).toBe(expectColor);
    });
  }
});

test.describe('comments panel and settings', () => {
  test('filters open, resolved and all threads and jumps to a thread', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Show comments panel' }).click();
    const panel = page.getByRole('complementary', { name: 'Pull request comments' });
    const status = panel.getByRole('combobox', { name: 'Comment status' });
    await expect(panel.getByRole('button', { name: /Handler\.java/ })).toHaveCount(0);
    await status.selectOption('resolved');
    await expect(panel.getByRole('button', { name: /Handler\.java/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /worker\.py line/ })).toHaveCount(0);
    await status.selectOption('all');
    await expect(panel.getByRole('button', { name: /line/ }).filter({ hasText: /\.(py|java)/ })).toHaveCount(3);
    await card(page, 'src/legacy.go').scrollIntoViewIfNeeded();
    await panel.getByRole('button', { name: 'worker.py line +10' }).click();
    await expect(card(page, 'src/worker.py').getByText('Please rename this 🎉')).toBeInViewport();
  });

  test('hides bot comments persistently while keeping human replies', async ({ page }) => {
    await mockGitHub(page);
    await openPR(page);
    await expect(page.getByText('Automated lint warning')).toBeVisible();
    await page.getByRole('button', { name: 'Diff display settings' }).click();
    await page.getByRole('switch', { name: 'Hide bot comments' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Automated lint warning')).toHaveCount(0);
    await expect(page.getByText('Human reply to bot')).toBeVisible();
    await page.reload();
    await page.getByRole('heading', { name: 'Improve worker retries', level: 1 }).waitFor();
    await expect(page.getByText('Human reply to bot')).toBeVisible();
    await expect(page.getByText('Automated lint warning')).toHaveCount(0);
  });
});

test('commit history opens a single commit read-only and returns to all commits', async ({ page }) => {
  await mockGitHub(page);
  await openPR(page);
  await page.getByRole('button', { name: /^Commits 2/ }).click();
  await expect(page.locator('article').filter({ hasText: 'Retry worker' })).toBeVisible();
  await page.locator('article').filter({ hasText: 'Retry worker' }).getByRole('button', { name: 'View changes' }).click();
  await expect(page.getByText(/Read-only range/)).toBeVisible();
  await expect(page.locator('article')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'All commits', exact: true })
    .and(page.getByTitle(/Restore the full PR diff/))
    .click();
  await expect(page.locator('article')).toHaveCount(6);
});

test.describe('mentions', () => {
  const box = (page: Page) => page.getByRole('textbox', { name: 'Leave a comment' });
  const openConversation = async (page: Page) => {
    await openPR(page);
    await page.getByRole('button', { name: /^Conversation/ }).click();
  };

  test('@ completes people in the conversation box, Escape dismisses, and the mention is posted', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openConversation(page);
    const list = page.getByRole('listbox', { name: 'Mention suggestions' });
    await box(page).fill('Thanks @ali');
    await expect(list.getByRole('option', { name: 'Alice Liddell alice' })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Alice Liddell alice' })).toHaveAttribute('aria-selected', 'true');
    await expect(box(page)).toHaveAttribute('aria-activedescendant', /option-0$/);
    await box(page).press('ArrowDown');
    await box(page).press('Enter');
    await expect(box(page)).toHaveValue('Thanks @alice ');
    await expect(box(page)).toBeFocused();
    await expect(list).toBeHidden();
    await box(page).pressSequentially('and @bo');
    await expect(list.getByRole('option', { name: /bob/ })).toBeVisible();
    await box(page).press('Escape');
    await expect(list).toBeHidden();
    await expect(box(page)).toHaveValue('Thanks @alice and @bo');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect.poll(() => lastWrite(fake, '/repos/acme/app/issues/42/comments')).toEqual({ body: 'Thanks @alice and @bo' });
    expect(fake.peopleSearches).toContainEqual({ kind: 'mentionable', query: 'ali', first: 10 });
  });

  test('@ completes people in a diff thread reply, and mentions there show the profile on hover', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    const reply = page.getByRole('textbox', { name: 'Reply to thread on line 10' });
    await reply.fill('Thanks @ali');
    const list = page.getByRole('listbox', { name: 'Mention suggestions' });
    await expect(list.getByRole('option', { name: 'Alice Liddell alice' })).toBeVisible();
    await reply.press('Enter');
    await expect(reply).toHaveValue('Thanks @alice ');
    await page.getByRole('group', { name: 'Reply actions' }).getByRole('button', { name: 'Reply', exact: true }).click();
    await expect.poll(() => lastWrite(fake, /\/pulls\/42\/comments\/101\/replies$/)).toEqual({ body: 'Thanks @alice' });
    await card(page, 'src/worker.py').getByRole('link', { name: '@alice', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Alice Liddell');
  });

  test('a rendered @mention links to the profile and its hover card loads the name once', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openConversation(page);
    await box(page).fill('Thanks @alice for the retries');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const mention = page.getByRole('link', { name: '@alice', exact: true });
    await expect(mention).toHaveAttribute('href', 'https://github.com/alice');
    const card = page.getByRole('tooltip');
    for (let hover = 0; hover < 2; hover++) {
      await mention.hover();
      await expect(card).toContainText('Alice Liddell');
      await page.mouse.move(0, 0);
      await expect(card).toBeHidden();
    }
    await mention.focus();
    await expect(card).toContainText('Alice Liddell');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    expect(fake.userReads).toEqual(['alice']);
  });
});

test.describe('editing your comments', () => {
  const items = (page: Page, text: string) => page.locator('.conversation-comment, .thread-comment').filter({ hasText: text });
  for (const { kind, path, post } of [
    {
      kind: 'conversation comment',
      path: /^\/repos\/acme\/app\/issues\/comments\/\d+$/,
      post: async (page: Page, fake: Fake) => {
        await page.getByRole('button', { name: /^Conversation/ }).click();
        await page.getByRole('textbox', { name: 'Leave a comment' }).fill('My note :+1:');
        await page.getByRole('button', { name: 'Comment', exact: true }).click();
        await expect.poll(() => lastWrite(fake, '/repos/acme/app/issues/42/comments')).toEqual({ body: 'My note :+1:' });
        await expect(page.getByText('My note 👍')).toBeVisible();
      },
    },
    {
      kind: 'thread reply',
      path: /^\/repos\/acme\/app\/pulls\/comments\/\d+$/,
      post: async (page: Page) => {
        await page.getByRole('textbox', { name: 'Reply to thread on line 10' }).fill('My note');
        await page.getByRole('group', { name: 'Reply actions' }).getByRole('button', { name: 'Reply', exact: true }).click();
      },
    },
  ])
    test(`posts, edits and deletes your ${kind}`, async ({ page }) => {
      const fake = await mockGitHub(page);
      await openPR(page);
      await expect(page.getByRole('button', { name: 'Edit comment' })).toHaveCount(0);
      await post(page, fake);
      await items(page, 'My note').getByRole('button', { name: 'Edit comment' }).click();
      await page.getByRole('textbox', { name: 'Edit comment' }).fill('Edited note');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(() => fake.writes.at(-1))
        .toMatchObject({ method: 'PATCH', path: expect.stringMatching(path), body: { body: 'Edited note' } });
      await expect(items(page, 'Edited note')).toHaveCount(1);
      await items(page, 'Edited note').getByRole('button', { name: 'Delete comment' }).click();
      await items(page, 'Edited note').getByRole('button', { name: 'Delete?' }).click();
      await expect.poll(() => fake.writes.at(-1)).toMatchObject({ method: 'DELETE', path: expect.stringMatching(path) });
      await expect(items(page, 'Edited note')).toHaveCount(0);
    });

  for (const write of [false, true])
    test(`${write ? 'shows' : 'hides'} edit and delete on others' comments ${write ? 'with' : 'without'} write access`, async ({
      page,
    }) => {
      await mockGitHub(page, { write });
      await openPR(page);
      await page.getByRole('button', { name: /^Conversation/ }).click();
      const others = page.locator('.conversation-comment').first();
      await expect(others.locator('.comment-author strong')).not.toHaveText('reviewer');
      for (const name of ['Edit comment', 'Delete comment']) {
        const button = others.getByRole('button', { name }).first();
        await (write ? expect(button).toBeVisible() : expect(button).toHaveCount(0));
      }
    });

  test('edits your review summary but cannot delete it', async ({ page }) => {
    const fake = await mockGitHub(page);
    await openPR(page);
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('textbox', { name: 'Review summary' }).fill('Looks fine');
    await page.getByRole('button', { name: 'Submit review' }).click();
    await page.getByRole('button', { name: /^Conversation/ }).click();
    const review = items(page, 'Looks fine');
    await expect(review.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);
    await review.getByRole('button', { name: 'Edit comment' }).click();
    await page.getByRole('textbox', { name: 'Edit comment' }).fill('Looks great');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(() => fake.writes.at(-1))
      .toMatchObject({
        method: 'PUT',
        path: expect.stringMatching(/^\/repos\/acme\/app\/pulls\/42\/reviews\/\d+$/),
        body: { body: 'Looks great' },
      });
    await expect(items(page, 'Looks great')).toHaveCount(1);
  });
});
