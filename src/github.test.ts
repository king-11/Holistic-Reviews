import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHub,
  branchRelations,
  classifyReview,
  inboxQuery,
  parsePRUrl,
  workspaceSections,
  type Comment,
  type PullRequest,
  type Review,
  type ReviewSummary,
  type StatusCheck,
} from './github.ts';
import { demoInbox, demoPR } from './demo.ts';

const ref = { owner: 'acme', repo: 'app', number: 42 };
const sha = demoPR.head.sha;
const pending: Review = { id: 7, node_id: 'review-node', user: { id: 1, login: 'me' }, state: 'PENDING', body: '', commit_id: sha };
const reviewComment: Comment = {
  id: 101,
  node_id: 'comment-node',
  body: 'old',
  user: pending.user,
  created_at: '2024-01-01T00:00:00Z',
  path: 'a.ts',
  pull_request_review_id: 7,
};
type Call = { url: string; init: RequestInit; body: Record<string, unknown> | undefined };
function fake(responses: { status?: number; data?: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const response = responses.shift();
    assert.ok(response, `Unexpected request: ${input}`);
    return new Response(response.status === 204 ? null : JSON.stringify(response.data), {
      status: response.status || 200,
      headers: response.headers,
    });
  });
  return calls;
}
afterEach(() => mock.restoreAll());
const checkRun = (id: number, name: string, suite: number, app = 15368) => ({
  id,
  name,
  status: 'completed',
  conclusion: 'success',
  html_url: null,
  started_at: '2026-01-01T10:00:00Z',
  check_suite: { id: suite },
  app: { id: app },
});
const workflowRun = (id: number, name: string, workflow: number, suite: number) => ({
  id,
  name,
  workflow_id: workflow,
  check_suite_id: suite,
});

