import type { MergeMethod, PRRef } from './github.ts';

export type Shortcut = { combos: string[]; label: string };
export type CommandSource = 'bar' | 'shortcut';
export type CommandAction =
  | 'open-command-bar'
  | 'submit-review'
  | 'approve'
  | 'approve-comment'
  | 'request-changes'
  | 'squash-merge'
  | 'merge-when-ready'
  | 'copy-branch-name'
  | 'theme'
  | 'upstack'
  | 'inbox';
export type CommandContext = {
  busy: boolean;
  pr?: {
    ref: PRRef;
    login: string;
    pendingComments: number;
    ownPR: boolean;
    draft: boolean;
    open: boolean;
    busy: boolean;
    canReview: boolean;
    stale: boolean;
    mergeMethods: MergeMethod[];
    mergeAvailable: boolean;
    mergeReason?: string;
    checksPending: boolean;
    autoMergeAvailable: boolean;
    autoMergeEnabled: boolean;
    autoMergeReason?: string;
    upstackAvailable: boolean;
  };
  actions: Partial<Record<CommandAction, (source: CommandSource) => void>>;
};
export type CommandEntry = {
  id: CommandAction;
  label: string;
  group: string;
  shortcutGroup?: string;
  keys: string[];
  inBar: boolean;
  prOnly: boolean;
  page?: 'approve' | 'theme';
  hold?: boolean;
  enabled: (context: CommandContext) => string | undefined;
  run: (context: CommandContext, source: CommandSource) => void;
  children?: CommandEntry[];
};

const busyReason = (context: CommandContext) => (context.busy || context.pr?.busy ? 'A GitHub update is in progress.' : undefined);
const reviewReason = (context: CommandContext) =>
  busyReason(context) ??
  (!context.pr?.open
    ? 'This pull request is not open.'
    : context.pr.stale
      ? 'Refresh the pull request before reviewing.'
      : !context.pr.canReview
        ? 'Reviews are not available on this pull request.'
        : undefined);
const approveReason = (context: CommandContext) =>
  (context.pr?.ownPR ? 'You cannot approve your own pull request.' : undefined) ??
  (context.pr?.draft ? 'Mark this pull request ready for review first.' : undefined) ??
  reviewReason(context);
const requestChangesReason = (context: CommandContext) =>
  (context.pr?.ownPR ? 'You cannot request changes on your own pull request.' : undefined) ?? reviewReason(context);
const squashMergeReason = (context: CommandContext) => {
  const pr = context.pr;
  if (!pr) return 'Only available on a pull request.';
  if (busyReason(context)) return busyReason(context);
  if (!pr.open) return 'This pull request is not open.';
  if (pr.draft) return 'Draft pull requests cannot be merged.';
  if (!pr.mergeMethods.includes('squash')) return 'Squash merge is not enabled for this repository.';
  if (pr.checksPending) return 'Checks are still running.';
  if (!pr.mergeAvailable) return pr.mergeReason ?? 'Merge requirements are not satisfied.';
  return undefined;
};
const mergeWhenReadyReason = (context: CommandContext) => {
  const pr = context.pr;
  if (!pr) return 'Only available on a pull request.';
  if (busyReason(context)) return busyReason(context);
  if (!pr.open) return 'This pull request is not open.';
  if (pr.draft) return 'Draft pull requests cannot be merged.';
  if (pr.autoMergeEnabled) return 'Merge when ready is already enabled.';
  if (!pr.autoMergeAvailable) return pr.autoMergeReason ?? 'Auto-merge is not available for this repository.';
  return undefined;
};
const enabled = () => undefined;

