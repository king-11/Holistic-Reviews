import type { BrowserContext, Page } from '@playwright/test';
import type { ChangedFile, Comment, PullRequest, Review, ReviewThread } from '../src/github.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fixture payloads are untyped GitHub JSON.
type Payload = Record<string, any>;

const NOW = new Date('2026-10-17T12:00:00Z');
const at = '2026-10-17T11:00:00Z';
const sha = (char: string) => char.repeat(40);
const BASE = sha('a');
export const FIRST = sha('c');
export const HEAD = sha('b');
const repo = { id: 1, full_name: 'acme/app' };
const repoPath = `/repos/${repo.full_name}`;
const user = (id: number, login: string, type = 'User') => ({ id, login, type });
const viewer = user(700, 'reviewer');
const alice = user(701, 'alice'),
  bob = user(702, 'bob'),
  carol = user(703, 'carol'),
  bot = user(704, 'ci-helper[bot]', 'Bot');
// Answers the assignable and mentionable searches, which GitHub matches on login and name; dave is on no PR, so only a search finds him.
const directory = [
  ['alice', 'Alice Liddell'],
  ['bob', 'Bob Stone'],
  ['carol', 'Carol Jones'],
  ['dave', 'Dave Dunn'],
  ['reviewer', 'Rae Viewer'],
].map(([login, name]) => ({ login, name, avatarUrl: '' }));

const workerLines = 80;
const changedWorkerLines = [10, 60];
const numbered = (change: (line: number) => string) => Array.from({ length: workerLines }, (_, i) => change(i + 1)).join('\n') + '\n';
const oldWorker = numbered(line => `line ${line}`);
const newWorker = numbered(line => (changedWorkerLines.includes(line) ? `line ${line} changed` : `line ${line}`));
const hunk = (line: number) =>
  `@@ -${line - 3},7 +${line - 3},7 @@\n${[line - 3, line - 2, line - 1].map(n => ` line ${n}`).join('\n')}\n-line ${line}\n+line ${line} changed\n${[line + 1, line + 2, line + 3].map(n => ` line ${n}`).join('\n')}`;

