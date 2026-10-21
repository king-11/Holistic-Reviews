import type { PeopleKind, Person } from './people';
import type { PriorityInput } from './priority';

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
  `${repoPath(ref)}/${comment.path || comment.pull_request_review_id ? 'pulls' : 'issues'}/comments/${comment.id}`;
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
  pendingComments: number;
  priority: PriorityInput;
  participants: { login: string; avatarUrl: string }[];
  participantCount: number;
  conflict?: boolean;
  // Requested teams as org/slug, for grouping team review requests.
  teams?: string[];
  // Humans whose latest review requested changes.
  changesBy?: string[];
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
export const searchPageSize = 100;
// GitHub search returns at most 1,000 results.
export const searchResultCap = 1000;
const restPageSize = 100;
// Bounds requests on huge PRs; 30 full pages reach REST's 3,000-file ceiling, and PR commits stop at 250.
const maxPages = { default: 30, reviews: 20, lists: 10, commits: 3, pickers: 3 } as const;
// GitHub's compare endpoint returns at most 300 files.
const compareFileLimit = 300;
const maxTextFileBytes = 1_048_576;
const contentCacheSize = 32;
// Review fields feed the authored classification; they are fetched for every page so one query serves all groups.
const pullRequestDetailFields =
  'createdAt additions deletions commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } recentCommits: commits(last: 20) { nodes { commit { oid committedDate } } } viewerLatestReview { submittedAt commit { oid } } readyEvents: timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) { nodes { ... on ReadyForReviewEvent { createdAt } } } pendingReviews: reviews(states: PENDING, first: 1) { nodes { comments { totalCount } } } participants(first: 10) { totalCount nodes { login avatarUrl(size: 40) } } mergeable reviewDecision latestReviews(first: 50) { nodes { state submittedAt author { __typename login } } } reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on User { login } ... on Team { combinedSlug } } } }';
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
export type InboxGroup = 'requested' | 'team' | 'authored' | 'drafts' | 'merged';
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
  reviewThreads: ReviewThread[];
  // The viewer's pending review comments, loaded separately because they are private until submitted.
  draftComments: Comment[];
  checks?: StatusCheck[];
  linkedIssues?: LinkedIssue[];
  codeOwners?: string[];
  onBehalfOf?: Record<string, string[]>;
  mergeMethods?: MergeMethod[];
  autoMerge?: boolean;
  timeline: TimelineEvent[];
  pending: WorkspaceSection[];
}

// Line events from the issue timeline; comments and reviews stay in their own lists so editing them is unchanged.
export interface TimelineEvent {
  event: (typeof timelineEvents)[number];
  id: string;
  created_at: string;
  actor?: User;
  label?: Label;
  rename?: { from: string; to: string };
  requested_reviewer?: User;
  requested_team?: Team;
  commit_id?: string | null;
  before_commit_id?: string;
  source?: { issue?: { number: number; title: string; html_url: string } };
  commit?: { sha: string; html_url: string; message: string; author: string };
}
export const timelineEvents = [
  'committed',
  'head_ref_force_pushed',
  'labeled',
  'unlabeled',
  'renamed',
  'review_requested',
  'review_request_removed',
  'ready_for_review',
  'convert_to_draft',
  'merged',
  'closed',
  'reopened',
  'cross-referenced',
  'head_ref_deleted',
] as const;

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
  seconds?: number;
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
export const checkOrder: CheckState[] = ['failure', 'cancelled', 'pending', 'neutral', 'success', 'skipped'];
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
  teams?: string[];
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

