import { searchResultCap, type InboxItem, type MergedFilter, type SearchOrder } from './github.ts';
import { tryStorage } from './storage.ts';

const mergedFilters = ['all', 'mine', 'reviewing'] as const;
const sectionIds = ['requested', 'returned', 'approved', 'waiting', 'drafts', 'reviewed', 'merged'] as const;
const sortChoices = [
  'priority',
  'title-asc',
  'title-desc',
  'size-desc',
  'size-asc',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
] as const;
export type SortChoice = (typeof sortChoices)[number];
export type InboxSectionId = (typeof sectionIds)[number];
export const sortOptions: { value: SortChoice; label: string; detail?: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'title-asc', label: 'Title', detail: 'A–Z' },
  { value: 'title-desc', label: 'Title', detail: 'Z–A' },
  { value: 'size-desc', label: 'Size of change', detail: 'Largest first' },
  { value: 'size-asc', label: 'Size of change', detail: 'Smallest first' },
  { value: 'updated-desc', label: 'Updated', detail: 'Latest first' },
  { value: 'updated-asc', label: 'Updated', detail: 'Oldest first' },
  { value: 'created-desc', label: 'Created', detail: 'Latest first' },
  { value: 'created-asc', label: 'Created', detail: 'Oldest first' },
];
export const defaultSort = (section: InboxSectionId): SortChoice => (section === 'requested' ? 'priority' : 'updated-desc');
// Updated and created also re-query, since only GitHub can order pages that aren't loaded yet.
export const serverOrder = (choice: SortChoice): SearchOrder => ({
  sort: choice.startsWith('created') ? 'created' : 'updated',
  order: choice.endsWith('asc') ? 'asc' : 'desc',
});
export const needsServerRefetch = (choice: SortChoice, loaded: number, total: number) =>
  (choice.startsWith('updated') || choice.startsWith('created')) && loaded < Math.min(total, searchResultCap);
const sizeOf = (item: InboxItem) => (item.details ? item.details.additions + item.details.deletions : undefined);
// Items without size data sort last whichever way the size is ordered.
const bySize = (direction: 1 | -1) => (a: InboxItem, b: InboxItem) => {
  const [sizeA, sizeB] = [sizeOf(a), sizeOf(b)];
  if (sizeA === undefined || sizeB === undefined) return Number(sizeA === undefined) - Number(sizeB === undefined);
  return direction * (sizeA - sizeB);
};
const byDate = (key: 'updated_at' | 'created_at', direction: 1 | -1) => (a: InboxItem, b: InboxItem) =>
  direction * a[key].localeCompare(b[key]);
// Server-ordered choices also sort what is loaded, so rows corrected after an action land where search will put them.
export const clientOrders: Record<SortChoice, (a: InboxItem, b: InboxItem) => number> = {
  priority: byDate('updated_at', -1),
  'title-asc': (a, b) => a.title.localeCompare(b.title),
  'title-desc': (a, b) => b.title.localeCompare(a.title),
  'size-asc': bySize(1),
  'size-desc': bySize(-1),
  'updated-desc': byDate('updated_at', -1),
  'updated-asc': byDate('updated_at', 1),
  'created-desc': byDate('created_at', -1),
  'created-asc': byDate('created_at', 1),
};

type InboxPreferences = {
  repos?: string[];
  sorts?: Partial<Record<InboxSectionId, SortChoice>>;
  merged?: MergedFilter;
  known?: string[];
};
const preferencesKey = 'review.inbox';
const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
const sectionSorts = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([section, choice]) =>
        sectionIds.includes(section as InboxSectionId) &&
        sortChoices.includes(choice as SortChoice) &&
        (section === 'requested' || choice !== 'priority'),
    ),
  ) as Partial<Record<InboxSectionId, SortChoice>>;
};
export function readPreferences(): InboxPreferences {
  const saved = tryStorage(() => JSON.parse(localStorage.getItem(preferencesKey) ?? 'null')) as Record<string, unknown> | null;
  return {
    repos: stringList(saved?.repos),
    sorts: sectionSorts(saved?.sorts),
    merged: mergedFilters.find(filter => filter === saved?.merged),
    known: stringList(saved?.known),
  };
}
export const savePreferences = (preferences: InboxPreferences) =>
  tryStorage(() => localStorage.setItem(preferencesKey, JSON.stringify(preferences)));
// Saved order stands in for counts, so the repository menu keeps its order until a fresh unfiltered load recounts.
export const rankCounts = (repos: string[]) => new Map(repos.map((repo, index) => [repo, repos.length - index]));
