import type { Page } from '@playwright/test';
import type { ChangedFile, Comment, PullRequest, Review, ReviewThread } from '../src/github.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fixture payloads are untyped GitHub JSON.
type Payload = Record<string, any>;

export const NOW = new Date('2026-10-17T12:00:00Z');
const at = '2026-10-17T11:00:00Z';
const sha = (char: string) => char.repeat(40);
export const BASE = sha('a'),
  HEAD = sha('b'),
  FIRST = sha('c');
const repo = { id: 1, full_name: 'acme/app' };
const user = (id: number, login: string, type = 'User') => ({ id, login, type });
export const viewer = user(700, 'reviewer');
const alice = user(701, 'alice'),
  bob = user(702, 'bob'),
  carol = user(703, 'carol'),
  bot = user(704, 'ci-helper[bot]', 'Bot');

const numbered = (change: (line: number) => string) => Array.from({ length: 80 }, (_, i) => change(i + 1)).join('\n') + '\n';
const oldWorker = numbered(line => `line ${line}`);
const newWorker = numbered(line => (line === 10 || line === 60 ? `line ${line} changed` : `line ${line}`));
const hunk = (line: number) =>
  `@@ -${line - 3},7 +${line - 3},7 @@\n${[line - 3, line - 2, line - 1].map(n => ` line ${n}`).join('\n')}\n-line ${line}\n+line ${line} changed\n${[line + 1, line + 2, line + 3].map(n => ` line ${n}`).join('\n')}`;