const files: ChangedFile[] = [
  { filename: 'src/worker.py', status: 'modified', additions: 2, deletions: 2, changes: 4, patch: changedWorkerLines.map(hunk).join('\n') },
  {
    filename: 'src/api/Handler.java',
    status: 'added',
    additions: 5,
    deletions: 0,
    changes: 5,
    patch: '@@ -0,0 +1,5 @@\n+class Handler {\n+  void run() {\n+    start();\n+  }\n+}',
  },
  {
    filename: 'docs/guide.md',
    previous_filename: 'docs/old-guide.md',
    status: 'renamed',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1,3 +1,3 @@\n # Guide\n-Old text\n+New text\n end',
  },
  {
    filename: 'src/legacy.go',
    status: 'removed',
    additions: 0,
    deletions: 3,
    changes: 3,
    patch: '@@ -1,3 +0,0 @@\n-package legacy\n-\n-func Old() {}',
  },
  { filename: 'scripts/tool.unknownext', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ -1,2 +1,2 @@\n-a\n+b\n c' },
  { filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
];

const branch = (ref: string, head: string) => ({ ref, sha: head, repo });
const pr: PullRequest = {
  id: 9042,
  node_id: 'PR42',
  mergeable_state: 'clean',
  requested_reviewers: [carol],
  requested_teams: [{ slug: 'backend', name: 'Backend' }],
  labels: [{ name: 'retry', color: '0e8a16' }],
  number: 42,
  title: 'Improve worker retries',
  body: 'Adds worker retries :smile:\n\n- [ ] Top task\n  - [x] Nested done\n\n<details><summary>Rollout</summary>\n\nShip behind a flag.\n\n</details>',
  html_url: 'https://github.com/acme/app/pull/42',
  user: alice,
  state: 'open',
  draft: false,
  merged: false,
  created_at: at,
  updated_at: at,
  head: branch('alice/worker', HEAD),
  base: branch('alice/base', BASE),
  additions: 9,
  deletions: 7,
  changed_files: files.length,
  commits: 2,
  comments: 1,
};
const parent: PullRequest = {
  ...pr,
  id: 9041,
  node_id: 'PR41',
  number: 41,
  title: 'Prepare worker base',
  head: branch('alice/base', sha('d')),
  base: branch('main', sha('e')),
};
const child: PullRequest = {
  ...pr,
  id: 9043,
  node_id: 'PR43',
  number: 43,
  title: 'Use retries in scheduler',
  head: branch('alice/next', sha('f')),
  base: branch('alice/worker', HEAD),
};

const inline = (id: number, author: typeof alice, path: string, line: number, body: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  node_id: `C${id}`,
  user: author,
  body,
  path,
  line,
  side: 'RIGHT',
  created_at: at,
  html_url: `${pr.html_url}#discussion_r${id}`,
  ...extra,
});
const inbox = (
  number: number,
  title: string,
  {
    draft = false,
    repository = repo.full_name,
    author = alice,
    updatedAt = at,
  }: { draft?: boolean; repository?: string; author?: typeof alice; updatedAt?: string } = {},
) => ({
  id: number,
  number,
  title,
  user: author,
  html_url: `https://github.com/${repository}/pull/${number}`,
  repository_url: `https://api.github.com/repos/${repository}`,
  draft,
  state: 'open',
  created_at: at,
  updated_at: updatedAt,
  comments: 1,
  labels: [],
});
const inboxGroups: [RegExp, ReturnType<typeof inbox>[]][] = [
  [
    /is:open user-review-requested:/,
    [
      inbox(42, pr.title, { updatedAt: new Date(NOW.getTime() - 52 * 60_000).toISOString() }),
      inbox(77, 'Tune cache eviction', { updatedAt: new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString() }),
      inbox(88, 'Rotate infra credentials', { repository: 'acme/infra' }),
    ],
  ],
  [/author:\S+ draft:true/, [inbox(90, 'Sketch retry dashboard', { draft: true, author: viewer })]],
  [
    /author:\S+ draft:false/,
    [
      inbox(91, 'Speed up CI cache', { author: viewer }),
      inbox(94, 'Retry the sync backoff', { author: viewer }),
      inbox(95, 'Tighten cache keys', { author: viewer }),
      inbox(98, 'Fix flaky upload test', { author: viewer }),
      inbox(99, 'Bump the parser', { author: viewer }),
    ],
  ],
  [/-user-review-requested:/, [inbox(92, 'Document the cache layout')]],
  [/is:open reviewed-by:/, [inbox(100, 'Trim worker logs', { draft: true })]],
];

const reviewState = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' } as Record<string, string>;
const mergedByViewer = inbox(93, 'Ship metrics exporter', { author: viewer }),
  mergedForReview = inbox(96, 'Tune retry jitter');
// Review-requested is checked first because the reviewing query also contains -author:.
const mergedResults = (q: string) =>
  q.includes('review-requested:')
    ? [mergedForReview]
    : q.includes('author:')
      ? [mergedByViewer]
      : [mergedByViewer, mergedForReview, inbox(97, 'Clean up scheduler logs', { author: carol })];
const reviewer = (login: string) => ({ __typename: 'User', login });
const basePullRequest: Payload = {
  createdAt: at,
  additions: 4,
  deletions: 1,
  reviewDecision: null,
  commits: { nodes: [{ commit: { committedDate: at, statusCheckRollup: { state: 'SUCCESS' } } }] },
  readyEvents: { nodes: [{ createdAt: at }] },
  pendingReviews: { nodes: [] },
  participants: { totalCount: 0, nodes: [] },
  latestReviews: { nodes: [] },
  reviewRequests: { nodes: [] },
};
// #94 has changes requested, #98 failing checks and #99 a conflict, so they need attention; #95 is ready to merge.
const reviewSummaries: Record<number, Payload> = {
  42: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
    reviewRequests: {
      nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: 'Team', slug: 'backend' } }],
    },
  },
  90: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
  },
  91: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
  },
  92: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
    reviewRequests: { nodes: [{ asCodeOwner: false, requestedReviewer: { __typename: 'Team', combinedSlug: 'acme/backend' } }] },
  },
  93: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
  },
  77: {
    additions: 200,
    deletions: 20,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
    reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: 'Team', slug: 'backend' } }] },
  },
  88: {
    additions: 10,
    deletions: 1,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
    reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: 'Team', slug: 'backend' } }] },
  },
  94: {
    additions: 12,
    deletions: 3,
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
    reviewDecision: 'CHANGES_REQUESTED',
    participants: {
      totalCount: 2,
      nodes: [
        { login: 'bob', avatarUrl: '' },
        { login: 'carol', avatarUrl: '' },
      ],
    },
    latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED', submittedAt: NOW.toISOString(), author: reviewer('bob') }] },
  },
  98: { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } },
  99: {
    mergeable: 'CONFLICTING',
    reviewDecision: 'APPROVED',
    latestReviews: { nodes: [{ state: 'APPROVED', author: reviewer('bob') }] },
  },
  95: {
    pendingReviews: { nodes: [{ comments: { totalCount: 1 } }] },
    reviewDecision: 'APPROVED',
    latestReviews: { nodes: [{ state: 'APPROVED', author: reviewer('bob') }] },
  },
};
const reactionContents = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'];

