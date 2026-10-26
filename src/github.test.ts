import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHub,
  branchRelations,
  classifyReview,
  inboxQuery,
  parsePRUrl,
  prPath,
  workspaceSections,
  type Comment,
  type PullRequest,
  type Review,
  type ReviewSummary,
  type StatusCheck,
} from './github.ts';
import { demoPR } from './fixtures.ts';

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
  it('loads only files whose GitHub viewed state is VIEWED', async () => {
    const calls = fake([
      {
        data: {
          data: {
            repository: {
              pullRequest: {
                files: {
                  nodes: [
                    { path: 'src/viewed.ts', viewerViewedState: 'VIEWED' },
                    { path: 'src/dismissed.ts', viewerViewedState: 'DISMISSED' },
                    { path: 'src/unviewed.ts', viewerViewedState: 'UNVIEWED' },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        },
      },
    ]);
    assert.deepEqual(await new GitHub('test-only-token').viewedFiles(ref), { items: ['src/viewed.ts'], truncated: false });
    assert.match(String(calls[0].body?.query), /query ViewedFiles/);
    assert.deepEqual(calls[0].body?.variables, { ...ref, cursor: null });
  });
  it('marks multiple files with one aliased GraphQL mutation', async () => {
    const calls = fake([
      {
        data: {
          data: {
            f0: { pullRequest: { id: 'PR42' } },
            f1: { pullRequest: { id: 'PR42' } },
          },
        },
      },
    ]);
    await new GitHub('test-only-token').setFilesViewed('PR42', ['src/a.ts', 'src/b.ts'], true);
    assert.equal(calls.length, 1);
    assert.match(String(calls[0].body?.query), /MarkFilesAsViewed/);
    assert.match(String(calls[0].body?.query), /f0: markFileAsViewed/);
    assert.match(String(calls[0].body?.query), /f1: markFileAsViewed/);
    assert.deepEqual(calls[0].body?.variables, { pullRequestId: 'PR42', path0: 'src/a.ts', path1: 'src/b.ts' });
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
  it('maps a reference to the app route that parses back to it', () => {
    assert.equal(prPath(ref), '/acme/app/pull/42');
    assert.deepEqual(parsePRUrl(`https://github.com${prPath(ref)}`), ref);
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
  it('creates distinct direct request, team request, authored and draft queries', () => {
    assert.match(inboxQuery('requested', 'me'), /is:open user-review-requested:me draft:false/);
    assert.match(inboxQuery('team', 'me'), /is:open review-requested:me -user-review-requested:me draft:false/);
    assert.match(inboxQuery('authored', 'me'), /author:me draft:false/);
    assert.match(inboxQuery('drafts', 'me'), /author:me draft:true/);
    assert.match(inboxQuery('reviewed', 'me'), /is:open reviewed-by:me -author:me -review-requested:me$/);
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
      await new GitHub('test-only-token').inbox('merged', { login: 'me', repos: ['acme/app'], merged });
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
    commits: { nodes: [{ commit: { committedDate: '2026-01-01T00:00:00Z', statusCheckRollup: { state: 'SUCCESS' } } }] },
    readyEvents: { nodes: [] },
    pendingReviews: { nodes: [] },
    participants: { totalCount: 0, nodes: [] },
    latestReviews: { nodes: latestReviews },
    reviewRequests: { nodes: [] },
  });
  const stackResponse = (entries: unknown[] = []) => ({
    data: {
      data: {
        pr0: {
          pullRequest: {
            number: 1,
            stack: { entries: { nodes: entries } },
          },
        },
      },
    },
  });

  for (const [name, input, expected] of [
    ['an approving decision', summary('APPROVED', [review('APPROVED', 'bob')]), 'approved'],
    ['a changes-requested decision', summary('CHANGES_REQUESTED'), 'returned'],
    ['a human comment that is not re-requested', summary('REVIEW_REQUIRED', [review('COMMENTED', 'bob')]), 'waiting'],
    [
      'changes requested by a reviewer who was re-requested',
      summary('CHANGES_REQUESTED', [review('CHANGES_REQUESTED', 'bob')], ['bob']),
      'waiting',
    ],
    [
      'changes requested by a reviewer who was not re-requested',
      summary('CHANGES_REQUESTED', [review('CHANGES_REQUESTED', 'bob')]),
      'returned',
    ],
    ['a human comment that was re-requested', summary('REVIEW_REQUIRED', [review('COMMENTED', 'bob')], ['bob']), 'waiting'],
    ['only bot comments', summary('REVIEW_REQUIRED', [review('COMMENTED', 'glean-pr-reviewer', 'Bot')]), 'waiting'],
    ["only the author's own comment", summary('REVIEW_REQUIRED', [review('COMMENTED', 'me')]), 'waiting'],
    ['an approval without a decision', summary(null, [review('APPROVED', 'bob')]), 'approved'],
    ['no reviews', summary(null), 'waiting'],
  ] as const)
    it(`classifies ${name} as ${expected}`, () => {
      assert.equal(classifyReview(input, 'me'), expected);
    });

  for (const group of ['authored', 'requested'] as const)
    it(`leaves ${group} items unenriched when the detail batch fails so the section still loads`, async () => {
      fake([
        { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
        { data: { errors: [{ message: 'Something went wrong' }] } },
        stackResponse(),
      ]);
      const result = await new GitHub('test-only-token').inbox(group, { login: 'me' });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].review, undefined);
      assert.equal(result.items[0].details, undefined);
    });
  for (const failedQuery of ['InboxDetails', 'InboxStacks'] as const)
    it(`chunks 60 requested items into 25/25/10 and isolates a failed ${failedQuery} chunk`, async () => {
      const items = Array.from({ length: 60 }, (_, index) => authoredItem(index + 1));
      const chunks = [items.slice(0, 25), items.slice(25, 50), items.slice(50)];
      const details = (chunk: typeof items) => ({
        data: {
          data: Object.fromEntries(
            chunk.map((item, index) => [`pr${index}`, { pullRequest: { ...reviewData(null), additions: item.number } }]),
          ),
        },
      });
      const stacks = (chunk: typeof items) => ({
        data: {
          data: Object.fromEntries(
            chunk.map((item, index) => [
              `pr${index}`,
              {
                pullRequest: {
                  number: item.number,
                  stack: {
                    entries: {
                      nodes: [
                        { position: 1, pullRequest: { number: item.number + 1000, state: 'OPEN', isDraft: false } },
                        { position: 2, pullRequest: { number: item.number, state: 'OPEN', isDraft: false } },
                      ],
                    },
                  },
                },
              },
            ]),
          ),
        },
      });
      const failed = { data: { errors: [{ message: 'Resource limits for this query exceeded.' }] } };
      const calls = fake([
        { data: { items, total_count: items.length, incomplete_results: false } },
        ...chunks.map((chunk, index) => (failedQuery === 'InboxDetails' && index === 1 ? failed : details(chunk))),
        ...chunks.map((chunk, index) => (failedQuery === 'InboxStacks' && index === 1 ? failed : stacks(chunk))),
      ]);

      const { items: result } = await new GitHub('test-only-token').inbox('requested', { login: 'me' });
      const queries = calls.filter(call => call.url.endsWith('/graphql'));
      const detailQueries = queries.filter(call => String(call.body?.query).startsWith('query InboxDetails'));
      const stackQueries = queries.filter(call => String(call.body?.query).startsWith('query InboxStacks'));
      const aliases = (call: Call) => (String(call.body?.query).match(/\bpr\d+: repository\(/g) ?? []).length;

      assert.deepEqual(
        result.map(item => item.number),
        items.map(item => item.number),
      );
      assert.deepEqual(detailQueries.map(aliases), [25, 25, 10]);
      assert.deepEqual(stackQueries.map(aliases), [25, 25, 10]);
      assert.deepEqual(
        result.map(item => item.details?.additions),
        items.map((item, index) => (failedQuery === 'InboxDetails' && index >= 25 && index < 50 ? undefined : item.number)),
      );
      if (failedQuery === 'InboxStacks')
        assert.deepEqual(
          result.map(item => item.details?.priority.stackedReady),
          items.map((_, index) => (index >= 25 && index < 50 ? 0 : 1)),
        );
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
        stackResponse(),
      ]);
      const [item] = (await new GitHub('test-only-token').inbox('requested', { login: 'me' })).items;
      assert.equal(item.details?.checks, checks);
      assert.equal(item.details?.pendingComments, 0);
    });
  it('counts comments in the viewer-specific pending review from the same detail batch', async () => {
    const calls = fake([
      { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
      {
        data: {
          data: {
            pr0: {
              pullRequest: {
                ...reviewData(null),
                pendingReviews: { nodes: [{ comments: { totalCount: 3 } }] },
              },
            },
          },
        },
      },
      stackResponse(),
    ]);
    const [item] = (await new GitHub('test-only-token').inbox('requested', { login: 'me' })).items;
    assert.equal(item.details?.pendingComments, 3);
    assert.match(String(calls[1].body?.query), /pendingReviews:\s*reviews\(states: PENDING, first: 1\)/);
    assert.match(String(calls[2].body?.query), /stack \{ entries\(first: 100\)/);
    assert.match(String(calls[2].body?.query), /pullRequest \{ number state isDraft \}/);
  });
  it('uses the ready time, code-owner requests, and only ready non-draft stack entries for priority', async () => {
    const calls = fake([
      { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
      {
        data: {
          data: {
            pr0: {
              pullRequest: {
                ...reviewData(null),
                readyEvents: { nodes: [{ createdAt: '2026-01-02T00:00:00Z' }] },
                reviewRequests: {
                  nodes: [
                    { asCodeOwner: true, requestedReviewer: { __typename: 'User', login: 'me' } },
                    { asCodeOwner: false, requestedReviewer: { __typename: 'Team', slug: 'backend' } },
                  ],
                },
              },
            },
          },
        },
      },
      stackResponse([
        { position: 1, pullRequest: { number: 99, state: 'OPEN', isDraft: false } },
        { position: 2, pullRequest: { number: 98, state: 'OPEN', isDraft: true } },
        { position: 3, pullRequest: { number: 1, state: 'OPEN', isDraft: false } },
        { position: 4, pullRequest: { number: 2, state: 'OPEN', isDraft: false } },
        { position: 5, pullRequest: { number: 4, state: 'CLOSED', isDraft: false } },
      ]),
    ]);
    const [item] = (await new GitHub('test-only-token').inbox('requested', { login: 'me' })).items;
    assert.deepEqual(item.details?.priority, {
      waitStart: '2026-01-02T00:00:00Z',
      stackedReady: 1,
      codeOwner: true,
      checks: 'success',
    });
    assert.doesNotMatch(String(calls[1].body?.query), /\bstack\s*\{/);
    assert.match(String(calls[1].body?.query), /requestEvents: timelineItems\(itemTypes: \[REVIEW_REQUESTED_EVENT\]/);
    assert.match(String(calls[1].body?.query), /asCodeOwner/);
  });
  for (const [group, expected] of [
    ['requested', '2026-01-03T00:00:00Z'],
    ['team', '2026-01-04T00:00:00Z'],
  ] as const)
    it(`starts the ${group} wait at the latest request that still applies`, async () => {
      fake([
        { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
        {
          data: {
            data: {
              pr0: {
                pullRequest: {
                  ...reviewData(null),
                  readyEvents: { nodes: [{ createdAt: '2026-01-02T00:00:00Z' }] },
                  reviewRequests: {
                    nodes: [{ asCodeOwner: false, requestedReviewer: { __typename: 'Team', combinedSlug: 'acme/backend' } }],
                  },
                  requestEvents: {
                    nodes: [
                      { createdAt: '2026-01-01T00:00:00Z', requestedReviewer: { login: 'me' } },
                      { createdAt: '2026-01-03T00:00:00Z', requestedReviewer: { login: 'me' } },
                      { createdAt: '2026-01-04T00:00:00Z', requestedReviewer: { combinedSlug: 'acme/backend' } },
                      { createdAt: '2026-01-05T00:00:00Z', requestedReviewer: { combinedSlug: 'acme/removed' } },
                    ],
                  },
                },
              },
            },
          },
        },
        stackResponse(),
      ]);
      const [item] = (await new GitHub('test-only-token').inbox(group, { login: 'me' })).items;
      assert.equal(item.details?.priority.waitStart, expected);
    });
  it('falls back to createdAt without a ready event and treats stack query failures as zero points', async () => {
    const calls = fake([
      { data: { items: [authoredItem(1)], total_count: 1, incomplete_results: false } },
      { data: { data: { pr0: { pullRequest: reviewData(null) } } } },
      { data: { errors: [{ message: 'Stack is unavailable' }] } },
    ]);
    const [item] = (await new GitHub('test-only-token').inbox('requested', { login: 'me' })).items;
    assert.equal(item.details?.priority.waitStart, '2026-01-01T00:00:00Z');
    assert.equal(item.details?.priority.stackedReady, 0);
    assert.equal(calls.length, 3);
  });
  for (const [group, reviews] of [
    ['team', [undefined, undefined]],
    ['authored', ['approved', 'waiting']],
  ] as const)
    it(`attaches details to ${group} items from one batched GraphQL query${reviews[0] ? ' and classifies their review' : ' without review state'}`, async () => {
      const calls = fake([
        { data: { items: [authoredItem(1), authoredItem(2, 'acme/other')], total_count: 2, incomplete_results: false } },
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
              pr1: { pullRequest: reviewData('REVIEW_REQUIRED', [review('COMMENTED', 'bob')]) },
            },
          },
        },
      ]);
      const { items } = await new GitHub('test-only-token').inbox(group, { login: 'me' });
      assert.deepEqual(
        items.map(item => item.review),
        reviews,
      );
      // Team requests also fetch stack counts for priority.
      assert.equal(calls.length, group === 'team' ? 3 : 2);
      assert.deepEqual(calls[1].body?.variables, { owner0: 'acme', name0: 'app', number0: 1, owner1: 'acme', name1: 'other', number1: 2 });
      const [item] = items;
      assert.deepEqual(item.details?.participants, [{ login: 'bob', avatarUrl: 'https://example.test/bob' }]);
      assert.equal(item.details?.participantCount, 2);
      assert.deepEqual([item.details?.additions, item.details?.deletions], [7, 2]);
    });
  for (const [order, page, sort, direction] of [
    [{ sort: 'created', order: 'asc' }, 2, 'created', 'asc'],
    [undefined, 1, 'updated', 'desc'],
  ] as const)
    it(`encodes page ${page} of ${sort} ${direction} search results${order ? '' : ' by default'}`, async () => {
      const calls = fake([{ data: { items: [], total_count: 0, incomplete_results: false } }]);
      await new GitHub('test-only-token').inbox('requested', { login: 'me', repos: ['acme/app'], page, merged: 'mine', order });
      const url = new URL(calls[0].url);
      assert.equal(url.searchParams.get('q'), inboxQuery('requested', 'me', ['acme/app']));
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.equal(url.searchParams.get('page'), String(page));
      assert.equal(url.searchParams.get('sort'), sort);
      assert.equal(url.searchParams.get('order'), direction);
    });

  const enabled = { data: { data: { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod: 'SQUASH' } } } } } };
  for (const [name, method, response, mutation, input] of [
    [
      'enables auto-merge with the chosen method pinned to the head commit',
      'squash',
      enabled,
      'enablePullRequestAutoMerge',
      { pullRequestId: 'demo-pr', mergeMethod: 'SQUASH', expectedHeadOid: sha },
    ],
    [
      'disables auto-merge and requires GitHub to confirm it was cleared',
      null,
      { data: { data: { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } } } },
      'disablePullRequestAutoMerge',
      { pullRequestId: 'demo-pr' },
    ],
  ] as const)
    it(name, async () => {
      const calls = fake([response]);
      await new GitHub('test-only-token').setAutoMerge(pullRequest('unknown'), method);
      assert.match(String(calls[0].body?.query), new RegExp(`${mutation}\\(input`));
      assert.deepEqual(calls[0].body?.variables, { input });
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
  it('reads pending review comments without using the browser HTTP cache', async () => {
    const calls = fake([{ data: [reviewComment] }]);
    assert.deepEqual(await new GitHub('test-only-token').reviewComments(ref, pending.id), [reviewComment]);
    assert.equal(calls[0].init.cache, 'no-cache');
  });
  it('memoises the fresh client and reuses it for fresh reads', () => {
    const client = new GitHub('test-only-token');
    assert.equal(client.fresh(), client.fresh());
    assert.notEqual(client.fresh(), client);
    assert.equal(client.fresh().fresh(), client.fresh());
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
  it('splits the timeline into comments and line events and resolves the commit a force push replaced', async () => {
    const user = { id: 1, login: 'alice' };
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
      new URL(String(input)).pathname === '/graphql'
        ? Response.json({ data: { nodes: [{ id: 'FP1', beforeCommit: { oid: 'old' } }] } })
        : Response.json([
            { event: 'commented', id: 9, node_id: 'IC9', body: 'Hi', user, created_at: '2026-01-01T00:00:00Z' },
            { event: 'subscribed', actor: user, created_at: '2026-01-01T00:00:00Z' },
            {
              event: 'committed',
              sha: 'abc',
              html_url: 'https://github.com/o/r/commit/abc',
              message: 'Fix',
              author: { name: 'Al', date: '2026-01-02T00:00:00Z' },
            },
            { event: 'head_ref_force_pushed', node_id: 'FP1', actor: user, created_at: '2026-01-03T00:00:00Z', commit_id: 'new' },
          ]),
    );
    const { comments, timeline } = await new GitHub('test-only-token').timeline(ref);
    assert.deepEqual(
      comments.map(comment => [comment.id, comment.body]),
      [[9, 'Hi']],
    );
    assert.deepEqual(
      timeline.map(event => [event.event, event.id, event.created_at, event.before_commit_id ?? event.commit?.sha]),
      [
        ['committed', 'abc', '2026-01-02T00:00:00Z', 'abc'],
        ['head_ref_force_pushed', 'FP1', '2026-01-03T00:00:00Z', 'old'],
      ],
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
    let firstRefreshAutoMerge: boolean | undefined;
    await new GitHub('test-only-token').workspace(ref, undefined, update => (firstRefreshAutoMerge ??= update.autoMerge), {
      ...result,
      autoMerge: true,
      mergeMethods: ['squash'],
    });
    assert.equal(firstRefreshAutoMerge, true);
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
  const lineComment = { body: 'Please cover this case', path: 'src/a.ts', line: 11, side: 'LEFT' as const };
  for (const [name, comment] of [
    ['creates a pending review without an event', undefined],
    ['starts a review and saves its first inline comment atomically without publishing', lineComment],
  ] as const)
    it(`${name}, after reading the PR head fresh`, async () => {
      const calls = fake([{ data: demoPR }, { data: pending }]);
      const result = await new GitHub('test-only-token').startReview(ref, sha, comment);
      assert.deepEqual([result.id, result.state], [7, 'PENDING']);
      assert.deepEqual(
        calls.map(call => [call.init.method ?? 'GET', call.init.cache, new URL(call.url).pathname]),
        [
          ['GET', 'no-cache', '/repos/acme/app/pulls/42'],
          ['POST', 'default', '/repos/acme/app/pulls/42/reviews'],
        ],
      );
      assert.deepEqual(calls[1].body, { commit_id: sha, ...(comment ? { comments: [comment] } : {}) });
    });
  for (const [name, write] of [
    ['a direct inline comment', (api: GitHub) => api.inlineComment(ref, sha, { body: 'body', path: 'a.ts', line: 2, side: 'RIGHT' })],
    ['a line-started review', (api: GitHub) => api.startReview(ref, sha, lineComment)],
    ['a pending reply', (api: GitHub) => api.reply(ref, 8, 'Reply', pending, 'thread')],
    ['a review submission', (api: GitHub) => api.submitReview(ref, sha, 'APPROVE', '')],
  ] as const)
    it(`blocks ${name} when the diff head is stale`, async () => {
      const calls = fake([{ data: { ...demoPR, head: { ...demoPR.head, sha: 'new-sha' } } }]);
      await assert.rejects(write(new GitHub('test-only-token')), /new commits/);
      assert.equal(calls.length, 1);
    });
  it('does not retry a failed line-started review', async () => {
    const calls = fake([{ data: demoPR }, { status: 422, data: { message: 'A pending review already exists' } }]);
    await assert.rejects(new GitHub('test-only-token').startReview(ref, sha, lineComment), /pending review already exists/);
    assert.equal(calls.length, 2);
  });
  it('blocks inline comments on a stale pending review', async () => {
    const calls = fake([{ data: demoPR }]);
    await assert.rejects(
      new GitHub('test-only-token').inlineComment(
        ref,
        sha,
        { body: 'feedback', path: 'a.ts', line: 9, side: 'RIGHT' },
        { ...pending, commit_id: 'old' },
      ),
      /older commit/,
    );
    assert.equal(calls.length, 1);
  });
  it('surfaces GraphQL mutation errors even with HTTP 200', async () => {
    fake([{ data: demoPR }, { data: { errors: [{ message: 'Insufficient permissions' }] } }]);
    await assert.rejects(
      new GitHub('test-only-token').inlineComment(ref, sha, { body: 'body', path: 'a.ts', line: 2, side: 'RIGHT' }, pending),
      /Insufficient permissions/,
    );
  });
  const comment = { body: 'feedback', path: 'a.ts', line: 5, side: 'RIGHT' } as const;
  const range = { start_line: 2, start_side: 'LEFT' } as const;
  const thread = { data: { data: { addPullRequestReviewThread: { thread: { id: 'thread' } } } } };
  for (const [name, review, start, response, path, sent] of [
    [
      'publishes a direct comment with commit, path, line and side',
      undefined,
      undefined,
      { data: {} },
      '/repos/acme/app/pulls/42/comments',
      { ...comment, commit_id: sha },
    ],
    [
      'publishes a direct multi-line range',
      undefined,
      range,
      { data: {} },
      '/repos/acme/app/pulls/42/comments',
      { ...comment, start_line: 2, start_side: 'LEFT', commit_id: sha },
    ],
    [
      'adds a pending comment with GraphQL rather than publishing it',
      pending,
      undefined,
      thread,
      '/graphql',
      { input: { pullRequestReviewId: 'review-node', ...comment } },
    ],
    [
      'adds a pending multi-line range with GraphQL',
      pending,
      range,
      thread,
      '/graphql',
      { input: { pullRequestReviewId: 'review-node', ...comment, startLine: 2, startSide: 'LEFT' } },
    ],
  ] as const)
    it(name, async () => {
      const calls = fake([{ data: demoPR }, response]);
      await new GitHub('test-only-token').inlineComment(ref, sha, { ...comment, ...start }, review);
      assert.equal(new URL(calls[1].url).pathname, path);
      assert.deepEqual(review ? calls[1].body?.variables : calls[1].body, sent);
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
  it('blocks pending replies without thread metadata', async () => {
    const calls = fake([]);
    await assert.rejects(new GitHub('test-only-token').reply(ref, 8, 'Reply', pending), /Thread metadata/);
    assert.equal(calls.length, 0);
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
    await api.inlineComment(ref, sha, { body: 'Another comment', path: 'src/b.ts', line: 12, side: 'LEFT' }, review);
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
  it('loads the viewer’s teams and rejects reviewer removals that GitHub silently ignores', async () => {
    fake([
      { data: [{ slug: 'core', organization: { login: 'acme' } }] },
      { data: { ...demoPR, requested_reviewers: [{ id: 2, login: 'carol' }], requested_teams: [] } },
    ]);
    const api = new GitHub('test-only-token');
    assert.deepEqual(await api.userTeams(), ['acme/core']);
    await assert.rejects(api.requestReviewers(ref, ['carol'], true), /kept this reviewer/);
  });
});