// The app's PR route mirrors GitHub's path, so prefixing a GitHub origin parses it back with parsePRUrl.
export const prPath = (ref: PRRef) => `/${ref.owner}/${ref.repo}/pull/${ref.number}`;
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
  latestReviews: { state: string; submittedAt?: string; author: { __typename: string; login: string } | null }[];
  requested: string[];
};
// One row per reviewer: their latest submitted review and whether a request is still open. The sidebar, Merge button
// and inbox all read review state from these rows, so they cannot disagree.
export interface Reviewer {
  login: string;
  review?: string;
  requested: boolean;
  human: boolean;
}
export function reviewerStates(reviews: { login: string; state: string; human: boolean }[], requested: string[]): Reviewer[] {
  const rows = new Map<string, Reviewer>();
  for (const { login, state, human } of reviews)
    if (state !== 'PENDING') rows.set(login, { login, review: state, requested: false, human });
  for (const login of requested) rows.set(login, { login, human: true, ...rows.get(login), requested: true });
  return [...rows.values()];
}
// A team request is satisfied once a member reviews on the team's behalf.
export function pullRequestReviewers(pr: PullRequest, reviews: Review[], onBehalfOf: Record<string, string[]> = {}) {
  const covered = new Set(Object.values(onBehalfOf).flat());
  const teams = (pr.requested_teams ?? []).map(team => teamKey(pr, team.slug)).filter(key => !covered.has(key));
  return reviewerStates(
    reviews.map(review => ({ login: review.user.login, state: review.state, human: (review.user.type ?? 'User') === 'User' })),
    [...(pr.requested_reviewers ?? []).map(user => user.login), ...teams],
  );
}
export const teamKey = (pr: PullRequest, slug: string) => `${pr.base.repo?.full_name.split('/')[0]}/${slug}`;
// Bots never count as reviewer feedback; GitHub never records an author approval, but authors comment on their own PRs.
const humans = (reviewers: Reviewer[]) => reviewers.filter(row => row.human);
// What GitHub's reviewDecision would say: a request for changes blocks until that reviewer approves or it is dismissed.
export function reviewDecision(reviewers: Reviewer[]): ReviewSummary['reviewDecision'] {
  const states = humans(reviewers).map(row => row.review);
  return states.includes('CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : states.includes('APPROVED') ? 'APPROVED' : null;
}
// GitHub's own decision wins when known; null means the repository requires no reviews, so any approval counts.
export function reviewOutcome(reviewers: Reviewer[], author: string, decision = reviewDecision(reviewers)): ReviewState {
  const rows = humans(reviewers).filter(row => row.login !== author);
  const blockers = rows.filter(row => row.review === 'CHANGES_REQUESTED');
  // Re-requesting everyone who asked for changes hands the PR back to them; comments alone never return it.
  if (decision === 'CHANGES_REQUESTED') return blockers.length && blockers.every(row => row.requested) ? 'waiting' : 'returned';
  if (decision === 'APPROVED' || (decision === null && rows.some(row => row.review === 'APPROVED'))) return 'approved';
  return blockers.some(row => !row.requested) ? 'returned' : 'waiting';
}
export const classifyReview = (summary: ReviewSummary, author: string) =>
  reviewOutcome(
    reviewerStates(
      summary.latestReviews.flatMap(review =>
        review.author ? [{ login: review.author.login, state: review.state, human: review.author.__typename === 'User' }] : [],
      ),
      summary.requested,
    ),
    author,
    summary.reviewDecision,
  );

// Your open PRs land in exactly one section, by what has to happen next.
export type AuthoredSection = 'attention' | 'ready' | 'waiting';
export const authoredSection = (item: InboxItem): AuthoredSection =>
  item.review === 'returned' || item.details?.checks === 'failure' || item.details?.conflict
    ? 'attention'
    : item.review === 'approved'
      ? 'ready'
      : 'waiting';

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function itemRepository(item: Pick<InboxItem, 'repository_url'>): string {
  return item.repository_url.replace('https://api.github.com/repos/', '');
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
    requested: `is:open user-review-requested:${login} draft:false`,
    // Team requests are whatever review-requested adds on top of requests made to the viewer by name.
    team: `is:open review-requested:${login} -user-review-requested:${login} draft:false`,
    authored: `is:open author:${login} draft:false`,
    drafts: `is:open author:${login} draft:true`,
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

  // GitHub names every mutation input `<Mutation>Input`, so one template serves them all.
  private async mutation<T>(name: string, input: object, selection: string) {
    const type = `${name[0].toUpperCase()}${name.slice(1)}`;
    const data = await this.graphql<Record<string, T | null>>(
      `mutation ${type}($input: ${type}Input!) { ${name}(input: $input) { ${selection} } }`,
      { input },
    );
    return data?.[name];
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
    pageLimit: number = maxPages.default,
    pick: (body: B) => T[] = body => body as unknown as T[],
  ): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    for (let page = 1; page <= pageLimit; page++) {
      const { data, headers } = await this.request<B>(`${path}${path.includes('?') ? '&' : '?'}per_page=${restPageSize}&page=${page}`, {
        signal,
      });
      const batch = pick(data);
      items.push(...batch);
      const more = headers.get('link')?.includes('rel="next"') ?? batch.length === restPageSize;
      if (!more) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  // Publishes the PR as soon as it arrives, then each section as it settles, so the page never waits on the slowest request.
  // Passing `previous` refreshes in place: settled sections stay on screen until their replacement arrives.
  async workspace(
    ref: PRRef,
    signal?: AbortSignal,
    onUpdate: (workspace: Workspace) => void = () => {},
    previous?: Workspace,
  ): Promise<Workspace> {
    const path = refPath(ref);
    const { data: pr } = await this.request<PullRequest>(path, { signal });
    let current: Workspace = {
      files: [],
      comments: [],
      inlineComments: [],
      reviews: [],
      related: [],
      reviewThreads: [],
      draftComments: [],
      timeline: [],
      reviewsLoaded: false,
      ...previous,
      pr,
      warnings: [],
      pending: previous ? previous.pending : [...workspaceSections],
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
    const failed = (name: string, error: unknown) => `${name} could not be loaded: ${errorMessage(error, String(error))}`;
    const section = <T>(
      name: WorkspaceSection,
      label: string,
      load: () => Promise<{ items: T[]; truncated: boolean }>,
      patch: (items: T[], truncated: boolean) => Partial<Workspace>,
    ) =>
      load().then(
        ({ items, truncated }) =>
          settle(name, patch(items, truncated), truncated ? [`${label} is limited to the first ${items.length} results.`] : []),
        error => settle(name, {}, [failed(label, error)]),
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
        error => settle('files', {}, [failed('Changed files', error)]),
      ),
      this.timeline(ref, signal).then(
        ({ comments, timeline, truncated }) =>
          settle('comments', { comments, timeline }, truncated ? ['Conversation is limited to the first 1,000 timeline events.'] : []),
        error => settle('comments', {}, [failed('Conversation', error)]),
      ),
      section(
        'inlineComments',
        'Inline comments',
        () => this.pages<Comment>(`${path}/comments`, signal, maxPages.lists),
        items => ({ inlineComments: items }),
      ),
      section(
        'reviews',
        'Reviews',
        () => this.pages<Review>(`${path}/reviews`, signal, maxPages.reviews),
        (items, truncated) => ({ reviews: items, reviewsLoaded: !truncated }),
      ),
      section(
        'related',
        'Branch dependencies',
        () => this.pages<PullRequest>(`${repoPath(ref)}/pulls?state=open`, signal, maxPages.lists),
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
        error => settle('checks', {}, [failed('Checks', error)]),
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
      started_at?: string | null;
      completed_at?: string | null;
    };
    type WorkflowRun = { name: string | null; workflow_id: number; check_suite_id: number };
    type Status = { id: number; context: string; state: string; target_url: string | null; description: string | null };
    const [runs, { data: combined }, workflows] = await Promise.all([
      this.pages<Run, { check_runs: Run[] }>(`${base}/check-runs`, signal, maxPages.default, body => body.check_runs),
      this.request<{ statuses: Status[] }>(`${base}/status`, { signal }),
      // Best-effort: without Actions read access, checks still list with plain job names.
      this.pages<WorkflowRun, { workflow_runs: WorkflowRun[] }>(
        `${repoPath(ref)}/actions/runs?head_sha=${sha}`,
        signal,
        maxPages.lists,
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
        seconds:
          run.started_at && run.completed_at ? Math.round((Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000) : undefined,
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

  // One timeline read serves both the comment cards and the line events between them.
  async timeline(ref: PRRef, signal?: AbortSignal) {
    type Raw = Omit<TimelineEvent, 'event' | 'id' | 'created_at' | 'commit'> & {
      event: string;
      id?: number;
      node_id?: string;
      created_at?: string;
      user?: User;
      body?: string;
      html_url?: string;
      sha?: string;
      message?: string;
      author?: { name: string; date: string };
      committer?: { date: string };
    };
    const { items, truncated } = await this.pages<Raw>(`${repoPath(ref)}/issues/${ref.number}/timeline`, signal, maxPages.lists);
    const comments: Comment[] = items
      .filter(item => item.event === 'commented')
      .map(({ id, node_id, body, user, created_at, html_url }) => ({
        id: id!,
        node_id,
        body: body ?? '',
        user: user!,
        created_at: created_at!,
        html_url,
      }));
    const timeline: TimelineEvent[] = items.flatMap(item =>
      (timelineEvents as readonly string[]).includes(item.event)
        ? [
            {
              ...item,
              event: item.event as TimelineEvent['event'],
              id: item.node_id ?? item.sha ?? String(item.id),
              created_at: item.created_at ?? item.committer?.date ?? item.author!.date,
              commit: item.sha
                ? { sha: item.sha, html_url: item.html_url!, message: item.message ?? '', author: item.author?.name ?? '' }
                : undefined,
              source: item.source?.issue && {
                issue: { number: item.source.issue.number, title: item.source.issue.title, html_url: item.source.issue.html_url },
              },
            },
          ]
        : [],
    );
    // REST only reports the new head of a force push; GraphQL also knows the commit it replaced.
    const pushes = timeline.filter(item => item.event === 'head_ref_force_pushed');
    if (pushes.length) {
      const data = await this.graphql<{ nodes: ({ id: string; beforeCommit: { oid: string } | null } | null)[] }>(
        'query ForcePushes($ids: [ID!]!) { nodes(ids: $ids) { ... on HeadRefForcePushedEvent { id beforeCommit { oid } } } }',
        { ids: pushes.map(item => item.id) },
        signal,
      ).catch(() => undefined);
      for (const node of data?.nodes ?? []) {
        const push = node && pushes.find(item => item.id === node.id);
        if (push && node.beforeCommit) push.before_commit_id = node.beforeCommit.oid;
      }
    }
    return { comments, timeline, truncated };
  }

  async commits(ref: PRRef, signal?: AbortSignal) {
    return this.pages<Commit>(`${refPath(ref)}/commits`, signal, maxPages.commits);
  }

  async compare(ref: PRRef, base: string, head: string, signal?: AbortSignal): Promise<Comparison> {
    if (!immutableSha.test(base) || !immutableSha.test(head)) throw new Error('Select immutable commit SHAs to compare.');
    // Files are not paginated; one commit per page keeps the unused commit list small.
    const { data } = await this.request<{ files: ChangedFile[]; merge_base_commit: { sha: string } }>(
      `${repoPath(ref)}/compare/${base}...${head}?per_page=1`,
      { signal },
    );
    if (!data.files || !immutableSha.test(data.merge_base_commit?.sha)) throw new Error('GitHub did not return a complete comparison.');
    return { files: data.files, mergeBase: data.merge_base_commit.sha, truncated: data.files.length >= compareFileLimit };
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
      if (data.type !== 'file' || data.encoding !== 'base64' || data.size > maxTextFileBytes || data.content === undefined)
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
    if (this.contentCache.size >= contentCacheSize) this.contentCache.delete(this.contentCache.keys().next().value!);
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
      const data = await this.graphql<{ node: Reactions | null }>(
        `query CommentReactions($id: ID!) { node(id: $id) { ... on Reactable { ${reactionFields} } } }`,
        { id: subject.node_id },
      );
      if (!data?.node?.reactionGroups) throw new Error('Comment reactions could not be loaded.');
      return data.node;
    }
    const { items } = await this.pages<{ id: number; content: string; user: User | null }>(path, undefined, maxPages.lists);
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
      const confirmed = (
        await this.mutation<{ subject: Reactions | null }>(
          add ? 'addReaction' : 'removeReaction',
          { subjectId: subject.node_id, content },
          `subject { ${reactionFields} }`,
        )
      )?.subject;
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
    type Result = {
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
    const data = await this.graphql<Result>(
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
    {
      login,
      repos = [],
      page = 1,
      merged = 'mine',
      order = defaultSearchOrder,
    }: { login: string; repos?: string[]; page?: number; merged?: MergedFilter; order?: SearchOrder },
    signal?: AbortSignal,
  ) {
    const query = inboxQuery(group, login, repos, merged);
    // Only the OR of review-requested and reviewed-by needs advanced search; plain search rejects it with 422.
    const advanced = group === 'merged' && merged === 'reviewing' ? '&advanced_search=true' : '';
    const { data: result } = await this.request<InboxResult>(
      `/search/issues?q=${encodeURIComponent(query)}&sort=${order.sort}&order=${order.order}&per_page=${searchPageSize}&page=${page}${advanced}`,
      { signal },
    );
    if (!result.items.length) return result;
    try {
      return { ...result, items: await this.withPullRequestDetails(group, result.items, login, signal) };
    } catch {
      return result;
    }
  }

  // Items a detail batch misses stay as search returned them.
  private async withPullRequestDetails(group: InboxGroup, items: InboxItem[], login: string, signal?: AbortSignal): Promise<InboxItem[]> {
    type PullRequestData = {
      createdAt: string;
      additions: number;
      deletions: number;
      reviewDecision: ReviewSummary['reviewDecision'];
      commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
      recentCommits: { nodes: { commit: { oid: string; committedDate: string } }[] };
      viewerLatestReview: { submittedAt: string; commit: { oid: string } | null } | null;
      readyEvents: { nodes: { createdAt?: string }[] };
      pendingReviews: { nodes: { comments: { totalCount: number } }[] };
      participants: { totalCount: number; nodes: { login: string; avatarUrl: string }[] };
      latestReviews: { nodes: ReviewSummary['latestReviews'] };
      reviewRequests: {
        nodes: { asCodeOwner: boolean; requestedReviewer: { __typename: string; login?: string; combinedSlug?: string } | null }[];
      };
      mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
    };
    const chunkSize = 25; // GitHub's GraphQL resource limit rejects larger aliased batches.
    const chunks = Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, index) =>
      items.slice(index * chunkSize, (index + 1) * chunkSize),
    );
    const [detailChunks, stackChunks] = await Promise.all([
      Promise.all(
        chunks.map(async chunk => {
          const variables: Record<string, string | number> = {};
          const declarations: string[] = [];
          const selections = chunk.map((item, index) => {
            const [owner, name] = itemRepository(item).split('/');
            variables[`owner${index}`] = owner;
            variables[`name${index}`] = name;
            variables[`number${index}`] = item.number;
            declarations.push(`$owner${index}: String!, $name${index}: String!, $number${index}: Int!`);
            return `pr${index}: repository(owner: $owner${index}, name: $name${index}) { pullRequest(number: $number${index}) { ${pullRequestDetailFields} } }`;
          });
          try {
            return await this.graphql<Record<string, { pullRequest: PullRequestData | null } | null>>(
              `query InboxDetails(${declarations.join(', ')}) { ${selections.join(' ')} }`,
              variables,
              signal,
            );
          } catch {
            return undefined;
          }
        }),
      ),
      group === 'requested'
        ? Promise.all(chunks.map(chunk => this.requestedStackCounts(chunk, signal).catch(() => chunk.map(() => 0))))
        : Promise.resolve(chunks.map(chunk => chunk.map(() => 0))),
    ]);
    const stackCounts = stackChunks.flat();
    return items.map((item, index) => {
      const chunkIndex = Math.floor(index / chunkSize);
      const chunkItemIndex = index % chunkSize;
      const pr = detailChunks[chunkIndex]?.[`pr${chunkItemIndex}`]?.pullRequest;
      if (!pr) return item;
      const requested = pr.reviewRequests.nodes.flatMap(node => (node.requestedReviewer?.login ? [node.requestedReviewer.login] : []));
      const participants = pr.participants.nodes.filter(user => user.login !== item.user.login);
      const waitReadyAt = pr.readyEvents.nodes[0]?.createdAt ?? pr.createdAt;
      const reviewedOid = pr.viewerLatestReview?.commit?.oid;
      const reviewedIndex = reviewedOid ? pr.recentCommits.nodes.findIndex(({ commit }) => commit.oid === reviewedOid) : -1;
      const moreThanTwentyNewCommits = !!pr.viewerLatestReview && !!reviewedOid && reviewedIndex < 0;
      const newCommits = moreThanTwentyNewCommits ? 20 : reviewedIndex >= 0 ? pr.recentCommits.nodes.length - reviewedIndex - 1 : 0;
      const reviewedWithoutNewCommits = !!pr.viewerLatestReview && newCommits === 0 && !moreThanTwentyNewCommits;
      const firstNewCommit = moreThanTwentyNewCommits
        ? pr.recentCommits.nodes[0]?.commit.committedDate
        : reviewedIndex >= 0
          ? pr.recentCommits.nodes[reviewedIndex + 1]?.commit.committedDate
          : undefined;
      const waitStart = firstNewCommit ?? waitReadyAt;
      const checks = rollupChecks[pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? ''] ?? null;
      const changeRequests = pr.latestReviews.nodes.filter(
        review => review.state === 'CHANGES_REQUESTED' && review.author?.__typename === 'User' && review.author.login !== item.user.login,
      );
      const codeOwner = pr.reviewRequests.nodes.some(
        request =>
          request.asCodeOwner &&
          (request.requestedReviewer?.__typename === 'Team' ||
            (request.requestedReviewer?.__typename === 'User' && request.requestedReviewer.login === login)),
      );
      const details: PullRequestDetails = {
        additions: pr.additions,
        deletions: pr.deletions,
        createdAt: pr.createdAt,
        checks,
        pendingComments: pr.pendingReviews.nodes.reduce((total, review) => total + review.comments.totalCount, 0),
        priority: {
          waitStart,
          newCommits,
          moreThanTwentyNewCommits,
          reviewedWithoutNewCommits,
          stackedReady: stackCounts[index] ?? 0,
          codeOwner,
          checks,
        },
        participants,
        participantCount: pr.participants.totalCount - (participants.length < pr.participants.nodes.length ? 1 : 0),
        conflict: pr.mergeable === 'CONFLICTING',
        teams: pr.reviewRequests.nodes.flatMap(node => (node.requestedReviewer?.combinedSlug ? [node.requestedReviewer.combinedSlug] : [])),
        changesBy: changeRequests.map(review => review.author!.login),
      };
      const classified =
        group === 'authored' ? classifyReview({ ...pr, latestReviews: pr.latestReviews.nodes, requested }, item.user.login) : undefined;
      // GitHub keeps a change request until the reviewer looks again; a push after it means the author has answered.
      const lastPush = pr.recentCommits.nodes.at(-1)?.commit.committedDate ?? '';
      const answered = changeRequests.length > 0 && changeRequests.every(review => !!review.submittedAt && review.submittedAt < lastPush);
      const review = classified === 'returned' && answered ? 'waiting' : classified;
      return { ...item, details, ...(review ? { review } : {}) };
    });
  }

  private async requestedStackCounts(items: InboxItem[], signal?: AbortSignal): Promise<number[]> {
    const variables: Record<string, string | number> = {};
    const declarations: string[] = [];
    const selections = items.map((item, index) => {
      const [owner, name] = itemRepository(item).split('/');
      variables[`owner${index}`] = owner;
      variables[`name${index}`] = name;
      variables[`number${index}`] = item.number;
      declarations.push(`$owner${index}: String!, $name${index}: String!, $number${index}: Int!`);
      return `pr${index}: repository(owner: $owner${index}, name: $name${index}) { pullRequest(number: $number${index}) { number stack { entries(first: 100) { nodes { position pullRequest { number state isDraft } } } } } }`;
    });
    type StackPR = {
      number: number;
      stack: { entries: { nodes: { position: number; pullRequest: { number: number; state: string; isDraft: boolean } | null }[] } } | null;
    };
    const data = await this.graphql<Record<string, { pullRequest: StackPR | null } | null>>(
      `query InboxStacks(${declarations.join(', ')}) { ${selections.join(' ')} }`,
      variables,
      signal,
    );
    return items.map((_, index) => {
      const pr = data?.[`pr${index}`]?.pullRequest;
      const entries = pr?.stack?.entries.nodes ?? [];
      const position = entries.find(entry => entry.pullRequest?.number === pr?.number)?.position;
      if (position === undefined) return 0;
      return entries.filter(entry => entry.position < position && entry.pullRequest?.state === 'OPEN' && !entry.pullRequest.isDraft).length;
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
    type Result = { repository: { pullRequest: { reviewThreads: Connection } } };
    const items: ReviewThread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages.lists; page++) {
      // Annotated because `cursor` feeds back into this call, which defeats inference.
      const data: Result | undefined = await this.graphql<Result>(
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
    const thread = (
      await this.mutation<{ thread: { id: string; isResolved: boolean; viewerCanResolve: boolean; viewerCanUnresolve: boolean } | null }>(
        resolved ? 'resolveReviewThread' : 'unresolveReviewThread',
        { threadId: id },
        'thread { id isResolved viewerCanResolve viewerCanUnresolve }',
      )
    )?.thread;
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
      await this.request<Comment>(`${repoPath(ref)}/issues/${ref.number}/comments`, {
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

  async inlineComment(ref: PRRef, sha: string, { body, path, line, side, start_line, start_side }: ReviewCommentInput, review?: Review) {
    const start = start_line && start_side ? { line: start_line, side: start_side } : undefined;
    await this.ensureHead(ref, sha);
    if (review) {
      if (review.commit_id !== sha) throw new Error('Your pending review is on an older commit. Discard it and start a new review.');
      const added = await this.mutation<{ thread: { id: string } | null }>(
        'addPullRequestReviewThread',
        { pullRequestReviewId: review.node_id, body, path, line, side, ...(start ? { startLine: start.line, startSide: start.side } : {}) },
        'thread { id }',
      );
      if (!added?.thread) throw new Error('GitHub did not confirm the review comment.');
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
    return (await this.fresh().pages<Comment>(`${refPath(ref)}/reviews/${id}/comments`)).items;
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
      const comment = (
        await this.mutation<{ comment: Reply | null }>(
          'addPullRequestReviewThreadReply',
          { pullRequestReviewId: review.node_id, pullRequestReviewThreadId: threadId, body },
          'comment { id databaseId body createdAt url path line author { login __typename ... on User { databaseId } ... on Bot { databaseId } } pullRequestReview { databaseId } }',
        )
      )?.comment;
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
    const confirmed = (
      await this.mutation<{ pullRequestReviewComment: { body: string } | null }>(
        'updatePullRequestReviewComment',
        { pullRequestReviewCommentId: comment.node_id, body },
        'pullRequestReviewComment { id body }',
      )
    )?.pullRequestReviewComment;
    if (!confirmed) throw new Error('GitHub did not confirm the comment update. Refresh before trying again.');
    return { ...comment, body: confirmed.body };
  }

  async deleteComment(ref: PRRef, comment: Comment, pending = false) {
    if (!pending) {
      await this.request(commentPath(ref, comment), { method: 'DELETE' });
      return;
    }
    if (!comment.node_id) throw new Error('Refresh this PR to load the GitHub comment ID.');
    await this.mutation('deletePullRequestReviewComment', { id: comment.node_id }, 'clientMutationId');
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
    const confirmed = (
      await this.mutation<{ pullRequest: { isDraft: boolean } | null }>(
        draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview',
        { pullRequestId: pr.node_id },
        'pullRequest { isDraft }',
      )
    )?.pullRequest;
    if (confirmed?.isDraft !== draft) throw new Error('GitHub did not confirm the draft change. Refresh before retrying.');
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
    const confirmed = (
      await this.mutation<{ pullRequest: { autoMergeRequest: unknown } | null }>(
        enable ? 'enablePullRequestAutoMerge' : 'disablePullRequestAutoMerge',
        enable
          ? { pullRequestId: pr.node_id, mergeMethod: method.toUpperCase(), expectedHeadOid: pr.head.sha }
          : { pullRequestId: pr.node_id },
        'pullRequest { autoMergeRequest { mergeMethod } }',
      )
    )?.pullRequest;
    if (!confirmed || !!confirmed.autoMergeRequest !== enable)
      throw new Error('GitHub did not confirm the auto-merge change. Refresh before trying again.');
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
    return (await this.pages<Label>(`${repoPath(ref)}/labels`, undefined, maxPages.pickers)).items;
  }

  async setLabels(ref: PRRef, labels: string[]) {
    return (
      await this.request<Label[]>(`${repoPath(ref)}/issues/${ref.number}/labels`, { method: 'PUT', body: JSON.stringify({ labels }) })
    ).data;
  }

  // GitHub searches logins and names server-side; REST assignees would need every page of large orgs.
  async people(ref: Pick<PRRef, 'owner' | 'repo'>, kind: PeopleKind, search: string, first: number, signal?: AbortSignal) {
    const field = `${kind}Users`;
    const operation = `${field[0].toUpperCase()}${field.slice(1)}`;
    const data = await this.graphql<{ repository: { people: { nodes: Person[] } } | null }>(
      `query ${operation}($owner: String!, $name: String!, $search: String!, $first: Int!) { repository(owner: $owner, name: $name) { people: ${field}(query: $search, first: $first) { nodes { login name avatarUrl(size: 40) } } } }`,
      { owner: ref.owner, name: ref.repo, search, first },
      signal,
    );
    return data?.repository?.people.nodes ?? [];
  }

  async user(login: string): Promise<Person> {
    const { data } = await this.request<User & { name: string | null }>(`/users/${encodeURIComponent(login)}`);
    return { login: data.login, name: data.name, avatarUrl: data.avatar_url };
  }

  async repoTeams(ref: PRRef) {
    return (await this.pages<Team>(`${repoPath(ref)}/teams`, undefined, maxPages.pickers)).items;
  }

  async userTeams(signal?: AbortSignal) {
    const { items } = await this.pages<{ slug: string; organization: { login: string } }>('/user/teams', signal, maxPages.pickers);
    return items.map(team => `${team.organization.login}/${team.slug}`);
  }

  // Teams are keyed `org/slug`; logins can't contain '/', and GitHub takes team slugs separately.
  async requestReviewers(ref: PRRef, keys: string[], remove = false) {
    const reviewers = keys.filter(key => !key.includes('/'));
    const team_reviewers = keys.filter(key => key.includes('/')).map(key => key.split('/')[1]);
    const { data } = await this.request<PullRequest>(`${refPath(ref)}/requested_reviewers`, {
      method: remove ? 'DELETE' : 'POST',
      body: JSON.stringify({ reviewers, team_reviewers }),
    });
    // GitHub answers 200 even when it refuses to remove a required code owner, leaving them in the list.
    if (
      remove &&
      (reviewers.some(login => data.requested_reviewers?.some(user => user.login === login)) ||
        team_reviewers.some(slug => data.requested_teams?.some(team => team.slug === slug)))
    )
      throw new Error('GitHub kept this reviewer (code owners and required reviewers cannot be removed).');
    return data;
  }

  async reviewExists(ref: PRRef, id: number) {
    return this.requestIfPresent(`${refPath(ref)}/reviews/${id}`);
  }

  async discardReview(ref: PRRef, id: number) {
    return this.requestIfPresent(`${refPath(ref)}/reviews/${id}`, { method: 'DELETE' });
  }
}
