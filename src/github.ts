export interface User {
  id: number;
  login: string;
  type?: string;
  avatar_url?: string;
}

export interface Repository {
  id: number;
  full_name: string;
  private?: boolean;
}

export interface Team {
  slug: string;
  name: string;
}

export interface Branch {
  ref: string;
  sha: string;
  repo: Repository | null;
}

export interface PullRequest {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: User;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  created_at: string;
  updated_at: string;
  head: Branch;
  base: Branch;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  comments: number;
  requested_reviewers?: User[];
  requested_teams?: Team[];
  assignees?: User[];
  labels?: Label[];
  mergeable?: boolean | null;
  mergeable_state?: 'clean' | 'blocked' | 'behind' | 'dirty' | 'unstable' | 'draft' | 'has_hooks' | 'unknown';
  auto_merge?: { merge_method: MergeMethod; enabled_by: User } | null;
}

export interface ChangedFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface Comment {
  id: number;
  node_id?: string;
  body: string;
  user: User;
  created_at: string;
  html_url?: string;
  path?: string;
  line?: number | null;
  side?: 'LEFT' | 'RIGHT';
  start_line?: number | null;
  start_side?: 'LEFT' | 'RIGHT' | null;
  pull_request_review_id?: number;
  in_reply_to_id?: number;
  subject_type?: 'line' | 'file';
  outdated?: boolean;
  diff_hunk?: string;
}

export interface Commit {
  sha: string;
  html_url: string;
  author: User | null;
  commit: { message: string; author: { name: string; date: string } | null };
  parents: { sha: string }[];
}

export interface Comparison {
  files: ChangedFile[];
  mergeBase: string;
  truncated: boolean;
}

export type ReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';
export interface ReactionGroup {
  content: ReactionContent;
  viewerHasReacted: boolean;
  reactors: { totalCount: number };
}
export interface Reactions {
  viewerCanReact: boolean;
  reactionGroups: ReactionGroup[];
  mine?: Partial<Record<ReactionContent, number>>;
}
const reactionFields = 'viewerCanReact reactionGroups { content viewerHasReacted reactors { totalCount } }';
const restReactions: Record<ReactionContent, string> = {
  THUMBS_UP: '+1',
  THUMBS_DOWN: '-1',
  LAUGH: 'laugh',
  HOORAY: 'hooray',
  CONFUSED: 'confused',
  HEART: 'heart',
  ROCKET: 'rocket',
  EYES: 'eyes',
};
export type ReactionSubject = Pick<Comment, 'id' | 'node_id' | 'path' | 'pull_request_review_id'> & { state?: string };
// Reviews have no REST reactions endpoint, so only they fall back to GraphQL.
const commentPath = (ref: PRRef, comment: Pick<Comment, 'id' | 'path' | 'pull_request_review_id'>) =>
  `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${comment.path || comment.pull_request_review_id ? 'pulls' : 'issues'}/comments/${comment.id}`;
const reactionPath = (ref: PRRef, subject: ReactionSubject) => (subject.state ? null : `${commentPath(ref, subject)}/reactions`);
const immutableSha = /^[0-9a-f]{40}$/i;

export interface ReviewThread {
  id: string;
  rootCommentId: number;
  resolved: boolean;
  canResolve: boolean;
  canUnresolve: boolean;
  path?: string;
  line?: number | null;
  side?: 'LEFT' | 'RIGHT';
  outdated?: boolean;
  subjectType?: 'LINE' | 'FILE';
}

export interface Review {
  id: number;
  node_id: string;
  user: User;
  state: string;
  body: string;
  commit_id: string;
  submitted_at?: string;
  html_url?: string;
}

export interface ReviewCommentInput {
  body: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

export interface PRRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestDetails {
  additions: number;
  deletions: number;
  createdAt: string;
  checks: 'success' | 'failure' | 'pending' | null;
  participants: { login: string; avatarUrl: string }[];
  participantCount: number;
}

export interface InboxItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  user: User;
  draft: boolean;
  state: string;
  created_at: string;
  updated_at: string;
  comments: number;
  labels: { name: string; color: string }[];
  review?: ReviewState;
  details?: PullRequestDetails;
}

export interface SearchOrder {
  sort: 'updated' | 'created';
  order: 'asc' | 'desc';
}
const defaultSearchOrder: SearchOrder = { sort: 'updated', order: 'desc' };
// Review fields feed the authored classification; they are fetched for every page so one query serves all groups.
const pullRequestDetailFields =
  'createdAt additions deletions commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } participants(first: 10) { totalCount nodes { login avatarUrl(size: 40) } } reviewDecision latestReviews(first: 50) { nodes { state author { __typename login } } } reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }';
// Pending and expected checks both mean the outcome is still open; absent rollups mean there are no checks.
const rollupChecks: Record<string, 'success' | 'failure' | 'pending'> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

// Derived from GraphQL review data; GitHub search cannot tell comment-only reviews from none.
export type ReviewState = 'approved' | 'returned' | 'waiting';
export type InboxGroup = 'requested' | 'authored' | 'drafts' | 'reviewed' | 'merged';
export interface InboxResult {
  items: InboxItem[];
  total_count: number;
  incomplete_results: boolean;
}

export interface Workspace {
  pr: PullRequest;
  files: ChangedFile[];
  comments: Comment[];
  inlineComments: Comment[];
  reviews: Review[];
  related: PullRequest[];
  warnings: string[];
  reviewsLoaded: boolean;
  nativeStack?: NativeStack;
  reviewThreads?: ReviewThread[];
  checks?: StatusCheck[];
  linkedIssues?: LinkedIssue[];
  codeOwners?: string[];
  onBehalfOf?: Record<string, string[]>;
  mergeMethods?: MergeMethod[];
  autoMerge?: boolean;
  pending: WorkspaceSection[];
}

export const workspaceSections = [
  'files',
  'comments',
  'inlineComments',
  'reviews',
  'related',
  'reviewThreads',
  'nativeStack',
  'checks',
  'linkedIssues',
  'mergeMethods',
] as const;
export type WorkspaceSection = (typeof workspaceSections)[number];

