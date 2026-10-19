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

- [ ] Add aggressive caching for responsiveness
  - Cache PR metadata, files, commits, comments, and comparison results.
  - Use stale-while-revalidate behavior.
  - Invalidate or refresh cache entries after writes and force pushes.
  - Bound cache size and avoid serving stale review state indefinitely.

- [ ] Add optimistic background GitHub mutations
  - Update the local UI immediately for comments, replies, reactions, reviews, and thread state.
  - Queue GitHub writes as background tasks.
  - Show pending, failed, retry, and rollback states.
  - Ensure mutations are idempotent and preserve ordering.
