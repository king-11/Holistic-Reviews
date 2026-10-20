# Checks & Merging Specification

## CI Checks (`Checks.tsx`, `DetailsPanel.tsx`)

### Loading & Deduplication (`checks()` in `src/github.ts`)

Combines GitHub Actions / App check runs (`GET /commits/{sha}/check-runs`) and legacy commit statuses (`GET /commits/{sha}/status`):

1. **Check runs:** All pages are fetched. Runs are sorted by ID descending so the latest run wins, then deduplicated with one entry per job per workflow (`<workflow> / <job>` when a workflow name exists, falling back to `<app>:<name>`).
2. **Commit statuses:** Deduplicated by `context` (latest wins) and included only when no check run already has that name.
3. **State mapping & ordering:**
   - States: `failure`, `cancelled`, `pending`, `neutral`, `success`, `skipped`.
   - Sorted in that exact order so failing and cancelled checks appear first.
   - `failure` and `cancelled` are treated as blocking states (`blockingStates`).

### Re-running Checks

- Check runs whose URL matches `/actions/runs/<run>/job/<id>` expose an individual **Re-run** button (`POST /actions/jobs/{id}/rerun`).
- The toolbar provides **Re-run failed checks** (`POST /actions/runs/{run}/rerun-failed-jobs` for every run with a `failure` or `cancelled` job) and **Re-run all checks** (`POST /actions/runs/{run}/rerun`).

## Merge Readiness & Controls (`MergeControls`, `MergeMenu`)

### Definitions

- **`mergeReady(pr)`:** `pr.state === 'open' && !pr.draft && ['clean', 'has_hooks', 'unstable'].includes(pr.mergeable_state ?? '')`.
- **`mergeabilityPending(pr)`:** `pr.state === 'open' && (pr.mergeable === null || pr.mergeable_state === 'unknown')`.
- **`reviewApproved(pr, reviews, onBehalfOf)`:** Derived from `reviewerStates`: at least one reviewer is `APPROVED` and none is `CHANGES_REQUESTED`.
- **`mergeOffered`:** `mergeReady(pr) || (!pr.draft && mergeabilityPending(pr) && reviewApproved)`.
  - Rationale: On busy repositories where the base branch moves constantly, GitHub can report `unknown` almost continuously; offering merge on approved PRs while `unknown` lets GitHub enforce branch protection on the merge call itself without deadlocking the UI.

### Top-Bar Merge Button

- **Closed or merged PR:** Renders an **Open in GitHub** link.
- **When `mergeOffered` is true:** Renders a primary **Merge** button. Its menu lists the repository's allowed merge methods (`Squash and merge`, `Create a merge commit`, `Rebase and merge`). Clicking a method asks for confirmation (`Confirm squash and merge`), then calls `PUT /pulls/{n}/merge` pinned to `pr.head.sha`. When `mergeReady(pr)` is false (still `unknown`), each option shows the hint _"GitHub is still checking mergeability; it has the final say when you merge."_
- **When `mergeOffered` is false:** Renders a muted **⚠ Not ready to merge** button whose tooltip and menu display the most specific blocker (`notReadyReason`):
  1. `pr.draft` → _"Draft pull requests can’t be merged"_
  2. `pr.mergeable_state === 'dirty'` → _"This branch has conflicts that must be resolved"_
  3. `pr.mergeable_state === 'behind'` → _"This branch is out of date with the base branch"_
  4. `!reviewApproved` → _"This PR needs more approvals"_
  5. Otherwise (`blocked`) → _"Required reviews or checks aren’t satisfied yet"_

### Mergeability Polling

While a PR page is open and `mergeabilityPending(pr)` is true, the page polls `GET /pulls/{n}` (`no-cache`) at `2s, 4s, 8s, 16s, 30s` and updates `pr` in place (ignoring any poll that started before a write).

### Auto-Merge Switch

- Shown next to the Merge button when the repository has `allow_auto_merge: true` and the PR is open and not a draft (disabled when `mergeable_state === 'dirty'`).
- Toggling calls GraphQL `enablePullRequestAutoMerge` (with the repository's first allowed merge method and `expectedHeadOid: pr.head.sha`) or `disablePullRequestAutoMerge`.
- If GitHub rejects enabling auto-merge with _"Pull request is in clean status"_, the switch reverts and displays an error toast: _"This pull request is already mergeable. Use Merge."_

## PR Lifecycle Actions (`MoreMenu`)

Available on unmerged PRs via the `⋯` menu:

- **Open PR:** _Convert to draft_ / _Ready for review_ (GraphQL `convertPullRequestToDraft` / `markPullRequestReadyForReview`) and _Close pull request_ (`PATCH /pulls/{n}`).
- **Closed (unmerged) PR:** _Reopen pull request_ (`PATCH /pulls/{n}`).
