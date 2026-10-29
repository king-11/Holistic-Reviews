import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { local, localIsMemory, scopedKey, session } from './storage.ts';

describe('storage', () => {
  it('scopes keys per identity', () => {
    assert.equal(scopedKey('review.inbox', 'viewer'), 'review.inbox:viewer');
    assert.equal(scopedKey('review.inbox'), 'review.inbox');
  });

  it('keeps reads and writes working without browser localStorage', () => {
    // The node runner offers no localStorage, so `local` resolves to the in-memory shim.
    assert.equal(localIsMemory(), true);
    local.setItem('k', 'v');
    assert.equal(local.getItem('k'), 'v');
    assert.equal(local.length >= 1, true);
    local.removeItem('k');
    assert.equal(local.getItem('k'), null);
  });

  it('keeps local and session apart', () => {
    local.setItem('only-local', '1');
    session.setItem('only-session', '2');
    assert.equal(session.getItem('only-local'), null);
    assert.equal(local.getItem('only-session'), null);
    local.removeItem('only-local');
    session.removeItem('only-session');
  });
});
