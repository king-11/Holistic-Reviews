# Navigation, Diffs & Shortcuts Specification

## Routes

- `/` — Inbox (`InboxPage`, kept alive in memory via `<NuxtPage :keepalive="{ include: ['InboxPage'] }" />`).
- `/<owner>/<repo>/pull/<number>` — Pull request workspace (`PullRequestPage`).
- Legacy `/?pr=<owner>/<repo>#<number>` links redirect to `/<owner>/<repo>/pull/<number>`.
- While a write mutation is in flight (`mutationBusy`), route navigation and header switches are held until the request settles.

## Diff Workspace

- **Panels:** Both the left **Changed files** sidebar (`f`) and right **Pull request comments** sidebar (`C`) start closed. While the comments sidebar is closed, the right **Pull request details** sidebar is shown (collapsing into an inline **Information** summary on narrow viewports). Sidebars are resizable by dragging their edge (persisted in `localStorage`).
- **File tree & status filters:**
  - Colors and badges files by normalized Git status: `added` (`A`, green), `modified` (`M`, blue), `renamed` (`R`, amber), `deleted` (`D`, red).
  - The status filter popover toggles statuses; `Alt`/`Option`-clicking a status isolates it.
  - Combines with filename search and diff-content search.
- **Viewed progress:** Marking a file **Viewed** (`v` or `⌘/Ctrl+Enter`) collapses its diff and advances the sidebar progress bar (`scaleX`); unmarking reopens the diff. Viewed state is kept in memory per PR.
- **Single-file focus:** Clicking **Expand** on a file header opens that file at full width and hides the file sidebar; **Restore**, **Back to all files**, or `Escape` returns to all files.
- **Hunk context expansion:** Clicking a hidden-line control loads full UTF-8 file contents (up to 1 MiB) at the exact `base.sha` and `head.sha`, verifies them against the patch hunks, and reveals 20 lines in the nearest direction (or all lines on **Expand all**). Expanded context is read-only.
- **Commit comparison:** The **All commits** popover and **Commits** tab let the user inspect a single commit or base-to-head commit range. Comparison ranges are read-only; selecting **All commits** or jumping to a comment restores the full commentable PR diff.
- **Stacks & branch dependencies:** Displays native GitHub stack entries when available, falling back to parent/child PRs inferred by matching `head.ref` / `base.ref` within the same repository.

## Keyboard Shortcuts (`src/shortcuts.ts`)

Shortcuts pause when focus is inside an input, textarea, select, or contenteditable element.

| Scope            | Keys                                                  | Action                                                                                            |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Global**       | `?`                                                   | Show keyboard shortcuts                                                                           |
|                  | `⌘/Ctrl+K`                                            | Open a pull request by URL                                                                        |
|                  | `g` then `i`                                          | Go to inbox                                                                                       |
|                  | `Escape`                                              | Close dialog, menu, hover card, or focused file                                                   |
| **Inbox**        | `j` / `k`                                             | Focus next / previous pull request                                                                |
|                  | `/`                                                   | Focus pull request search                                                                         |
| **Pull request** | `j` / `k` or `⌘/Ctrl+↓` / `⌘/Ctrl+↑`                  | Select next / previous file                                                                       |
|                  | `v` or `⌘/Ctrl+Enter`                                 | Toggle selected file viewed                                                                       |
|                  | `x` / `X`                                             | Collapse/expand selected file / all files                                                         |
|                  | `f` / `C`                                             | Toggle changed files / comments sidebar                                                           |
|                  | `/`                                                   | Focus file search (opening the files sidebar if closed)                                           |
|                  | `n` / `p`                                             | Jump to next / previous comment                                                                   |
|                  | `u` / `s`                                             | Switch between Unified and Split diff                                                             |
|                  | `1` – `5`                                             | Switch to Changes, Commits, Conversation, Review, or Checks tab                                   |
|                  | `⇧+⌘/Ctrl+↑` / `↓`                                    | Open upstack / downstack pull request                                                             |
|                  | `o`                                                   | Open pull request on GitHub                                                                       |
| **Review**       | `r y`                                                 | Approve pull request immediately                                                                  |
|                  | `r a` / `r c` / `r n` / `r r`                         | Open review dialog pre-selected to Approve / Comment / Request changes / current                  |
| **Copy**         | `c l` / `c g` / `c t` / `c b` / `c c` / `c s` / `c p` | Copy app link, GitHub link, title, branch, `gh pr checkout` command, stack list, or `title (url)` |

## Motion Rules (`src/motion.ts`, `src/styles.css`)

- **Shared curves:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entrances/exits; `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement (switch thumb, disclosure chevrons).
- **High-frequency keyboard actions never animate:** `⌘/Ctrl+K`, `?`, `f`, `C`, diff file collapse (`x`/`v`), and tab revisits (`1`–`5`) render immediately.
- **First-arrival reveals:** Sections that arrive asynchronously fade in once (`reveal`, `200ms`); revisiting a tab does not replay the animation.
- **No layout jumps on comment actions:** Action confirmations use the bottom-left theme-colored toast (`rise`, `150ms`), newly posted comments grow in (`grow-in`, `200ms`), and resolving/reopening a thread folds/unfolds its height (`thread-fold`, `200ms`).
- **Delight:** Merging a PR while watching triggers a `500ms` badge pop and spark burst (`data-celebrate`); opening an already-merged PR does not.
- **Reduced motion (`prefers-reduced-motion: reduce`):** Keeps opacity and color fades while removing transforms and spark bursts.
