# AGENTS.md

- No code is the best code: merge and DRY up similar logic; don't create small one-off gardens of helpers across the codebase.
- Use parameterised tests when cases differ only by a few setup/assertion parameters.
- Comments explain why, never what, and stay succinct.
- No logs in production code except for failed API calls or meaningful success operations.
- Never render a bare browser-styled `<input>`; text and search fields use `SearchField` from `src/ui.tsx` (icon, soft focus ring, clear button). Inside menus and popovers use its `menu-search` variant, which sits flush at the top above a divider.
- Text sizes come only from the `--text-*` tokens, which follow Tailwind's scale (xs 12px, sm 14px, base 16px, lg 18px, xl 20px, 2xl 24px, 3xl 30px); nothing on screen goes below 12px.