export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type CheckState = 'success' | 'failure' | 'cancelled' | 'pending' | 'neutral' | 'skipped';
export interface StatusCheck {
  id: string;
  name: string;
  state: CheckState;
  url: string;
  detail?: string;
  // GitHub Actions check runs are jobs; only those can be re-run through the REST API.
  job?: { id: number; run: number };
}
export type Label = { name: string; color: string };
export type LinkedIssue = { number: number; title: string; url: string; state: string };
const failedConclusions = ['failure', 'timed_out', 'action_required', 'startup_failure'];
const actionsJob = (url: string | null) => {
  const [, run, id] = url?.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/) ?? [];
  return run ? { id: Number(id), run: Number(run) } : undefined;
};
const checkOrder: CheckState[] = ['failure', 'cancelled', 'pending', 'neutral', 'success', 'skipped'];
// GitHub re-runs cancelled jobs with failed ones and treats them as blocking.
export const blockingStates: CheckState[] = ['failure', 'cancelled'];

export interface NativeStack {
  number: number;
  size: number;
  entries: { position: number; number: number; title: string; url: string; state: string }[];
  truncated: boolean;
}

export interface TokenInfo {
  user: User;
  scopes: string[];
  fineGrained: boolean;
}

export function parsePRUrl(value: string): PRRef {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a full GitHub pull request URL.');
  }
  if (!['github.com', 'www.github.com', 'diffshub.com'].includes(url.hostname) || url.protocol !== 'https:') {
    throw new Error('Use an https://github.com/owner/repo/pull/123 URL.');
  }
  const match = url.pathname.match(/^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/([1-9]\d*)(?:\/.*)?$/);
  if (!match || !Number.isSafeInteger(Number(match[3]))) throw new Error('That URL does not identify a pull request.');
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export const repoPath = (ref: Pick<PRRef, 'owner' | 'repo'>) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
export const refPath = (ref: PRRef) => `${repoPath(ref)}/pulls/${ref.number}`;
export const mergeReady = (pr: PullRequest) =>
  pr.state === 'open' && !pr.draft && ['clean', 'has_hooks', 'unstable'].includes(pr.mergeable_state ?? '');
// GitHub computes mergeability lazily, so a freshly fetched PR can report unknown for a moment.
export const mergeabilityPending = (pr: PullRequest) => pr.state === 'open' && (pr.mergeable === null || pr.mergeable_state === 'unknown');

export function branchRelations(pr: PullRequest, candidates: PullRequest[]) {
  return {
    parents: candidates.filter(
      other =>
        other.id !== pr.id && other.head.repo?.id != null && other.head.repo.id === pr.base.repo?.id && other.head.ref === pr.base.ref,
    ),
    children: candidates.filter(
      other => other.id !== pr.id && pr.head.repo?.id != null && other.base.repo?.id === pr.head.repo.id && other.base.ref === pr.head.ref,
    ),
  };
}

export type ReviewSummary = {
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  latestReviews: { state: string; author: { __typename: string; login: string } | null }[];
  requested: string[];
};
// Bots and the author's own comments never count as reviewer feedback.
export function classifyReview(summary: ReviewSummary, author: string): ReviewState {
  const humans = summary.latestReviews.flatMap(review =>
    review.author?.__typename === 'User' && review.author.login !== author ? [{ state: review.state, login: review.author.login }] : [],
  );
  if (summary.reviewDecision === 'CHANGES_REQUESTED') return 'returned';
  if (summary.reviewDecision === 'APPROVED' || (summary.reviewDecision === null && humans.some(review => review.state === 'APPROVED')))
    return 'approved';
  // Re-requesting a reviewer hands the PR back to them, so it is waiting again.
  if (humans.some(review => ['COMMENTED', 'CHANGES_REQUESTED'].includes(review.state) && !summary.requested.includes(review.login)))
    return 'returned';
  return 'waiting';
}

