import type { ChangedFile, Comment } from './github';
import { parsePatchFiles, type ExpansionDirections } from '@pierre/diffs';

export type DiffSide = 'LEFT' | 'RIGHT';
export const diffSides = ['LEFT', 'RIGHT'] as const;
export const diffSideOf = (side?: 'additions' | 'deletions'): DiffSide => (side === 'deletions' ? 'LEFT' : 'RIGHT');
export interface PatchLine {
  kind: 'deletion' | 'addition' | 'context';
  text: string;
  hunk: number;
  LEFT?: number;
  RIGHT?: number;
}

export function* patchLines(patch = ''): Generator<PatchLine> {
  let left = 0,
    right = 0,
    hunk = -1;
  for (const line of patch.split('\n')) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      left = Number(header[1]);
      right = Number(header[2]);
      hunk++;
      continue;
    }
    const prefix = line[0];
    if (hunk < 0 || (prefix !== '-' && prefix !== '+' && prefix !== ' ')) continue;
    yield {
      kind: prefix === '-' ? 'deletion' : prefix === '+' ? 'addition' : 'context',
      text: line.slice(1),
      hunk,
      LEFT: prefix === '+' ? undefined : left++,
      RIGHT: prefix === '-' ? undefined : right++,
    };
  }
}

export function patchForFile(file: ChangedFile) {
  const old = file.previous_filename || file.filename;
  const mode = file.status === 'added' ? 'new file mode 100644\n' : file.status === 'removed' ? 'deleted file mode 100644\n' : '';
  return `diff --git ${JSON.stringify(`a/${old}`)} ${JSON.stringify(`b/${file.filename}`)}\n${mode}--- ${file.status === 'added' ? '/dev/null' : JSON.stringify(`a/${old}`)}\n+++ ${file.status === 'removed' ? '/dev/null' : JSON.stringify(`b/${file.filename}`)}\n${file.patch || ''}`;
}

export function metadataForFile(file: ChangedFile) {
  const metadata = parsePatchFiles(patchForFile(file), undefined, true)[0]?.files[0];
  if (metadata && file.previous_filename) {
    metadata.prevName = file.previous_filename;
    metadata.type = metadata.hunks.length ? 'rename-changed' : 'rename-pure';
  }
  return metadata;
}

// A folder counts as viewed only when every file in it is, so toggling a partly viewed folder marks the rest.
export function toggleViewedFiles(filenames: string[], viewed: ReadonlySet<string>, collapsed: ReadonlySet<string>) {
  const nextViewed = new Set(viewed),
    nextCollapsed = new Set(collapsed);
  const unview = filenames.every(filename => viewed.has(filename));
  for (const filename of filenames) {
    if (unview) {
      nextViewed.delete(filename);
      nextCollapsed.delete(filename);
    } else {
      nextViewed.add(filename);
      nextCollapsed.add(filename);
    }
  }
  return { viewed: nextViewed, collapsed: nextCollapsed };
}

export function threadsForComments(comments: Comment[]) {
  const groups = new Map<number, Comment[]>();
  for (const comment of comments) {
    const id = comment.in_reply_to_id || comment.id;
    groups.set(id, [...(groups.get(id) || []), comment]);
  }
  return [...groups.entries()].map(([id, items]) => {
    const root = items.find(comment => comment.id === id) || items[0];
    return { root, comments: [root, ...items.filter(comment => comment !== root)] };
  });
}

export type LineCounts = { LEFT: number; RIGHT: number };
export function nearestContextDirection(
  index: number,
  hunkCount: number,
  direction: ExpansionDirections,
  count?: number,
): ExpansionDirections {
  if (direction !== 'both' || count === Infinity) return direction;
  // The first/last gaps only have one adjacent changed block.
  if (index === 0) return 'down';
  if (index >= hunkCount) return 'up';
  return 'both';
}

export function textLineCount(text: string) {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

export function verifiedContextLines(file: ChangedFile, oldText: string, newText: string): LineCounts {
  const lines = { LEFT: oldText.split('\n'), RIGHT: newText.split('\n') };
  const counts = { LEFT: textLineCount(oldText), RIGHT: textLineCount(newText) };
  const verify = (side: DiffSide, line: number, text: string) => {
    if (line < 1 || line > counts[side] || lines[side][line - 1].replace(/\r$/, '') !== text.replace(/\r$/, ''))
      throw new Error('The full file does not match this diff revision. Refresh the PR before expanding context.');
  };
  for (const line of patchLines(file.patch))
    for (const side of diffSides) if (line[side] !== undefined) verify(side, line[side], line.text);
  return counts;
}

export function commentGroups(file: ChangedFile, comments: Comment[], fullLineCounts?: LineCounts) {
  const visible = new Set<string>();
  for (const line of patchLines(file.patch))
    for (const side of diffSides) if (line[side] !== undefined) visible.add(`${side}:${line[side]}`);
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const inline = new Map<string, Comment[]>();
  const below: Comment[] = [];
  for (const comment of comments) {
    const root = comment.in_reply_to_id ? byId.get(comment.in_reply_to_id) || comment : comment;
    const key = `${root.side || 'RIGHT'}:${root.line}`;
    if (
      root.line &&
      !root.outdated &&
      root.subject_type !== 'file' &&
      (visible.has(key) || (fullLineCounts && root.line > 0 && root.line <= fullLineCounts[root.side || 'RIGHT']))
    )
      inline.set(key, [...(inline.get(key) || []), comment]);
    else below.push(comment);
  }
  return { inline, below };
}
