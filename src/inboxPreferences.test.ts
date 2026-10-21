import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSort, needsServerRefetch, readPreferences, savePreferences } from './inboxPreferences.ts';

const saved = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  },
});
afterEach(() => saved.clear());

describe('Inbox preferences', () => {
  for (const [value, expected] of [
    ['all', 'all'],
    ['mine', 'mine'],
    ['reviewing', 'reviewing'],
    ['invalid', undefined],
    [42, undefined],
  ] as const)
    it(`reads merged filter ${String(value)}`, () => {
      saved.set('review.inbox', JSON.stringify({ merged: value }));
      assert.equal(readPreferences().merged, expected);
    });

  it('saves the merged filter with the other preferences', () => {
    savePreferences({ repos: ['acme/app'], merged: 'reviewing' });
    assert.deepEqual(JSON.parse(saved.get('review.inbox') ?? ''), { repos: ['acme/app'], merged: 'reviewing' });
  });

  it('ignores the old global sort and validates per-section sorts', () => {
    saved.set(
      'review.inbox',
      JSON.stringify({
        sort: 'created-asc',
        sorts: { requested: 'title-asc', attention: 'created-asc', ready: 'priority', returned: 'updated-asc' },
      }),
    );
    assert.deepEqual(readPreferences().sorts, { requested: 'title-asc', attention: 'created-asc' });
    assert.equal(defaultSort('requested'), 'priority');
    assert.equal(defaultSort('attention'), 'updated-desc');
  });

  for (const [choice, loaded, total, expected] of [
    ['created-asc', 100, 105, true],
    ['updated-desc', 3, 3, false],
    ['created-desc', 1000, 2000, false],
    ['title-asc', 10, 200, false],
    ['size-desc', 10, 200, false],
    ['priority', 10, 200, false],
  ] as const)
    it(`${choice} with ${loaded}/${total} items needs server refetch: ${expected}`, () =>
      assert.equal(needsServerRefetch(choice, loaded, total), expected));
});
