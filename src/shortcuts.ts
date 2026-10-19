export type Shortcut = { combos: string[]; label: string };

// A space separates the keys of a sequence; `mod` is ⌘ on macOS and Ctrl elsewhere.
export const shortcutGroups: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'General',
    shortcuts: [
      { combos: ['?'], label: 'Show keyboard shortcuts' },
      { combos: ['mod+k'], label: 'Open a pull request' },
      { combos: ['g i'], label: 'Go to inbox' },
      { combos: ['Escape'], label: 'Close a dialog, menu or focused file' },
    ],
  },
  {
    title: 'Inbox',
    shortcuts: [
      { combos: ['j', 'k'], label: 'Next / previous pull request' },
      { combos: ['/'], label: 'Search pull requests' },
    ],
  },
  {
    title: 'Pull request',
    shortcuts: [
      { combos: ['j', 'k'], label: 'Next / previous file' },
      { combos: ['mod+ArrowDown', 'mod+ArrowUp'], label: 'Jump to next / previous file' },
      { combos: ['v', 'mod+Enter'], label: 'Mark selected file viewed' },
      { combos: ['n', 'p'], label: 'Next / previous comment' },
      { combos: ['/'], label: 'Search changed files' },
      { combos: ['f'], label: 'Toggle changed files panel' },
      { combos: ['C'], label: 'Toggle comments panel' },
      { combos: ['x'], label: 'Collapse or expand selected file' },
      { combos: ['X'], label: 'Collapse or expand all files' },
      { combos: ['u', 's'], label: 'Unified / split diff' },
      { combos: ['1', '2', '3', '4', '5'], label: 'Changes / Commits / Conversation / Review / Checks tab' },
      { combos: ['shift+mod+ArrowUp'], label: 'View upstack pull request' },
      { combos: ['shift+mod+ArrowDown'], label: 'View downstack pull request' },
      { combos: ['o'], label: 'Open on GitHub' },
    ],
  },
  {
    title: 'Review',
    shortcuts: [
      { combos: ['r y'], label: 'Approve pull request' },
      { combos: ['r a'], label: 'Approve pull request with comment' },
      { combos: ['r c'], label: 'Comment on pull request' },
      { combos: ['r n'], label: 'Request changes on pull request' },
      { combos: ['r r'], label: 'Open review' },
    ],
  },
  {
    title: 'Copy',
    shortcuts: [
      { combos: ['c l'], label: 'Copy link to PR' },
      { combos: ['c t'], label: 'Copy title' },
      { combos: ['c b'], label: 'Copy PR branch name' },
      { combos: ['c c'], label: 'Copy CLI checkout command' },
      { combos: ['c g'], label: 'Copy link to GitHub' },
      { combos: ['c s'], label: 'Copy stack' },
      { combos: ['c p'], label: 'Copy PR' },
    ],
  },
];

const symbols: Record<string, string> = { shift: '⇧', ArrowUp: '↑', ArrowDown: '↓', Enter: '⏎', Escape: 'Esc' };

export function comboKeys(combo: string, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '')) {
  return combo
    .split(' ')
    .map(step =>
      step
        .split(/\+(?=.)/)
        .flatMap(key => (key === 'mod' ? [mac ? '⌘' : 'Ctrl'] : /^[A-Z]$/.test(key) ? ['⇧', key] : [symbols[key] ?? key.toUpperCase()])),
    );
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'> & {
  composedPath: () => EventTarget[];
};

// Shortcuts must never steal typing, Alt-based OS chords, or keys meant for an open dialog.
export function eventCombo(event: KeyEventLike, blocked: boolean) {
  if (event.defaultPrevented || event.altKey || blocked) return null;
  // composedPath sees through the diff renderer's shadow root, where event.target is retargeted to the host.
  const target = event.composedPath()[0] as { tagName?: string; isContentEditable?: boolean } | undefined;
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return null;
  if (!event.ctrlKey && !event.metaKey) return event.key;
  return `${event.shiftKey ? 'shift+' : ''}mod+${event.key.length === 1 ? event.key.toLowerCase() : event.key}`;
}

export function createShortcuts(bindings: () => Record<string, () => void>, blocked: () => boolean, timeout = 1500) {
  let prefix = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (event: KeyEventLike & { preventDefault: () => void }) => {
    const combo = eventCombo(event, blocked());
    if (!combo || ['Shift', 'Control', 'Meta'].includes(combo.split('+').pop()!)) return;
    const map = bindings();
    const key = prefix ? `${prefix} ${combo}` : combo;
    clearTimeout(timer);
    prefix = '';
    if (map[key]) {
      event.preventDefault();
      map[key]();
    } else if (Object.keys(map).some(name => name.startsWith(`${key} `))) {
      event.preventDefault();
      prefix = key;
      timer = setTimeout(() => (prefix = ''), timeout);
    }
  };
}

export const modalOpen = () => !!document.querySelector('[aria-modal="true"]');

export function step<T>(items: T[], current: T | undefined, delta: 1 | -1) {
  const index = current === undefined ? -1 : items.indexOf(current);
  if (!items.length) return undefined;
  return items[index < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.min(Math.max(index + delta, 0), items.length - 1)];
}
