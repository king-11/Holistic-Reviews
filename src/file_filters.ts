import type { ChangedFile } from './github.ts';

export const fileStatuses = [
  { value: 'added', label: 'Added', letter: 'A' },
  { value: 'modified', label: 'Modified', letter: 'M' },
  { value: 'renamed', label: 'Renamed', letter: 'R' },
  { value: 'deleted', label: 'Deleted', letter: 'D' },
] as const;
export type FileStatus = (typeof fileStatuses)[number]['value'];

export function fileStatus(status: string): (typeof fileStatuses)[number] {
  switch (status) {
    case 'added':
    case 'copied':
      return fileStatuses[0];
    case 'renamed':
      return fileStatuses[2];
    case 'removed':
    case 'deleted':
      return fileStatuses[3];
    default:
      return fileStatuses[1];
  }
}

export function toggleFileStatus(selected: readonly FileStatus[], status: FileStatus, exclusive = false): FileStatus[] {
  if (exclusive) return [status];
  return selected.includes(status) ? selected.filter(value => value !== status) : [...selected, status];
}

// GitHub orders files by raw path, so match it in both the diff and the sidebar tree.
export const compareFilenames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortFiles(files: ChangedFile[]): ChangedFile[] {
  return [...files].sort((a, b) => compareFilenames(a.filename, b.filename));
}

export function filterFiles(
  files: ChangedFile[],
  filters: { filename?: string; content?: string; statuses?: readonly FileStatus[] },
): ChangedFile[] {
  const filename = (filters.filename || '').toLowerCase();
  const content = (filters.content || '').toLowerCase();
  return files.filter(
    file =>
      (!filters.statuses?.length || filters.statuses.includes(fileStatus(file.status).value)) &&
      (file.filename.toLowerCase().includes(filename) || !!file.previous_filename?.toLowerCase().includes(filename)) &&
      (!content || !!file.patch?.toLowerCase().includes(content)),
  );
}
