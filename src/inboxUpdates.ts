import { shallowRef } from 'vue';
import {
  itemRepository,
  pullRequestReviewers,
  reviewOutcome,
  type Comment,
  type InboxGroup,
  type InboxItem,
  type MergedFilter,
  type PullRequest,
  type Review,
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

function involvement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string) {
  const row = pullRequestReviewers(pr, reviews).find(reviewer => reviewer.login === viewer);
  // A single line comment is a review on GitHub, so it counts as reviewed-by too.
  const reviewed =
    !!row?.review ||
    comments.some(comment => comment.user.login === viewer && !reviews.some(review => review.id === comment.pull_request_review_id));
  return { reviewed, direct: !!row?.requested };
}

export function placement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string): Placement {
  const open = pr.state === 'open';
  const mine = pr.user.login === viewer;
  const { reviewed, direct } = involvement(pr, reviews, comments, viewer);
  // Submitting any review clears the viewer's request; otherwise a team request may still include them.
  const requested = direct ? true : reviewed || !pr.requested_teams?.length ? false : undefined;
  return {
    requested: open && !pr.draft ? requested : false,
    authored: open && mine && !pr.draft,
    drafts: open && mine && pr.draft,
    reviewed: open && !mine && reviewed,
    merged: pr.merged,
  };
}

const snapshots = shallowRef(new Map<string, PRSnapshot>());
export const inboxSnapshots = () => snapshots.value;

export function recordPR(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string) {
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
    // REST reviews stand in for GraphQL's reviewDecision until search catches up.
    review: reviewOutcome(pullRequestReviewers(pr, reviews), pr.user.login),
  };
  const { reviewed, direct } = involvement(pr, reviews, comments, viewer);
  snapshots.value = new Map(snapshots.value).set(pr.html_url, {
    item,
    placement: placement(pr, reviews, comments, viewer),
    involved: reviewed || direct,
    at: Date.now(),
  });
}

// When the viewer last changed a PR; the kept-alive inbox refetches on return if it loaded before this.
export const inboxChangedAt = shallowRef(0);
export const markInboxStale = () => (inboxChangedAt.value = Date.now());

export const clearInboxSnapshots = () => (snapshots.value = new Map());

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
