# TODO

- [x] Migrate from SolidJS/Vite to Vue/Nuxt
  - Preserve existing GitHub, diff, Markdown, review, and test behavior.
  - Use Nuxt static-site generation where possible.
  - Decide how authenticated API calls and any future backend/webhook features work with SSG.
  - Keep credentials in `sessionStorage` no more proxy

- [x] Add a formatter and linter
  - Use https://oxc.rs/docs/guide/usage/formatter.html
  - Use oxlint

- [x] Add transitions and animations
  - Use Motion for Vue: https://motion.dev/docs/vue
  - Apply animation principles from https://github.com/emilkowalski/skills
  - Respect `prefers-reduced-motion`.
  - Focus first on panels, dialogs, composers, lists, and state changes.

- [x] Add more themes
  - Keep colors and typography centralized in shared design tokens.
  - Support light, dark, system, and additional user-selectable themes.
  - Verify contrast and update visual regression coverage.

- [x] Add comprehensive keyboard shortcuts
  - Document shortcuts in the UI.
  - Add a shortcut help dialog.
  - Avoid conflicts with text inputs, editors, browser shortcuts, and accessibility tools.

- [ ] Build on the caching we already have
  - Already done: reads use GitHub's 60s browser HTTP cache; `api.fresh()` skips it for manual refresh, rereads after our own writes, PRs mutated within the last 3 minutes, and mergeability polling. File contents sit in a 32-entry in-memory cache, and inbox snapshots cover the search-index lag.
  - Keep the last loaded PR sections (files, commits, comments, comparisons) in memory across navigations so going back to a PR paints instantly, then revalidate in the background.
  - Use ETags / `If-None-Match` on revalidation so unchanged resources return 304 and don't count against the rate limit.
  - Drop cached sections when a push or force-push changes the head SHA, and limit the cache by PR count so stale review state never outlives one revalidation.

- [ ] Make GitHub writes optimistic
  - Already done: every write goes through the shared `mutate()` runner, updates the single PR store and inbox snapshot right away, and rereads with `no-cache`.
  - Apply comments, replies, reactions, thread resolution and review state locally before the request returns, instead of after the reread.
  - Queue writes per PR so they stay in order, and show pending / failed / retry states inline. On failure, roll back only the affected item.
  - Make writes idempotent (client IDs on comments) so a retry never posts twice.

- [x] Rank "Needs your review" by priority
  - Compute a score in one pure function and show the reasons as chips on each row, never a bare number. Sort rows into Now (≥ 50) / Soon (≥ 20) / Later lanes; nothing is hidden. Priority is the default sort, with a toggle back to "Updated".
  - Signals:
    - Stack: count only ready-for-review PRs stacked on top; drafts add nothing. `min(30, 15·log₂(1 + n))`, so it levels off instead of growing with every PR someone opens.
    - Waiting on you: since the PR was marked ready for review, or since the first commit after your last review. `min(30, 30·ln(1 + h) / ln 17)`, levelling off at 16 working hours. `h` counts only 9–5 on weekdays in the viewer's local time zone; the chip still shows the real elapsed time.
    - You are a code owner (`reviewRequests { asCodeOwner }`): fixed +20.
    - Checks green: fixed +15. Failing checks go to Later.
  - Commits since your review: in the same `InboxDetails` batch, keep `commits(last: 1)` for checks and add `recentCommits: commits(last: 20) { nodes { commit { oid committedDate } } }` plus `viewerLatestReview { submittedAt commit { oid } }`. Count the commits after the reviewed oid; if it's outside the recent 20, show "20+" and start waiting at the oldest listed commit. No extra detail requests.
  - Use total additions and deletions only as the size tie-breaker (smaller first).
  - Ignore labels; they mean different things in every repo.

- [x] Pending review comments
  - Show "N pending" as a pill with the total in the PR header (and on the inbox row), and the count for each file in that file's diff header.
  - The Submit review button opens a sheet listing every pending comment with its file:line, editable in place, above the Comment / Approve / Request changes choice.
  - No guard when leaving the page; the pending review already lives on GitHub.

- [ ] Diff minimap (toggle)
  - A canvas strip (about 96px wide) next to the diff in Blocks style, not blurred code: one row per diff line, coloured by added / removed, with markers for comment threads, pending comments and file boundaries, and a viewport frame.
  - Click or drag to jump. Toggle with `m` and remember the choice; off by default and hidden on narrow screens.
  - Draw from the patch data we already load; redraw only when files load, expand or collapse. The frame snaps (no animation) during keyboard navigation.

- [ ] Command bar
  - Grow ⌘K from "open by URL" into a command bar for the current PR. Commands: Submit review, Approve, Request changes, Squash and merge, Merge when ready, Copy branch name, Toggle minimap, Theme, Upstack, Inbox.
  - Pasting a PR URL, `owner/repo#123` or `#123` switches the bar and the page to that PR.
  - Define each command once (label, keys, `run`, `enabled(ctx)` returning a reason when disabled) in `shortcuts.ts`, so key bindings, the `?` dialog and the bar all come from that one list.
  - Show disabled commands with their reason (for example, "waiting on test / integration") instead of hiding them.
  - Approve and Theme open a sub-page; Approve's shows what will happen before it runs. Approvals and merges wait a few seconds with an Undo, since GitHub can't take them back.
  - Show each command's shortcut, and list recently used commands first.