describe('commit history, full-file context and reactions', () => {
  const base = 'a'.repeat(40),
    head = 'b'.repeat(40),
    mergeBase = 'c'.repeat(40);
  const blob = (text: string) => ({
    type: 'file',
    encoding: 'base64',
    size: Buffer.byteLength(text),
    content: Buffer.from(text).toString('base64'),
  });
  it('paginates PR commits and forwards cancellation', async () => {
    const calls = fake([{ data: [{ sha: base }], headers: { link: '<next>; rel="next"' } }, { data: [{ sha: head }] }]);
    const signal = new AbortController().signal;
    const result = await new GitHub('test-only-token').commits(ref, signal);
    assert.deepEqual(
      result.items.map(commit => commit.sha),
      [base, head],
    );
    assert.match(calls[0].url, /\/pulls\/42\/commits\?per_page=100&page=1$/);
    assert.match(calls[1].url, /page=2$/);
    assert.equal(calls[0].init.signal, signal);
  });
  it('compares immutable commits and returns the actual merge base, not the moving base branch head', async () => {
    const calls = fake([
      { data: { files: [], merge_base_commit: { sha: mergeBase } } },
      { data: { files: Array(300).fill({ filename: 'a.ts' }), merge_base_commit: { sha: mergeBase } } },
    ]);
    const api = new GitHub('test-only-token');
    assert.deepEqual(await api.compare(ref, base, head), { files: [], mergeBase, truncated: false });
    assert.equal((await api.compare(ref, base, head)).truncated, true);
    assert.match(calls[0].url, new RegExp(`/compare/${base}\\.\\.\\.${head}\\?per_page=1$`));
    await assert.rejects(api.compare(ref, 'main', head), /immutable/);
    await assert.rejects(api.compare(ref, base, '../head'), /immutable/);
    assert.equal(calls.length, 2);
  });
  it('loads exact UTF-8 blobs with encoded path segments and caches by immutable revision', async () => {
    const calls = fake([{ data: blob('你好\none\n') }, { data: blob('你好\ntwo\n') }]);
    const api = new GitHub('test-only-token');
    const values = await Promise.all([
      api.textFile('acme/app', 'src/新 file#?.ts', base),
      api.textFile('acme/app', 'src/新 file#?.ts', base),
    ]);
    assert.deepEqual(values, ['你好\none\n', '你好\none\n']);
    assert.equal(await api.textFile('acme/app', 'src/新 file#?.ts', head), '你好\ntwo\n');
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get('ref'), base);
    assert.match(calls[0].url, /contents\/src\/%E6%96%B0%20file%23%3F.ts/);
  });
  it('uses the merge-base old filename and the fork repository for renamed-file context', async () => {
    const calls = fake([{ data: blob('old') }, { data: blob('new') }]);
    const result = await new GitHub('test-only-token').diffContents(
      ref,
      { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 1, deletions: 1, changes: 2 },
      mergeBase,
      head,
      'fork/app',
    );
    assert.equal(result.oldFile.name, 'old.ts');
    assert.equal(result.oldFile.contents, 'old');
    assert.equal(result.newFile.contents, 'new');
    assert.match(calls[0].url, new RegExp(`/repos/acme/app/contents/old.ts\\?ref=${mergeBase}`));
    assert.match(calls[1].url, new RegExp(`/repos/fork/app/contents/new.ts\\?ref=${head}`));
  });
  it('allows explicit retries after failed reads without serving stale content', async () => {
    const calls = fake([{ status: 403, data: { message: 'Contents not allowed' } }, { data: blob('retry worked') }]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.textFile('acme/app', 'a.ts', base), /Contents not allowed/);
    assert.equal(await api.textFile('acme/app', 'a.ts', base), 'retry worked');
    assert.equal(calls.length, 2);
  });
  it('bounds full-file caching instead of retaining every opened repository blob indefinitely', async () => {
    const calls = fake(Array.from({ length: 34 }, () => ({ data: blob('text') })));
    const api = new GitHub('test-only-token');
    for (let index = 0; index < 33; index++) await api.textFile('acme/app', `file-${index}.ts`, base);
    await api.textFile('acme/app', 'file-32.ts', base);
    assert.equal(calls.length, 33);
    await api.textFile('acme/app', 'file-0.ts', base);
    assert.equal(calls.length, 34);
  });
  it('refuses invalid paths, mutable refs, large/binary/invalid UTF-8 blobs and symlinks', async () => {
    const calls = fake([
      { data: { ...blob('large'), size: 2_000_000 } },
      { data: blob('a\0b') },
      { data: { ...blob('x'), content: '/w==' } },
      { data: { ...blob('x'), type: 'symlink' } },
    ]);
    const api = new GitHub('test-only-token');
    for (const path of ['../secret', 'a/./b', '/a', 'a\\b'])
      await assert.rejects(api.textFile('acme/app', path, base), /Invalid immutable/);
    await assert.rejects(api.textFile('acme/app', 'a.ts', 'main'), /Invalid immutable/);
    assert.equal(calls.length, 0);
    await assert.rejects(api.textFile('acme/app', 'a.ts', base), /1 MiB/);
    await assert.rejects(api.textFile('acme/app', 'a.ts', base), /binary/);
    await assert.rejects(api.textFile('acme/app', 'a.ts', base), /UTF-8/);
    await assert.rejects(api.textFile('acme/app', 'a.ts', base), /UTF-8/);
  });
  for (const [kind, subject, path] of [
    ['issue comment', { id: 5 }, '/repos/acme/app/issues/comments/5/reactions'],
    ['review comment', { id: 6, path: 'src/a.ts' }, '/repos/acme/app/pulls/comments/6/reactions'],
  ] as const)
    it(`loads ${kind} reactions over REST and finds the viewer's own reaction IDs`, async () => {
      const calls = fake([
        {
          data: [
            { id: 70, content: '+1', user: { id: 1 } },
            { id: 71, content: '+1', user: { id: 2 } },
            { id: 72, content: 'heart', user: { id: 2 } },
          ],
        },
      ]);
      assert.deepEqual(await new GitHub('test-only-token').reactions(ref, subject, 1), {
        viewerCanReact: true,
        reactionGroups: [
          { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
          { content: 'HEART', viewerHasReacted: false, reactors: { totalCount: 1 } },
        ],
        mine: { THUMBS_UP: 70 },
      });
      assert.equal(new URL(calls[0].url).pathname, path);
    });
  it('adds and removes the viewer reaction over REST, then returns confirmed counts', async () => {
    const calls = fake([
      { status: 201, data: { id: 80, content: 'heart' } },
      { data: [{ id: 80, content: 'heart', user: { id: 1 } }] },
      { status: 204 },
      { data: [] },
    ]);
    const api = new GitHub('test-only-token');
    const added = await api.setReaction(ref, { id: 5 }, 'HEART', true, 1, { viewerCanReact: true, reactionGroups: [] });
    assert.deepEqual(added.mine, { HEART: 80 });
    assert.deepEqual((await api.setReaction(ref, { id: 5 }, 'HEART', false, 1, added)).reactionGroups, []);
    assert.deepEqual(
      calls.filter(call => (call.init.method ?? 'GET') === 'GET').map(call => call.init.cache),
      ['no-cache', 'no-cache'],
    );
    assert.deepEqual(
      calls.map(call => [call.init.method ?? 'GET', new URL(call.url).pathname, call.body]),
      [
        ['POST', '/repos/acme/app/issues/comments/5/reactions', { content: 'heart' }],
        ['GET', '/repos/acme/app/issues/comments/5/reactions', undefined],
        ['DELETE', '/repos/acme/app/issues/comments/5/reactions/80', undefined],
        ['GET', '/repos/acme/app/issues/comments/5/reactions', undefined],
      ],
    );
  });
  it('uses GraphQL only for review reactions, which REST does not expose', async () => {
    const result = {
      viewerCanReact: true,
      reactionGroups: [{ content: 'HEART' as const, viewerHasReacted: true, reactors: { totalCount: 2 } }],
    };
    const calls = fake([{ data: { data: { node: result } } }, { data: { data: { addReaction: { subject: result } } } }]);
    const api = new GitHub('test-only-token');
    const review = { id: 3, node_id: 'review-node', state: 'APPROVED' };
    assert.deepEqual(await api.reactions(ref, review, 1), result);
    assert.deepEqual(await api.setReaction(ref, review, 'HEART', true, 1, result), result);
    assert.deepEqual(calls[0].body?.variables, { id: 'review-node' });
    assert.deepEqual(calls[1].body?.variables, { input: { subjectId: 'review-node', content: 'HEART' } });
    assert.ok(calls.every(call => call.url === 'https://api.github.com/graphql'));
  });
  it('surfaces reaction errors and never treats unconfirmed mutations as saved', async () => {
    const calls = fake([
      { data: { errors: [{ message: 'Comment is locked' }] } },
      { data: { data: { node: null } } },
      { data: { data: { addReaction: { subject: null } } } },
      { status: 403, data: { message: 'Not authorized' } },
    ]);
    const api = new GitHub('test-only-token');
    const review = { id: 3, node_id: 'review-node', state: 'APPROVED' };
    const empty = { viewerCanReact: true, reactionGroups: [] };
    await assert.rejects(api.reactions(ref, review, 1), /locked/);
    await assert.rejects(api.reactions(ref, review, 1), /could not be loaded/);
    await assert.rejects(api.setReaction(ref, review, 'ROCKET', true, 1, empty), /did not confirm/);
    await assert.rejects(api.setReaction(ref, { id: 5 }, 'ROCKET', true, 1, empty), /Not authorized/);
    await assert.rejects(api.setReaction(ref, { id: 5 }, 'ROCKET', false, 1, empty), /reaction ID is unavailable/);
    assert.equal(calls.length, 4);
  });
  for (const status of [404, 500]) {
    it(`removing a reaction whose DELETE returns ${status} ${status === 404 ? 're-lists confirmed counts' : 'still throws'}`, async () => {
      const calls = fake([{ status, data: { message: 'Server broke' } }, { data: [] }]);
      const api = new GitHub('test-only-token');
      const removal = api.setReaction(ref, { id: 5 }, 'HEART', false, 1, {
        viewerCanReact: true,
        reactionGroups: [{ content: 'HEART', viewerHasReacted: true, reactors: { totalCount: 1 } }],
        mine: { HEART: 80 },
      });
      if (status === 404) assert.deepEqual((await removal).reactionGroups, []);
      else await assert.rejects(removal, /Server broke/);
      assert.deepEqual(
        calls.map(call => [call.init.method ?? 'GET', new URL(call.url).pathname]),
        status === 404
          ? [
              ['DELETE', '/repos/acme/app/issues/comments/5/reactions/80'],
              ['GET', '/repos/acme/app/issues/comments/5/reactions'],
            ]
          : [['DELETE', '/repos/acme/app/issues/comments/5/reactions/80']],
      );
    });
  }
});

