# review.

A client-only GitHub pull-request inbox and review workspace built with Nuxt 4, Vue + TSX, and `@pierre/diffs`. All GitHub API requests go directly from the browser to `api.github.com` using your personal access token.

## Run

Requires Node.js 22.18+ (or 24+) and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Each pull request lives at `/<owner>/<repo>/pull/<number>`, mirroring its GitHub URL.

## Connect GitHub

Click **Connect GitHub** and paste a token with `repo`, `read:org`, and `workflow` scopes (kept in `localStorage` so it persists across tabs and restarts):

```sh
gh auth login --scopes repo,read:org,workflow
gh auth token
```

Or [create a classic token on GitHub](https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Holistic%20Review%20App%20Token).

## Specification

Detailed behavior and interaction rules live in [`specification/`](./specification/specification.md):

- [Overview & Core Principles](./specification/specification.md)
- [Inbox](./specification/inbox.md)
- [Reviews & Comments](./specification/reviews-and-comments.md)
- [Reviewers & People](./specification/reviewers-and-people.md)
- [Checks & Merging](./specification/checks-and-merging.md)
- [Navigation, Diffs & Shortcuts](./specification/navigation-and-shortcuts.md)

## Verify & Build

```sh
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm build
```
