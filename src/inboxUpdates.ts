import { shallowRef } from 'vue';
import {
  classifyReview,
  itemRepository,
  type Comment,
  type InboxGroup,
  type InboxItem,
  type MergedFilter,
  type PullRequest,
  type Review,
  type ReviewSummary,
} from './github.ts';

// Where a PR belongs in each inbox group: true or false when the PR page knows, undefined when only search can tell
// (a review requested through a team the viewer may belong to).
export type Placement = Partial<Record<InboxGroup, boolean>>;
export interface PRSnapshot {
  item: InboxItem;
  placement: Placement;
  // Reviewed or directly requested; the merged "review requested" filter needs it after the PR closes.
  involved: boolean;
  at: number;
}

// GitHub search catches up with writes within about a minute; past this, what search says wins again.
export const snapshotLifetime = 3 * 60_000;

function involvement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string, teams?: string[]) {
  const submitted = (review: Review) => review.user.login === viewer && review.state !== 'PENDING';
  // A single line comment is a review on GitHub, so it counts as reviewed-by too.
  const reviewed =
    reviews.some(submitted) ||
    comments.some(comment => comment.user.login === viewer && !reviews.some(review => review.id === comment.pull_request_review_id));
  const direct = !!pr.requested_reviewers?.some(user => user.login === viewer);
  const owner = new URL(pr.html_url).pathname.split('/')[1];
  const team = !pr.requested_teams?.length
    ? false
    : teams
      ? pr.requested_teams.some(entry => teams.includes(`${owner}/${entry.slug}`))
      : undefined;
  return { reviewed, direct, team };
}

export function placement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string, teams?: string[]): Placement {
  const open = pr.state === 'open';
  const mine = pr.user.login === viewer;
  const { reviewed, direct, team } = involvement(pr, reviews, comments, viewer, teams);
  // Submitting any review clears a team request; otherwise direct or team membership decides.
  const requested = direct ? true : reviewed ? false : team;
  return {
    requested: open && !pr.draft ? requested : false,
    authored: open && mine && !pr.draft,
    drafts: open && mine && pr.draft,
    reviewed: open && !mine && reviewed,
    merged: pr.merged,
  };
}

// The authored sections split by review outcome; REST reviews stand in for GraphQL's reviewDecision until search catches up.
function reviewState(pr: PullRequest, reviews: Review[]) {
  const latest = new Map<string, ReviewSummary['latestReviews'][number]>();
  for (const review of reviews)
    if (review.state !== 'PENDING' && review.state !== 'DISMISSED')
      latest.set(review.user.login, { state: review.state, author: { __typename: review.user.type ?? 'User', login: review.user.login } });
  const latestReviews = [...latest.values()];
  return classifyReview(
    {
      reviewDecision: latestReviews.some(review => review.state === 'CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : null,
      latestReviews,
      requested: (pr.requested_reviewers ?? []).map(user => user.login),
    },
    pr.user.login,
  );
}

const snapshots = shallowRef(new Map<string, PRSnapshot>());
export const inboxSnapshots = () => snapshots.value;

export function recordPR(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string, teams?: string[]) {
  const item: InboxItem = {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    repository_url: `https://api.github.com/repos/${new URL(pr.html_url).pathname.split('/').slice(1, 3).join('/')}`,
    user: pr.user,
    draft: pr.draft,
    state: pr.state,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    comments: pr.comments,
    labels: pr.labels ?? [],
    review: reviewState(pr, reviews),
  };
  const { reviewed, direct, team } = involvement(pr, reviews, comments, viewer, teams);
  snapshots.value = new Map(snapshots.value).set(pr.html_url, {
    item,
    placement: placement(pr, reviews, comments, viewer, teams),
    involved: reviewed || direct || !!team,
    at: Date.now(),
  });
}

// When the viewer last changed a PR; the kept-alive inbox refetches on return if it loaded before this, and reopening
// that PR within snapshotLifetime bypasses the browser's 60s HTTP cache.
const mutated = new Map<string, number>();
export const inboxChangedAt = shallowRef(0);
export function markInboxStale(url?: string) {
  const now = Date.now();
  inboxChangedAt.value = now;
  if (url) mutated.set(url, now);
}
export const isRecentlyMutated = (url: string, now = Date.now()) => {
  const at = mutated.get(url);
  return at !== undefined && now - at < snapshotLifetime;
};

export function clearInboxSnapshots() {
  snapshots.value = new Map();
  mutated.clear();
}

export interface InboxView {
  login: string;
  repos: string[];
  merged: MergedFilter;
  now: number;
}

// Whether a recently merged PR passes the section's filter, mirroring inboxQuery.
function mergedVisible(snapshot: PRSnapshot, view: InboxView) {
  const mine = snapshot.item.user.login === view.login;
  if (view.merged === 'mine' || !view.repos.length) return mine;
  // Team requests aren't visible here, so an uninvolved viewer is left to search.
  if (view.merged === 'reviewing') return mine ? false : snapshot.involved || undefined;
  return true;
}

// Corrects one group's search results with what PR pages saw since, returning how many rows that added or removed.
// `known` holds every loaded row, so a PR moving between groups keeps its checks, size and participants.
export function withSnapshots(
  group: InboxGroup,
  items: InboxItem[],
  all: Map<string, PRSnapshot>,
  view: InboxView,
  known = new Map<string, InboxItem>(),
) {
  const live = new Map([...all].filter(([, snapshot]) => view.now - snapshot.at < snapshotLifetime));
  const belongs = (snapshot: PRSnapshot) => {
    if (view.repos.length && !view.repos.includes(itemRepository(snapshot.item))) return false;
    const placed = snapshot.placement[group];
    return group === 'merged' && placed ? mergedVisible(snapshot, view) : placed;
  };
  let delta = 0;
  const kept = items.flatMap(item => {
    const snapshot = live.get(item.html_url);
    if (!snapshot) return [item];
    if (belongs(snapshot) === false) {
      delta--;
      return [];
    }
    return [{ ...item, ...snapshot.item, id: item.id, details: item.details }];
  });
  const present = new Set(items.map(item => item.html_url));
  for (const [url, snapshot] of live)
    if (!present.has(url) && belongs(snapshot) === true) {
      const loaded = known.get(url);
      kept.push({ ...loaded, ...snapshot.item, id: loaded?.id ?? snapshot.item.id, details: loaded?.details });
      delta++;
    }
  return { items: kept, delta };
}