describe('PR references and inbox queries', () => {
  it('accepts GitHub and DiffsHub references and strips suffixes', () => {
    for (const host of ['github.com', 'www.github.com', 'diffshub.com']) {
      assert.deepEqual(parsePRUrl(` https://${host}/acme/app/pull/42/files?x=1#diff `), ref);
    }
  });
  it('rejects non-HTTPS, lookalike domains, issue links and unsafe numbers', () => {
    for (const url of [
      'http://github.com/acme/app/pull/42',
      'https://github.com.attacker.test/acme/app/pull/42',
      'https://example.com/acme/app/pull/42',
      'https://github.com/acme/app/issues/42',
      'https://github.com/acme/app/pull/0',
      'https://github.com/acme/app/pull/999999999999999999999999',
      'not a URL',
    ]) {
      assert.throws(() => parsePRUrl(url));
    }
  });
  it('creates distinct review, authored, draft, reviewed and merged queries', () => {
    assert.match(inboxQuery('requested', 'me'), /is:open review-requested:me draft:false/);
    assert.match(inboxQuery('authored', 'me'), /author:me draft:false/);
    assert.match(inboxQuery('drafts', 'me'), /author:me draft:true/);
    assert.match(inboxQuery('reviewed', 'me'), /reviewed-by:me -author:me/);
    assert.doesNotMatch(inboxQuery('reviewed', 'me'), /\bdraft:/);
    assert.match(inboxQuery('merged', 'me'), /is:merged author:me/);
    assert.match(inboxQuery('requested', 'me', ['acme/app', 'acme/other']), /repo:acme\/app repo:acme\/other/);
  });
  for (const [name, repos, merged, expected] of [
    ['every merged PR in selected repositories', ['acme/app'], 'all', 'is:pr archived:false repo:acme/app is:merged'],
    ['only your merged PRs when no repository is selected', [], 'all', 'is:pr archived:false is:merged author:me'],
    ['your merged PRs', ['acme/app'], 'mine', 'is:pr archived:false repo:acme/app is:merged author:me'],
    [
      'PRs where you were asked or reviewed',
      [],
      'reviewing',
      'is:pr archived:false is:merged (review-requested:me OR reviewed-by:me) -author:me',
    ],
  ] as const)
    it(`builds the merged query for ${name}`, () => {
      assert.equal(inboxQuery('merged', 'me', [...repos], merged), expected);
    });
  for (const [merged, advanced] of [
    ['reviewing', true],
    ['mine', false],
    ['all', false],
  ] as const)
    it(`requests advanced search only for the ${merged} merged filter`, async () => {
      const calls = fake([{ data: { items: [], total_count: 0, incomplete_results: false } }]);
      await new GitHub('test-only-token').inbox('merged', 'me', ['acme/app'], 1, undefined, merged);
      assert.equal(new URL(calls[0].url).searchParams.has('advanced_search'), advanced);
    });
  it('links only branch matches in the correct repository, excluding itself', () => {
    const parent = { ...demoPR, id: 3, head: { ...demoPR.head, ref: demoPR.base.ref } };
    const child = { ...demoPR, id: 4, base: { ...demoPR.base, ref: demoPR.head.ref } };
    const unrelated = { ...parent, id: 5, head: { ...parent.head, repo: { id: 999, full_name: 'other/app' } } };
    const deletedFork = { ...child, id: 6, base: { ...child.base, repo: null } };
    assert.deepEqual(branchRelations(demoPR, [demoPR, parent, child, unrelated, deletedFork]), { parents: [parent], children: [child] });
  });
});

describe('review state, auto-merge and merge settings', () => {
  const me = { id: 1, login: 'me', type: 'User' };
  const review = (state: string, login: string, type = 'User') => ({ state, author: { __typename: type, login } });
  const summary = (
    reviewDecision: ReviewSummary['reviewDecision'],
    latestReviews: ReviewSummary['latestReviews'] = [],
    requested: string[] = [],
  ) => ({ reviewDecision, latestReviews, requested }) satisfies ReviewSummary;
  const pullRequest = (mergeable_state: PullRequest['mergeable_state']): PullRequest => ({
    ...demoPR,
    state: 'open',
    draft: false,
    mergeable_state,
  });
  const authoredItem = (number: number, repo = 'acme/app') => ({
    id: number,
    number,
    title: `PR ${number}`,
    html_url: '',
    repository_url: `https://api.github.com/repos/${repo}`,
    user: me,
    draft: false,
    state: 'open',
    updated_at: '',
    comments: 0,
    labels: [],
  });
  const reviewData = (decision: ReviewSummary['reviewDecision'], latestReviews: ReviewSummary['latestReviews'] = []) => ({
    createdAt: '2026-01-01T00:00:00Z',
    additions: 3,
    deletions: 1,
    reviewDecision: decision,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    participants: { totalCount: 0, nodes: [] },
    latestReviews: { nodes: latestReviews },
    reviewRequests: { nodes: [] },
  });

  for (const [name, input, expected] of [
    ['an approving decision', summary('APPROVED', [review('APPROVED', 'bob')]), 'approved'],
    ['a changes-requested decision', summary('CHANGES_REQUESTED'), 'returned'],
    ['a human comment that is not re-requested', summary('REVIEW_REQUIRED', [review('COMMENTED', 'bob')]), 'returned'],
    ['a human comment that was re-requested', summary('REVIEW_REQUIRED', [review('COMMENTED', 'bob')], ['bob']), 'waiting'],
    ['only bot comments', summary('REVIEW_REQUIRED', [review('COMMENTED', 'glean-pr-reviewer', 'Bot')]), 'waiting'],
    ["only the author's own comment", summary('REVIEW_REQUIRED', [review('COMMENTED', 'me')]), 'waiting'],
    ['an approval without a decision', summary(null, [review('APPROVED', 'bob')]), 'approved'],
    ['no reviews', summary(null), 'waiting'],
  ] as const)
    it(`classifies ${name} as ${expected}`, () => {
      assert.equal(classifyReview(input, 'me'), expected);
    });

  it('attaches review state to authored items from one batched GraphQL query', async () => {
    const calls = fake([
      { data: { items: [authoredItem(1), authoredItem(2, 'acme/other')], total_count: 2, incomplete_results: false } },
      {
        data: {
          data: {
            pr0: { pullRequest: reviewData('APPROVED') },
            pr1: { pullRequest: reviewData('REVIEW_REQUIRED', [review('COMMENTED', 'bob')]) },
          },
        },
      },
    ]);
    const result = await new GitHub('test-only-token').inbox('authored', 'me');
    assert.deepEqual(
      result.items.map(item => item.review),
      ['approved', 'returned'],
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body?.variables, {
      owner0: 'acme',
      name0: 'app',
      number0: 1,
      owner1: 'acme',
      name1: 'other',
      number1: 2,
    });
  });
  for (const group of ['authored', 'requested'] as const)
    it(`leaves ${group} items unenriched when the detail batch fails so the section still loads`, async () => {
      fake([
        { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
        { data: { errors: [{ message: 'Something went wrong' }] } },
      ]);
      const result = await new GitHub('test-only-token').inbox(group, 'me');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].review, undefined);
      assert.equal(result.items[0].details, undefined);
    });
  for (const [rollup, checks] of [
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['ERROR', 'failure'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
    [null, null],
  ] as const)
    it(`maps check rollup ${rollup} to ${checks}`, async () => {
      fake([
        { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
        {
          data: {
            data: {
              pr0: {
                pullRequest: {
                  ...reviewData(null),
                  commits: { nodes: [{ commit: { statusCheckRollup: rollup ? { state: rollup } : null } }] },
                },
              },
            },
          },
        },
      ]);
      const [item] = (await new GitHub('test-only-token').inbox('requested', 'me')).items;
      assert.equal(item.details?.checks, checks);
    });
  for (const [group, review] of [
    ['reviewed', undefined],
    ['authored', 'approved'],
  ] as const)
    it(`attaches details to ${group} items${review ? ' and classifies their review' : ' without review state'}`, async () => {
      fake([
        { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
        {
          data: {
            data: {
              pr0: {
                pullRequest: {
                  ...reviewData('APPROVED'),
                  additions: 7,
                  deletions: 2,
                  participants: {
                    totalCount: 3,
                    nodes: [
                      { login: 'me', avatarUrl: 'https://example.test/me' },
                      { login: 'bob', avatarUrl: 'https://example.test/bob' },
                    ],
                  },
                },
              },
            },
          },
        },
      ]);
      const [item] = (await new GitHub('test-only-token').inbox(group, 'me')).items;
      assert.equal(item.review, review);
      assert.deepEqual(item.details?.participants, [{ login: 'bob', avatarUrl: 'https://example.test/bob' }]);
      assert.equal(item.details?.participantCount, 2);
      assert.deepEqual([item.details?.additions, item.details?.deletions], [7, 2]);
    });
  for (const [order, sort, direction] of [
    [{ sort: 'created', order: 'asc' }, 'created', 'asc'],
    [undefined, 'updated', 'desc'],
  ] as const)
    it(`requests ${sort} ${direction} search results${order ? '' : ' by default'}`, async () => {
      const calls = fake([{ data: { items: [], total_count: 0, incomplete_results: false } }]);
      await new GitHub('test-only-token').inbox('requested', 'me', [], 1, undefined, 'mine', order);
      const url = new URL(calls[0].url);
      assert.equal(url.searchParams.get('sort'), sort);
      assert.equal(url.searchParams.get('order'), direction);
    });

  const enabled = { data: { data: { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod: 'SQUASH' } } } } } };
  const cleanStatus = { data: { errors: [{ message: 'Pull request is in clean status' }] } };
  const merged = { data: { merged: true, message: 'Merged' } };
  for (const [name, state, autoMerge, responses, result, paths] of [
    ['merges a clean PR directly', 'clean', true, [merged], 'merged', ['PUT /repos/acme/app/pulls/42/merge']],
    ['queues auto-merge while mergeability is unknown', 'unknown', true, [enabled], 'queued', ['POST /graphql']],
    [
      'merges directly when GitHub says the PR is already clean',
      'unknown',
      true,
      [cleanStatus, merged],
      'merged',
      ['POST /graphql', 'PUT /repos/acme/app/pulls/42/merge'],
    ],
    ['merges directly without auto-merge enabled', 'blocked', false, [merged], 'merged', ['PUT /repos/acme/app/pulls/42/merge']],
  ] as const)
    it(`${name}`, async () => {
      const calls = fake([...responses]);
      const outcome = await new GitHub('test-only-token').mergeOrAutoMerge(ref, pullRequest(state), 'squash', autoMerge);
      assert.equal(outcome, result);
      assert.deepEqual(
        calls.map(call => `${call.init.method ?? 'GET'} ${new URL(call.url).pathname}`),
        paths,
      );
    });

  it('enables auto-merge with the chosen method pinned to the head commit', async () => {
    const calls = fake([enabled]);
    await new GitHub('test-only-token').mergeOrAutoMerge(ref, pullRequest('unknown'), 'squash', true);
    assert.match(String(calls[0].body?.query), /EnableAutoMerge/);
    assert.deepEqual(calls[0].body?.variables, { input: { pullRequestId: 'demo-pr', mergeMethod: 'SQUASH', expectedHeadOid: sha } });
  });
  it('disables auto-merge and requires GitHub to confirm it was cleared', async () => {
    const calls = fake([{ data: { data: { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } } } }]);
    await new GitHub('test-only-token').setAutoMerge(pullRequest('clean'), null);
    assert.match(String(calls[0].body?.query), /DisableAutoMerge/);
    assert.deepEqual(calls[0].body?.variables, { input: { pullRequestId: 'demo-pr' } });
  });
  for (const [allowed, autoMerge] of [
    [true, true],
    [undefined, false],
  ] as const)
    it(`reads merge methods and auto-merge support (allow_auto_merge ${allowed ? 'true' : 'absent'}) from one repository request`, async () => {
      const calls = fake([
        { data: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true, allow_auto_merge: allowed } },
      ]);
      assert.deepEqual(await new GitHub('test-only-token').mergeSettings(ref), { methods: ['squash', 'rebase'], autoMerge });
      assert.equal(calls.length, 1);
    });
});

