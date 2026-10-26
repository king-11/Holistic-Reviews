# Holistic Reviews — Specification

Holistic Reviews is a client-only single-page application that talks directly to `https://api.github.com` using the user's personal access token. There is no backend server.

## Core Principles

1. **Single source of truth per PR.** When a PR page is loaded, the PR resource (`PullRequest`), its `reviews`, `comments`, `inlineComments`, and `reviewThreads` drive every view on the page (header, diff, conversation, comments panel, details sidebar, and inbox snapshot). Any write updates that shared state immediately.
2. **Progressive, non-blocking loading.** Opening a PR renders the header as soon as `GET /pulls/{n}` resolves, then fills each section (`files`, `comments`, `inlineComments`, `reviews`, `reviewThreads`, `checks`, `linkedIssues`, `mergeMethods`, `nativeStack`, `related`) independently as its request settles. In-place refreshes keep already-settled sections on screen until their replacement arrives.
3. **Cache policy (`default` vs `no-cache`).**
   - Normal reads use the browser's default HTTP cache (`Cache-Control: private, max-age=60` from GitHub).
   - Reads use `cache: 'no-cache'` (`api.fresh()`) only when:
     - The user clicks a manual Refresh button (inbox or PR).
     - The app rereads a resource immediately after its own write (or reopens a PR mutated within the last 3 minutes).
     - The app polls `GET /pulls/{n}` while GitHub computes mergeability.
4. **Immediate local reconciliation ahead of GitHub's search index.** GitHub's `/search/issues` index lags writes by 15–60 seconds. Whenever a PR is viewed or mutated, the page records a 3-minute snapshot of its current state and section placement so the kept-alive inbox reflects approvals, merges, draft toggles, and reviewer changes immediately upon return.
5. **Authentication & storage.**
   - Token lives in `localStorage` (`review.github-token`) so it persists across tabs and browser restarts, and is validated via `GET /user` (requiring `repo` or `public_repo` on classic tokens). Other tabs sync connect/disconnect through the `storage` event.
   - User-facing preferences are scoped per GitHub login (`review.preferences:<login>`, `review.inbox:<login>`, `review.teams:<login>`); `review.identity` remembers the last login so settings apply before a session restores. Legacy unscoped keys are migrated to the first identity that connects.
   - On connect/restore, the viewer's organization teams (`GET /user/teams`, formatted as `org/slug`) are cached in `localStorage` (`review.teams:<login>`) and refreshed in the background.
   - Disconnecting clears the stored token, the connecting identity's cached teams, people directories (`review.people.*`), and in-memory PR snapshots. Settings and inbox preferences persist per identity.

## Domain Specifications

- [Inbox](./inbox.md) — Sections, search queries, authored PR classification, filters, sorting, repository selection, and post-action updates.
- [Reviews & Comments](./reviews-and-comments.md) — Pending vs single comments, submitting and discarding reviews, editing/deleting, thread resolution, reactions, and Markdown/bot rules.
- [Reviewers & People](./reviewers-and-people.md) — Reviewer state derivation, code owners, team requests, people search/caching, `@mention` autocomplete, and hover cards.
- [Checks & Merging](./checks-and-merging.md) — Check deduplication and ordering, re-running jobs, merge readiness rules, mergeability polling, and auto-merge.
- [Navigation, Diffs & Shortcuts](./navigation-and-shortcuts.md) — Routes, diff workspace, file filters, context expansion, commit comparison, stacks, keyboard shortcuts, and motion rules.
