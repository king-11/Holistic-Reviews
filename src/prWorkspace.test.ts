import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshot } from './prWorkspace.ts';
import { demoWorkspace } from './fixtures.ts';
import type { Comment } from './github.ts';

const comment = (id: number): Comment => ({ id, user: { id, login: `u${id}` }, body: `c${id}`, created_at: '2026-01-01T00:00:00Z' });

describe('mergeSnapshot', () => {
  it('takes the first snapshot as is', () => {
    const incoming = demoWorkspace();
    assert.equal(mergeSnapshot(null, incoming), incoming);
  });

  it('keeps a local write to a field the next snapshot did not change', () => {
    const first = demoWorkspace();
    const local = { ...first, pr: { ...first.pr, labels: [{ name: 'local', color: 'ffffff' }] } };
    const next = { ...first, pending: [] };
    const merged = mergeSnapshot(local, next, first);
    assert.equal(merged.pr, local.pr);
    assert.deepEqual(merged.pending, []);
  });

  for (const [name, key] of [
    ['conversation comments', 'comments'],
    ['inline comments', 'inlineComments'],
  ] as const)
    it(`keeps locally added ${name} the server copy predates`, () => {
      const first = { ...demoWorkspace(), [key]: [comment(1)] };
      const local = { ...first, [key]: [comment(1), comment(2)] };
      const next = { ...first, [key]: [comment(1), comment(3)] };
      assert.deepEqual(
        mergeSnapshot(local, next, first)[key].map(item => item.id),
        [1, 3, 2],
      );
    });

  it('lets a changed scalar section replace the local value', () => {
    const first = { ...demoWorkspace(), autoMerge: false };
    const next = { ...first, autoMerge: true };
    assert.equal(mergeSnapshot(first, next, first).autoMerge, true);
  });
});
