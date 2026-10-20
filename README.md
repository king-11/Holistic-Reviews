# review.

A standalone Vue (Nuxt) + TypeScript pull-request inbox and review workspace, using the framework-independent `@pierre/diffs` renderer.

## Run

Requires Node.js 22.18+ (or Node.js 24+) and pnpm. Run `corepack enable` to use the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm dev
```

Open the local Nuxt address (http://localhost:5173) and connect GitHub to see your inbox. Each pull request has its own page at `/<owner>/<repo>/pull/<number>`, mirroring its GitHub URL, so PRs can be bookmarked, shared, or opened in a new tab.

## Connect GitHub

Select **Connect GitHub** and paste a personal token. The app validates your identity and the token's reported scopes, then calls `api.github.com` directly from the browser. The token is kept in this tab's `sessionStorage` until you disconnect or close the tab, and is never sent to any other server.

Generate a classic token locally using the GitHub CLI:

```sh
gh auth login --scopes repo,read:org,workflow
# If already logged in:
gh auth refresh --scopes repo,read:org,workflow
gh auth token
```

Or [create a classic token on GitHub](https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Holistic%20Review%20App%20Token): the link pre-fills the name **Holistic Review App Token** and the `repo`, `read:org` and `workflow` scopes; pick an expiration and generate it.

Never share the output in chat. Classic tokens need `repo` for private repositories (`public_repo` for public-only use). Organization SSO authorization may be required. Identity and reported classic scopes are validated; fine-grained grants and organization policies are enforced by GitHub on each request, not claimed as verified.

## Review workflow

- Inbox sections: review requests, your open PRs, your drafts, PRs you reviewed, and your merged PRs. **Needs your review** excludes drafts; **Reviewed by you** includes drafts you have reviewed. Search loaded results; filter by repository; load more per section (subject to GitHub's search limits).
- Open GitHub or DiffsHub PR URLs. Browse changed files, search filenames or patch content, collapse files/folders, mark files viewed locally, switch split/unified layout and light/dark appearance.
- The file sidebar colors added files green, modified files blue, renamed files amber, and deleted files red, with A/M/R/D labels. **Filter files by Git status** combines Added, Modified, Renamed, and Deleted; Alt/Option-click isolates one status. Counts describe the current comparison before filtering. Filters compose with filename/content search and apply to both the file tree and diffs. Clear filters or navigate to an existing comment to restore hidden files. Diff collapse/expand stays in the toolbar above the diffs; the sidebar's separate folder control only collapses/expands the tree.
- Recognized file extensions and common build/config filenames use bundled [VSCode Icons](https://github.com/vscode-icons/vscode-icons) (MIT), including Java, Python, TypeScript, JavaScript, Bazel, Markdown, and images. Unknown files keep a generic icon. Icons require no external requests; Git status remains visible on the filename and A/M/R/D badge.
- Both the changed-files and comments panels start closed. Open them with **Files** or **Comments**, then hide them with the matching panel icon in their header. Reopen buttons appear only while that panel is hidden. Hover controls for their descriptions. **Expand** opens a single file at full width; **Restore**, **Back to all files**, or Escape restores the workspace. The filename/chevron toggles the file's diff.
- Marking a file **Viewed** collapses its diff; unmarking it reopens the diff. Viewed progress remains local to this workspace.
- Use the compact hunk expansion controls to reveal the nearest hidden lines, 20 at a time. Clicking a hidden-line count above the first change or below the last change expands only the adjacent context; **Expand all** is explicit. Full UTF-8 file contents (up to 1 MiB per side) load before expansion at the exact merge-base/head revisions and are checked against the displayed patch. Binary, oversized, inaccessible, or mismatched files show an error without substituting another revision. Additional context is read-only: GitHub rejected comments outside its original PR diff hunks through both REST and GraphQL, so those lines do not offer a comment composer.
- Descriptions, conversation comments, reviews, and inline threads render GitHub-flavored Markdown: links, code, tables, nested checklists, GitHub emoji shortcodes, and expandable details. Checkboxes are read-only; inline/fenced code and link destinations retain literal shortcodes. The emoji font supports systems without a native emoji font. HTML is sanitized with tag/attribute/protocol allowlists; HTML comments and unsafe embeds are not rendered.
- Add/remove GitHub reactions on published inline comments, replies, PR conversation comments, and review summaries. Counts and your selected reactions are shared across the inline, comments-panel, and conversation views. Reactions load lazily as comments become visible; failed writes do not claim success or clear the confirmed counts. Pending-review comments cannot receive reactions until published.
- **Commits** shows the PR's commit history, authors, dates, SHAs, and individual **View changes** actions. The diff toolbar's **All commits** selector supports base/head range selection. Comparison ranges are read-only and do not attach current review threads to historical coordinates; **All commits** restores the commentable current PR diff. Comment-panel navigation also restores that diff. GitHub limits commit history to 250 entries and compare file lists to 300; notices identify potentially incomplete results.
- Read inline threads at their diff lines or change **Diff preferences → Comment placement** to show them below each file. Outdated/off-patch comments stay visible below the diff.
- The right-side **Comments** panel lists review threads and PR conversation comments. Filter by **Open**, **Resolved**, **All**, or reviewer. Select a file/line heading to jump to the comment, expanding its file/thread and clearing file-search filters. Outdated comments navigate below their file when it is still available; removed-file comments keep a GitHub link instead of inventing a diff location.
- **Diff preferences → Hide bot comments** is saved with your display settings and applies to the diff, conversation, and comments panel. Bots are identified by GitHub's user type or `[bot]` suffix. Human replies to a hidden bot root remain visible and keep their original thread location.
- Thread cards show author, time, rendered feedback, and an inline reply field. **Resolve/Reopen** uses GitHub's actual thread IDs and viewer permissions. If thread metadata cannot be loaded, comments/replies remain available without claiming a resolution state. Separate threads on the same line remain separate.
- Start a review from a new line comment or an existing thread's reply composer, not from a standalone toolbar button. Without an active review, choose to publish the single comment/reply immediately or **Start a review**. While a review is active, all new line comments and replies join that review and stay pending until submission. Reply drafts and errors survive diff re-rendering; failures show GitHub's actual diagnostic without clearing the text. Pending comment locations are reconciled with GitHub's thread path, side, and line metadata.
- **Your review** collects your feedback and pending comments. **Finish review** submits comments, approves, or requests changes. Pending reviews can be discarded with confirmation.
- Direct PR conversation comments publish immediately. Thread replies publish immediately only when you choose **Reply** without an active review; otherwise they join the pending review. Approval/request-changes restrictions are shown for your own PRs; draft PRs cannot be approved.
- Native GitHub stacks appear when the API exposes them. Otherwise, parent/child PRs are inferred from repository-aware head/base branch matches, above the description. Branch inference is limited to the open PRs GitHub returned.
- Close the stack/dependency panel with `×`; select its header to reopen it without losing navigation.

Before inline/review writes, the app checks that the PR head still matches the displayed diff. It refuses to add to pending reviews targeting older commits. Failed writes aren't retried automatically; refresh before retrying an ambiguous network failure.

## Checks and build

```sh
pnpm test
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm fmt` formats with Oxfmt; `pnpm lint` runs Oxlint. Tests use Node's built-in runner and mocked GitHub requests; they do not post anything to GitHub.

`pnpm build` runs `nuxt generate` with `ssr: false`, writing a static single-page app to `.output/public/`; it needs no server. GitHub calls stay in the browser because they need the user's token, so there is nothing to prerender per user; a future webhook or hosted mode would be a separate server alongside this static app. Only `/` is generated, so for deep links such as PR pages the static host must serve the SPA fallback for unknown paths: `nuxt generate` emits `200.html` and `404.html`, both copies of the same app shell as `index.html` (for example, configure the host's single-page fallback to `200.html`, or rely on hosts that serve `404.html` for missing paths, such as GitHub Pages). All review state except display preferences and the session token is in memory or on GitHub.
