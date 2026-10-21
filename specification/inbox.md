# Inbox Specification

The inbox (`/` route, kept alive across PR navigations) groups pull requests into seven sections backed by five GitHub search queries (`is:pr archived:false` plus optional `repo:<owner>/<name>` qualifiers).

## Sections & Search Queries

| Section                | Group                              | Search Query                                    | Notes                                                                                               |
| ---------------------- | ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Needs your review**  | `requested`                        | `is:open review-requested:<viewer> draft:false` | Ready-for-review PRs requesting the viewer directly or via a team.                                  |
| **Returned to you**    | `authored` (`review = 'returned'`) | `is:open author:<viewer> draft:false`           | Viewer's open PRs where a human reviewer requested changes or commented without being re-requested. |
| **Approved**           | `authored` (`review = 'approved'`) | `is:open author:<viewer> draft:false`           | Viewer's open PRs approved by reviewers with no outstanding changes requested.                      |
| **Waiting for review** | `authored` (`review = 'waiting'`)  | `is:open author:<viewer> draft:false`           | Viewer's open PRs with no actionable human review yet, or where reviewers were re-requested.        |
| **Drafts**             | `drafts`                           | `is:open author:<viewer> draft:true`            | Viewer's open draft PRs.                                                                            |
| **Reviewed by you**    | `reviewed`                         | `is:open reviewed-by:<viewer> -author:<viewer>` | Open PRs (including drafts) the viewer has reviewed. Collapsed by default.                          |
| **Recently merged**    | `merged`                           | Filter-dependent (see below)                    | Merged PRs. Collapsed by default.                                                                   |

### Recently Merged Filter

Rendered as a segmented radio group (`All`, `By me`, `Review requested`) in the **Recently merged** header bar; clicking any option expands the section:

- **All:** `is:merged` when at least one repository is selected; disabled when no repository is selected (falls back to `By me`).
- **By me:** `is:merged author:<viewer>`.
- **Review requested:** `is:merged (review-requested:<viewer> OR reviewed-by:<viewer>) -author:<viewer>` with `advanced_search=true`.

## Authored PR Classification (`classifyReview`)

Each search page is enriched with parallel aliased GraphQL batches of up to 25 items (`InboxDetails`) to stay within GitHub's GraphQL resource limit; a failed batch leaves only its own items unenriched. For the `authored` group, each PR is classified into `returned`, `approved`, or `waiting` ignoring bots (`__typename !== 'User'`) and the PR author:

1. `reviewDecision === 'CHANGES_REQUESTED'` → **`returned`**.
2. `reviewDecision === 'APPROVED'`, or `reviewDecision === null` with at least one human `APPROVED` review → **`approved`**.
3. Any human latest review is `COMMENTED` or `CHANGES_REQUESTED` **and** that reviewer is not currently in `reviewRequests` → **`returned`**.
4. Otherwise → **`waiting`**.

## Row Indicators

Each row (`InboxRow`) is a `<NuxtLink>` to `/<owner>/<repo>/pull/<number>` displaying:

- Status icon (`merged`, `draft`, or `open`), repository `owner/name#number`, title, author, relative update time, and labels.
- **Participants:** Up to 4 avatars (excluding the PR author) plus a `+N` overflow badge.
- **Checks:** Latest commit `statusCheckRollup` mapped to `success` (green check), `failure`/`error` (red cross), `pending`/`expected` (amber dashed circle), or empty when no checks exist.
- **Diff size:** `+additions` and `−deletions`.
- **Pending review comments:** A dashed `N pending` pill when the viewer has unpublished inline comments on the PR.

## Repository Filter & Sorting

- **Default repository:** After the first unfiltered load, the repository with the highest PR count is selected automatically. Subsequent changes are persisted in `localStorage` (`review.inbox`: `repos`, `sort`, `known`).
- **Sorting:**
  - `Updated` (`updated-desc` / `updated-asc`) and `Created` (`created-desc` / `created-asc`) sort on the server via `/search/issues` parameters and also sort loaded items client-side.
  - `Title` (`title-asc` / `title-desc`) and `Size of change` (`size-desc` / `size-asc`, where `size = additions + deletions`) sort loaded items client-side.
  - `Priority` is the default sort (`updated-desc` on GitHub); it ranks only **Needs your review** into Now (score ≥ 50), Soon (≥ 20), and Later. Other sections use updated-desc ordering while Priority is selected.

## Search Result Loading

GitHub search requests up to 100 results per page (its maximum), while each inbox section initially reveals 10. Rows are filtered and sorted before the visible limit is applied, so priority mode shows the highest-ranked loaded PRs first and lane counts include only visible rows. **Load more** reveals the next 10 loaded matches, requesting another 100-result API page only when needed. When searching locally, the visible count is measured against loaded rows matching the search. Limits reset to 10 after a full reload, repository or sort change, or merged-filter change; quiet background refreshes preserve the current limits. The button does not change the viewport when rows are revealed.

## Needs Your Review Priority

The `InboxDetails` batches provide the last ready-for-review event (falling back to `createdAt`), the latest commit check rollup, the latest 20 commit OIDs and timestamps, the viewer's latest submitted review and reviewed OID, and code-owner review requests. A separate set of aliased stack queries runs in parallel in the same 25-item chunks for requested PRs; a failed chunk gets zero stack points for its items. Stack entries above the current PR count only when open and not draft.

The score adds:

- Stack points: `min(30, 15 × log₂(1 + n))`, where `n` is the count of ready PRs stacked above this one.
- Waiting points: `min(30, 30 × ln(1 + h) / ln(17))`, where `h` is weekday 09:00–17:00 working time in the viewer's local time zone. A viewer review with no new commits earns no waiting points.
- 20 points for a code-owner request assigned to the viewer or a team, and 15 for successful checks. Failing checks always put the PR in Later.

Rows show reason chips rather than a bare score. The ready-time chip shows real elapsed time and its tooltip explains the working-hours score. New commits are counted after the reviewed OID; if it is absent from the recent 20, the chip says `20+ new commits since your review` and waiting starts at the oldest listed commit. Labels do not affect priority. Within a lane, higher scores come first and ties are broken by smaller total diff size.

Priority mode shows a count in each Now, Soon, and Later heading. When Now is empty, its only empty-state message is “Nothing is waiting on you.”

## Immediate Updates After PR Actions (`inboxUpdates`)

Because the inbox stays alive and GitHub's search index lags writes by up to a minute:

1. Whenever a PR page has loaded its reviews, it records a snapshot (`recordPR`) with a 3-minute TTL (`snapshotLifetime`) containing the PR's latest metadata and its computed group placement:
   - `requested`: `false` if not open or draft; else `true` if the viewer is in `requested_reviewers`; else `false` if the viewer has submitted a review or commented inline; else whether any `requested_teams` entry is in the viewer's cached `info.teams` (`undefined` only if viewer teams are unknown).
   - `authored`: `open && mine && !draft` (with `review` computed via `classifyReview` from loaded reviews and `requested_reviewers`).
   - `drafts`: `open && mine && draft`.
   - `reviewed`: `open && !mine && reviewed`.
   - `merged`: `pr.merged`.
2. `withSnapshots` overlays live snapshots onto each inbox group: removing rows whose placement is `false`, adding rows whose placement is `true` (preserving previously loaded `details`), updating titles/labels in place, and adjusting section counts by the net delta.
3. Returning to the inbox after any write (`inboxChangedAt > fetchedAt`) triggers a quiet background refresh (`api.fresh()`) that updates each section in place as it arrives without blanking the list.
