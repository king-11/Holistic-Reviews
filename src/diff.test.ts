import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiffHunksRenderer, hydratePartialDiff, parsePatchFiles } from '@pierre/diffs';
import {
  commentGroups,
  metadataForFile,
  nearestContextDirection,
  patchForFile,
  textLineCount,
  threadsForComments,
  toggleViewedFile,
  verifiedContextLines,
} from './diff.ts';
import { demoWorkspace } from './demo.ts';
import type { ChangedFile, Comment } from './github.ts';

const file: ChangedFile = {
  filename: 'src/a.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -10,3 +10,3 @@\n context\n-old\n+new\n last\n',
};
const comment = (id: number, line: number | null, side: 'LEFT' | 'RIGHT' = 'RIGHT'): Comment => ({
  id,
  line,
  side,
  path: file.filename,
  body: 'test',
  user: { id: 1, login: 'me' },
  created_at: new Date().toISOString(),
});

describe('diff patches and inline comment placement', () => {
  it('expands the first/last gaps from the adjacent block, never the far end of the file', () => {
    for (const diffStyle of ['split', 'unified'] as const) {
      const renderer = new DiffHunksRenderer({ diffStyle });
      renderer.expandHunk(0, nearestContextDirection(0, 2, 'both'), 20);
      renderer.expandHunk(2, nearestContextDirection(2, 2, 'both'), 20);
      assert.deepEqual(renderer.getExpandedHunksMap().get(0), { fromStart: 0, fromEnd: 20 });
      assert.deepEqual(renderer.getExpandedHunksMap().get(2), { fromStart: 20, fromEnd: 0 });
      renderer.expandHunk(0, nearestContextDirection(0, 2, 'both'), 20);
      renderer.expandHunk(2, nearestContextDirection(2, 2, 'both'), 20);
      assert.deepEqual(renderer.getExpandedHunksMap().get(0), { fromStart: 0, fromEnd: 40 });
      assert.deepEqual(renderer.getExpandedHunksMap().get(2), { fromStart: 40, fromEnd: 0 });
    }
  });
  it('preserves directional arrows, interior-gap expansion and explicit Expand all', () => {
    assert.equal(nearestContextDirection(0, 2, 'down'), 'down');
    assert.equal(nearestContextDirection(2, 2, 'up'), 'up');
    assert.equal(nearestContextDirection(1, 2, 'both'), 'both');
    assert.equal(nearestContextDirection(1, 2, 'up'), 'up');
    assert.equal(nearestContextDirection(1, 2, 'down'), 'down');
    assert.equal(nearestContextDirection(0, 2, 'both', Infinity), 'both');
    assert.equal(nearestContextDirection(2, 2, 'both', Infinity), 'both');
    const renderer = new DiffHunksRenderer();
    renderer.expandHunk(1, nearestContextDirection(1, 2, 'up'), 20);
    assert.deepEqual(renderer.getExpandedHunksMap().get(1), { fromStart: 20, fromEnd: 0 });
    renderer.expandHunk(1, nearestContextDirection(1, 2, 'down'), 20);
    assert.deepEqual(renderer.getExpandedHunksMap().get(1), { fromStart: 20, fromEnd: 20 });
  });
  it('extends toward the start contiguously across repeated expansions without skipping adjacent lines', () => {
    const renderer = new DiffHunksRenderer();
    const firstVisibleLine = 101;
    const visibleRanges: [number, number][] = [];
    for (let click = 1; click <= 3; click++) {
      renderer.expandHunk(0, nearestContextDirection(0, 1, 'both'), 20);
      const expanded = renderer.getExpandedHunksMap().get(0)!;
      visibleRanges.push([firstVisibleLine - expanded.fromEnd, firstVisibleLine - 1]);
      assert.equal(expanded.fromStart, 0);
    }
    assert.deepEqual(visibleRanges, [
      [81, 100],
      [61, 100],
      [41, 100],
    ]);
  });
  it('hydrates partial hunks with full unchanged lines above and below without shifting side coordinates', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\ncontext\nold\nlast\nthirteen\nfourteen\n';
    const after = before.replace('\nold\n', '\nnew\n');
    const partial = metadataForFile(file)!;
    assert.equal(partial.isPartial, true);
    const hydrated = hydratePartialDiff('merge', partial, {
      oldFile: { name: file.filename, contents: before },
      newFile: { name: file.filename, contents: after },
    });
    assert.equal(hydrated.isPartial, false);
    assert.equal(hydrated.deletionLines[10], 'old\n');
    assert.equal(hydrated.additionLines[10], 'new\n');
    assert.equal(hydrated.additionLines[13], 'fourteen\n');
    assert.equal(hydrated.hunks[0].additionStart, 10);
    assert.equal(hydrated.hunks[0].deletionStart, 10);
    assert.deepEqual(verifiedContextLines(file, before, after), { LEFT: 14, RIGHT: 14 });
    assert.throws(() => verifiedContextLines(file, after, before), /does not match this diff/);
    assert.throws(() => verifiedContextLines(file, '', after), /does not match this diff/);
  });
  it('verifies full context across multiple hunks, CRLF files, and missing terminal newlines', () => {
    const changed = { ...file, patch: '@@ -2 +2 @@\n-old\n+new\n@@ -4 +4 @@\n-last old\n+last new\n\\ No newline at end of file\n' };
    assert.deepEqual(verifiedContextLines(changed, 'one\r\nold\r\nthree\r\nlast old', 'one\r\nnew\r\nthree\r\nlast new'), {
      LEFT: 4,
      RIGHT: 4,
    });
    assert.throws(() => verifiedContextLines(changed, 'one\r\nold\r\nthree\r\nwrong', 'one\r\nnew\r\nthree\r\nlast new'), /does not match/);
  });
  it('anchors expanded-context threads only within verified full-file line counts', () => {
    const before = comment(1, 2, 'LEFT'),
      after = comment(2, 14),
      invalid = comment(3, 99);
    const outdated = { ...comment(4, 3), outdated: true },
      fileLevel = { ...comment(5, 4), subject_type: 'file' as const };
    assert.deepEqual(commentGroups(file, [before, after]).below, [before, after]);
    const groups = commentGroups(file, [before, after, invalid, outdated, fileLevel], { LEFT: 14, RIGHT: 14 });
    assert.deepEqual([...groups.inline.keys()], ['LEFT:2', 'RIGHT:14']);
    assert.deepEqual(groups.below, [invalid, outdated, fileLevel]);
    assert.equal(textLineCount(''), 0);
    assert.equal(textLineCount('one\n'), 1);
    assert.equal(textLineCount('one\ntwo'), 2);
  });
  const viewedCases: [string, string[], string[], string[], string[]][] = [
    [
      'marks a file viewed and collapses it, preserving unrelated state',
      ['src/other.ts'],
      ['src/third.ts'],
      ['src/other.ts', file.filename],
      ['src/third.ts', file.filename],
    ],
    [
      'unmarks a viewed file and reopens it, preserving unrelated state',
      [file.filename, 'src/other.ts'],
      [file.filename, 'src/third.ts'],
      ['src/other.ts'],
      ['src/third.ts'],
    ],
    ['marks an already closed unviewed file', [], [file.filename], [file.filename], [file.filename]],
    ['reopens a manually expanded viewed file when unmarked', [file.filename], [], [], []],
  ];
  for (const [name, viewed, collapsed, nextViewed, nextCollapsed] of viewedCases) {
    it(name, () => {
      const input = { viewed: new Set(viewed), collapsed: new Set(collapsed) };
      const next = toggleViewedFile(file.filename, input.viewed, input.collapsed);
      assert.deepEqual([[...next.viewed], [...next.collapsed]], [nextViewed, nextCollapsed]);
      assert.deepEqual([[...input.viewed], [...input.collapsed]], [viewed, collapsed]);
    });
  }
  it('renders every text patch in the sample workspace with Pierre Diffs', () => {
    for (const file of demoWorkspace().files.filter(file => file.patch)) {
      const parsed = parsePatchFiles(patchForFile(file), undefined, true)[0]?.files[0];
      assert.equal(parsed?.name, file.filename);
      assert.ok(parsed.hunks.length);
      if (file.status === 'added') assert.equal(parsed.type, 'new');
    }
  });
  it('preserves spaces, quotes, Unicode and renamed file paths', () => {
    const renamed = { ...file, status: 'renamed', filename: 'src/新 file "new".ts', previous_filename: 'src/old name.ts' };
    const parsed = metadataForFile(renamed)!;
    assert.equal(parsed.name, renamed.filename);
    assert.equal(parsed.prevName, renamed.previous_filename);
    assert.equal(parsed.type, 'rename-changed');
  });
  it('handles deleted files with no new path', () => {
    const deleted = { ...file, status: 'removed', patch: '@@ -1 +0,0 @@\n-old\n' };
    const parsed = parsePatchFiles(patchForFile(deleted), undefined, true)[0].files[0];
    assert.equal(parsed.type, 'deleted');
  });
  it('anchors left and right comments independently and keeps replies with their root', () => {
    const root = comment(1, 11),
      left = comment(2, 11, 'LEFT');
    const reply = { ...comment(3, null), in_reply_to_id: 1 };
    const groups = commentGroups(file, [root, left, reply]);
    assert.deepEqual(groups.inline.get('RIGHT:11'), [root, reply]);
    assert.deepEqual(groups.inline.get('LEFT:11'), [left]);
    assert.deepEqual(groups.below, []);
  });
  it('keeps outdated, file-level and off-patch comments visible below the file', () => {
    const comments = [comment(1, null), comment(2, 400), { ...comment(3, null), in_reply_to_id: 999 }];
    assert.deepEqual(commentGroups(file, comments).below, comments);
  });
  it('handles context, multiple hunks, added files and binary files', () => {
    const multi = { ...file, patch: `${file.patch}@@ -50 +60 @@\n-old\n+new\n` };
    const groups = commentGroups(multi, [comment(1, 10, 'LEFT'), comment(2, 60), comment(3, 50, 'LEFT')]);
    assert.equal(groups.inline.size, 3);
    assert.deepEqual(
      commentGroups({ ...file, patch: undefined }, [comment(1, 11)]).below.map(item => item.id),
      [1],
    );
    assert.equal(commentGroups(demoWorkspace().files[0], demoWorkspace().inlineComments).inline.size, 1);
  });
  it('keeps separate root threads on the same line and places each root before its replies', () => {
    const root = comment(1, 11),
      other = comment(2, 11);
    const reply = { ...comment(3, 11), in_reply_to_id: 1 };
    const groups = threadsForComments([reply, other, root]);
    assert.deepEqual(
      groups.map(group => group.comments.map(item => item.id)),
      [[1, 3], [2]],
    );
    assert.deepEqual(
      groups.map(group => group.root.id),
      [1, 2],
    );
    assert.deepEqual(threadsForComments([reply])[0].comments, [reply]);
    assert.deepEqual(threadsForComments([]), []);
  });
});
