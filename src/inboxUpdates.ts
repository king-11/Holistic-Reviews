import { shallowRef } from 'vue';
import {
  itemRepository,
  pullRequestReviewers,
  reviewOutcome,
  teamKey,
  type Comment,
  type InboxGroup,
  type InboxItem,
  type MergedFilter,
  type PullRequest,
  type PRRef,
  type Review,
} from './github.ts';
import { createSnapshotStore, snapshotLifetime } from './snapshots.ts';

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

const writtenPRs = createSnapshotStore<{ fields: Partial<PullRequest>; at: number }>();
// One PR has one set of written fields, so it takes a single fixed key in the shared store.
const writtenPRKey = 0;
const prKey = (ref: PRRef) => `${ref.owner}/${ref.repo}#${ref.number}`;
export function recordPRFields(ref: PRRef, fields: Partial<PullRequest>) {
  const previous = writtenPRs.get(prKey(ref), writtenPRKey)?.fields ?? {};
  writtenPRs.set(prKey(ref), writtenPRKey, { fields: { ...previous, ...fields }, at: Date.now() });
}
export function writtenPRFields(ref: PRRef) {
  return writtenPRs.get(prKey(ref), writtenPRKey)?.fields ?? {};
}
export function clearWrittenPRFields(ref: PRRef) {
  writtenPRs.remove(prKey(ref), writtenPRKey);
}

function involvement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string, teams?: string[]) {
  const row = pullRequestReviewers(pr, reviews).find(reviewer => reviewer.login === viewer);
  // A single line comment is a review on GitHub, so it counts as reviewed-by too.
  const reviewed =
    !!row?.review ||
    comments.some(comment => comment.user.login === viewer && !reviews.some(review => review.id === comment.pull_request_review_id));
  const direct = !!row?.requested;
  const team = !pr.requested_teams?.length
    ? false
    : teams
      ? pr.requested_teams.some(entry => teams.includes(teamKey(pr, entry.slug)))
      : undefined;
  return { reviewed, direct, team };
}

export function placement(pr: PullRequest, reviews: Review[], comments: Comment[], viewer: string, teams?: string[]): Placement {
  const open = pr.state === 'open';
  const mine = pr.user.login === viewer;
  const { reviewed, direct, team } = involvement(pr, reviews, comments, viewer, teams);
  // Submitting any review clears a team request; a request by name always wins over one through a team.
  const ready = open && !pr.draft;
  return {
    requested: ready && direct,
    team: ready && !direct && (reviewed ? false : team),
    authored: open && mine && !pr.draft,
    drafts: open && mine && pr.draft,
    reviewed: open && !mine && reviewed && !direct,
    merged: pr.merged,
  };
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
    // REST reviews stand in for GraphQL's reviewDecision until search catches up.
    review: reviewOutcome(pullRequestReviewers(pr, reviews), pr.user.login),
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
  writtenPRs.clear();
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
