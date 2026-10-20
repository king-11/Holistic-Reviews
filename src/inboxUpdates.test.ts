import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearInboxSnapshots,
  inboxSnapshots,
  placement,
  recordPR,
  snapshotLifetime,
  withSnapshots,
  type InboxView,
} from './inboxUpdates.ts';
import type { Comment, InboxItem, PullRequest, Review } from './github.ts';
import { demoPR } from './fixtures.ts';

const me = { id: 1, login: 'me' };
const alice = { id: 2, login: 'alice' };
const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({
  ...demoPR,
  html_url: 'https://github.com/acme/app/pull/42',
  number: 42,
  user: alice,
  state: 'open',
  draft: false,
  merged: false,
  requested_reviewers: [],
  requested_teams: [],
  ...extra,
});
const review = (user: typeof me, state: string, id = 1): Review => ({ id, node_id: `R${id}`, user, state, body: '', commit_id: 'sha' });
const row = (number: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  id: number,
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/acme/app/pull/${number}`,
  repository_url: 'https://api.github.com/repos/acme/app',
  user: alice,
  draft: false,
  state: 'open',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  comments: 0,
  labels: [],
  ...extra,
});
const view = (extra: Partial<InboxView> = {}): InboxView => ({ login: 'me', repos: [], merged: 'all', now: Date.now(), ...extra });

describe('placement', () => {
  for (const { name, pull, reviews = [], comments = [], teams, expected } of [
    {
      name: 'a direct request stays requested until the viewer reviews',
      pull: pr({ requested_reviewers: [me] }),
      expected: { requested: true, reviewed: false, authored: false, merged: false },
    },
    {
      name: 'approving clears a team request and counts as reviewed',
      pull: pr({ requested_teams: [{ slug: 'core', name: 'Core' }] }),
      reviews: [review(me, 'APPROVED')],
      expected: { requested: false, reviewed: true },
    },
    {
      name: 'a team request without known viewer teams is left to search',
      pull: pr({ requested_teams: [{ slug: 'core', name: 'Core' }] }),
      expected: { requested: undefined, reviewed: false },
    },
    {
      name: 'a team request for one of the viewer’s teams counts as requested',
      pull: pr({ requested_teams: [{ slug: 'core', name: 'Core' }] }),
      teams: ['acme/core'],
      expected: { requested: true, reviewed: false },
    },
    {
      name: 'a PR whose only remaining requested teams do not include the viewer is not requested',
      pull: pr({ requested_teams: [{ slug: 'qa', name: 'QA' }] }),
      teams: ['acme/core'],
      expected: { requested: false, reviewed: false },
    },
    {
      name: 'a single line comment counts as reviewed',
      pull: pr(),
      comments: [{ id: 9, node_id: 'C9', user: me, body: 'x', created_at: '', path: 'a.ts', pull_request_review_id: 5 } as Comment],
      expected: { reviewed: true },
    },
    {
      name: 'a pending review does not count as reviewed',
      pull: pr({ requested_reviewers: [me] }),
      reviews: [review(me, 'PENDING')],
      expected: { requested: true, reviewed: false },
    },
    {
      name: 'a merged PR leaves every open group',
      pull: pr({ user: me, state: 'closed', merged: true }),
      expected: { requested: false, authored: false, drafts: false, reviewed: false, merged: true },
    },
    {
      name: 'your draft sits in drafts, not authored',
      pull: pr({ user: me, draft: true }),
      expected: { authored: false, drafts: true },
    },
  ])
    it(name, () => {
      const placed = placement(pull, reviews, comments, 'me', teams);
      for (const [group, value] of Object.entries(expected)) assert.equal(placed[group as keyof typeof placed], value, group);
    });
});

describe('withSnapshots', () => {
  beforeEach(clearInboxSnapshots);

  it('moves an approved PR from review requests to reviewed by you, keeping its loaded details', () => {
    const details = { additions: 1, deletions: 2, createdAt: '', checks: 'success' as const, participants: [], participantCount: 0 };
    const requested = [row(42, { details }), row(7)];
    recordPR(pr({ title: 'Renamed' }), [review(me, 'APPROVED')], [], 'me');
    const known = new Map(requested.map(item => [item.html_url, item]));
    assert.deepEqual(
      withSnapshots('requested', requested, inboxSnapshots(), view()).items.map(item => item.number),
      [7],
    );
    const reviewed = withSnapshots('reviewed', [], inboxSnapshots(), view(), known);
    assert.equal(reviewed.delta, 1);
    assert.equal(reviewed.items[0]!.title, 'Renamed');
    assert.deepEqual(reviewed.items[0]!.details, details);
  });

  it('keeps a row search already has and refreshes its fields instead of duplicating it', () => {
    recordPR(pr({ title: 'New title', requested_reviewers: [me] }), [], [], 'me');
    const { items, delta } = withSnapshots('requested', [row(42)], inboxSnapshots(), view());
    assert.equal(delta, 0);
    assert.deepEqual(
      items.map(item => [item.id, item.title]),
      [[42, 'New title']],
    );
  });

  for (const [filter, repos, shown] of [
    ['all', ['acme/app'], true],
    ['all', [], false],
    ['mine', ['acme/app'], false],
    ['reviewing', ['acme/app'], true],
  ] as const)
    it(`adds a merged PR by someone else under the ${filter} filter ${repos.length ? 'with' : 'without'} a repository: ${shown}`, () => {
      recordPR(pr({ state: 'closed', merged: true }), [review(me, 'APPROVED')], [], 'me');
      const merged = withSnapshots('merged', [], inboxSnapshots(), view({ merged: filter, repos: [...repos] }));
      assert.equal(merged.items.length, shown ? 1 : 0);
    });

  it('ignores PRs outside the selected repositories', () => {
    recordPR(pr({ html_url: 'https://github.com/acme/infra/pull/3', requested_reviewers: [me] }), [], [], 'me');
    assert.equal(withSnapshots('requested', [], inboxSnapshots(), view({ repos: ['acme/app'] })).items.length, 0);
  });

  it('trusts search again once a snapshot is older than GitHub needs to catch up', () => {
    recordPR(pr(), [review(me, 'APPROVED')], [], 'me');
    const later = view({ now: Date.now() + snapshotLifetime + 1 });
    assert.equal(withSnapshots('requested', [row(42)], inboxSnapshots(), later).items.length, 1);
  });

  it('classifies your PR by its reviews, letting requested changes win over an approval', () => {
    recordPR(pr({ user: me }), [review(alice, 'APPROVED', 1), review({ id: 3, login: 'bob' }, 'CHANGES_REQUESTED', 2)], [], 'me');
    assert.equal(withSnapshots('authored', [], inboxSnapshots(), view()).items[0]!.review, 'returned');
    recordPR(pr({ user: me }), [review(alice, 'APPROVED', 1)], [], 'me');
    assert.equal(withSnapshots('authored', [], inboxSnapshots(), view()).items[0]!.review, 'approved');
  });
});