// Pass the browser context instead of a page to also serve tabs the app opens.
export async function mockGitHub(
  page: Page | BrowserContext,
  options: {
    hold?: RegExp;
    write?: boolean;
    onBehalf?: boolean;
    emptyReviewDeletes?: boolean;
    prState?: 'merged' | 'closed';
    draftPR?: boolean;
    mergeStates?: PullRequest['mergeable_state'][];
    autoMergeClean?: boolean;
    signedOut?: boolean;
    approved?: boolean;
    blockedUntilApproved?: boolean;
    viewerRequested?: boolean;
    stalePendingReadAfterEdit?: boolean;
    ownPR?: boolean;
    requestedPRCount?: number;
    teamsDelayMs?: number;
    singleCheck?: boolean;
    viewed?: Record<string, 'VIEWED' | 'DISMISSED'>;
    viewedFails?: boolean;
  } = {},
) {
  const requestedPRCount = options.requestedPRCount ?? 3;
  const requestedItems = [
    ...inboxGroups[0][1],
    ...Array.from({ length: Math.max(0, requestedPRCount - inboxGroups[0][1].length) }, (_, index) =>
      inbox(1000 + index, `Requested change ${index + 1}`),
    ),
  ].slice(0, requestedPRCount);
  let release = () => {};
  const gate = new Promise<void>(resolve => (release = resolve));
  const state = {
    inline: [
      inline(101, alice, 'src/worker.py', 10, 'Please rename this :tada:'),
      inline(201, bob, 'src/api/Handler.java', 3, 'Looks resolved now', {
        pull_request_review_id: 502,
        diff_hunk: '@@ -1,3 +1,3 @@\n package api;\n class Handler {\n-  void old() {}\n+  void retry() {}',
      }),
      inline(301, bot, 'src/worker.py', 60, 'Automated lint warning'),
      inline(302, carol, 'src/worker.py', 60, 'Human reply to bot', { in_reply_to_id: 301 }),
    ] as Comment[],
    threads: [
      { id: 'T101', rootCommentId: 101, resolved: false },
      { id: 'T201', rootCommentId: 201, resolved: true },
      { id: 'T301', rootCommentId: 301, resolved: false },
    ] as Pick<ReviewThread, 'id' | 'rootCommentId' | 'resolved'>[],
    conversation: [{ id: 401, node_id: 'IC401', user: alice, body: 'Ready for review :rocket:', created_at: at }] as Comment[],
    reviews: [
      { id: 501, node_id: 'R501', user: alice, state: 'APPROVED', body: '', commit_id: HEAD, submitted_at: at },
      {
        id: 502,
        node_id: 'R502',
        user: bob,
        // Without the change request, alice's approval leaves the PR approved.
        state: options.approved ? 'COMMENTED' : 'CHANGES_REQUESTED',
        body: 'Please add retry tests.',
        commit_id: HEAD,
        submitted_at: at,
      },
    ] as Review[],
    reactions: new Map<string, Map<string, { count: number; viewer: boolean }>>(),
    restReactions: new Map<string, { id: number; content: string; user: typeof viewer }[]>(),
    writes: [] as { method: string; path: string; body: Record<string, unknown> | undefined; operation?: string }[],
    searches: [] as {
      q: string;
      advanced: boolean;
      sort: string | null;
      order: string | null;
      page: number;
      perPage: number;
    }[],
    peopleSearches: [] as { kind: string; query: string; first: number }[],
    userReads: [] as string[],
    nextId: 1000,
    prEdits: {} as Record<string, unknown>,
    prReads: 0,
    autoMerge: null as null | { merge_method: string; enabled_by: typeof viewer },
    stalePendingComment: null as null | { id: number; body: string },
    stalePendingReadArmed: false,
    stalePendingReadServed: false,
    stalePendingReadBody: null as null | string,
    viewedFiles: new Map<string, 'VIEWED' | 'DISMISSED' | 'UNVIEWED'>(
      Object.entries(options.viewed ?? {}).map(([path, viewed]) => [path, viewed]),
    ),
  };
  const reactionGroups = (id: string) =>
    reactionContents.map(content => {
      const group = state.reactions.get(id)?.get(content);
      return { content, viewerHasReacted: !!group?.viewer, reactors: { totalCount: group?.count || 0 } };
    });
  const threadNodes = () =>
    state.threads.map(thread => {
      const root = state.inline.find(comment => comment.id === thread.rootCommentId)!;
      return {
        id: thread.id,
        isResolved: thread.resolved,
        viewerCanResolve: !thread.resolved,
        viewerCanUnresolve: thread.resolved,
        path: root.path,
        line: root.line,
        diffSide: root.side,
        isOutdated: false,
        subjectType: 'LINE',
        comments: { nodes: [{ databaseId: root.id }] },
      };
    });
  const addInline = (fields: Partial<Comment> & { body: string; path: string }) => {
    const comment = { id: state.nextId++, user: viewer, created_at: NOW.toISOString(), side: 'RIGHT' as const, ...fields };
    comment.node_id = `C${comment.id}`;
    state.inline.push(comment);
    if (!comment.in_reply_to_id) state.threads.push({ id: `T${comment.id}`, rootCommentId: comment.id, resolved: false });
    return comment;
  };
  const inPendingReview = (comment: Comment) =>
    state.reviews.some(review => review.id === comment.pull_request_review_id && review.state === 'PENDING');
  const pendingComment = (nodeId: string) => {
    const comment = state.inline.find(comment => comment.node_id === nodeId);
    return comment && inPendingReview(comment) ? comment : undefined;
  };
  function graphql(query: string, variables: Payload) {
    const operation = query.match(/^(?:query|mutation) (\w+)/)?.[1];
    const input = variables.input || {};
    switch (operation) {
      case 'ForcePushes':
        return { nodes: [{ id: 'HRFPE1', beforeCommit: { oid: FIRST } }] };
      case 'ViewedFiles':
        return {
          repository: {
            pullRequest: {
              files: {
                nodes: files.map(file => ({ path: file.filename, viewerViewedState: state.viewedFiles.get(file.filename) || 'UNVIEWED' })),
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      case 'MarkFilesAsViewed':
      case 'UnmarkFilesAsViewed': {
        if (options.viewedFails) return { errors: [{ message: 'Viewed file update failed.' }] };
        const viewed = operation === 'MarkFilesAsViewed';
        return Object.fromEntries(
          Object.keys(variables)
            .filter(key => /^path\d+$/.test(key))
            .map(key => {
              state.viewedFiles.set(String(variables[key]), viewed ? 'VIEWED' : 'UNVIEWED');
              return [`f${key.slice('path'.length)}`, { pullRequest: { id: 'PR42' } }];
            }),
        );
      }
      case 'Development':
        return {
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: [{ number: 7, title: 'Workers drop retries', url: 'https://github.com/acme/app/issues/7', state: 'OPEN' }],
              },
              reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: { login: 'carol' } }] },
              latestReviews: {
                nodes: options.onBehalf ? [{ author: { login: 'alice' }, onBehalfOf: { nodes: [{ combinedSlug: 'acme/backend' }] } }] : [],
              },
            },
          },
        };
      case 'ConvertPullRequestToDraft':
      case 'MarkPullRequestReadyForReview': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        return { [name]: { pullRequest: { isDraft: name === 'convertPullRequestToDraft' } } };
      }
      case 'AssignableUsers':
      case 'MentionableUsers': {
        const query = variables.search.toLowerCase();
        state.peopleSearches.push({ kind: operation === 'AssignableUsers' ? 'assignable' : 'mentionable', query, first: variables.first });
        const nodes = directory.filter(person => `${person.login} ${person.name}`.toLowerCase().includes(query)).slice(0, variables.first);
        return { repository: { people: { nodes } } };
      }
      case 'ReviewStack':
        return { repository: { pullRequest: { stack: null } } };
      case 'ReviewThreads':
        return {
          repository: { pullRequest: { reviewThreads: { nodes: threadNodes(), pageInfo: { hasNextPage: false, endCursor: null } } } },
        };
      case 'CommentReactions':
        return { node: { viewerCanReact: true, reactionGroups: reactionGroups(variables.id) } };
      case 'AddReaction':
      case 'RemoveReaction': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        const groups = state.reactions.get(input.subjectId) || new Map();
        const group = groups.get(input.content) || { count: 0, viewer: false };
        const add = name === 'addReaction';
        if (group.viewer !== add) groups.set(input.content, { count: group.count + (add ? 1 : -1), viewer: add });
        state.reactions.set(input.subjectId, groups);
        return { [name]: { subject: { viewerCanReact: true, reactionGroups: reactionGroups(input.subjectId) } } };
      }
      case 'UpdatePullRequestReviewComment': {
        const comment = pendingComment(input.pullRequestReviewCommentId);
        if (!comment) return { updatePullRequestReviewComment: { pullRequestReviewComment: null } };
        if (options.stalePendingReadAfterEdit) state.stalePendingComment = { id: comment.id, body: comment.body };
        comment.body = input.body;
        return { updatePullRequestReviewComment: { pullRequestReviewComment: { id: comment.node_id, body: comment.body } } };
      }
      case 'DeletePullRequestReviewComment': {
        const comment = pendingComment(input.id)!;
        state.inline = state.inline.filter(other => other !== comment);
        const review = state.reviews.find(other => other.id === comment.pull_request_review_id)!;
        if (options.emptyReviewDeletes && !state.inline.some(other => other.pull_request_review_id === review.id))
          state.reviews = state.reviews.filter(other => other !== review);
        return { deletePullRequestReviewComment: { clientMutationId: null } };
      }
      case 'EnablePullRequestAutoMerge':
        if (options.autoMergeClean) return { errors: [{ message: 'Pull request is in clean status' }] };
        state.autoMerge = { merge_method: input.mergeMethod.toLowerCase(), enabled_by: viewer };
        return { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { mergeMethod: input.mergeMethod } } } };
      case 'DisablePullRequestAutoMerge':
        state.autoMerge = null;
        return { disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } } };
      case 'InboxDetails':
        return Object.fromEntries(
          Object.keys(variables)
            .filter(key => key.startsWith('number'))
            .map(key => [`pr${key.slice('number'.length)}`, { pullRequest: { ...basePullRequest, ...reviewSummaries[variables[key]] } }]),
        );
      case 'InboxStacks':
        return Object.fromEntries(
          Object.keys(variables)
            .filter(key => key.startsWith('number'))
            .map(key => {
              const number = variables[key];
              return [
                `pr${key.slice('number'.length)}`,
                {
                  pullRequest: {
                    number,
                    stack: {
                      entries: {
                        nodes: [
                          { position: 1, pullRequest: { number: number + 1, state: 'OPEN', isDraft: false } },
                          { position: 2, pullRequest: { number, state: 'OPEN', isDraft: false } },
                          { position: 3, pullRequest: { number: number + 2, state: 'OPEN', isDraft: true } },
                        ],
                      },
                    },
                  },
                },
              ];
            }),
        );
      case 'ResolveReviewThread':
      case 'UnresolveReviewThread': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        const thread = state.threads.find(thread => thread.id === input.threadId)!;
        thread.resolved = name === 'resolveReviewThread';
        return {
          [name]: {
            thread: { id: thread.id, isResolved: thread.resolved, viewerCanResolve: !thread.resolved, viewerCanUnresolve: thread.resolved },
          },
        };
      }
      case 'AddPullRequestReviewThread': {
        const review = state.reviews.find(review => review.node_id === input.pullRequestReviewId)!;
        const comment = addInline({
          body: input.body,
          path: input.path,
          line: input.line,
          side: input.side,
          start_line: input.startLine,
          start_side: input.startSide,
          pull_request_review_id: review.id,
        });
        return { addPullRequestReviewThread: { thread: { id: `T${comment.id}` } } };
      }
      case 'AddPullRequestReviewThreadReply': {
        const review = state.reviews.find(review => review.node_id === input.pullRequestReviewId)!;
        const root = state.inline.find(comment => `T${comment.id}` === input.pullRequestReviewThreadId)!;
        const reply = addInline({
          body: input.body,
          path: root.path!,
          line: root.line,
          in_reply_to_id: root.id,
          pull_request_review_id: review.id,
        });
        return {
          addPullRequestReviewThreadReply: {
            comment: {
              id: reply.node_id,
              databaseId: reply.id,
              body: reply.body,
              createdAt: reply.created_at,
              url: '',
              path: reply.path,
              line: reply.line,
              author: { login: viewer.login, __typename: 'User', databaseId: viewer.id },
              pullRequestReview: { databaseId: review.id },
            },
          },
        };
      }
    }
    throw new Error(`Unexpected GraphQL operation ${operation}`);
  }
  function rest(
    method: string,
    path: string,
    query: URLSearchParams,
    body: Payload | undefined,
  ): [number, unknown, Record<string, string>?] {
    const prPath = `${repoPath}/pulls/42`;
    const profile = path.match(/^\/users\/([^/]+)$/);
    if (profile) {
      state.userReads.push(profile[1]);
      const person = directory.find(person => person.login === profile[1]);
      return person ? [200, { login: person.login, name: person.name, avatar_url: '' }] : [404, { message: 'Not Found' }];
    }
    if (path === '/user') return [200, viewer, { 'access-control-expose-headers': 'X-OAuth-Scopes', 'x-oauth-scopes': 'repo, read:org' }];
    if (path === '/user/teams') return [200, [{ slug: 'backend', name: 'Backend', organization: { login: 'acme' } }]];
    if (path === '/search/issues') {
      const q = query.get('q') || '';
      // GitHub rejects OR outside advanced search.
      if (/\sOR\s/.test(q) && !query.has('advanced_search')) return [422, { message: 'Validation Failed' }];
      const page = Number(query.get('page') || 1);
      const perPage = Number(query.get('per_page') || Number.MAX_SAFE_INTEGER);
      state.searches.push({ q, advanced: query.has('advanced_search'), sort: query.get('sort'), order: query.get('order'), page, perPage });
      const repos = [...q.matchAll(/repo:(\S+)/g)].map(match => match[1]);
      const found = q.includes('is:merged')
        ? mergedResults(q)
        : q.includes('is:open user-review-requested:')
          ? requestedItems
          : inboxGroups.find(([pattern]) => pattern.test(q))?.[1] || [];
      const items = found.filter(item => !repos.length || repos.some(repo => item.repository_url.endsWith(`/${repo}`)));
      return [
        200,
        {
          items: items.slice((page - 1) * perPage, page * perPage),
          total_count: items.length,
          incomplete_results: false,
        },
      ];
    }
    if (path === prPath && method === 'PATCH') Object.assign(state.prEdits, body);
    if (path === prPath) {
      const reads = options.mergeStates ?? [];
      const approvedByViewer = state.reviews.some(review => review.user.login === viewer.login && review.state === 'APPROVED');
      const mergeable_state = options.blockedUntilApproved
        ? approvedByViewer
          ? 'clean'
          : 'blocked'
        : (reads[Math.min(state.prReads, reads.length - 1)] ?? pr.mergeable_state);
      if (method === 'GET') state.prReads++;
      return [
        200,
        {
          ...pr,
          user: options.ownPR ? viewer : pr.user,
          requested_reviewers: options.viewerRequested ? [viewer, ...(pr.requested_reviewers ?? [])] : pr.requested_reviewers,
          state: options.prState ? 'closed' : 'open',
          merged: options.prState === 'merged',
          draft: options.draftPR ?? pr.draft,
          mergeable_state,
          mergeable: mergeable_state === 'unknown' ? null : true,
          auto_merge: state.autoMerge,
          ...state.prEdits,
        },
      ];
    }
    if (path === `${prPath}/files`) return [200, files];
    if (path === `${prPath}/commits`)
      return [
        200,
        [
          {
            sha: FIRST,
            html_url: '',
            author: alice,
            commit: { message: 'Add handler\n\nDetails', author: { name: 'Alice', date: at } },
            parents: [{ sha: BASE }],
          },
          {
            sha: HEAD,
            html_url: '',
            author: alice,
            commit: { message: 'Retry worker', author: { name: 'Alice', date: at } },
            parents: [{ sha: FIRST }],
          },
        ],
      ];
    if (path.startsWith(`${repoPath}/compare/`))
      return [200, { files: [files[0]], merge_base_commit: { sha: path.endsWith(`${FIRST}...${HEAD}`) ? FIRST : BASE } }];
    if (path.startsWith(`${repoPath}/contents/`)) {
      if (path !== `${repoPath}/contents/src/worker.py`) return [404, { message: 'Not Found' }];
      const text = query.get('ref') === BASE ? oldWorker : newWorker;
      return [200, { type: 'file', encoding: 'base64', size: text.length, content: Buffer.from(text).toString('base64') }];
    }
    if (path === `${repoPath}/issues/42/timeline`)
      return [
        200,
        [
          {
            event: 'committed',
            sha: FIRST,
            html_url: '',
            message: 'Add retries\n\nDetails',
            author: { name: 'Alice', date: at },
            committer: { date: at },
          },
          { event: 'review_requested', node_id: 'RRE1', actor: alice, created_at: at, requested_reviewer: carol },
          { event: 'review_requested', node_id: 'RRE2', actor: alice, created_at: at, requested_reviewer: bob },
          { event: 'labeled', node_id: 'LE1', actor: alice, created_at: at, label: { name: 'retry', color: '0e8a16' } },
          { event: 'subscribed', actor: alice, created_at: at },
          ...state.conversation.map(comment => ({ event: 'commented', ...comment })),
          { event: 'head_ref_force_pushed', node_id: 'HRFPE1', actor: alice, created_at: at, commit_id: HEAD },
        ],
      ];
    if (path === `${repoPath}/issues/42/comments`) {
      if (method === 'GET') return [200, state.conversation];
      const comment = { id: state.nextId++, user: viewer, body: body!.body, created_at: NOW.toISOString() };
      state.conversation.push(comment);
      return [201, comment];
    }
    if (path === `${prPath}/comments`) {
      if (method === 'GET') return [200, state.inline];
      return [
        201,
        addInline({
          body: body!.body,
          path: body!.path,
          line: body!.line,
          side: body!.side,
          start_line: body!.start_line,
          start_side: body!.start_side,
        }),
      ];
    }
    const commentPath = path.match(/^\/repos\/acme\/app\/(issues|pulls)\/comments\/(\d+)$/);
    if (commentPath) {
      const list = commentPath[1] === 'issues' ? 'conversation' : 'inline';
      const comment = state[list].find(comment => comment.id === Number(commentPath[2]));
      if (!comment || inPendingReview(comment)) return [404, { message: 'Not Found' }];
      if (method === 'DELETE') {
        state[list] = state[list].filter(other => other !== comment) as never;
        return [204, null];
      }
      return [200, Object.assign(comment, { body: body!.body })];
    }
    const reply = path.match(/\/pulls\/42\/comments\/(\d+)\/replies$/);
    if (reply) {
      const root = state.inline.find(comment => comment.id === Number(reply[1]))!;
      return [201, addInline({ body: body!.body, path: root.path!, line: root.line, in_reply_to_id: root.id })];
    }
    if (path === `${prPath}/reviews`) {
      if (method === 'GET') return [200, state.reviews];
      const id = state.nextId++;
      const review: Review = {
        id,
        node_id: `R${id}`,
        user: viewer,
        state: body!.event ? reviewState[body!.event] : 'PENDING',
        body: body!.body || '',
        commit_id: body!.commit_id,
        submitted_at: body!.event ? NOW.toISOString() : undefined,
      };
      state.reviews.push(review);
      for (const comment of body!.comments || []) addInline({ ...comment, pull_request_review_id: id });
      return [200, review];
    }
    const reviewPath = path.match(/\/pulls\/42\/reviews\/(\d+)(\/events|\/comments)?$/);
    if (reviewPath) {
      const review = state.reviews.find(review => review.id === Number(reviewPath[1]));
      if (!review) return [404, { message: 'Not Found' }];
      if (reviewPath[2] === '/comments') {
        const comments = state.inline.filter(comment => comment.pull_request_review_id === review.id);
        return [200, review.state === 'PENDING' ? comments.map(comment => ({ ...comment, line: null })) : comments];
      }
      if (method === 'GET') return [200, review];
      if (method === 'DELETE') {
        state.reviews = state.reviews.filter(other => other !== review);
        state.inline = state.inline.filter(comment => comment.pull_request_review_id !== review.id);
        return [204, null];
      }
      if (method === 'PUT') return [200, Object.assign(review, { body: body!.body })];
      Object.assign(review, { state: reviewState[body!.event], body: body!.body, submitted_at: NOW.toISOString() });
      return [200, review];
    }
    if (path === `${repoPath}/pulls`) return [200, [parent, pr, child]];
    if (path === repoPath)
      return [
        200,
        {
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: false,
          allow_auto_merge: true,
          permissions: { push: !!options.write },
        },
      ];
    if (path === `${prPath}/merge`) {
      Object.assign(state.prEdits, { state: 'closed', merged: true });
      return [200, { merged: true, message: 'Merged' }];
    }
    if (path === `${repoPath}/labels`)
      return [
        200,
        [
          { name: 'bug', color: 'd73a4a' },
          { name: 'retry', color: '0e8a16' },
        ],
      ];
    if (path === `${repoPath}/issues/42/labels`) {
      const labels = (body!.labels as string[]).map(name => ({ name, color: 'ededed' }));
      Object.assign(state.prEdits, { labels });
      return [200, labels];
    }
    if (path === `${repoPath}/teams`)
      return [
        200,
        [
          { slug: 'backend', name: 'Backend' },
          { slug: 'frontend', name: 'Frontend' },
        ],
      ];
    if (path === `${prPath}/requested_reviewers`) {
      const current = { ...pr, ...state.prEdits };
      const requested_reviewers =
        method === 'DELETE'
          ? (current.requested_reviewers ?? []).filter(user => !(body!.reviewers as string[]).includes(user.login))
          : [...(current.requested_reviewers ?? []), ...(body!.reviewers as string[]).map((login, id) => ({ id, login }))];
      const requested_teams =
        method === 'DELETE'
          ? (current.requested_teams ?? []).filter(team => !(body!.team_reviewers as string[]).includes(team.slug))
          : [...(current.requested_teams ?? []), ...(body!.team_reviewers as string[]).map(slug => ({ slug, name: slug }))];
      Object.assign(state.prEdits, { requested_reviewers, requested_teams });
      return [200, { ...current, requested_reviewers, requested_teams }];
    }
    if (/^\/repos\/acme\/app\/actions\/(runs\/\d+\/rerun(-failed-jobs)?|jobs\/\d+\/rerun)$/.test(path)) return [201, {}];
    if (path === `${repoPath}/commits/${HEAD}/check-runs`)
      return [
        200,
        {
          check_runs: [
            {
              id: 1,
              name: 'test',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/acme/app/actions/runs/9/job/1',
              output: { title: 'All tests passed' },
            },
            {
              id: 2,
              name: 'lint',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/acme/app/actions/runs/9/job/2',
              output: { title: '1 error' },
            },
          ].filter(run => !options.singleCheck || run.id === 1),
        },
      ];
    if (path === `${repoPath}/commits/${HEAD}/status`)
      return [
        200,
        {
          statuses: options.singleCheck
            ? []
            : [
                {
                  id: 3,
                  context: 'deploy/preview',
                  state: 'pending',
                  target_url: 'https://preview.example/42',
                  description: 'Building',
                },
              ],
        },
      ];
    const reactionsPath = path.match(/^\/repos\/acme\/app\/(issues|pulls)\/comments\/(\d+)\/reactions(?:\/(\d+))?$/);
    if (reactionsPath) {
      const key = `${reactionsPath[1]}:${reactionsPath[2]}`;
      const list = state.restReactions.get(key) || [];
      if (method === 'GET') return [200, list];
      if (method === 'POST') {
        const reaction = { id: state.nextId++, content: body!.content, user: viewer };
        state.restReactions.set(key, [...list, reaction]);
        return [201, reaction];
      }
      state.restReactions.set(
        key,
        list.filter(reaction => reaction.id !== Number(reactionsPath[3])),
      );
      return [204, null];
    }
    return [404, { message: `Unhandled ${method} ${path}` }];
  }
  // Time must keep moving: Vue drops a parent's handler when Date.now() hasn't advanced past when it was attached.
  await page.clock.setSystemTime(NOW);
  if (!options.signedOut) await page.addInitScript(() => sessionStorage.setItem('review.github-token', 'github_pat_test'));
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    if (options.hold?.test(path)) await gate;
    try {
      if (path === '/user/teams' && options.teamsDelayMs) await new Promise<void>(resolve => setTimeout(resolve, options.teamsDelayMs));
      if (path === '/graphql') {
        const operation = body.query.match(/^(?:query|mutation) (\w+)/)?.[1];
        if (body.query.startsWith('mutation')) state.writes.push({ method: 'POST', path, body: body.variables, operation });
        const result = graphql(body.query, body.variables);
        return await route.fulfill({ json: 'errors' in result ? result : { data: result } });
      }
      if (request.method() !== 'GET') state.writes.push({ method: request.method(), path, body });
      let [status, data, headers] = rest(request.method(), path, url.searchParams, body);
      if (
        request.method() === 'GET' &&
        state.stalePendingComment &&
        state.stalePendingReadArmed &&
        /^\/repos\/acme\/app\/pulls\/42\/reviews\/\d+\/comments$/.test(path)
      ) {
        const stale = state.stalePendingComment;
        state.stalePendingComment = null;
        state.stalePendingReadArmed = false;
        state.stalePendingReadServed = true;
        state.stalePendingReadBody = stale.body;
        data = (data as Comment[]).map(comment => (comment.id === stale.id ? { ...comment, body: stale.body } : comment));
      }
      await route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(data), contentType: 'application/json' });
    } catch (error) {
      await route.fulfill({ status: 500, json: { message: String(error) } });
    }
  });
  return Object.assign(state, {
    release,
    armStalePendingRead: () => (state.stalePendingReadArmed = true),
  });
}

// Sections load after the header, so most tests wait for every request to settle before interacting.
export async function openPR(page: Page, { settled = true } = {}) {
  await page.goto('/acme/app/pull/42');
  await page.getByRole('heading', { name: 'Improve worker retries', level: 1 }).waitFor();
  if (settled) await page.locator('.review-layout[aria-busy="false"]').waitFor();
}
