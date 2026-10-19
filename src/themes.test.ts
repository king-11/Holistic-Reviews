import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, themeTokens, themes } from './themes.ts';

// WCAG AA: 4.5:1 for body text, 3:1 for de-emphasized text, status hues and controls.
const pairs = [
  ['text', 'surface', 7],
  ['strong', 'surface', 7],
  ['text', 'sidebar', 4.5],
  ['secondary', 'surface', 4.5],
  ['accent', 'surface', 4.5],
  ['white', 'primary', 4.5],
  ['white', 'danger', 4.5],
  ['white', 'approve', 4.5],
  ['muted', 'surface', 3],
  ['muted', 'sidebar', 3],
  ['green', 'surface', 3],
  ['red', 'surface', 3],
  ['file-modified', 'sidebar', 3],
  ['file-renamed', 'sidebar', 3],
  ['file-deleted', 'sidebar', 3],
] as const;

for (const theme of themes) {
  const colors: Record<string, string> = { ...themeTokens(theme.id), white: '#ffffff' };
  for (const [fg, bg, minimum] of pairs)
    test(`${theme.label} ${fg} on ${bg} meets ${minimum}:1`, () => {
      const ratio = contrast(colors[fg], colors[bg]);
      assert.ok(ratio >= minimum, `${colors[fg]} on ${colors[bg]} is ${ratio.toFixed(2)}:1`);
    });
}