export type MergedFilter = 'all' | 'mine' | 'reviewing';
export function inboxQuery(group: InboxGroup, login: string, repos: string[] = [], merged: MergedFilter = 'mine'): string {
  const base = ['is:pr archived:false', ...repos.map(repo => `repo:${repo}`)].join(' ');
  // Every merged PR is only meaningful within selected repositories; without them, "all" stays limited to the viewer.
  const mergedQueries: Record<MergedFilter, string> = {
    all: repos.length ? 'is:merged' : `is:merged author:${login}`,
    mine: `is:merged author:${login}`,
    reviewing: `is:merged (review-requested:${login} OR reviewed-by:${login}) -author:${login}`,
  };
  const queries: Record<InboxGroup, string> = {
    requested: `is:open review-requested:${login} draft:false`,
    authored: `is:open author:${login} draft:false`,
    drafts: `is:open author:${login} draft:true`,
    reviewed: `is:open reviewed-by:${login} -author:${login}`,
    merged: mergedQueries[merged],
  };
  return `${base} ${queries[group]}`.trim();
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  private readonly token: string;
  private readonly cacheMode: RequestCache;
  private freshClient?: GitHub;
  constructor(token: string, cacheMode: RequestCache = 'default') {
    this.token = token;
    this.cacheMode = cacheMode;
  }
  private readonly contentCache = new Map<string, Promise<string>>();

  // Fresh reads only serve manual refreshes and reads that must observe our own writes.
  fresh(): GitHub {
    if (this.cacheMode === 'no-cache') return this;
    this.freshClient ??= new GitHub(this.token, 'no-cache');
    return this.freshClient;
  }

  private async graphql<T>(query: string, variables: object, signal?: AbortSignal) {
    const { data } = await this.request<{ data?: T; errors?: { message: string }[] }>('/graphql', {
      method: 'POST',
      signal,
      body: JSON.stringify({ query, variables }),
    });
    if (data.errors?.length) throw new Error(data.errors.map(error => error.message).join(' '));
    return data.data;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<{ data: T; headers: Headers }> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub API path.');
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'omit',
      redirect: 'error',
      cache: this.cacheMode,
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        message?: string;
        errors?: (string | { message?: string; field?: string; code?: string })[];
      };
      let message = error.message || `GitHub returned ${response.status}.`;
      if (response.status === 401) message = 'Your GitHub token is invalid or expired. Reconnect with a valid token.';
      if (response.status === 404)
        message = 'PR or repository not found. Check the URL, token repository access, and organization SSO authorization.';
      if (response.status === 403) {
        if (response.headers.get('x-ratelimit-remaining') === '0') {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          message = `GitHub rate limit reached.${reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ''}`;
        } else if (response.headers.get('x-github-sso')?.includes('required')) {
          message = 'Your organization requires SSO authorization for this token. Authorize it in GitHub → Settings → Developer settings.';
        } else message += ' Check Pull requests: write permission, repository access, and organization restrictions.';
      }
      const detail = error.errors
        ?.map(item => (typeof item === 'string' ? item : item.message || [item.field, item.code].filter(Boolean).join(': ')))
        .filter(Boolean)
        .join(' ');
      throw new GitHubError(`${message}${detail ? ` ${detail}` : ''}`, response.status);
    }
    if (response.status === 204) return { data: undefined as T, headers: response.headers };
    return { data: (await response.json()) as T, headers: response.headers };
  }

  // A 404 means the target is already gone, which callers treat as done rather than as a failure.
  private async requestIfPresent(path: string, options?: RequestInit): Promise<boolean> {
    try {
      await this.request(path, options);
      return true;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return false;
      throw error;
    }
  }

  async validate(signal?: AbortSignal): Promise<TokenInfo> {
    const { data: user, headers } = await this.request<User>('/user', { signal });
    const scopes = (headers.get('x-oauth-scopes') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const fineGrained = this.token.startsWith('github_pat_');
    if (!fineGrained && !scopes.includes('repo') && !scopes.includes('public_repo')) {
      throw new Error(
        'This token does not report repo or public_repo scope. Use gh auth login --scopes repo,read:org, then gh auth token; or use a fine-grained PAT with Pull requests: write and Contents: read.',
      );
    }
    return { user, scopes, fineGrained };
  }

  async pages<T, B = T[]>(
    path: string,
    signal?: AbortSignal,
    maxPages = 30,
    pick: (body: B) => T[] = body => body as unknown as T[],
  ): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data, headers } = await this.request<B>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { signal });
      const batch = pick(data);
      items.push(...batch);
      const more = headers.get('link')?.includes('rel="next"') ?? batch.length === 100;
      if (!more) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  // Publishes the PR as soon as it arrives, then each section as it settles, so the page never waits on the slowest request.
  async workspace(ref: PRRef, signal?: AbortSignal, onUpdate: (workspace: Workspace) => void = () => {}): Promise<Workspace> {
    const path = refPath(ref);
    const { data: pr } = await this.request<PullRequest>(path, { signal });
    let current: Workspace = {
      pr,
      files: [],
      comments: [],
      inlineComments: [],
      reviews: [],
      related: [],
      reviewThreads: [],
      warnings: [],
      reviewsLoaded: false,
      pending: [...workspaceSections],
    };
    onUpdate(current);
    const settle = (section: WorkspaceSection, patch: Partial<Workspace>, warnings: string[] = []) => {
      current = {
        ...current,
        ...patch,
        warnings: [...current.warnings, ...warnings],
        pending: current.pending.filter(name => name !== section),
      };
      if (!signal?.aborted) onUpdate(current);
    };
    const failed = (name: string) => (error: unknown) =>
      `${name} could not be loaded: ${String(error instanceof Error ? error.message : error)}`;
    const section = <T>(
      name: WorkspaceSection,
      label: string,
      load: () => Promise<{ items: T[]; truncated: boolean }>,
      patch: (items: T[], truncated: boolean) => Partial<Workspace>,
    ) =>
      load().then(
        ({ items, truncated }) =>
          settle(name, patch(items, truncated), truncated ? [`${label} is limited to the first ${items.length} results.`] : []),
        error => settle(name, {}, [failed(label)(error)]),
      );
    await Promise.all([
      this.pages<ChangedFile>(`${path}/files`, signal).then(
        files =>
          settle(
            'files',
            { files: files.items },
            files.truncated || files.items.length < pr.changed_files
              ? ['GitHub returned an incomplete file list (REST supports up to 3,000 files). Open GitHub to see the rest.']
              : [],
          ),
        error => settle('files', {}, [failed('Changed files')(error)]),
      ),
      section(
        'comments',
        'Conversation',
        () => this.pages<Comment>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, signal, 10),
        items => ({ comments: items }),
      ),
      section(
        'inlineComments',
        'Inline comments',
        () => this.pages<Comment>(`${path}/comments`, signal, 10),
        items => ({ inlineComments: items }),
      ),
      section(
        'reviews',
        'Reviews',
        () => this.pages<Review>(`${path}/reviews`, signal, 20),
        (items, truncated) => ({ reviews: items, reviewsLoaded: !truncated }),
      ),
      section(
        'related',
        'Branch dependencies',
        () => this.pages<PullRequest>(`/repos/${ref.owner}/${ref.repo}/pulls?state=open`, signal, 10),
        items => ({ related: items }),
      ),
      section(
        'reviewThreads',
        'Thread status',
        () => this.reviewThreads(ref, signal),
        items => ({ reviewThreads: items }),
      ),
      this.checks(ref, pr.head.sha, signal).then(
        checks => settle('checks', { checks }),
        error => settle('checks', {}, [failed('Checks')(error)]),
      ),
      this.development(ref, signal).then(
        development => settle('linkedIssues', development),
        () => settle('linkedIssues', { linkedIssues: [], codeOwners: [], onBehalfOf: {} }),
      ),
      this.mergeSettings(ref, signal).then(
        ({ methods, autoMerge }) => settle('mergeMethods', { mergeMethods: methods, autoMerge }),
        () => settle('mergeMethods', { mergeMethods: [], autoMerge: false }),
      ),
      this.stack(ref, signal).then(
        nativeStack => settle('nativeStack', { nativeStack }),
        () => settle('nativeStack', {}, ['Native stack metadata is unavailable. Showing branch-based dependencies instead.']),
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return current;
  }

  // GitHub Actions and Apps report check runs; older integrations still post commit statuses, so both are merged.
  async checks(ref: PRRef, sha: string, signal?: AbortSignal): Promise<StatusCheck[]> {
    const base = `${repoPath(ref)}/commits/${sha}`;
    const fallback = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}/checks`;
    type Run = {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url: string | null;
      check_suite?: { id: number } | null;
      app?: { id: number } | null;
      output?: { title?: string | null };
    };
    type WorkflowRun = { name: string | null; workflow_id: number; check_suite_id: number };
    type Status = { id: number; context: string; state: string; target_url: string | null; description: string | null };
    const [runs, { data: combined }, workflows] = await Promise.all([
      this.pages<Run, { check_runs: Run[] }>(`${base}/check-runs`, signal, 30, body => body.check_runs),
      this.request<{ statuses: Status[] }>(`${base}/status`, { signal }),
      // Best-effort: without Actions read access, checks still list with plain job names.
      this.pages<WorkflowRun, { workflow_runs: WorkflowRun[] }>(
        `${repoPath(ref)}/actions/runs?head_sha=${sha}`,
        signal,
        10,
        body => body.workflow_runs,
      ).then(
        result => result.items,
        () => [],
      ),
    ]);
    // Each re-triggered workflow run and re-run attempt reports its jobs again; IDs increase with every run, so the newest ID wins.
    const workflowBySuite = new Map(workflows.map(workflow => [workflow.check_suite_id, workflow]));
    const latest = new Map<string, { run: Run; workflow?: WorkflowRun }>();
    for (const run of runs.items) {
      const workflow = run.check_suite ? workflowBySuite.get(run.check_suite.id) : undefined;
      const key = workflow ? `workflow:${workflow.workflow_id}:${run.name}` : `app:${run.app?.id}:${run.name}`;
      if (!latest.has(key) || run.id > latest.get(key)!.run.id) latest.set(key, { run, workflow });
    }
    const checks: StatusCheck[] = [
      ...[...latest.values()].map(({ run, workflow }) => ({
        id: `run-${run.id}`,
        job: actionsJob(run.html_url),
        name: workflow?.name ? `${workflow.name} / ${run.name}` : run.name,
        url: run.html_url || fallback,
        detail: run.output?.title || undefined,
        state: (run.status !== 'completed'
          ? 'pending'
          : run.conclusion === 'success'
            ? 'success'
            : failedConclusions.includes(run.conclusion ?? '')
              ? 'failure'
              : run.conclusion === 'cancelled'
                ? 'cancelled'
                : run.conclusion === 'skipped'
                  ? 'skipped'
                  : 'neutral') as CheckState,
      })),
      ...combined.statuses.map(status => ({
        id: `status-${status.id}`,
        name: status.context,
        url: status.target_url || fallback,
        detail: status.description || undefined,
        state: (status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure') as CheckState,
      })),
    ];
    return checks.sort((a, b) => checkOrder.indexOf(a.state) - checkOrder.indexOf(b.state));
  }

  async commits(ref: PRRef, signal?: AbortSignal) {
    return this.pages<Commit>(`${refPath(ref)}/commits`, signal, 3);
  }

  async compare(ref: PRRef, base: string, head: string, signal?: AbortSignal): Promise<Comparison> {
    if (!immutableSha.test(base) || !immutableSha.test(head)) throw new Error('Select immutable commit SHAs to compare.');
    const { data } = await this.request<{ files: ChangedFile[]; merge_base_commit: { sha: string } }>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/compare/${base}...${head}?per_page=1`,
      { signal },
    );
    if (!data.files || !immutableSha.test(data.merge_base_commit?.sha)) throw new Error('GitHub did not return a complete comparison.');
    return { files: data.files, mergeBase: data.merge_base_commit.sha, truncated: data.files.length >= 300 };
  }

  async textFile(repository: string, path: string, sha: string): Promise<string> {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      repository.split('/').some(part => part === '.' || part === '..') ||
      !immutableSha.test(sha) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))
    ) {
      throw new Error('Invalid immutable file location.');
    }
    const endpoint = `/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`;
    const cached = this.contentCache.get(endpoint);
    if (cached) {
      this.contentCache.delete(endpoint);
      this.contentCache.set(endpoint, cached);
      return cached;
    }
    const promise = (async () => {
      const { data } = await this.request<{ type: string; encoding: string; size: number; content?: string }>(endpoint);
      if (data.type !== 'file' || data.encoding !== 'base64' || data.size > 1_048_576 || data.content === undefined)
        throw new Error('Full context is only available for UTF-8 text files up to 1 MiB. Open this file on GitHub instead.');
      try {
        const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), char => char.charCodeAt(0));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0')) throw new Error('Binary file');
        return text;
      } catch {
        throw new Error('This file is binary or is not valid UTF-8. Open it on GitHub instead.');
      }
    })();
    if (this.contentCache.size >= 32) this.contentCache.delete(this.contentCache.keys().next().value!);
    this.contentCache.set(endpoint, promise);
    try {
      return await promise;
    } catch (error) {
      if (this.contentCache.get(endpoint) === promise) this.contentCache.delete(endpoint);
      throw error;
    }
  }

  async diffContents(ref: PRRef, file: ChangedFile, base: string, head: string, headRepository = `${ref.owner}/${ref.repo}`) {
    const oldName = file.previous_filename || file.filename;
    const [oldContents, newContents] = await Promise.all([
      this.textFile(`${ref.owner}/${ref.repo}`, oldName, base),
      this.textFile(headRepository, file.filename, head),
    ]);
    return {
      oldFile: { name: oldName, contents: oldContents, cacheKey: `${ref.owner}/${ref.repo}:${base}:${oldName}` },
      newFile: { name: file.filename, contents: newContents, cacheKey: `${headRepository}:${head}:${file.filename}` },
    };
  }

  async reactions(ref: PRRef, subject: ReactionSubject, viewerId: number): Promise<Reactions> {
    const path = reactionPath(ref, subject);
    if (!path) {
      if (!subject.node_id) throw new Error('Refresh this PR to load the GitHub review ID.');
      const data: { node: Reactions | null } | undefined = await this.graphql<{ node: Reactions | null }>(
        `query CommentReactions($id: ID!) { node(id: $id) { ... on Reactable { ${reactionFields} } } }`,
        { id: subject.node_id },
      );
      if (!data?.node?.reactionGroups) throw new Error('Comment reactions could not be loaded.');
      return data.node;
    }
    const { items } = await this.pages<{ id: number; content: string; user: User | null }>(path, undefined, 10);
    const contents = Object.keys(restReactions) as ReactionContent[];
    const mine: Partial<Record<ReactionContent, number>> = {};
    const reactionGroups = contents.flatMap(content => {
      const matching = items.filter(item => item.content === restReactions[content]);
      const own = matching.find(item => item.user?.id === viewerId);
      if (own) mine[content] = own.id;
      return matching.length ? [{ content, viewerHasReacted: !!own, reactors: { totalCount: matching.length } }] : [];
    });
    return { viewerCanReact: true, reactionGroups, mine };
  }

  async setReaction(
    ref: PRRef,
    subject: ReactionSubject,
    content: ReactionContent,
    add: boolean,
    viewerId: number,
    current: Reactions,
  ): Promise<Reactions> {
    const path = reactionPath(ref, subject);
    if (!path) {
      const name = add ? 'addReaction' : 'removeReaction';
      const inputType = add ? 'AddReactionInput' : 'RemoveReactionInput';
      const data: Record<string, { subject: Reactions | null }> | undefined = await this.graphql<
        Record<string, { subject: Reactions | null }>
      >(`mutation CommentReaction($input: ${inputType}!) { ${name}(input: $input) { subject { ${reactionFields} } } }`, {
        input: { subjectId: subject.node_id, content },
      });
      const confirmed = data?.[name]?.subject;
      if (!confirmed?.reactionGroups) throw new Error('GitHub did not confirm the reaction. Refresh before trying again.');
      return confirmed;
    }
    if (add) await this.request(path, { method: 'POST', body: JSON.stringify({ content: restReactions[content] }) });
    else {
      const id = current.mine?.[content];
      if (!id) throw new Error('Your reaction ID is unavailable. Refresh reactions before trying again.');
      await this.requestIfPresent(`${path}/${id}`, { method: 'DELETE' });
    }
    return this.fresh().reactions(ref, subject, viewerId);
  }

  async stack(ref: PRRef, signal?: AbortSignal): Promise<NativeStack | undefined> {
    type StackResult = {
      data?: {
        repository: {
          pullRequest: {
            stack: {
              number: number;
              size: number;
              entries: {
                nodes: { position: number; pullRequest: { number: number; title: string; url: string; state: string } | null }[];
                pageInfo: { hasNextPage: boolean };
              };
            } | null;
          };
        };
      };
      errors?: { message: string }[];
    };
    const data: NonNullable<StackResult['data']> | undefined = await this.graphql<NonNullable<StackResult['data']>>(
      'query ReviewStack($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { stack { number size entries(first: 100) { nodes { position pullRequest { number title url state } } pageInfo { hasNextPage } } } } } }',
      ref,
      signal,
    );
    const stack = data?.repository?.pullRequest?.stack;
    if (!stack) return;
    return {
      number: stack.number,
      size: stack.size,
      truncated: stack.entries.pageInfo.hasNextPage,
      entries: stack.entries.nodes
        .filter(entry => entry.pullRequest)
        .map(entry => ({ position: entry.position, ...entry.pullRequest! }))
        .sort((a, b) => a.position - b.position),
    };
  }

  async inbox(
    group: InboxGroup,
    login: string,
    repos: string[] = [],
    page = 1,
    signal?: AbortSignal,
    merged: MergedFilter = 'mine',
    order: SearchOrder = defaultSearchOrder,
  ) {
    const query = inboxQuery(group, login, repos, merged);
    // Only the OR of review-requested and reviewed-by needs advanced search; plain search rejects it with 422.
    const advanced = group === 'merged' && merged === 'reviewing' ? '&advanced_search=true' : '';
    const result = (
      await this.request<InboxResult>(
        `/search/issues?q=${encodeURIComponent(query)}&sort=${order.sort}&order=${order.order}&per_page=30&page=${page}${advanced}`,
        { signal },
      )
    ).data;
    if (!result.items.length) return result;
    try {
      return { ...result, items: await this.withPullRequestDetails(group, result.items, signal) };
    } catch {
      return result;
    }
  }

  // One aliased query per page enriches every group; items the batch misses stay as search returned them.
  private async withPullRequestDetails(group: InboxGroup, items: InboxItem[], signal?: AbortSignal): Promise<InboxItem[]> {
    type PullRequestData = {
      createdAt: string;
      additions: number;
      deletions: number;
      reviewDecision: ReviewSummary['reviewDecision'];
      commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
      participants: { totalCount: number; nodes: { login: string; avatarUrl: string }[] };
      latestReviews: { nodes: ReviewSummary['latestReviews'] };
      reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] };
    };
    const variables: Record<string, string | number> = {};
    const declarations: string[] = [];
    const selections = items.map((item, index) => {
      const [owner, name] = item.repository_url.split('/repos/')[1].split('/');
      variables[`owner${index}`] = owner;
      variables[`name${index}`] = name;
      variables[`number${index}`] = item.number;
      declarations.push(`$owner${index}: String!, $name${index}: String!, $number${index}: Int!`);
      return `pr${index}: repository(owner: $owner${index}, name: $name${index}) { pullRequest(number: $number${index}) { ${pullRequestDetailFields} } }`;
    });
    const data = await this.graphql<Record<string, { pullRequest: PullRequestData | null } | null>>(
      `query InboxDetails(${declarations.join(', ')}) { ${selections.join(' ')} }`,
      variables,
      signal,
    );
    return items.map((item, index) => {
      const pr = data?.[`pr${index}`]?.pullRequest;
      if (!pr) return item;
      const requested = pr.reviewRequests.nodes.flatMap(node => (node.requestedReviewer?.login ? [node.requestedReviewer.login] : []));
      const participants = pr.participants.nodes.filter(user => user.login !== item.user.login);
      const details: PullRequestDetails = {
        additions: pr.additions,
        deletions: pr.deletions,
        createdAt: pr.createdAt,
        checks: rollupChecks[pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? ''] ?? null,
        participants,
        participantCount: pr.participants.totalCount - (participants.length < pr.participants.nodes.length ? 1 : 0),
      };
      const review =
        group === 'authored' ? classifyReview({ ...pr, latestReviews: pr.latestReviews.nodes, requested }, item.user.login) : undefined;
      return { ...item, details, ...(review ? { review } : {}) };
    });
  }

  async reviewThreads(ref: PRRef, signal?: AbortSignal): Promise<{ items: ReviewThread[]; truncated: boolean }> {
    type ThreadNode = {
      id: string;
      isResolved: boolean;
      viewerCanResolve: boolean;
      viewerCanUnresolve: boolean;
      path?: string;
      line?: number | null;
      diffSide?: 'LEFT' | 'RIGHT';
      isOutdated?: boolean;
      subjectType?: 'LINE' | 'FILE';
      comments: { nodes: { databaseId: number | null }[] };
    };
    type Connection = { nodes: ThreadNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    type Result = { data?: { repository: { pullRequest: { reviewThreads: Connection } } }; errors?: { message: string }[] };
    const items: ReviewThread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data: NonNullable<Result['data']> | undefined = await this.graphql<NonNullable<Result['data']>>(
        'query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) { nodes { id isResolved viewerCanResolve viewerCanUnresolve path line diffSide isOutdated subjectType comments(first: 1) { nodes { databaseId } } } pageInfo { hasNextPage endCursor } } } } }',
        { ...ref, cursor },
        signal,
      );
      const connection: Connection | undefined = data?.repository?.pullRequest?.reviewThreads;
      if (!connection) throw new Error('GitHub did not return thread status. Refresh to try again.');
      for (const node of connection.nodes) {
        const rootCommentId = node?.comments.nodes[0]?.databaseId;
        if (rootCommentId)
          items.push({
            id: node.id,
            rootCommentId,
            resolved: node.isResolved,
            canResolve: node.viewerCanResolve,
            canUnresolve: node.viewerCanUnresolve,
            ...(node.path !== undefined
              ? { path: node.path, line: node.line, side: node.diffSide, outdated: node.isOutdated, subjectType: node.subjectType }
              : {}),
          });
      }
      if (!connection.pageInfo.hasNextPage) return { items, truncated: false };
      if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor)
        throw new Error('GitHub returned an invalid thread pagination cursor.');
      cursor = connection.pageInfo.endCursor;
    }
    return { items, truncated: true };
  }

  async setThreadResolved(id: string, resolved: boolean) {
    const operation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
    const inputType = resolved ? 'ResolveReviewThreadInput' : 'UnresolveReviewThreadInput';
    type Result = {
      data?: Record<string, { thread: { id: string; isResolved: boolean; viewerCanResolve: boolean; viewerCanUnresolve: boolean } | null }>;
      errors?: { message: string }[];
    };
    const data: NonNullable<Result['data']> | undefined = await this.graphql<NonNullable<Result['data']>>(
      `mutation UpdateReviewThread($input: ${inputType}!) { ${operation}(input: $input) { thread { id isResolved viewerCanResolve viewerCanUnresolve } } }`,
      { input: { threadId: id } },
    );
    const thread = data?.[operation]?.thread;
    if (!thread || thread.id !== id || thread.isResolved !== resolved)
      throw new Error('GitHub did not confirm the thread update. Refresh before retrying.');
    return { id: thread.id, resolved: thread.isResolved, canResolve: thread.viewerCanResolve, canUnresolve: thread.viewerCanUnresolve };
  }

  async ensureHead(ref: PRRef, sha: string) {
    const { data } = await this.fresh().request<PullRequest>(refPath(ref));
    if (data.head.sha !== sha) throw new Error('This PR has new commits. Refresh the diff before submitting a review or inline comment.');
    return data;
  }

  async comment(ref: PRRef, body: string) {
    return (
      await this.request<Comment>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
    ).data;
  }

  async startReview(ref: PRRef, sha: string, comment?: ReviewCommentInput) {
    await this.ensureHead(ref, sha);
    return (
      await this.request<Review>(`${refPath(ref)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ commit_id: sha, ...(comment ? { comments: [comment] } : {}) }),
      })
    ).data;
  }

  async inlineComment(
    ref: PRRef,
    sha: string,
    body: string,
    path: string,
    line: number,
    side: 'LEFT' | 'RIGHT',
    review?: Review,
    start?: { line: number; side: 'LEFT' | 'RIGHT' },
  ) {
    await this.ensureHead(ref, sha);
    if (review) {
      if (review.commit_id !== sha) throw new Error('Your pending review is on an older commit. Discard it and start a new review.');
      const data: { addPullRequestReviewThread: { thread: { id: string } } } | undefined = await this.graphql<{
        addPullRequestReviewThread: { thread: { id: string } };
      }>(
        'mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { id } } }',
        {
          input: {
            pullRequestReviewId: review.node_id,
            body,
            path,
            line,
            side,
            ...(start ? { startLine: start.line, startSide: start.side } : {}),
          },
        },
      );
      if (!data?.addPullRequestReviewThread.thread) throw new Error('GitHub did not confirm the review comment.');
      return;
    }
    await this.request<Comment>(`${refPath(ref)}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        path,
        line,
        side,
        ...(start ? { start_line: start.line, start_side: start.side } : {}),
        commit_id: sha,
      }),
    });
  }

  async reviewComments(ref: PRRef, id: number) {
    return (await this.pages<Comment>(`${refPath(ref)}/reviews/${id}/comments`)).items;
  }

  async reply(ref: PRRef, commentId: number, body: string, review?: Review, threadId?: string): Promise<Comment> {
    if (review) {
      if (!threadId) throw new Error('Thread metadata is unavailable. Refresh this PR before adding a reply to your review.');
      await this.ensureHead(ref, review.commit_id);
      type Reply = {
        id: string;
        databaseId: number;
        body: string;
        createdAt: string;
        url: string;
        path: string;
        line: number | null;
        author: { login: string; __typename: string; databaseId?: number } | null;
        pullRequestReview: { databaseId: number };
      };
      const data: { addPullRequestReviewThreadReply?: { comment: Reply | null } } | undefined = await this.graphql<{
        addPullRequestReviewThreadReply?: { comment: Reply | null };
      }>(
        'mutation AddReviewReply($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id databaseId body createdAt url path line author { login __typename ... on User { databaseId } ... on Bot { databaseId } } pullRequestReview { databaseId } } } }',
        { input: { pullRequestReviewId: review.node_id, pullRequestReviewThreadId: threadId, body } },
      );
      const comment = data?.addPullRequestReviewThreadReply?.comment;
      if (!comment?.databaseId || comment.pullRequestReview?.databaseId !== review.id)
        throw new Error('GitHub did not confirm a reply in your pending review. Refresh before trying again.');
      return {
        id: comment.databaseId,
        node_id: comment.id,
        body: comment.body,
        created_at: comment.createdAt,
        html_url: comment.url,
        path: comment.path,
        line: comment.line,
        in_reply_to_id: commentId,
        pull_request_review_id: review.id,
        user: { id: comment.author?.databaseId || 0, login: comment.author?.login || 'ghost', type: comment.author?.__typename },
      };
    }
    return (
      await this.request<Comment>(`${refPath(ref)}/comments/${commentId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
    ).data;
  }

  async editComment(ref: PRRef, comment: Comment, body: string, pending = false) {
    if (!pending) return (await this.request<Comment>(commentPath(ref, comment), { method: 'PATCH', body: JSON.stringify({ body }) })).data;
    if (!comment.node_id) throw new Error('Refresh this PR to load the GitHub comment ID.');
    const data: { updatePullRequestReviewComment?: { pullRequestReviewComment: { body: string } | null } } | undefined = await this.graphql(
      'mutation EditPendingComment($input: UpdatePullRequestReviewCommentInput!) { updatePullRequestReviewComment(input: $input) { pullRequestReviewComment { id body } } }',
      { input: { pullRequestReviewCommentId: comment.node_id, body } },
    );
    const confirmed = data?.updatePullRequestReviewComment?.pullRequestReviewComment;
    if (!confirmed) throw new Error('GitHub did not confirm the comment update. Refresh before trying again.');
    return { ...comment, body: confirmed.body };
  }

  async deleteComment(ref: PRRef, comment: Comment, pending = false) {
    if (!pending) {
      await this.request(commentPath(ref, comment), { method: 'DELETE' });
      return;
    }
    if (!comment.node_id) throw new Error('Refresh this PR to load the GitHub comment ID.');
    await this.graphql(
      'mutation DeletePendingComment($input: DeletePullRequestReviewCommentInput!) { deletePullRequestReviewComment(input: $input) { clientMutationId } }',
      { input: { id: comment.node_id } },
    );
  }

  async editReview(ref: PRRef, id: number, body: string) {
    return (await this.request<Review>(`${refPath(ref)}/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ body }) })).data;
  }

  async submitReview(ref: PRRef, sha: string, event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES', body: string, pending?: Review) {
    const pr = await this.ensureHead(ref, sha);
    if (pr.state !== 'open') throw new Error('This pull request is no longer open.');
    if (pending && pending.commit_id !== sha)
      throw new Error('The pending review is on an older commit. Discard it and start a new review.');
    return (
      await this.request<Review>(pending ? `${refPath(ref)}/reviews/${pending.id}/events` : `${refPath(ref)}/reviews`, {
        method: 'POST',
        body: JSON.stringify(pending ? { event, body } : { event, body, commit_id: sha }),
      })
    ).data;
  }

  // REST exposes neither the issues a PR closes, which review requests come from CODEOWNERS, nor which teams a review was for.
  async development(ref: PRRef, signal?: AbortSignal) {
    type Result = {
      repository: {
        pullRequest: {
          closingIssuesReferences: { nodes: LinkedIssue[] };
          reviewRequests: { nodes: { asCodeOwner: boolean; requestedReviewer: { login?: string; combinedSlug?: string } | null }[] };
          latestReviews: { nodes: { author: { login: string } | null; onBehalfOf: { nodes: { combinedSlug: string }[] } }[] };
        };
      };
    };
    const data = await this.graphql<Result>(
      'query Development($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { closingIssuesReferences(first: 20) { nodes { number title url state } } reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { ... on User { login } ... on Team { combinedSlug } } } } latestReviews(first: 50) { nodes { author { login } onBehalfOf(first: 10) { nodes { combinedSlug } } } } } } }',
      ref,
      signal,
    );
    const pr = data?.repository?.pullRequest;
    return {
      linkedIssues: pr?.closingIssuesReferences?.nodes ?? [],
      codeOwners: (pr?.reviewRequests?.nodes ?? []).flatMap(node =>
        node.asCodeOwner && node.requestedReviewer ? [node.requestedReviewer.login ?? node.requestedReviewer.combinedSlug ?? ''] : [],
      ),
      onBehalfOf: Object.fromEntries(
        (pr?.latestReviews?.nodes ?? []).flatMap(node =>
          node.author && node.onBehalfOf.nodes.length ? [[node.author.login, node.onBehalfOf.nodes.map(team => team.combinedSlug)]] : [],
        ),
      ),
    };
  }

  async mergeSettings(ref: PRRef, signal?: AbortSignal): Promise<{ methods: MergeMethod[]; autoMerge: boolean }> {
    const { data } = await this.request<{
      allow_merge_commit?: boolean;
      allow_squash_merge?: boolean;
      allow_rebase_merge?: boolean;
      allow_auto_merge?: boolean;
    }>(repoPath(ref), { signal });
    const methods = (['squash', 'merge', 'rebase'] as const).filter(
      method =>
        data[method === 'merge' ? 'allow_merge_commit' : method === 'squash' ? 'allow_squash_merge' : 'allow_rebase_merge'] !== false,
    );
    return { methods, autoMerge: data.allow_auto_merge === true };
  }

  async pullRequest(ref: PRRef, signal?: AbortSignal) {
    return (await this.request<PullRequest>(refPath(ref), { signal })).data;
  }

  // Write access lets GitHub users edit and delete anyone's comments.
  async canModerate(ref: PRRef) {
    return !!(await this.request<{ permissions?: { push?: boolean } }>(repoPath(ref))).data.permissions?.push;
  }

  async editPR(ref: PRRef, fields: Partial<Pick<PullRequest, 'title' | 'body' | 'state'>>) {
    return (await this.request<PullRequest>(refPath(ref), { method: 'PATCH', body: JSON.stringify(fields) })).data;
  }

  // REST cannot toggle draft state; only these GraphQL mutations can.
  async setDraft(pr: PullRequest, draft: boolean) {
    const name = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
    const inputType = draft ? 'ConvertPullRequestToDraftInput' : 'MarkPullRequestReadyForReviewInput';
    const data = await this.graphql<Record<string, { pullRequest: { isDraft: boolean } | null }>>(
      `mutation PullRequestDraft($input: ${inputType}!) { ${name}(input: $input) { pullRequest { isDraft } } }`,
      { input: { pullRequestId: pr.node_id } },
    );
    if (data?.[name]?.pullRequest?.isDraft !== draft) throw new Error('GitHub did not confirm the draft change. Refresh before retrying.');
  }

  async merge(ref: PRRef, sha: string, method: MergeMethod) {
    return (
      await this.request<{ merged: boolean; message: string }>(`${refPath(ref)}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: method, sha }),
      })
    ).data;
  }

  // Clean PRs refuse auto-merge, so they merge directly; GitHub then reports the queue state.
  async setAutoMerge(pr: PullRequest, method: MergeMethod | null) {
    const enable = method !== null;
    const name = enable ? 'enablePullRequestAutoMerge' : 'disablePullRequestAutoMerge';
    const data = await this.graphql<Record<string, { pullRequest: { autoMergeRequest: unknown } | null } | null>>(
      enable
        ? 'mutation EnableAutoMerge($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { autoMergeRequest { mergeMethod } } } }'
        : 'mutation DisableAutoMerge($input: DisablePullRequestAutoMergeInput!) { disablePullRequestAutoMerge(input: $input) { pullRequest { autoMergeRequest { mergeMethod } } } }',
      enable
        ? { input: { pullRequestId: pr.node_id, mergeMethod: method.toUpperCase(), expectedHeadOid: pr.head.sha } }
        : { input: { pullRequestId: pr.node_id } },
    );
    const confirmed = data?.[name]?.pullRequest;
    if (!confirmed || !!confirmed.autoMergeRequest !== enable)
      throw new Error('GitHub did not confirm the auto-merge change. Refresh before trying again.');
  }

  async mergeOrAutoMerge(ref: PRRef, pr: PullRequest, method: MergeMethod, autoMerge: boolean): Promise<'merged' | 'queued'> {
    if (!mergeReady(pr) && autoMerge) {
      try {
        await this.setAutoMerge(pr, method);
        return 'queued';
      } catch (error) {
        if (!(error instanceof Error && /clean status/i.test(error.message))) throw error;
      }
    }
    await this.merge(ref, pr.head.sha, method);
    return 'merged';
  }

  async rerunChecks(ref: PRRef, checks: StatusCheck[], failedOnly: boolean) {
    const runs = new Set(
      checks.flatMap(check => (check.job && (!failedOnly || blockingStates.includes(check.state)) ? [check.job.run] : [])),
    );
    await Promise.all(
      [...runs].map(run =>
        this.request(`${repoPath(ref)}/actions/runs/${run}/${failedOnly ? 'rerun-failed-jobs' : 'rerun'}`, { method: 'POST' }),
      ),
    );
    return runs.size;
  }

  async rerunJob(ref: PRRef, id: number) {
    await this.request(`${repoPath(ref)}/actions/jobs/${id}/rerun`, { method: 'POST' });
  }

  async repoLabels(ref: PRRef) {
    return (await this.pages<Label>(`${repoPath(ref)}/labels`, undefined, 3)).items;
  }

  async setLabels(ref: PRRef, labels: string[]) {
    return (
      await this.request<Label[]>(`${repoPath(ref)}/issues/${ref.number}/labels`, { method: 'PUT', body: JSON.stringify({ labels }) })
    ).data;
  }

  async assignableUsers(ref: PRRef) {
    return (await this.pages<User>(`${repoPath(ref)}/assignees`, undefined, 3)).items;
  }

  async repoTeams(ref: PRRef) {
    return (await this.pages<Team>(`${repoPath(ref)}/teams`, undefined, 3)).items;
  }

  // Teams are keyed `org/slug`; logins can't contain '/', and GitHub takes team slugs separately.
  async requestReviewers(ref: PRRef, keys: string[], remove = false) {
    return (
      await this.request<PullRequest>(`${refPath(ref)}/requested_reviewers`, {
        method: remove ? 'DELETE' : 'POST',
        body: JSON.stringify({
          reviewers: keys.filter(key => !key.includes('/')),
          team_reviewers: keys.filter(key => key.includes('/')).map(key => key.split('/')[1]),
        }),
      })
    ).data;
  }

  async reviewExists(ref: PRRef, id: number) {
    return this.requestIfPresent(`${refPath(ref)}/reviews/${id}`);
  }

  async discardReview(ref: PRRef, id: number) {
    return this.requestIfPresent(`${refPath(ref)}/reviews/${id}`, { method: 'DELETE' });
  }
}
