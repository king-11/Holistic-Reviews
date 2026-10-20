# Reviews & Comments Specification

## Comment & Review Types

| Action                                                                       | Allowed on Closed/Merged PRs?                         | Behavior                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conversation comment** (bottom of Conversation tab)                        | Yes                                                   | Publishes immediately via `POST /issues/{n}/comments`. Does not count as a PR review.                                                                                      |
| **Single line comment** (`Add single comment` in diff)                       | Yes (`canReply`)                                      | Publishes immediately via `POST /pulls/{n}/comments` when no pending review exists. Clears the viewer's review request.                                                    |
| **Single thread reply** (`Reply` in thread)                                  | Yes (`canReply`)                                      | Publishes immediately via `POST /pulls/{n}/comments/{id}/replies` when no pending review exists. Clears the viewer's review request.                                       |
| **Start a review** (from line composer or thread reply)                      | Open PRs only (`canReview`)                           | Creates a `PENDING` review on the current `head.sha` and attaches the comment/reply to it.                                                                                 |
| **Add to pending review**                                                    | While a `PENDING` review exists on current `head.sha` | Attaches new line comments and replies to the active `PENDING` review (`pull_request_review_id` / GraphQL `addPullRequestReviewThread` or `addPullRequestReviewComment`).  |
| **Submit review** (`Review changes` dialog or `r y` / `r a` / `r c` / `r n`) | Open PRs only                                         | Publishes `APPROVE`, `COMMENT`, or `REQUEST_CHANGES` (submitting the active `PENDING` review if one exists, or creating a new review). Clears the viewer's review request. |
| **Discard pending review**                                                   | When `PENDING` review exists                          | Deletes the `PENDING` review and all its unpublished comments after confirmation.                                                                                          |

## Pending Review Comments

- The PR header and each changed-file header show a dashed, muted `N pending` pill when the viewer has unpublished inline comments; inbox rows show the pending total returned by GitHub's viewer-specific `pendingReviews` connection.
- The Submit review sheet lists each pending comment as `file:line` with its body. Existing edit and delete actions update the pending comment on GitHub; a stale reread must not replace an edited body during the current PR session. Selecting a location closes the sheet and navigates to the matching diff thread when it is available.
- Pending comments are already stored on GitHub as a pending review; leaving the PR does not prompt for confirmation.

## Safety & Commit Pinning (`ensureHead`)

- Before any inline comment or review write, the app fetches `GET /pulls/{n}` (`no-cache`) and verifies `pr.head.sha` still matches the displayed diff's `head.sha`. If new commits were pushed, the write is refused with an instruction to refresh.
- If the viewer already has a `PENDING` review whose `commit_id !== pr.head.sha` (`stalePending`), inline commenting and review submission are blocked until that stale pending review is discarded.
- Line comments are only allowed on lines belonging to a single hunk of the original PR diff (not on expanded read-only context lines or commit-range comparisons).

## Editing & Deleting Comments

- **Who can edit:** The comment/review author, or any user with repository push access (`canModerate`). Submitted reviews can only be edited if they have a non-empty body; they cannot be deleted on GitHub.
- **Published comments:** Edited via `PATCH` and deleted via `DELETE` on `/issues/comments/{id}` or `/pulls/comments/{id}`.
- **Pending review comments:** Must be edited via GraphQL `updatePullRequestReviewComment` and deleted via `deletePullRequestReviewComment` using `node_id` (REST rejects pending review comment mutations in some states).
- **Empty pending review cleanup:** After deleting a pending review comment, the app checks `reviewExists` (`GET /pulls/{n}/reviews/{id}` with `no-cache`). If GitHub automatically deleted the now-empty pending review (404), local pending state is cleared.

## Review Threads & Resolution

- Threads are matched to REST comments by their root comment's database ID (`rootCommentId`).
- **Resolve / Reopen** calls GraphQL `resolveReviewThread` / `unresolveReviewThread` when `canResolve` / `canUnresolve` is true, and smoothly folds or unfolds the thread body (`200ms --ease-out`).
- Unresolved threads default to expanded; resolved threads default to collapsed. Manual expand/collapse choices are remembered across diff re-renders.

## Reactions

- Supported on published conversation comments, inline comments, replies, and submitted review summaries (disabled on pending review items and when `viewerCanReact` is false).
- Loaded lazily via `IntersectionObserver` (`200px` root margin) as comments scroll near the viewport.
- Comments use REST (`/issues/comments/{id}/reactions` or `/pulls/comments/{id}/reactions`) for fast toggling, then re-read with `no-cache` to confirm counts; review summaries use GraphQL `addReaction` / `removeReaction` (since reviews have no REST reactions endpoint).

## Markdown & Bot Filtering

- **Markdown (`src/markdown.ts`):** Renders GFM (tables, task lists, strikethrough, autolinks, `<details>`), `:shortcode:` emojis outside code/links, and `@user` / `@org/team` mentions outside code/links/emails. Sanitized via `sanitize-html`. Relative links and images resolve against the PR's head repository and commit.
- **Hide bot comments:** Toggleable in Appearance/Diff preferences (`hideBotComments`). Identifies bots by `user.type === 'Bot'` or `[bot]` suffix. In diff threads, if a human replied to a bot root comment, the thread remains visible so human context is never lost.
