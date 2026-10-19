import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentEntries,
  commentRange,
  commentSnippet,
  diffLinePreview,
  filterCommentEntries,
  isBot,
  visibleThreads,
  withThreadLocations,
} from './comments.ts';
import type { ChangedFile, Comment, ReviewThread, User } from './github.ts';

const file: ChangedFile = {
  filename: 'src/work.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -10,3 +10,4 @@\n context\n-old\n+new\n+next\n last\n',
};
const person: User = { id: 1, login: 'reviewer', type: 'User' };
const bot: User = { id: 2, login: 'review-assistant[bot]', type: 'Bot' };
const comment = (id: number, user: User, line: number | null = 11, side: 'LEFT' | 'RIGHT' = 'RIGHT'): Comment => ({
  id,
  user,
  line,
  side,
  path: file.filename,
  body: String(id),
  created_at: `2026-10-17T00:00:${String(id).padStart(2, '0')}Z`,
});
const resolved: ReviewThread = { id: 'thread-3', rootCommentId: 3, resolved: true, canResolve: false, canUnresolve: true };
const open: ReviewThread = { id: 'thread-1', rootCommentId: 1, resolved: false, canResolve: true, canUnresolve: false };

describe('comment panel and bot visibility', () => {
  it('restores pending REST comment locations from canonical GraphQL threads, including left-side replies', () => {
    const root = { ...comment(1, person, null), side: undefined };
    const reply = { ...comment(2, person, null), in_reply_to_id: 1 };
    const thread: ReviewThread = { ...open, path: file.filename, line: 11, side: 'LEFT', outdated: false, subjectType: 'LINE' };
    const located = withThreadLocations([root, reply], [thread]);
    assert.deepEqual(
      located.map(item => [item.id, item.path, item.line, item.side]),
      [
        [1, file.filename, 11, 'LEFT'],
        [2, file.filename, 11, 'LEFT'],
      ],
    );
    const entries = commentEntries([file], located, [], [thread], false);
    assert.equal(entries[0].kind === 'thread' && entries[0].location, 'diff');
    assert.equal(root.line, null);
    assert.equal(root.side, undefined);
  });
  it('never turns outdated or file-level feedback into a current inline comment', () => {
    for (const extra of [{ outdated: true }, { subjectType: 'FILE' as const }]) {
      const thread = { ...open, path: file.filename, line: 11, side: 'RIGHT' as const, ...extra };
      const located = withThreadLocations([comment(1, person)], [thread]);
      assert.equal(located[0].line, null);
      const entries = commentEntries([file], located, [], [thread], false);
      assert.equal(entries[0].kind === 'thread' && entries[0].location, 'below');
    }
  });
  it('does not attach comments to the wrong file or discard usable REST locations when metadata is unavailable', () => {
    const root = comment(1, person);
    assert.deepEqual(withThreadLocations([root], []), [root]);
    assert.deepEqual(withThreadLocations([root], [open]), [root]);
    assert.deepEqual(withThreadLocations([root], [{ ...open, path: 'another/file.ts', line: 11 }]), [root]);
  });
  it('recognizes typed and suffixed bots without hiding normal reviewers', () => {
    assert.equal(isBot(bot), true);
    assert.equal(isBot({ id: 3, login: 'legacy[bot]' }), true);
    assert.equal(isBot({ id: 4, login: 'robotic-reviewer', type: 'User' }), false);
    assert.equal(isBot(person), false);
  });
  it('keeps the hidden bot root for navigation and the human reply for display', () => {
    const root = comment(1, bot);
    const reply = { ...comment(2, person, null), in_reply_to_id: 1 };
    assert.deepEqual(visibleThreads([reply, root], true), [{ root, comments: [reply] }]);
    assert.deepEqual(visibleThreads([root], true), []);
    assert.deepEqual(visibleThreads([root, reply], false), [{ root, comments: [root, reply] }]);
  });
  it('includes inline, off-patch, missing-file and conversation entries without inventing resolution', () => {
    const inline = [
      comment(1, bot),
      { ...comment(2, person, null), in_reply_to_id: 1 },
      comment(3, person, 11, 'LEFT'),
      comment(4, person, 900),
      { ...comment(5, person), path: 'deleted.ts' },
    ];
    const issue = [comment(6, person), comment(7, bot)];
    const entries = commentEntries([file], inline, issue, [open, resolved], true);
    assert.equal(entries.length, 5);
    assert.deepEqual(
      entries.filter(entry => entry.kind === 'thread').map(entry => [entry.root.id, entry.location]),
      [
        [5, 'missing'],
        [4, 'below'],
        [3, 'diff'],
        [1, 'diff'],
      ],
    );
    const withReply = entries.find(entry => entry.kind === 'thread' && entry.root.id === 1);
    assert.ok(withReply?.kind === 'thread');
    assert.equal(withReply.comments.length, 1);
    assert.deepEqual(
      filterCommentEntries(entries, 'resolved').map(entry => (entry.kind === 'thread' ? entry.root.id : entry.comment.id)),
      [3],
    );
    assert.deepEqual(
      filterCommentEntries(entries, 'open').map(entry => (entry.kind === 'thread' ? entry.root.id : entry.comment.id)),
      [6, 5, 4, 1],
    );
    assert.equal(filterCommentEntries(entries, 'all').length, 5);
    assert.deepEqual(commentEntries([file], [comment(1, bot)], [], [], true), []);
  });
  const multi = { ...file, patch: `${file.patch}@@ -50 +60 @@\n-old again\n+new again\n` };
  for (const [line, side, expected, patched = file] of [
    [11, 'LEFT', { text: 'old', kind: 'deletion' }],
    [11, 'RIGHT', { text: 'new', kind: 'addition' }],
    [12, 'RIGHT', { text: 'next', kind: 'addition' }],
    [10, 'LEFT', { text: 'context', kind: 'context' }],
    [12, 'LEFT', { text: 'last', kind: 'context' }],
    [999, 'RIGHT', undefined],
    [60, 'RIGHT', { text: 'new again', kind: 'addition' }, multi],
  ] as const) {
    it(`previews ${side}:${line}${patched === multi ? ' in a later hunk' : ''}`, () =>
      assert.deepEqual(diffLinePreview(patched, line, side), expected));
  }
  const hunk = '@@ -1,2 +1,2 @@\n a\n-b\n+c';
  for (const [name, extra, lines, expected] of [
    ['the lines up to the commented one', {}, 4, ['context', 'old', 'new']],
    ['only the commented line', {}, 1, ['new']],
    ['the end of an outdated diff_hunk', { line: null, diff_hunk: hunk }, 4, ['a', 'b', 'c']],
    ['nothing for a line outside the patch', { line: 999 }, 4, []],
    ['nothing for a file comment', { subject_type: 'file' }, 4, []],
  ] as const) {
    it(`snippets ${name}`, () =>
      assert.deepEqual(
        commentSnippet({ ...comment(1, person), ...extra }, file, lines).map(row => row.text),
        expected,
      ));
  }
});