describe('GitHub authentication and safe requests', () => {
  it('sends auth only to GitHub, omits cookies, and refuses redirects', async () => {
    const calls = fake([{ data: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, read:org' } }]);
    const info = await new GitHub('test-only-token').validate();
    assert.equal(info.user.login, 'me');
    assert.deepEqual(info.scopes, ['repo', 'read:org']);
    assert.equal(calls[0].url, 'https://api.github.com/user');
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer test-only-token');
  });
  for (const [name, api, cache] of [
    ['a default client', () => new GitHub('test-only-token'), 'default'],
    ['a fresh client', () => new GitHub('test-only-token').fresh(), 'no-cache'],
  ] as const)
    it(`reads through ${name} with the ${cache} HTTP cache mode`, async () => {
      const calls = fake([{ data: demoPR }]);
      await api().pullRequest(ref);
      assert.equal(calls[0].init.cache, cache);
    });
  it('memoises the fresh client and reuses it for fresh reads', () => {
    const client = new GitHub('test-only-token');
    assert.equal(client.fresh(), client.fresh());
    assert.notEqual(client.fresh(), client);
    assert.equal(client.fresh().fresh(), client.fresh());
  });
  it('reads the PR head fresh before a write that depends on it', async () => {
    const calls = fake([{ data: demoPR }, { data: pending }]);
    await new GitHub('test-only-token').startReview(ref, sha);
    assert.equal(calls[0].init.method, undefined);
    assert.equal(calls[0].init.cache, 'no-cache');
    assert.equal(new URL(calls[0].url).pathname, '/repos/acme/app/pulls/42');
  });
  it('rejects URL paths that could escape the API origin', async () => {
    const calls = fake([]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.request('//evil.test/user'), /Invalid/);
    await assert.rejects(api.request('https://evil.test/user'), /Invalid/);
    assert.equal(calls.length, 0);
  });
  it('rejects classic tokens without repository scope', async () => {
    fake([{ data: { login: 'me' }, headers: { 'x-oauth-scopes': 'read:user' } }]);
    await assert.rejects(new GitHub('ghp_test').validate(), /repo or public_repo scope/);
  });
  for (const [name, token, headers, fineGrained, scopes] of [
    ['accepts public-repository scope', 'ghp_test', { 'x-oauth-scopes': 'public_repo' }, false, ['public_repo']],
    ['identifies fine-grained tokens without claiming their grants are verified', 'github_pat_test', undefined, true, []],
  ] as const) {
    it(name, async () => {
      fake([{ data: { login: 'me' }, headers }]);
      const info = await new GitHub(token).validate();
      assert.deepEqual([info.fineGrained, info.scopes], [fineGrained, scopes]);
    });
  }
  for (const [name, response, message] of [
    ['invalid tokens', { status: 401, data: { message: 'Bad credentials' } }, /invalid or expired/],
    [
      'SSO',
      { status: 403, data: { message: 'Forbidden' }, headers: { 'x-github-sso': 'required; url=https://github.com' } },
      /SSO authorization/,
    ],
    ['permission failures', { status: 403, data: { message: 'Resource not accessible by personal access token' } }, /Pull requests: write/],
    ['missing resources', { status: 404, data: {} }, /not found/],
    [
      'rate limits',
      { status: 403, data: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } },
      /rate limit reached/,
    ],
    [
      'validation details',
      { status: 422, data: { message: 'Validation failed', errors: [{ message: 'Line is outside the diff' }] } },
      /Line is outside the diff/,
    ],
  ] as const) {
    it(`explains ${name}`, async () => {
      fake([response]);
      await assert.rejects(new GitHub('test-only-token').request('/user'), message);
    });
  }
});

describe('GitHub data loading', () => {
  it('paginates using Link headers without following arbitrary Link URLs', async () => {
    const calls = fake([{ data: [1], headers: { link: '<https://evil.test/ignored>; rel="next"' } }, { data: [2] }]);
    assert.deepEqual(await new GitHub('test-only-token').pages('/items'), { items: [1, 2], truncated: false });
    assert.equal(calls[1].url, 'https://api.github.com/items?per_page=100&page=2');
  });
  it('reports pagination truncation and preserves existing query parameters', async () => {
    const calls = fake([{ data: [1], headers: { link: '<next>; rel="next"' } }]);
    assert.deepEqual(await new GitHub('test-only-token').pages('/items?state=open', undefined, 1), { items: [1], truncated: true });
    assert.match(calls[0].url, /\?state=open&per_page/);
  });
  it('encodes inbox searches and pages', async () => {
    const calls = fake([{ data: { items: [], total_count: 0, incomplete_results: false } }]);
    await new GitHub('test-only-token').inbox('requested', 'me', ['acme/app'], 2);
    const url = new URL(calls[0].url);
    assert.match(url.searchParams.get('q')!, /review-requested:me/);
    assert.match(url.searchParams.get('q')!, /\bdraft:false\b/);
    assert.equal(url.searchParams.get('page'), '2');
  });
  it('keeps draft PRs eligible for Reviewed by you', async () => {
    const draft = { ...demoInbox.requested[0], draft: true };
    const calls = fake([{ data: { items: [draft], total_count: 1, incomplete_results: false } }]);
    const result = await new GitHub('test-only-token').inbox('reviewed', 'me');
    assert.deepEqual(result.items, [draft]);
    assert.equal(result.total_count, 1);
    const query = new URL(calls[0].url).searchParams.get('q')!;
    assert.match(query, /reviewed-by:me/);
    assert.doesNotMatch(query, /\bdraft:/);
  });
  it('returns native stack entries in position order, noting truncation', async () => {
    fake([
      {
        data: {
          data: {
            repository: {
              pullRequest: {
                stack: {
                  number: 5,
                  size: 120,
                  entries: {
                    nodes: [
                      { position: 2, pullRequest: { number: 43 } },
                      { position: 1, pullRequest: { number: 42 } },
                      { position: 3, pullRequest: null },
                    ],
                    pageInfo: { hasNextPage: true },
                  },
                },
              },
            },
          },
        },
      },
    ]);
    const stack = await new GitHub('test-only-token').stack(ref);
    assert.deepEqual(
      stack?.entries.map(entry => entry.number),
      [42, 43],
    );
    assert.equal(stack?.truncated, true);
  });
  it('returns no stack for a normal PR and surfaces GraphQL errors for fallback', async () => {
    fake([{ data: { data: { repository: { pullRequest: { stack: null } } } } }, { data: { errors: [{ message: 'Field unavailable' }] } }]);
    const api = new GitHub('test-only-token');
    assert.equal(await api.stack(ref), undefined);
    await assert.rejects(api.stack(ref), /Field unavailable/);
  });
  it('sorts checks by state with skipped ones last and cancelled apart from failures', async () => {
    const run = (id: number, conclusion: string | null) => ({
      id,
      name: `job ${id}`,
      status: conclusion ? 'completed' : 'in_progress',
      conclusion,
      html_url: null,
    });
    fake([
      {
        data: {
          check_runs: [
            run(1, 'skipped'),
            run(2, 'success'),
            run(3, null),
            run(4, 'failure'),
            run(5, 'neutral'),
            run(6, 'cancelled'),
            run(7, 'timed_out'),
          ],
        },
      },
      { data: { statuses: [] } },
      { data: { workflow_runs: [] } },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.deepEqual(
      checks.map(check => check.state),
      ['failure', 'failure', 'cancelled', 'pending', 'neutral', 'success', 'skipped'],
    );
  });
  it('re-runs failed and cancelled jobs for "Re-run failed checks"', async () => {
    const calls = fake([
      { status: 201, data: {} },
      { status: 201, data: {} },
    ]);
    const job = (run: number, state: StatusCheck['state']): StatusCheck => ({
      id: `run-${run}`,
      name: `job ${run}`,
      state,
      url: '',
      job: { id: run, run },
    });
    const checks = [job(10, 'failure'), job(11, 'cancelled'), job(12, 'success')];
    assert.equal(await new GitHub('test-only-token').rerunChecks(ref, checks, true), 2);
    assert.deepEqual(calls.map(call => new URL(call.url).pathname).sort(), [
      '/repos/acme/app/actions/runs/10/rerun-failed-jobs',
      '/repos/acme/app/actions/runs/11/rerun-failed-jobs',
    ]);
  });
  it('keeps the highest check run id per workflow job, even when a queued or re-run attempt has no start time', async () => {
    fake([
      {
        data: {
          check_runs: [
            checkRun(11, 'analyze', 1),
            checkRun(12, 'analyze', 2),
            { ...checkRun(13, 'analyze', 3), conclusion: 'failure', started_at: null },
            checkRun(14, 'lint', 4),
            { ...checkRun(15, 'lint', 5), status: 'queued', conclusion: null, started_at: null },
          ],
        },
      },
      { data: { statuses: [] } },
      {
        data: {
          workflow_runs: [
            workflowRun(900, 'CI', 10, 1),
            workflowRun(901, 'CI', 10, 2),
            workflowRun(899, 'CI', 10, 3),
            workflowRun(902, 'CI', 10, 4),
            workflowRun(903, 'CI', 10, 5),
          ],
        },
      },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.deepEqual(
      checks.map(check => [check.id, check.name, check.state]),
      [
        ['run-13', 'CI / analyze', 'failure'],
        ['run-15', 'CI / lint', 'pending'],
      ],
    );
  });
  it('keeps same-named jobs from different workflows apart, labelled by workflow', async () => {
    fake([
      {
        data: {
          check_runs: [checkRun(21, 'check', 1), checkRun(22, 'check', 2)],
        },
      },
      { data: { statuses: [] } },
      { data: { workflow_runs: [workflowRun(800, 'CI', 10, 1), workflowRun(801, 'Release', 20, 2)] } },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.deepEqual(
      checks.map(check => check.name),
      ['CI / check', 'Release / check'],
    );
  });
  it('dedupes check runs without a workflow by app and name', async () => {
    fake([
      {
        data: {
          check_runs: [checkRun(31, 'deploy', 5, 99), checkRun(32, 'deploy', 6, 99), checkRun(33, 'deploy', 7, 88)],
        },
      },
      { data: { statuses: [] } },
      { data: { workflow_runs: [] } },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.deepEqual(
      checks.map(check => [check.id, check.name]),
      [
        ['run-32', 'deploy'],
        ['run-33', 'deploy'],
      ],
    );
  });
  it('follows check-run pagination past the first 100 runs', async () => {
    const batch = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => checkRun(start + index, `job ${start + index}`, 1));
    const calls = fake([
      { headers: { link: '<https://api.github.com/x?page=2>; rel="next"' }, data: { check_runs: batch(1, 100) } },
      { data: { statuses: [] } },
      { data: { workflow_runs: [] } },
      { data: { check_runs: batch(101, 1) } },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.equal(checks.length, 101);
    assert.deepEqual(
      calls.filter(call => call.url.includes('/check-runs')).map(call => new URL(call.url).searchParams.get('page')),
      ['1', '2'],
    );
  });
  it('falls back to app and name dedupe with plain names when the Actions run lookup fails', async () => {
    fake([
      {
        data: {
          check_runs: [checkRun(41, 'lint', 1), checkRun(42, 'lint', 2)],
        },
      },
      { data: { statuses: [] } },
      { status: 403, data: { message: 'Resource not accessible by integration' } },
    ]);
    const checks = await new GitHub('test-only-token').checks(ref, sha);
    assert.deepEqual(
      checks.map(check => [check.id, check.name]),
      [['run-42', 'lint']],
    );
  });
  it('keeps a workspace usable when conversation or stack data fails', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/files')) return Response.json([]);
      if (url.pathname.endsWith('/pulls/42')) return Response.json({ ...demoPR, changed_files: 2 });
      if (url.pathname.endsWith('/reviews')) return new Response('{}', { status: 403 });
      if (url.pathname === '/graphql') return Response.json({ errors: [{ message: 'Unknown stack field' }] });
      return Response.json([]);
    });
    const updates: string[][] = [];
    const result = await new GitHub('test-only-token').workspace(ref, undefined, update => updates.push(update.pending));
    assert.equal(updates[0].length, workspaceSections.length);
    assert.deepEqual(updates.at(-1), []);
    assert.equal(updates.length, workspaceSections.length + 1);
    assert.equal(result.reviewsLoaded, false);
    assert.ok(result.warnings.some(warning => warning.includes('incomplete file list')));
    assert.ok(result.warnings.some(warning => warning.includes('Reviews could not')));
    assert.ok(result.warnings.some(warning => warning.includes('branch-based dependencies')));
  });
});

describe('GitHub review actions (mocked; no real writes)', () => {
  it('paginates thread status and associates GraphQL threads with REST root comments', async () => {
    const connection = (id: string, root: number | null, more: boolean, cursor: string) => ({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { id, isResolved: false, viewerCanResolve: true, viewerCanUnresolve: false, comments: { nodes: [{ databaseId: root }] } },
              ],
              pageInfo: { hasNextPage: more, endCursor: cursor },
            },
          },
        },
      },
    });
    const calls = fake([{ data: connection('thread-1', 21, true, 'next') }, { data: connection('thread-2', null, false, 'done') }]);
    const result = await new GitHub('test-only-token').reviewThreads(ref);
    assert.deepEqual(result, {
      items: [{ id: 'thread-1', rootCommentId: 21, resolved: false, canResolve: true, canUnresolve: false }],
      truncated: false,
    });
    assert.deepEqual(calls[1].body?.variables, { ...ref, cursor: 'next' });
    assert.match(String(calls[0].body?.query), /comments\(first: 1\)/);
  });
  it('surfaces missing thread data, GraphQL errors and broken pagination instead of inventing status', async () => {
    fake([
      { data: { errors: [{ message: 'Permission denied' }] } },
      { data: { data: {} } },
      {
        data: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } } } },
      },
    ]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.reviewThreads(ref), /Permission denied/);
    await assert.rejects(api.reviewThreads(ref), /did not return thread status/);
    await assert.rejects(api.reviewThreads(ref), /invalid thread pagination cursor/);
  });
  it('resolves and reopens threads using the actual GraphQL thread ID and confirmed state', async () => {
    const state = (resolved: boolean) => ({
      id: 'thread-1',
      isResolved: resolved,
      viewerCanResolve: !resolved,
      viewerCanUnresolve: resolved,
    });
    const calls = fake([
      { data: { data: { resolveReviewThread: { thread: state(true) } } } },
      { data: { data: { unresolveReviewThread: { thread: state(false) } } } },
    ]);
    const api = new GitHub('test-only-token');
    assert.deepEqual(await api.setThreadResolved('thread-1', true), {
      id: 'thread-1',
      resolved: true,
      canResolve: false,
      canUnresolve: true,
    });
    assert.match(String(calls[0].body?.query), /resolveReviewThread\(input/);
    assert.deepEqual(calls[0].body?.variables, { input: { threadId: 'thread-1' } });
    assert.equal((await api.setThreadResolved('thread-1', false)).resolved, false);
    assert.match(String(calls[1].body?.query), /UnresolveReviewThreadInput/);
  });
  it('does not retry resolution failures or accept unconfirmed thread updates', async () => {
    const calls = fake([
      { data: { errors: [{ message: 'Not allowed' }] } },
      { data: { data: { resolveReviewThread: { thread: null } } } },
      { data: { data: { resolveReviewThread: { thread: { id: 'other-thread', isResolved: true } } } } },
    ]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.setThreadResolved('thread-1', true), /Not allowed/);
    await assert.rejects(api.setThreadResolved('thread-1', true), /did not confirm/);
    await assert.rejects(api.setThreadResolved('thread-1', true), /did not confirm/);
    assert.equal(calls.length, 3);
  });
  it('creates a pending review without an event', async () => {
    const calls = fake([{ data: demoPR }, { data: pending }]);
    assert.equal((await new GitHub('test-only-token').startReview(ref, sha)).id, 7);
    assert.deepEqual(calls[1].body, { commit_id: sha });
    assert.equal(calls[1].init.method, 'POST');
  });
  it('blocks writes when the diff head is stale', async () => {
    const calls = fake([{ data: { ...demoPR, head: { ...demoPR.head, sha: 'new-sha' } } }]);
    await assert.rejects(new GitHub('test-only-token').inlineComment(ref, sha, 'body', 'a.ts', 2, 'RIGHT'), /new commits/);
    assert.equal(calls.length, 1);
  });
  it('starts a review and saves its first inline comment atomically without publishing', async () => {
    const calls = fake([{ data: demoPR }, { data: pending }]);
    const input = { body: 'Please cover this case', path: 'src/a.ts', line: 11, side: 'LEFT' as const };
    const result = await new GitHub('test-only-token').startReview(ref, sha, input);
    assert.equal(result.state, 'PENDING');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body, { commit_id: sha, comments: [input] });
    assert.equal(Object.hasOwn(calls[1].body || {}, 'event'), false);
  });
  it('does not create a line-started review on an outdated diff or retry failed writes', async () => {
    const calls = fake([
      { data: { ...demoPR, head: { ...demoPR.head, sha: 'new-sha' } } },
      { data: demoPR },
      { status: 422, data: { message: 'A pending review already exists' } },
    ]);
    const api = new GitHub('test-only-token');
    const input = { body: 'Feedback', path: 'a.ts', line: 2, side: 'RIGHT' as const };
    await assert.rejects(api.startReview(ref, sha, input), /new commits/);
    assert.equal(calls.length, 1);
    await assert.rejects(api.startReview(ref, sha, input), /pending review already exists/);
    assert.equal(calls.length, 3);
  });
  it('adds pending inline comments with GraphQL rather than publishing them', async () => {
    const calls = fake([{ data: demoPR }, { data: { data: { addPullRequestReviewThread: { thread: { id: 'thread' } } } } }]);
    await new GitHub('test-only-token').inlineComment(ref, sha, 'feedback', 'a.ts', 9, 'LEFT', pending);
    assert.equal(calls[1].url, 'https://api.github.com/graphql');
    assert.deepEqual(calls[1].body?.variables, {
      input: { pullRequestReviewId: 'review-node', body: 'feedback', path: 'a.ts', line: 9, side: 'LEFT' },
    });
  });
  it('blocks inline comments on a stale pending review', async () => {
    const calls = fake([{ data: demoPR }]);
    await assert.rejects(
      new GitHub('test-only-token').inlineComment(ref, sha, 'feedback', 'a.ts', 9, 'RIGHT', { ...pending, commit_id: 'old' }),
      /older commit/,
    );
    assert.equal(calls.length, 1);
  });
  it('surfaces GraphQL mutation errors even with HTTP 200', async () => {
    fake([{ data: demoPR }, { data: { errors: [{ message: 'Insufficient permissions' }] } }]);
    await assert.rejects(
      new GitHub('test-only-token').inlineComment(ref, sha, 'body', 'a.ts', 2, 'RIGHT', pending),
      /Insufficient permissions/,
    );
  });
  it('publishes direct inline comments with commit, path, line and side', async () => {
    const calls = fake([{ data: demoPR }, { data: {} }]);
    await new GitHub('test-only-token').inlineComment(ref, sha, 'feedback', 'a.ts', 2, 'RIGHT');
    assert.deepEqual(calls[1].body, { body: 'feedback', path: 'a.ts', line: 2, side: 'RIGHT', commit_id: sha });
    assert.match(calls[1].url, /\/pulls\/42\/comments$/);
  });
  it('sends multi-line ranges to both direct and pending comment APIs', async () => {
    const calls = fake([
      { data: demoPR },
      { data: {} },
      { data: demoPR },
      { data: { data: { addPullRequestReviewThread: { thread: { id: 'thread' } } } } },
    ]);
    const api = new GitHub('test-only-token');
    await api.inlineComment(ref, sha, 'range', 'a.ts', 5, 'RIGHT', undefined, { line: 2, side: 'LEFT' });
    assert.deepEqual(calls[1].body, {
      body: 'range',
      path: 'a.ts',
      line: 5,
      side: 'RIGHT',
      start_line: 2,
      start_side: 'LEFT',
      commit_id: sha,
    });
    await api.inlineComment(ref, sha, 'range', 'a.ts', 5, 'RIGHT', pending, { line: 3, side: 'RIGHT' });
    assert.deepEqual(calls[3].body?.variables, {
      input: { pullRequestReviewId: 'review-node', body: 'range', path: 'a.ts', line: 5, side: 'RIGHT', startLine: 3, startSide: 'RIGHT' },
    });
  });
  it('posts PR conversation comments and thread replies to distinct endpoints', async () => {
    const calls = fake([{ data: {} }, { data: {} }]);
    const api = new GitHub('test-only-token');
    await api.comment(ref, 'conversation');
    await api.reply(ref, 8, 'reply');
    assert.match(calls[0].url, /\/issues\/42\/comments$/);
    assert.match(calls[1].url, /\/pulls\/42\/comments\/8\/replies$/);
    assert.deepEqual(calls[1].body, { body: 'reply' });
  });
  it('batches replies into the active review using its actual thread ID instead of publishing via REST', async () => {
    const reply = {
      databaseId: 90,
      body: 'Reply',
      createdAt: '2026-10-17T10:00:00Z',
      url: 'https://github.com/acme/app/pull/42#discussion_r90',
      path: 'src/a.ts',
      line: 10,
      author: { login: 'me', __typename: 'User', databaseId: 1 },
      pullRequestReview: { databaseId: pending.id },
    };
    const calls = fake([{ data: demoPR }, { data: { data: { addPullRequestReviewThreadReply: { comment: reply } } } }]);
    const result = await new GitHub('test-only-token').reply(ref, 8, 'Reply', pending, 'thread-node');
    assert.equal(result.in_reply_to_id, 8);
    assert.equal(result.pull_request_review_id, pending.id);
    assert.equal(result.user.id, 1);
    assert.equal(result.path, 'src/a.ts');
    assert.equal(result.line, 10);
    assert.deepEqual(calls[1].body?.variables, {
      input: { pullRequestReviewId: pending.node_id, pullRequestReviewThreadId: 'thread-node', body: 'Reply' },
    });
    assert.equal(calls[1].url, 'https://api.github.com/graphql');
    assert.equal(calls.length, 2);
  });
  it('does not publish or retry failed pending replies, or silently accept a reply in a different review', async () => {
    const calls = fake([
      { data: demoPR },
      { data: { errors: [{ message: 'Cannot add to this review' }] } },
      { data: demoPR },
      { data: { data: { addPullRequestReviewThreadReply: { comment: null } } } },
      { data: demoPR },
      { data: { data: { addPullRequestReviewThreadReply: { comment: { databaseId: 90, pullRequestReview: { databaseId: 999 } } } } } },
    ]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.reply(ref, 8, 'Reply', pending, 'thread'), /Cannot add/);
    await assert.rejects(api.reply(ref, 8, 'Reply', pending, 'thread'), /did not confirm/);
    await assert.rejects(api.reply(ref, 8, 'Reply', pending, 'thread'), /did not confirm/);
    assert.equal(calls.length, 6);
    assert.ok(calls.filter(call => call.init.method === 'POST').every(call => call.url.endsWith('/graphql')));
  });
  it('blocks pending replies without thread metadata or when the PR head changed', async () => {
    const calls = fake([{ data: { ...demoPR, head: { ...demoPR.head, sha: 'new-head' } } }]);
    const api = new GitHub('test-only-token');
    await assert.rejects(api.reply(ref, 8, 'Reply', pending), /Thread metadata/);
    assert.equal(calls.length, 0);
    await assert.rejects(api.reply(ref, 8, 'Reply', pending, 'thread'), /new commits/);
    assert.equal(calls.length, 1);
  });
  it('keeps a reply-started review, subsequent line comments, and submission in the same review', async () => {
    const reply = {
      databaseId: 90,
      body: 'Reply',
      createdAt: '',
      url: '',
      path: 'src/a.ts',
      line: 10,
      author: { login: 'me', __typename: 'User', databaseId: 1 },
      pullRequestReview: { databaseId: pending.id },
    };
    const calls = fake([
      { data: demoPR },
      { data: pending },
      { data: demoPR },
      { data: { data: { addPullRequestReviewThreadReply: { comment: reply } } } },
      { data: demoPR },
      { data: { data: { addPullRequestReviewThread: { thread: { id: 'new-thread' } } } } },
      { data: demoPR },
      { data: { ...pending, state: 'COMMENTED' } },
    ]);
    const api = new GitHub('test-only-token');
    const review = await api.startReview(ref, sha);
    await api.reply(ref, 8, 'Reply', review, 'thread');
    await api.inlineComment(ref, sha, 'Another comment', 'src/b.ts', 12, 'LEFT', review);
    await api.submitReview(ref, sha, 'COMMENT', 'Summary', review);
    assert.equal(
      (calls[3].body as { variables: { input: { pullRequestReviewId: string } } }).variables.input.pullRequestReviewId,
      review.node_id,
    );
    assert.equal(
      (calls[5].body as { variables: { input: { pullRequestReviewId: string } } }).variables.input.pullRequestReviewId,
      review.node_id,
    );
    assert.match(calls[7].url, /\/reviews\/7\/events$/);
    assert.deepEqual(calls[7].body, { event: 'COMMENT', body: 'Summary' });
    assert.equal(calls.filter(call => call.url.endsWith('/reviews') && call.init.method === 'POST').length, 1);
  });
  it('preserves actionable validation details returned as strings or field errors', async () => {
    fake([
      {
        status: 422,
        data: { message: 'Validation Failed', errors: ['A pending review already exists', { field: 'line', code: 'invalid' }] },
      },
    ]);
    await assert.rejects(new GitHub('test-only-token').reply(ref, 8, 'Reply'), /pending review already exists.*line: invalid/);
  });
  it('submits an existing pending review with the chosen event', async () => {
    const calls = fake([{ data: demoPR }, { data: { ...pending, state: 'APPROVED' } }]);
    await new GitHub('test-only-token').submitReview(ref, sha, 'APPROVE', 'Looks good', pending);
    assert.match(calls[1].url, /\/reviews\/7\/events$/);
    assert.deepEqual(calls[1].body, { event: 'APPROVE', body: 'Looks good' });
  });
  it('creates a standalone review with a commit and rejects closed PRs', async () => {
    const calls = fake([{ data: demoPR }, { data: {} }, { data: { ...demoPR, state: 'closed' } }]);
    const api = new GitHub('test-only-token');
    await api.submitReview(ref, sha, 'REQUEST_CHANGES', 'Please add tests');
    assert.deepEqual(calls[1].body, { event: 'REQUEST_CHANGES', body: 'Please add tests', commit_id: sha });
    await assert.rejects(api.submitReview(ref, sha, 'APPROVE', ''), /no longer open/);
    assert.equal(calls.length, 3);
  });
  for (const [name, ok] of [
    ['discardReview', 204],
    ['reviewExists', 200],
  ] as const) {
    it(`${name} reports true when GitHub answers, false for a 404, and rethrows other failures`, async () => {
      const calls = fake([{ status: ok, data: { id: 7 } }, { status: 404 }, { status: 500, data: { message: 'Server broke' } }]);
      const api = new GitHub('test-only-token');
      assert.equal(await api[name](ref, 7), true);
      assert.equal(await api[name](ref, 7), false);
      await assert.rejects(api[name](ref, 7), /Server broke/);
      assert.deepEqual(
        calls.map(call => [call.init.method ?? 'GET', new URL(call.url).pathname]),
        Array(3).fill([name === 'discardReview' ? 'DELETE' : 'GET', '/repos/acme/app/pulls/42/reviews/7']),
      );
    });
  }
  for (const pendingComment of [true, false]) {
    it(`edits and deletes ${pendingComment ? 'pending' : 'published'} comments ${pendingComment ? 'only through GraphQL' : 'over REST'}`, async () => {
      const calls = fake(
        pendingComment
          ? [
              {
                data: { data: { updatePullRequestReviewComment: { pullRequestReviewComment: { id: 'comment-node', body: 'new body' } } } },
              },
              { data: { data: { deletePullRequestReviewComment: { clientMutationId: null } } } },
            ]
          : [{ data: { ...reviewComment, body: 'new body' } }, { status: 204 }],
      );
      const api = new GitHub('test-only-token');
      assert.equal((await api.editComment(ref, reviewComment, 'new body', pendingComment)).body, 'new body');
      await api.deleteComment(ref, reviewComment, pendingComment);
      assert.deepEqual(
        calls.map(call => [call.init.method ?? 'GET', new URL(call.url).pathname]),
        pendingComment
          ? [
              ['POST', '/graphql'],
              ['POST', '/graphql'],
            ]
          : [
              ['PATCH', '/repos/acme/app/pulls/comments/101'],
              ['DELETE', '/repos/acme/app/pulls/comments/101'],
            ],
      );
      if (pendingComment)
        assert.deepEqual(
          calls.map(call => call.body?.variables),
          [{ input: { pullRequestReviewCommentId: 'comment-node', body: 'new body' } }, { input: { id: 'comment-node' } }],
        );
    });
  }
  it('refuses pending comment writes without a GraphQL ID and rejects unconfirmed edits', async () => {
    const calls = fake([{ data: { data: { updatePullRequestReviewComment: { pullRequestReviewComment: null } } } }]);
    const api = new GitHub('test-only-token');
    const withoutId: Comment = { ...reviewComment, node_id: undefined };
    await assert.rejects(api.editComment(ref, withoutId, 'x', true), /Refresh this PR to load the GitHub comment ID/);
    await assert.rejects(api.deleteComment(ref, withoutId, true), /Refresh this PR to load the GitHub comment ID/);
    await assert.rejects(api.editComment(ref, reviewComment, 'x', true), /did not confirm the comment update/);
    assert.equal(calls.length, 1);
  });
});
