# Reviewers & People Specification

## Reviewer States (`reviewerStates`)

The Reviewers list in the Details sidebar and the compact Information bar combines submitted reviews, pending requests, team requests, and GraphQL `onBehalfOf` / `asCodeOwner` metadata in a deterministic order:

1. **Submitted reviews:** For each review in chronological order where `state !== 'PENDING'`, set `latest[review.user.login] = review.state` (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`).
2. **Direct requests:** For each user in `pr.requested_reviewers`, set `latest[user.login] = 'REQUESTED'` (a re-request overrides an earlier review). When the viewer submits a review or single inline comment in the current session, the viewer is immediately removed from `requested_reviewers` locally.
3. **Team requests:** For each team in `pr.requested_teams` (`<org>/<slug>`), set `latest['<org>/<slug>'] = 'REQUESTED'` **unless** a reviewer in `onBehalfOf` has already reviewed on behalf of that team (in which case the team badge is shown under that person's row instead of as a separate pending team).
4. **Code owners:** Any user or team flagged with `asCodeOwner` in the `Development` GraphQL query gets a `· code owner` indicator on their status icon.

## Requesting & Removing Reviewers

- **Requesting:** The `Request reviewer` picker searches assignable users on GitHub and lists repository teams (`GET /repos/{owner}/{repo}/teams`, ignoring 404s when org read access is absent). The PR author and `[bot]` accounts are excluded (`requestable`).
- **Re-requesting:** Reviewers with a completed review (`review !== 'REQUESTED'`) who are `requestable` show a re-request button; the section header also offers **Re-request all reviews**.
- **Removing:** Reviewers with `review === 'REQUESTED'` show a remove (`×`) button calling `DELETE /pulls/{n}/requested_reviewers`.
  - Because GitHub responds `200 OK` without removing required code owners, `requestReviewers` verifies the target is no longer in the returned `requested_reviewers` / `requested_teams` and throws an error if GitHub kept them.

## People Directory (`src/people.ts`)

A single `PeopleDirectory` instance is shared per repository (`owner/repo`) across PR pages and persisted in `localStorage` (`review.people.<owner>/<repo>`) for 7 days (capped at 2,000 people and 300 cached search queries; cleared on disconnect):

1. **Zero-request seeding:** Every PR page seeds the directory with all users already present on the PR (author, requested reviewers, assignees, comment/review authors, and the viewer) including their `avatar_url`.
2. **Prefix-aware remote search:**
   - Local matches are ranked first (exact login → login prefix → name word prefix → substring) and returned synchronously.
   - A GraphQL search (`assignableUsers` for the reviewer picker, limit 20; `mentionableUsers` for `@` autocomplete, limit 10) is debounced by `250ms` and only sent when:
     - The query is at least 2 characters,
     - Local matches do not already fill the limit, and
     - No cached shorter prefix query already returned a complete (`< limit`) result set.

## `@mention` Autocomplete & Hover Cards

- **Autocomplete (`MentionField.tsx`):** Typing `@` followed by up to 39 login characters (not preceded by a word character or backtick, and outside fenced/inline code) opens a floating listbox (`Teleport to="body"`) navigated with `↑`/`↓`, completed with `Enter` or `Tab` (inserting `@login `), and dismissed with `Escape`.
- **Hover cards (`MarkdownView.tsx`):** Hovering (after `150ms`) or focusing a rendered `.user-mention` link opens a tooltip card showing the user's avatar, display name, and login. If the user's display name is not yet in the directory, `GET /users/{login}` is fetched once per login per session and cached.