describe('commentRange', () => {
  const R = (line: number) => ({ line, side: 'RIGHT' as const });
  const L = (line: number) => ({ line, side: 'LEFT' as const });
  const twoHunks: ChangedFile = { ...file, patch: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -20,2 +20,2 @@\n x\n-y\n+z\n' };
  const down = { line: 13, side: 'RIGHT', startLine: 11, startSide: 'RIGHT' };
  const mixed = { line: 12, side: 'RIGHT', startLine: 11, startSide: 'LEFT' };
  for (const [name, start, end, expected, patched = file] of [
    ['keeps a clicked added line single-line', R(11), R(11), { line: 11, side: 'RIGHT' }],
    ['keeps a clicked context line single-line', L(10), R(10), { line: 10, side: 'RIGHT' }],
    ['keeps a clicked left line single-line', L(12), L(12), { line: 12, side: 'LEFT' }],
    ['orders a downward drag', R(11), R(13), down],
    ['orders an upward drag', R(13), R(11), down],
    ['spans deleted then added lines', L(11), R(12), mixed],
    ['spans added then deleted lines', R(12), L(11), mixed],
    ['rejects lines outside the diff', R(11), R(30), undefined],
    ['rejects ranges across hunks', R(1), R(21), undefined, twoHunks],
    ['allows ranges within a later hunk', R(20), R(21), { line: 21, side: 'RIGHT', startLine: 20, startSide: 'RIGHT' }, twoHunks],
  ] as const) {
    it(name, () => assert.deepEqual(commentRange(patched, start, end), expected));
  }
});
