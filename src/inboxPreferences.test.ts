import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readPreferences, savePreferences } from './inboxPreferences.ts';

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
});
