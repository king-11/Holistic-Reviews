import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileStatus, fileStatuses, filterFiles, toggleFileStatus, type FileStatus } from './file_filters.ts';
import type { ChangedFile } from './github.ts';

const files: ChangedFile[] = [
  { filename: 'src/new.ts', status: 'added', additions: 2, deletions: 0, changes: 2, patch: '+NEW value' },
  { filename: 'src/updated.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '-old\n+new value' },
  { filename: 'src/moved.ts', previous_filename: 'legacy/original.ts', status: 'renamed', additions: 0, deletions: 0, changes: 0 },
  { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 1, changes: 1, patch: '-old' },
  { filename: 'assets/new.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
];

describe('Git status file filters', () => {
  it('provides the four requested labels and unambiguous status badges', () => {
    assert.deepEqual(
      fileStatuses.map(status => [status.value, status.label, status.letter]),
      [
        ['added', 'Added', 'A'],
        ['modified', 'Modified', 'M'],
        ['renamed', 'Renamed', 'R'],
        ['deleted', 'Deleted', 'D'],
      ],
    );
    assert.equal(fileStatus('removed').value, 'deleted');
    assert.equal(fileStatus('deleted').value, 'deleted');
    assert.equal(fileStatus('copied').value, 'added');
    assert.equal(fileStatus('changed').value, 'modified');
    assert.equal(fileStatus('unknown').value, 'modified');
  });

  it('shows every file with no filters, including binary files and renamed files without a patch', () => {
    assert.deepEqual(filterFiles(files, {}), files);
    assert.deepEqual(filterFiles(files, { filename: '', content: '', statuses: [] }), files);
  });

  it('filters each Git status and unions multiple selected statuses in original diff order', () => {
    assert.deepEqual(filterFiles(files, { statuses: ['added'] }), [files[0], files[4]]);
    assert.deepEqual(filterFiles(files, { statuses: ['modified'] }), [files[1]]);
    assert.deepEqual(filterFiles(files, { statuses: ['renamed'] }), [files[2]]);
    assert.deepEqual(filterFiles(files, { statuses: ['deleted'] }), [files[3]]);
    assert.deepEqual(filterFiles(files, { statuses: ['deleted', 'added'] }), [files[0], files[3], files[4]]);
    assert.deepEqual(filterFiles(files, { statuses: fileStatuses.map(status => status.value) }), files);
  });

  it('searches both the current filename and a rename’s original path case-insensitively', () => {
    assert.deepEqual(filterFiles(files, { filename: 'SRC/MOVED' }), [files[2]]);
    assert.deepEqual(filterFiles(files, { filename: 'LEGACY/original' }), [files[2]]);
    assert.deepEqual(filterFiles(files, { filename: '.PNG', statuses: ['added'] }), [files[4]]);
  });

  it('intersects Git status, filename and case-insensitive diff-content filters', () => {
    assert.deepEqual(filterFiles(files, { statuses: ['added', 'modified'], filename: 'src/', content: 'NEW VALUE' }), [files[0], files[1]]);
    assert.deepEqual(filterFiles(files, { statuses: ['modified'], filename: 'updated', content: '+new' }), [files[1]]);
    assert.deepEqual(filterFiles(files, { statuses: ['deleted'], filename: 'src/', content: 'new' }), []);
    assert.deepEqual(filterFiles(files, { statuses: ['renamed'], filename: 'updated' }), []);
  });

  it('requires actual patch content for content searches without dropping patchless files from other filters', () => {
    assert.deepEqual(filterFiles(files, { content: 'old' }), [files[1], files[3]]);
    assert.deepEqual(filterFiles(files, { statuses: ['added'], content: 'new.png' }), []);
    assert.deepEqual(filterFiles(files, { statuses: ['renamed'], content: 'original' }), []);
    assert.deepEqual(filterFiles([], { statuses: ['added'] }), []);
  });

  it('adds/removes statuses without mutating selection and treats the last deselection as clearing the filter', () => {
    const selected: FileStatus[] = ['added'];
    const combined = toggleFileStatus(selected, 'modified');
    assert.deepEqual(combined, ['added', 'modified']);
    assert.deepEqual(selected, ['added']);
    assert.deepEqual(toggleFileStatus(combined, 'added'), ['modified']);
    assert.deepEqual(combined, ['added', 'modified']);
    assert.deepEqual(toggleFileStatus(selected, 'added'), []);
    assert.deepEqual(filterFiles(files, { statuses: toggleFileStatus(selected, 'added') }), files);
  });

  it('Alt/Option-click isolates exactly one status even when it is already selected', () => {
    const selected: FileStatus[] = ['added', 'modified'];
    assert.deepEqual(toggleFileStatus(selected, 'added', true), ['added']);
    assert.deepEqual(toggleFileStatus(selected, 'deleted', true), ['deleted']);
    assert.deepEqual(toggleFileStatus([], 'renamed', true), ['renamed']);
    assert.deepEqual(selected, ['added', 'modified']);
  });

  it('preserves file identity and diff metadata, and restores all files after empty results are cleared', () => {
    const before = structuredClone(files);
    assert.deepEqual(filterFiles(files, { filename: 'no-such-file', statuses: ['added'] }), []);
    const restored = filterFiles(files, {});
    assert.deepEqual(files, before);
    restored.forEach((file, index) => assert.equal(file, files[index]));
    assert.equal(restored[2].previous_filename, 'legacy/original.ts');
  });
});