// A space separates the keys of a sequence; `mod` is ⌘ on macOS and Ctrl elsewhere.
export const commandDefinitions: CommandEntry[] = [
  {
    id: 'open-command-bar',
    label: 'Open command bar',
    group: 'General',
    shortcutGroup: 'General',
    keys: ['mod+k'],
    inBar: false,
    prOnly: false,
    enabled: context => (context.busy ? 'Wait for the current GitHub update to finish.' : undefined),
    run: (context, source) => context.actions['open-command-bar']?.(source),
  },
  {
    id: 'submit-review',
    label: 'Submit review',
    group: 'Review',
    shortcutGroup: 'Review',
    keys: ['r r'],
    inBar: true,
    prOnly: true,
    enabled: reviewReason,
    run: (context, source) => context.actions['submit-review']?.(source),
  },
  {
    id: 'approve',
    label: 'Approve',
    group: 'Review',
    shortcutGroup: 'Review',
    keys: ['r y'],
    inBar: true,
    prOnly: true,
    page: 'approve',
    hold: true,
    enabled: approveReason,
    run: (context, source) => context.actions.approve?.(source),
    children: [
      {
        id: 'approve-comment',
        label: 'Approve with comment',
        group: 'Review',
        shortcutGroup: 'Review',
        keys: ['r a'],
        inBar: false,
        prOnly: true,
        enabled: approveReason,
        run: (context, source) => context.actions['approve-comment']?.(source),
      },
    ],
  },
  {
    id: 'request-changes',
    label: 'Request changes',
    group: 'Review',
    shortcutGroup: 'Review',
    keys: ['r n'],
    inBar: true,
    prOnly: true,
    enabled: requestChangesReason,
    run: (context, source) => context.actions['request-changes']?.(source),
  },
  {
    id: 'squash-merge',
    label: 'Squash and merge',
    group: 'Merge',
    keys: [],
    inBar: true,
    prOnly: true,
    hold: true,
    enabled: squashMergeReason,
    run: (context, source) => context.actions['squash-merge']?.(source),
  },
  {
    id: 'merge-when-ready',
    label: 'Merge when ready',
    group: 'Merge',
    keys: [],
    inBar: true,
    prOnly: true,
    enabled: mergeWhenReadyReason,
    run: (context, source) => context.actions['merge-when-ready']?.(source),
  },
  {
    id: 'copy-branch-name',
    label: 'Copy branch name',
    group: 'Pull request',
    shortcutGroup: 'Copy',
    keys: ['c b'],
    inBar: true,
    prOnly: true,
    enabled: context => (!context.pr ? 'Only available on a pull request.' : undefined),
    run: (context, source) => context.actions['copy-branch-name']?.(source),
  },
  {
    id: 'theme',
    label: 'Theme',
    group: 'Appearance',
    keys: [],
    inBar: true,
    prOnly: false,
    page: 'theme',
    enabled,
    run: (context, source) => context.actions.theme?.(source),
  },
  {
    id: 'upstack',
    label: 'Upstack',
    group: 'Pull request',
    shortcutGroup: 'Pull request',
    keys: ['shift+mod+ArrowUp'],
    inBar: true,
    prOnly: true,
    enabled: context => (!context.pr?.upstackAvailable ? 'No pull request is stacked above this one.' : busyReason(context)),
    run: (context, source) => context.actions.upstack?.(source),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    group: 'Navigation',
    shortcutGroup: 'General',
    keys: ['g i'],
    inBar: true,
    prOnly: false,
    enabled: context => (context.busy ? 'Wait for the current GitHub update to finish.' : undefined),
    run: (context, source) => context.actions.inbox?.(source),
  },
];

const commandShortcuts = (group: string): Shortcut[] =>
  commandDefinitions
    .flatMap(command => [command, ...(command.children ?? [])])
    .filter(command => command.shortcutGroup === group && command.keys.length)
    .map(command => ({ combos: command.keys, label: command.label }));

export const shortcutGroups: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'General',
    shortcuts: [
      { combos: ['?'], label: 'Show keyboard shortcuts' },
      ...commandShortcuts('General'),
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
      ...commandShortcuts('Pull request'),
      { combos: ['f'], label: 'Toggle changed files panel' },
      { combos: ['C'], label: 'Toggle comments panel' },
      { combos: ['x'], label: 'Collapse or expand selected file' },
      { combos: ['X'], label: 'Collapse or expand all files' },
      { combos: ['u', 's'], label: 'Unified / split diff' },
      { combos: ['1', '2', '3', '4', '5'], label: 'Changes / Commits / Conversation / Review / Checks tab' },
      { combos: ['shift+mod+ArrowDown'], label: 'View downstack pull request' },
      { combos: ['o'], label: 'Open on GitHub' },
    ],
  },
  {
    title: 'Review',
    shortcuts: [...commandShortcuts('Review'), { combos: ['r c'], label: 'Comment on pull request' }],
  },
  {
    title: 'Copy',
    shortcuts: [
      { combos: ['c l'], label: 'Copy link to PR' },
      { combos: ['c t'], label: 'Copy title' },
      ...commandShortcuts('Copy'),
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