export const files: ChangedFile[] = [
  { filename: 'src/worker.py', status: 'modified', additions: 2, deletions: 2, changes: 4, patch: `${hunk(10)}\n${hunk(60)}` },
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
export const pr: PullRequest = {
  id: 9042,
  node_id: 'PR42',
  mergeable_state: 'clean',
  requested_reviewers: [{ id: 703, login: 'carol' }],
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
const inbox = (number: number, title: string, options: { draft?: boolean; repository?: string; login?: string } = {}) => ({
  id: number,
  number,
  title,
  user: user(options.login === 'reviewer' ? 700 : 701, options.login || 'alice'),
  html_url: `https://github.com/${options.repository || 'acme/app'}/pull/${number}`,
  repository_url: `https://api.github.com/repos/${options.repository || 'acme/app'}`,
  draft: !!options.draft,
  state: 'open',
  updated_at: at,
  comments: 1,
  labels: [],
});
const inboxGroups: [RegExp, ReturnType<typeof inbox>[]][] = [
  [
    /review-requested:/,
    [inbox(42, pr.title), inbox(77, 'Tune cache eviction'), inbox(88, 'Rotate infra credentials', { repository: 'acme/infra' })],
  ],
  [/author:\S+ draft:true/, [inbox(90, 'Sketch retry dashboard', { draft: true, login: 'reviewer' })]],
  [/author:\S+ draft:false/, [inbox(91, 'Speed up CI cache', { login: 'reviewer' })]],
  [/reviewed-by:/, [inbox(92, 'Draft reviewed earlier', { draft: true })]],
  [/is:merged/, [inbox(93, 'Ship metrics exporter', { login: 'reviewer' })]],
];

const reviewState = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' } as Record<string, string>;
const reactionContents = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'];

export async function mockGitHub(page: Page, options: { hold?: RegExp; write?: boolean; onBehalf?: boolean } = {}) {
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
        state: 'CHANGES_REQUESTED',
        body: 'Please add retry tests.',
        commit_id: HEAD,
        submitted_at: at,
      },
    ] as Review[],
    reactions: new Map<string, Map<string, { count: number; viewer: boolean }>>(),
    restReactions: new Map<string, { id: number; content: string; user: typeof viewer }[]>(),
    writes: [] as { method: string; path: string; body: Record<string, unknown> | undefined; operation?: string }[],
    nextId: 1000,
    prEdits: {} as Record<string, unknown>,
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
  function graphql(query: string, variables: Payload) {
    const operation = query.match(/^(?:query|mutation) (\w+)/)?.[1];
    const input = variables.input || {};
    switch (operation) {
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
      case 'PullRequestDraft': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        return { [name]: { pullRequest: { isDraft: name === 'convertPullRequestToDraft' } } };
      }
      case 'ReviewStack':
        return { repository: { pullRequest: { stack: null } } };
      case 'ReviewThreads':
        return {
          repository: { pullRequest: { reviewThreads: { nodes: threadNodes(), pageInfo: { hasNextPage: false, endCursor: null } } } },
        };
      case 'CommentReactions':
        return { node: { viewerCanReact: true, reactionGroups: reactionGroups(variables.id) } };
      case 'CommentReaction': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        const groups = state.reactions.get(input.subjectId) || new Map();
        const group = groups.get(input.content) || { count: 0, viewer: false };
        const add = name === 'addReaction';
        if (group.viewer !== add) groups.set(input.content, { count: group.count + (add ? 1 : -1), viewer: add });
        state.reactions.set(input.subjectId, groups);
        return { [name]: { subject: { viewerCanReact: true, reactionGroups: reactionGroups(input.subjectId) } } };
      }
      case 'UpdateReviewThread': {
        const name = query.match(/\{ (\w+)\(input/)![1];
        const thread = state.threads.find(thread => thread.id === input.threadId)!;
        thread.resolved = name === 'resolveReviewThread';
        return {
          [name]: {
            thread: { id: thread.id, isResolved: thread.resolved, viewerCanResolve: !thread.resolved, viewerCanUnresolve: thread.resolved },
          },
        };
      }
      case 'AddReviewThread': {
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
      case 'AddReviewReply': {
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
    const prPath = '/repos/acme/app/pulls/42';
    if (path === '/user') return [200, viewer, { 'access-control-expose-headers': 'X-OAuth-Scopes', 'x-oauth-scopes': 'repo, read:org' }];
    if (path === '/search/issues') {
      const q = query.get('q') || '';
      const repos = [...q.matchAll(/repo:(\S+)/g)].map(match => match[1]);
      const items = (inboxGroups.find(([pattern]) => pattern.test(q))?.[1] || []).filter(
        item => !repos.length || repos.some(repo => item.repository_url.endsWith(`/${repo}`)),
      );
      return [200, { items, total_count: items.length, incomplete_results: false }];
    }
    if (path === prPath && method === 'PATCH') Object.assign(state.prEdits, body);
    if (path === prPath) return [200, { ...pr, ...state.prEdits }];
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
    if (path.startsWith('/repos/acme/app/compare/'))
      return [200, { files: [files[0]], merge_base_commit: { sha: path.endsWith(`${FIRST}...${HEAD}`) ? FIRST : BASE } }];
    if (path.startsWith('/repos/acme/app/contents/')) {
      if (path !== '/repos/acme/app/contents/src/worker.py') return [404, { message: 'Not Found' }];
      const text = query.get('ref') === BASE ? oldWorker : newWorker;
      return [200, { type: 'file', encoding: 'base64', size: text.length, content: Buffer.from(text).toString('base64') }];
    }
    if (path === '/repos/acme/app/issues/42/comments') {
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
      if (!comment) return [404, { message: 'Not Found' }];
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
      const review = state.reviews.find(review => review.id === Number(reviewPath[1]))!;
      if (reviewPath[2] === '/comments') return [200, state.inline.filter(comment => comment.pull_request_review_id === review.id)];
      if (method === 'DELETE') {
        state.reviews = state.reviews.filter(other => other !== review);
        state.inline = state.inline.filter(comment => comment.pull_request_review_id !== review.id);
        return [204, null];
      }
      if (method === 'PUT') return [200, Object.assign(review, { body: body!.body })];
      Object.assign(review, { state: reviewState[body!.event], body: body!.body, submitted_at: NOW.toISOString() });
      return [200, review];
    }
    if (path === '/repos/acme/app/pulls') return [200, [parent, pr, child]];
    if (path === '/repos/acme/app')
      return [
        200,
        { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false, permissions: { push: !!options.write } },
      ];
    if (path === `${prPath}/merge`) return [200, { merged: true, message: 'Merged' }];
    if (path === '/repos/acme/app/labels')
      return [
        200,
        [
          { name: 'bug', color: 'd73a4a' },
          { name: 'retry', color: '0e8a16' },
        ],
      ];
    if (path === '/repos/acme/app/issues/42/labels') return [200, (body!.labels as string[]).map(name => ({ name, color: 'ededed' }))];
    if (path === '/repos/acme/app/assignees') return [200, [pr.user, { id: 704, login: 'bob' }, { id: 705, login: 'dave' }]];
    if (path === '/repos/acme/app/teams')
      return [
        200,
        [
          { slug: 'backend', name: 'Backend' },
          { slug: 'frontend', name: 'Frontend' },
        ],
      ];
    if (path === `${prPath}/requested_reviewers`)
      return [
        200,
        {
          ...pr,
          requested_reviewers:
            method === 'DELETE'
              ? (pr.requested_reviewers ?? []).filter(user => !(body!.reviewers as string[]).includes(user.login))
              : (body!.reviewers as string[]).map((login, id) => ({ id, login })),
          requested_teams:
            method === 'DELETE'
              ? (pr.requested_teams ?? []).filter(team => !(body!.team_reviewers as string[]).includes(team.slug))
              : (body!.team_reviewers as string[]).map(slug => ({ slug, name: slug })),
        },
      ];
    if (/^\/repos\/acme\/app\/actions\/(runs\/\d+\/rerun(-failed-jobs)?|jobs\/\d+\/rerun)$/.test(path)) return [201, {}];
    if (path === `/repos/acme/app/commits/${HEAD}/check-runs`)
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
          ],
        },
      ];
    if (path === `/repos/acme/app/commits/${HEAD}/status`)
      return [
        200,
        {
          statuses: [
            { id: 3, context: 'deploy/preview', state: 'pending', target_url: 'https://preview.example/42', description: 'Building' },
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
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => sessionStorage.setItem('review.github-token', 'github_pat_test'));
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    if (options.hold?.test(path)) await gate;
    try {
      if (path === '/graphql') {
        const operation = body.query.match(/^(?:query|mutation) (\w+)/)?.[1];
        if (body.query.startsWith('mutation')) state.writes.push({ method: 'POST', path, body: body.variables, operation });
        return await route.fulfill({ json: { data: graphql(body.query, body.variables) } });
      }
      if (request.method() !== 'GET') state.writes.push({ method: request.method(), path, body });
      const [status, data, headers] = rest(request.method(), path, url.searchParams, body);
      await route.fulfill({ status, headers, body: status === 204 ? '' : JSON.stringify(data), contentType: 'application/json' });
    } catch (error) {
      await route.fulfill({ status: 500, json: { message: String(error) } });
    }
  });
  return Object.assign(state, { release });
}

export async function demoMode(page: Page) {
  await page.clock.setFixedTime(NOW);
}

// Sections load after the header, so most tests wait for every request to settle before interacting.
export async function openPR(page: Page, { settled = true } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: /Improve worker retries/ }).click();
  await page.getByRole('heading', { name: 'Improve worker retries', level: 1 }).waitFor();
  if (settled) await page.locator('.review-layout[aria-busy="false"]').waitFor();
}
