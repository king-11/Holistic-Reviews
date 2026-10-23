import type { ChangedFile, Comment, Review, ReviewThread, User } from './github';
import { commentGroups, diffSides, patchLines, threadsForComments, type DiffSide } from './diff.ts';

export type CommentFilter = 'open' | 'resolved' | 'all';

export type CommentEntry =
  | {
      kind: 'thread';
      root: Comment;
      comments: Comment[];
      thread?: ReviewThread;
      file?: ChangedFile;
      location: 'diff' | 'below' | 'missing';
    }
  | { kind: 'conversation'; comment: Comment };

export const isReview = (item: Comment | Review): item is Review => 'state' in item;

// Anchors match GitHub's, so a link converts between the app and GitHub by swapping the host.
const anchorKinds = ['discussion_r', 'issuecomment-', 'pullrequestreview-'] as const;
export type CommentAnchor = { kind: (typeof anchorKinds)[number]; id: number };
export const commentAnchor = (item: Comment | Review) =>
  `${isReview(item) ? 'pullrequestreview-' : item.path || item.pull_request_review_id ? 'discussion_r' : 'issuecomment-'}${item.id}`;
export function parseCommentAnchor(hash: string): CommentAnchor | null {
  const name = hash.replace(/^#/, '');
  const kind = anchorKinds.find(prefix => name.startsWith(prefix));
  const id = kind && Number(name.slice(kind.length));
  return kind && id && Number.isSafeInteger(id) && id > 0 ? { kind, id } : null;
}

export function isBot(user: User) {
  return user.type === 'Bot' || /\[bot\]$/i.test(user.login);
}

export function visibleThreads(comments: Comment[], hideBots: boolean) {
  return threadsForComments(comments)
    .map(group => ({
      root: group.root,
      comments: hideBots ? group.comments.filter(comment => !isBot(comment.user)) : group.comments,
    }))
    .filter(group => group.comments.length > 0);
}

export function withThreadLocations(comments: Comment[], threads: ReviewThread[]) {
  const byRoot = new Map(threads.map(thread => [thread.rootCommentId, thread]));
  return comments.map(comment => {
    const thread = byRoot.get(comment.in_reply_to_id || comment.id);
    if (!thread?.path || (comment.path && comment.path !== thread.path)) return comment;
    return {
      ...comment,
      path: thread.path,
      line: thread.outdated || thread.subjectType === 'FILE' ? null : thread.line,
      side: thread.side || comment.side,
      subject_type: thread.subjectType === 'FILE' ? ('file' as const) : ('line' as const),
      outdated: thread.outdated,
    };
  });
}

export function preservePendingCommentEdits(loaded: Comment[], current: Comment[], editedBodies: ReadonlyMap<number, string>) {
  const loadedIds = new Set(loaded.map(comment => comment.id));
  return [
    ...loaded.map(comment => (editedBodies.has(comment.id) ? { ...comment, body: editedBodies.get(comment.id)! } : comment)),
    ...current
      .filter(comment => editedBodies.has(comment.id) && !loadedIds.has(comment.id))
      .map(comment => ({ ...comment, body: editedBodies.get(comment.id)! })),
  ];
}

export function commentLocationLabel(comment: Pick<Comment, 'path' | 'line' | 'subject_type'>) {
  const path = comment.path ?? '';
  if (comment.subject_type === 'file') return `${path}:file`;
  return typeof comment.line === 'number' ? `${path}:${comment.line}` : path;
}

export function commentEntries(
  files: ChangedFile[],
  inline: Comment[],
  conversation: Comment[],
  threads: ReviewThread[],
  hideBots: boolean,
): CommentEntry[] {
  const byPath = new Map(files.map(file => [file.filename, file]));
  const byRoot = new Map(threads.map(thread => [thread.rootCommentId, thread]));
  const entries: CommentEntry[] = visibleThreads(inline, hideBots).map(group => {
    const file = byPath.get(group.root.path || '');
    return {
      kind: 'thread' as const,
      ...group,
      file,
      thread: byRoot.get(group.root.in_reply_to_id || group.root.id),
      location: file ? (commentGroups(file, [group.root]).inline.size ? ('diff' as const) : ('below' as const)) : ('missing' as const),
    };
  });
  entries.push(
    ...conversation.filter(comment => !hideBots || !isBot(comment.user)).map(comment => ({ kind: 'conversation' as const, comment })),
  );
  return entries.sort(
    (a, b) =>
      Date.parse(b.kind === 'thread' ? b.root.created_at : b.comment.created_at) -
      Date.parse(a.kind === 'thread' ? a.root.created_at : a.comment.created_at),
  );
}

export function filterCommentEntries(entries: CommentEntry[], filter: CommentFilter) {
  if (filter === 'all') return entries;
  return entries.filter(entry =>
    entry.kind === 'thread'
      ? filter === 'resolved'
        ? entry.thread?.resolved === true
        : entry.thread?.resolved !== true
      : filter === 'open',
  );
}

export function diffLinePreview(file: ChangedFile, line: number, side: DiffSide) {
  for (const row of patchLines(file.patch)) if (row[side] === line) return { text: row.text, kind: row.kind };
  return undefined;
}

export function commentSnippet(comment: Comment, file?: ChangedFile, lines = 4) {
  if (comment.subject_type === 'file') return [];
  const rows = [...patchLines(comment.diff_hunk || file?.patch)];
  // GitHub's diff_hunk ends at the commented line, even once the comment is outdated.
  const end = comment.diff_hunk ? rows.length - 1 : rows.findIndex(row => row[comment.side || 'RIGHT'] === comment.line);
  return end < 0 ? [] : rows.slice(Math.max(0, end - lines + 1), end + 1);
}

export interface LinePoint {
  line: number;
  side: DiffSide;
}
export interface CommentLocation extends LinePoint {
  startLine?: number;
  startSide?: DiffSide;
}

export function commentRange(file: ChangedFile, start: LinePoint, end: LinePoint): CommentLocation | undefined {
  const rows = new Map<string, { row: number; hunk: number }>();
  let row = 0;
  for (const line of patchLines(file.patch)) {
    for (const side of diffSides) if (line[side] !== undefined) rows.set(`${side}:${line[side]}`, { row, hunk: line.hunk });
    row++;
  }
  const a = rows.get(`${start.side}:${start.line}`),
    b = rows.get(`${end.side}:${end.line}`);
  // GitHub rejects multi-line comments that leave a hunk.
  if (!a || !b || a.hunk !== b.hunk) return undefined;
  if (a.row === b.row) return { line: end.line, side: end.side };
  const [first, last] = a.row < b.row ? [start, end] : [end, start];
  return { line: last.line, side: last.side, startLine: first.line, startSide: first.side };
}
