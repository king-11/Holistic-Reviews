import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSort, needsServerRefetch, readPreferences, savePreferences } from './inboxPreferences.ts';

const login = 'viewer';
const key = `review.inbox:${login}`;
const saved = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
    clear: () => saved.clear(),
    key: (index: number) => [...saved.keys()][index] ?? null,
    get length() {
      return saved.size;
    },
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
      saved.set(key, JSON.stringify({ merged: value }));
      assert.equal(readPreferences(login).merged, expected);
    });

  it('saves the merged filter under the identity-scoped key', () => {
    savePreferences(login, { repos: ['acme/app'], merged: 'reviewing' });
    assert.deepEqual(JSON.parse(saved.get(key) ?? ''), { repos: ['acme/app'], merged: 'reviewing' });
    assert.equal(saved.has('review.inbox'), false);
  });

  it('keeps identities apart', () => {
    savePreferences('other', { repos: ['acme/other'] });
    assert.equal(readPreferences(login).repos, undefined);
    assert.deepEqual(readPreferences('other').repos, ['acme/other']);
  });

  it('ignores the old global sort and validates per-section sorts', () => {
    saved.set(
      key,
      JSON.stringify({
        sort: 'created-asc',
        sorts: { requested: 'title-asc', attention: 'created-asc', ready: 'priority', returned: 'updated-asc' },
      }),
    );
    assert.deepEqual(readPreferences(login).sorts, { requested: 'title-asc', attention: 'created-asc' });
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
