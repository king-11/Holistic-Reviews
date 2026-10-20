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

- [ ] Rank the inbox by priority
  - Compute a score in one pure function and show the reasons as chips on each row, never a bare number. Sort rows into Now / Soon / Later lanes; nothing is hidden, and a toggle switches back to "Updated".
  - Signals:
    - Stack: PRs that other open PRs are stacked on rank higher.
    - Waiting on you: time since the PR was marked ready for review, or since your last review if there are new commits since then.
    - You are a code owner (`reviewRequests { asCodeOwner }`).
    - Checks green, so your review is what's blocking it.
  - Show a size tag from lines changed: XS < 10, S < 50, M < 250, L < 500, XL < 1,000, XXL ≥ 1,000.
  - Ignore labels; they mean different things in every repo.
  - Add the needed fields to the existing `InboxDetails` batch, with no extra requests.

- [ ] Pending review comments
  - Show "N pending" as a pill in the PR header (and on the inbox row) whenever the viewer has a pending review.
  - Submitting opens a sheet listing every pending comment with its file:line, editable in place, above the Comment / Approve / Request changes choice.
  - No guard when leaving the page; the pending review already lives on GitHub.

- [ ] Diff minimap (toggle)
  - A canvas strip next to the diff in Blocks style: one row per diff line, coloured by added / removed, with markers for comment threads, pending comments and file boundaries, and a viewport frame.
  - Click or drag to jump. Toggle with `m` and remember the choice; off by default and hidden on narrow screens.
  - Draw from the patch data we already load; redraw only when files load, expand or collapse. The frame snaps (no animation) during keyboard navigation.

- [ ] Command bar
  - Grow ⌘K from "open by URL" into one place for every action, aware of the current context (inbox, PR, selection).
  - Define each action once (label, keys, `run`, `enabled(ctx)` returning a reason when disabled) in `shortcuts.ts`, so key bindings, the `?` dialog and the menu all come from that one list.
  - Show disabled actions with their reason (for example, "waiting on test / integration") instead of hiding them.
  - Actions with options open a sub-page that shows what will happen before running (for example, Approve with a comment).
  - Hold approvals and merges started from the bar for a few seconds with an Undo, since GitHub can't take them back.
  - Recognise pasted PR URLs, `owner/repo#123` and `#123`; support `>` files, `@` people, `#` PRs.
  - Bulk actions on inbox rows selected with `x`, run through `mutate()`.
  - Show each action's shortcut, and list recently used actions first.
