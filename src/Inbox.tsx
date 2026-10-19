import { computed, defineComponent, onUnmounted, shallowRef, watch } from 'vue';
import { createShortcuts, modalOpen, step } from './shortcuts';
import { AnimatePresence, motion } from 'motion-v';
import { fade } from './motion';
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  FilePenLine,
  Filter,
  GitMerge,
  GitPullRequest,
  Hourglass,
  Inbox as InboxIcon,
  Layers,
  MessageSquareReply,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  ThumbsUp,
} from '@lucide/vue';
import {
  type GitHub,
  type InboxGroup,
  type InboxItem,
  type InboxResult,
  type MergedFilter,
  type ReviewState,
  type SearchOrder,
  type TokenInfo,
} from './github';
import { demoInbox } from './demo';
import { checkIcons } from './Checks';
import { Avatar, IconButton, SearchField, Spinner, inputValue, timeAgo, tryStorage, Dismiss } from './ui';
import styles from './Inbox.module.css';

// Each section is a view of one fetched group; the authored group splits by review state.
type Section = {
  id: string;
  group: InboxGroup;
  review?: ReviewState;
  label: string;
  description: string;
  icon: typeof GitPullRequest;
};
const sections: Section[] = [
  {
    id: 'requested',
    group: 'requested',
    label: 'Needs your review',
    description: 'Ready-for-review pull requests where you are a requested reviewer',
    icon: CircleDot,
  },
  {
    id: 'returned',
    group: 'authored',
    review: 'returned',
    label: 'Returned to you',
    description: 'Reviewers commented or requested changes and haven’t been re-requested',
    icon: MessageSquareReply,
  },
  {
    id: 'approved',
    group: 'authored',
    review: 'approved',
    label: 'Approved',
    description: 'Your open pull requests that reviewers approved',
    icon: ThumbsUp,
  },
  {
    id: 'waiting',
    group: 'authored',
    review: 'waiting',
    label: 'Waiting for review',
    description: 'Your open pull requests waiting on reviewers',
    icon: Hourglass,
  },
  { id: 'drafts', group: 'drafts', label: 'Drafts', description: 'Work in progress, authored by you', icon: FilePenLine },
  {
    id: 'reviewed',
    group: 'reviewed',
    label: 'Reviewed by you',
    description: 'Open pull requests you have reviewed, including drafts',
    icon: CircleCheck,
  },
  {
    id: 'merged',
    group: 'merged',
    label: 'Recently merged',
    description: 'Merged pull requests in the selected repositories, most recently updated first',
    icon: GitMerge,
  },
];
const fetchedGroups = [...new Set(sections.map(section => section.group))];
const sectionById = (id: string) => sections.find(section => section.id === id)!;
// Items GitHub search returns before review data arrives count as waiting.
const reviewOf = (item: InboxItem) => item.review ?? 'waiting';
const mergedOptions: { value: MergedFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Every merged pull request in the selected repositories' },
  { value: 'mine', label: 'By me', title: 'Merged pull requests you authored' },
  {
    value: 'reviewing',
    label: 'Review requested',
    title: 'Merged pull requests where your review was requested (directly or via a team) or that you reviewed',
  },
];
// Without a repository selection, "all" falls back to the viewer's own PRs, matching the query.
const effectiveMerged = (repos: string[], filter: MergedFilter): MergedFilter => (filter === 'all' && !repos.length ? 'mine' : filter);
// Demo items use "you" for the signed-in viewer.
const demoViewer = 'you';
const demoMerged = (repos: string[], filter: MergedFilter) => {
  const mode = effectiveMerged(repos, filter);
  return demoInbox.merged.filter(item => {
    const mine = item.user.login === demoViewer;
    return (!repos.length || repos.includes(repository(item))) && (mode === 'all' || (mode === 'mine' ? mine : !mine));
  });
};
const demoResult = (items: InboxItem[]): InboxResult => ({ items, total_count: items.length, incomplete_results: false });

const sortChoices = [
  'title-asc',
  'title-desc',
  'size-desc',
  'size-asc',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
] as const;
type SortChoice = (typeof sortChoices)[number];
const sortOptions: { value: SortChoice; label: string; detail: string }[] = [
  { value: 'title-asc', label: 'Title', detail: 'A–Z' },
  { value: 'title-desc', label: 'Title', detail: 'Z–A' },
  { value: 'size-desc', label: 'Size of change', detail: 'Largest first' },
  { value: 'size-asc', label: 'Size of change', detail: 'Smallest first' },
  { value: 'updated-desc', label: 'Updated', detail: 'Latest first' },
  { value: 'updated-asc', label: 'Updated', detail: 'Oldest first' },
  { value: 'created-desc', label: 'Created', detail: 'Latest first' },
  { value: 'created-asc', label: 'Created', detail: 'Oldest first' },
];
// Updated and created are GitHub's own ordering, so they re-query; the rest reorder what is loaded.
const serverOrder = (choice: SortChoice): SearchOrder => ({
  sort: choice.startsWith('created') ? 'created' : 'updated',
  order: choice.endsWith('asc') ? 'asc' : 'desc',
});
const sizeOf = (item: InboxItem) => (item.details ? item.details.additions + item.details.deletions : undefined);
// Items without size data sort last whichever way the size is ordered.
const bySize = (direction: 1 | -1) => (a: InboxItem, b: InboxItem) => {
  const [sizeA, sizeB] = [sizeOf(a), sizeOf(b)];
  if (sizeA === undefined || sizeB === undefined) return Number(sizeA === undefined) - Number(sizeB === undefined);
  return direction * (sizeA - sizeB);
};
const clientOrders: Partial<Record<SortChoice, (a: InboxItem, b: InboxItem) => number>> = {
  'title-asc': (a, b) => a.title.localeCompare(b.title),
  'title-desc': (a, b) => b.title.localeCompare(a.title),
  'size-asc': bySize(1),
  'size-desc': bySize(-1),
};

type InboxPreferences = { repos?: string[]; sort?: SortChoice; known?: string[] };
const preferencesKey = 'review.inbox';
const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
function readPreferences(): InboxPreferences {
  const saved = tryStorage(() => JSON.parse(localStorage.getItem(preferencesKey) ?? 'null')) as Record<string, unknown> | null;
  return {
    repos: stringList(saved?.repos),
    sort: sortChoices.find(choice => choice === saved?.sort),
    known: stringList(saved?.known),
  };
}
// Saved order stands in for counts, so the repository menu keeps its order until a fresh unfiltered load recounts.
const rankCounts = (repos: string[]) => new Map(repos.map((repo, index) => [repo, repos.length - index]));
const savePreferences = (preferences: InboxPreferences) =>
  tryStorage(() => localStorage.setItem(preferencesKey, JSON.stringify(preferences)));

type Props = {
  api: GitHub | null;
  info: TokenInfo | null;
  onOpen: (url: string, item?: InboxItem) => void;
  onOpenDialog: () => void;
  onConnect: () => void;
};

export default defineComponent(
  (props: Props) => {
    const data = shallowRef<Partial<Record<InboxGroup, InboxResult>>>({});
    const errors = shallowRef<Partial<Record<InboxGroup, string>>>({});
    const loading = shallowRef(false);
    const query = shallowRef('');
    const search = shallowRef<HTMLInputElement>();
    const move = (delta: 1 | -1) =>
      step([...document.querySelectorAll<HTMLElement>('.pr-row')], document.activeElement as HTMLElement, delta)?.focus();
    const keydown = createShortcuts(() => ({ '/': () => search.value?.focus(), j: () => move(1), k: () => move(-1) }), modalOpen);
    document.addEventListener('keydown', keydown);
    onUnmounted(() => document.removeEventListener('keydown', keydown));
    const active = shallowRef('all');
    const collapsed = shallowRef<Set<string>>(new Set(['reviewed', 'merged']));
    const repoMenu = shallowRef(false);
    const sortMenu = shallowRef(false);
    const preferences = readPreferences();
    const selected = shallowRef<string[]>(preferences.repos ?? []);
    const sortChoice = shallowRef<SortChoice>(preferences.sort ?? 'updated-desc');
    const serverSort = computed(() => serverOrder(sortChoice.value));
    // Until a first unfiltered load picks the most-used repository, the choice is not saved, so it can still default.
    let repoDefaulted = preferences.repos !== undefined;
    // Live counts start from the saved list; demo counts are kept apart so they never overwrite it before sign-in.
    const knownRepos = shallowRef<string[]>(preferences.known ?? []);
    const repoCounts = shallowRef(rankCounts(knownRepos.value));
    const demoRepoCounts = shallowRef(new Map<string, number>());
    const customRepos = shallowRef<string[]>([]);
    const repoOptions = computed(() => {
      const counts = props.api && props.info ? repoCounts.value : demoRepoCounts.value;
      return [...new Set([...counts.keys(), ...customRepos.value, ...selected.value])].sort(
        (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
      );
    });
    watch(repoOptions, options => {
      if (props.api && props.info) knownRepos.value = options;
    });
    const customRepo = shallowRef('');
    const repoError = shallowRef('');
    const refresh = shallowRef(0);
    const moreBusy = shallowRef<InboxGroup | null>(null);
    let request = 0;
    let forceFresh = false;
    let controller: AbortController | undefined;
    // Each merged load (full reload or filter change) bumps this so only the newest one may write its result.
    let mergedVersion = 0;
    const mergedFilter = shallowRef<MergedFilter>('all');
    const mergedLoading = shallowRef(false);
    const stale = (group: InboxGroup, version: number, stamp: number) =>
      version !== request || (group === 'merged' && stamp !== mergedVersion);
    // Unfiltered loads define how many PRs each repository has; filtered loads only add repositories not yet seen.
    const countRepos = (target: typeof repoCounts, items: InboxItem[], unfiltered: boolean) => {
      const counts = new Map(target.value);
      for (const item of items) counts.set(repository(item), (counts.get(repository(item)) ?? 0) + (unfiltered ? 1 : 0));
      target.value = counts;
    };
    function applyDefaultRepo() {
      if (repoDefaulted) return;
      repoDefaulted = true;
      const [first] = repoOptions.value;
      if (first) selected.value = [first];
    }
    watch([selected, sortChoice, knownRepos], ([repos, sort, known]) =>
      savePreferences({ repos: repoDefaulted ? repos : undefined, sort, known }),
    );
    watch(
      [() => props.api, () => props.info, selected, refresh, serverSort],
      ([api, info, repos]) => {
        controller?.abort();
        const version = ++request;
        if (!api || !info) {
          if (!repos.length) demoRepoCounts.value = new Map();
          data.value = Object.fromEntries(
            fetchedGroups.map(group => {
              const items =
                group === 'merged'
                  ? demoMerged(repos, mergedFilter.value)
                  : demoInbox[group].filter(item => !repos.length || repos.includes(repository(item)));
              countRepos(demoRepoCounts, items, !repos.length);
              return [group, demoResult(items)];
            }),
          );
          errors.value = {};
          loading.value = false;
          return;
        }
        if (!repos.length) repoCounts.value = new Map();
        const signal = (controller = new AbortController()).signal;
        const client = forceFresh ? api.fresh() : api;
        forceFresh = false;
        const mergedStamp = ++mergedVersion;
        mergedLoading.value = false;
        loading.value = true;
        errors.value = {};
        data.value = {};
        void Promise.all(
          fetchedGroups.map(async group => {
            try {
              const result = await client.inbox(group, info.user.login, repos, 1, signal, mergedFilter.value, serverSort.value);
              if (stale(group, version, mergedStamp)) return;
              data.value = { ...data.value, [group]: result };
              countRepos(repoCounts, result.items, !repos.length);
            } catch (error) {
              if (version === request && !signal.aborted)
                errors.value = { ...errors.value, [group]: error instanceof Error ? error.message : 'Could not load this section.' };
            }
          }),
        ).finally(() => {
          if (version !== request) return;
          loading.value = false;
          applyDefaultRepo();
        });
      },
      { immediate: true },
    );
    // Only the merged group reloads on a filter change; the other sections keep their results.
    function reloadMerged() {
      const version = ++mergedVersion;
      errors.value = { ...errors.value, merged: undefined };
      if (!props.api || !props.info) {
        data.value = { ...data.value, merged: demoResult(demoMerged(selected.value, mergedFilter.value)) };
        return;
      }
      mergedLoading.value = true;
      data.value = { ...data.value, merged: undefined };
      props.api.inbox('merged', props.info.user.login, selected.value, 1, undefined, mergedFilter.value, serverSort.value).then(
        result => {
          if (version !== mergedVersion) return;
          data.value = { ...data.value, merged: result };
          mergedLoading.value = false;
        },
        error => {
          if (version !== mergedVersion) return;
          errors.value = { ...errors.value, merged: error instanceof Error ? error.message : 'Could not load this section.' };
          mergedLoading.value = false;
        },
      );
    }
    watch(mergedFilter, reloadMerged);
    onUnmounted(() => {
      request++;
      controller?.abort();
    });
    const items = (section: Section) => {
      const q = query.value.toLowerCase();
      const shown = (data.value[section.group]?.items || []).filter(
        item =>
          (!section.review || reviewOf(item) === section.review) &&
          `${item.title} ${item.number} ${item.user.login} ${repository(item)}`.toLowerCase().includes(q),
      );
      const compare = clientOrders[sortChoice.value];
      return compare ? shown.sort(compare) : shown;
    };
    const visibleSections = computed(() => sections.filter(section => active.value === 'all' || section.id === active.value));
    function toggleGroup(id: string) {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    }
    async function loadMore(id: InboxGroup) {
      const api = props.api,
        info = props.info,
        current = data.value[id],
        version = request,
        stamp = mergedVersion;
      if (!api || !info || !current || moreBusy.value) return;
      moreBusy.value = id;
      try {
        const next = await api.inbox(
          id,
          info.user.login,
          selected.value,
          Math.floor(current.items.length / 30) + 1,
          controller?.signal,
          mergedFilter.value,
          serverSort.value,
        );
        if (!stale(id, version, stamp)) {
          data.value = { ...data.value, [id]: { ...next, items: [...current.items, ...next.items] } };
          countRepos(repoCounts, next.items, !selected.value.length);
        }
      } catch (error) {
        if (!stale(id, version, stamp))
          errors.value = { ...errors.value, [id]: error instanceof Error ? error.message : 'Could not load more.' };
      } finally {
        moreBusy.value = null;
      }
    }
    const groupTotal = (group: InboxGroup) => data.value[group]?.total_count ?? '–';
    // Review sections count loaded items; a trailing + means more authored pages can still arrive.
    const sectionCount = (section: Section) => {
      const result = data.value[section.group];
      if (!result || !section.review) return groupTotal(section.group);
      const loaded = result.items.filter(item => reviewOf(item) === section.review).length;
      return `${loaded}${result.items.length < result.total_count ? '+' : ''}`;
    };
    const toggleRepo = (repo: string) => {
      selected.value = selected.value.includes(repo) ? selected.value.filter(r => r !== repo) : [...selected.value, repo];
    };
    function addRepo(event: Event) {
      event.preventDefault();
      const value = customRepo.value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(value)) {
        repoError.value = 'Use owner/repository.';
        return;
      }
      customRepos.value = [...new Set([...customRepos.value, value])];
      toggleRepo(value);
      customRepo.value = '';
      repoError.value = '';
    }
    const navItem = (id: string, title: string, Icon: typeof InboxIcon, label: string, total: Section) => (
      <button
        class={`nav-item ${active.value === id ? 'selected' : ''}`}
        title={title}
        onClick={() => {
          active.value = id;
        }}
      >
        <Icon size={17} />
        {label}
        <span class="nav-count">{sectionCount(total)}</span>
      </button>
    );
    const allCollapsed = () => collapsed.value.size === sections.length;
    return () => (
      <div class="inbox-layout">
        <aside class="app-sidebar">
          <div class={`${styles['workspace-label']}`}>
            <span
              class={`grid place-items-center w-7 h-7 bg-accent-soft text-indigo ${styles['font-display']} text-xs rounded-lg border ${styles['border-border-strong']}`}
            >
              {props.info?.user.login.slice(0, 1).toUpperCase() || 'Y'}
            </span>
            <span>
              {props.info?.user.login || 'Your workspace'}
              <small>Personal workspace</small>
            </span>
          </div>
          <div class={`${styles['nav-caption']}`}>WORKSPACE</div>
          {navItem('all', 'Show all pull request inbox sections', InboxIcon, 'Inbox', sectionById('requested'))}
          {navItem(
            'requested',
            'Show ready-for-review PRs requesting your review, excluding drafts',
            CircleDot,
            'Review requests',
            sectionById('requested'),
          )}
          {navItem(
            'returned',
            'Show your pull requests reviewers returned to you',
            MessageSquareReply,
            'Returned to you',
            sectionById('returned'),
          )}
          {navItem('approved', 'Show your open pull requests that reviewers approved', ThumbsUp, 'Approved', sectionById('approved'))}
          {navItem(
            'waiting',
            'Show your open, non-draft pull requests waiting on reviewers',
            Hourglass,
            'Waiting for review',
            sectionById('waiting'),
          )}
          {navItem('drafts', 'Show your work-in-progress draft pull requests', FilePenLine, 'Drafts', sectionById('drafts'))}
          <div class={`${styles['nav-caption']} ${styles['repo-caption']}`}>
            REPOSITORIES<span>{repoOptions.value.length}</span>
          </div>
          {repoOptions.value.map(repo => (
            <button
              key={repo}
              class={`nav-item ${styles['repo-nav']} ${selected.value.includes(repo) ? styles['repo-active'] : ''}`}
              title={`${selected.value.includes(repo) ? 'Remove' : 'Add'} the ${repo} repository filter`}
              onClick={() => toggleRepo(repo)}
            >
              <BookOpen size={15} />
              <span>{repo.split('/').at(-1)}</span>
              {selected.value.includes(repo) && <Check size={13} />}
            </button>
          ))}
          <div class={`${styles['sidebar-bottom']}`}>
            <Layers size={20} />
            <h4>
              Less switching.
              <br />
              More shipping.
            </h4>
            <p>Your branches, context, and reviews. One focused workspace.</p>
            <a href="https://docs.github.com/en/pull-requests" target="_blank" rel="noopener noreferrer">
              GitHub review guide <ArrowUpRight size={13} />
            </a>
          </div>
          <div class="border-t border-t-border py-3 px-2 flex items-center gap-1.5 text-muted text-xs">
            <span class="status-dot" />
            {props.api ? 'Connected to GitHub' : 'Demo workspace'}
            <span class="version ml-auto text-xs">v0.2</span>
          </div>
        </aside>
        <main class="min-w-0 bg-surface">
          <div class="page-breadcrumb">
            <InboxIcon size={15} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>Inbox</strong>
            <div class="breadcrumb-actions">
              <IconButton
                label="Refresh inbox"
                onClick={() => {
                  forceFresh = true;
                  refresh.value++;
                }}
                disabled={loading.value}
              >
                <RefreshCw size={15} class={loading.value ? 'spin' : ''} />
              </IconButton>
              <span class="divider" />
              <button class="button small" title="Open a GitHub pull request by URL" onClick={() => props.onOpenDialog()}>
                <Plus size={14} />
                Open pull request
              </button>
            </div>
          </div>
          <div class="inbox-content">
            <div class="inbox-title">
              <div>
                <div class={`${styles['eyebrow']}`}>YOUR WORK, IN FOCUS</div>
                <h1>
                  {active.value === 'all' ? 'Inbox' : sections.find(section => section.id === active.value)?.label}
                  <span class="text-indigo">.</span>
                </h1>
                <p>A clear view of what needs your attention.</p>
              </div>
              <div class="inbox-summary">
                <span>
                  <strong>{sectionCount(sectionById('requested'))}</strong>to review
                </span>
                <span>
                  <strong>{groupTotal('authored')}</strong>in progress
                </span>
              </div>
            </div>
            {!props.api && (
              <div class="demo-card">
                <div class="demo-card-icon">
                  <GitPullRequest size={23} />
                </div>
                <div>
                  <h3>A better place for your next review.</h3>
                  <p>You’re exploring sample PRs. Connect GitHub to bring in your own.</p>
                </div>
                <button
                  class="button primary"
                  title="Connect your GitHub account to replace sample PRs with your inbox"
                  onClick={() => props.onConnect()}
                >
                  Connect GitHub
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            <div class="inbox-toolbar">
              <SearchField
                class="inbox-search"
                label="Search loaded pull requests"
                placeholder="Search pull requests…"
                value={query.value}
                inputRef={element => (search.value = element as HTMLInputElement)}
                onInput={value => (query.value = value)}
              />
              <div class="toolbar-right">
                <div class="popover-anchor">
                  <button
                    class={`button small ${selected.value.length ? 'filter-active' : ''}`}
                    title="Choose which repositories appear in your inbox"
                    aria-expanded={repoMenu.value}
                    onClick={() => {
                      repoMenu.value = !repoMenu.value;
                    }}
                  >
                    <Filter size={14} />
                    {selected.value.length
                      ? `${selected.value.length} ${selected.value.length === 1 ? 'repository' : 'repositories'}`
                      : 'All repositories'}
                    <ChevronDown size={13} />
                  </button>
                  {repoMenu.value && (
                    <>
                      <Dismiss onClose={() => (repoMenu.value = false)} />
                      <div class={`popover ${styles['repo-popover']}`}>
                        <div class="popover-title">
                          Repositories
                          <button
                            title="Clear all repository filters"
                            onClick={() => {
                              selected.value = [];
                            }}
                          >
                            Reset
                          </button>
                        </div>
                        {repoOptions.value.map(repo => (
                          <label key={repo} class={`${styles['repo-option']}`}>
                            <input type="checkbox" checked={selected.value.includes(repo)} onChange={() => toggleRepo(repo)} />
                            <BookOpen size={14} />
                            {repo}
                          </label>
                        ))}
                        <form class={`${styles['add-repo-form']}`} onSubmit={addRepo}>
                          <input
                            aria-label="Add repository filter"
                            placeholder="owner/repository"
                            value={customRepo.value}
                            onInput={event => {
                              customRepo.value = inputValue(event);
                            }}
                          />
                          <button aria-label="Add repository" title="Add and select this repository filter" type="submit">
                            <Plus size={15} />
                          </button>
                        </form>
                        {repoError.value && <p class="error-message">{repoError.value}</p>}
                        <button
                          class="button small full-width"
                          title="Close the repository filter menu"
                          onClick={() => {
                            repoMenu.value = false;
                          }}
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div class="popover-anchor">
                  <IconButton label="Sort pull requests" active={sortMenu.value} onClick={() => (sortMenu.value = !sortMenu.value)}>
                    <ArrowDownWideNarrow size={15} />
                  </IconButton>
                  {sortMenu.value && (
                    <>
                      <Dismiss onClose={() => (sortMenu.value = false)} />
                      <div class={`popover ${styles['sort-popover']}`} role="menu" aria-label="Sort by">
                        <div class="popover-title">Sort by</div>
                        {sortOptions.map(option => {
                          const checked = sortChoice.value === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={checked}
                              class={styles['sort-option']}
                              onClick={() => {
                                sortChoice.value = option.value;
                                sortMenu.value = false;
                              }}
                            >
                              {option.label}
                              <span class={styles['sort-detail']}>{option.detail}</span>
                              {checked && <Check size={14} />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                <button
                  class="button small"
                  title={allCollapsed() ? 'Expand every inbox section' : 'Collapse every inbox section'}
                  onClick={() => {
                    collapsed.value = allCollapsed() ? new Set() : new Set(sections.map(section => section.id));
                  }}
                >
                  <SlidersHorizontal size={14} />
                  {allCollapsed() ? 'Expand all' : 'Collapse all'}
                </button>
              </div>
            </div>
            {query.value && (
              <div class={`text-muted -mt-1 ${styles['mb-4']} ${styles['mx-0']} text-xs`}>
                Searching loaded PRs by title, number, author, and repository.
              </div>
            )}
            <div class="inbox-groups">
              {visibleSections.value.map(section => {
                const GroupIcon = section.icon,
                  result = data.value[section.group],
                  open = !collapsed.value.has(section.id),
                  shown = items(section);
                return (
                  <section key={section.id} class={`mb-5 ${section.group}`}>
                    <div class={styles['group-row']}>
                      <button
                        class={`${styles['group-heading']}`}
                        title={`${open ? 'Collapse' : 'Expand'} ${section.label} — ${section.description}`}
                        aria-expanded={open}
                        onClick={() => toggleGroup(section.id)}
                      >
                        <ChevronRight size={15} class={open ? 'rotated' : ''} />
                        <span class="group-status">
                          <GroupIcon size={15} />
                        </span>
                        <strong>{section.label}</strong>
                        <span
                          class={`text-xs text-muted bg-surface border border-border rounded-sm min-w-4 ${styles['py-px']} px-1 text-center`}
                        >
                          {query.value ? shown.length : sectionCount(section)}
                        </span>
                        <span class={`${styles['group-hint']}`}>{section.id === 'requested' ? 'YOUR TURN' : ''}</span>
                      </button>
                      {section.group === 'merged' && (
                        <div class={`segmented ${styles['merged-filter']}`} role="radiogroup" aria-label="Merged pull requests">
                          {mergedOptions.map(option => {
                            const noRepos = !selected.value.length;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={effectiveMerged(selected.value, mergedFilter.value) === option.value}
                                disabled={option.value === 'all' && noRepos}
                                title={
                                  option.value === 'all' && noRepos ? 'Select repositories to see every merged pull request' : option.title
                                }
                                onClick={() => {
                                  mergedFilter.value = option.value;
                                  if (!open) toggleGroup(section.id);
                                }}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {open && (
                      <>
                        {!result ? (
                          <div class={`${styles['group-empty']}`}>
                            {loading.value || (section.group === 'merged' && mergedLoading.value) ? (
                              <Spinner text="Loading pull requests…" />
                            ) : (
                              'Unable to load pull requests.'
                            )}
                          </div>
                        ) : (
                          <>
                            {shown.length ? (
                              <AnimatePresence initial={false}>
                                {shown.map(item => (
                                  <motion.button
                                    {...fade()}
                                    key={item.id}
                                    class="pr-row"
                                    title={`Review ${repository(item)}#${item.number}: ${item.title}${item.draft ? ' (draft)' : ''}`}
                                    onClick={() => props.onOpen(item.html_url, item)}
                                  >
                                    <span class={`pr-row-status ${item.draft ? 'draft' : section.group === 'merged' ? 'merged' : ''}`}>
                                      {item.draft ? (
                                        <FilePenLine size={17} />
                                      ) : section.group === 'merged' ? (
                                        <GitMerge size={17} />
                                      ) : (
                                        <GitPullRequest size={17} />
                                      )}
                                    </span>
                                    <div class="flex-1 min-w-0">
                                      <div class="pr-row-title">
                                        {item.title}
                                        {item.labels.slice(0, 1).map(label => (
                                          <span key={label.name} class="pr-label">
                                            {label.name}
                                          </span>
                                        ))}
                                      </div>
                                      <div class="pr-row-meta">
                                        <span>{repository(item).split('/').at(-1)}</span>
                                        <span>#{item.number}</span>
                                        <span class="text-xs">·</span>
                                        <span>{item.user.login === (props.info?.user.login || 'you') ? 'you' : item.user.login}</span>
                                      </div>
                                    </div>
                                    <RowIndicators item={item} />
                                    <span class="row-time">{timeAgo(item.updated_at)}</span>
                                    <Avatar login={item.user.login} small />
                                    <ChevronRight class="row-arrow" size={15} />
                                  </motion.button>
                                ))}
                              </AnimatePresence>
                            ) : (
                              <div class={`${styles['group-empty']}`}>
                                <Check size={16} />
                                {query.value ? 'No loaded PRs match your search.' : 'Nothing here. You’re all caught up.'}
                              </div>
                            )}
                            {result.items.length < Math.min(result.total_count, 1000) && (
                              <button
                                class="py-3 px-5 text-xs text-accent"
                                title={`Load the next page of ${section.label.toLowerCase()}`}
                                disabled={!!moreBusy.value}
                                onClick={() => void loadMore(section.group)}
                              >
                                {moreBusy.value === section.group ? (
                                  <Spinner text="Loading…" />
                                ) : (
                                  `Load more · ${result.items.length} of ${result.total_count}`
                                )}
                              </button>
                            )}
                            {(result.incomplete_results || result.total_count > 1000) && (
                              <p class="group-warning">GitHub search may be incomplete and caps results at 1,000. Narrow by repository.</p>
                            )}
                          </>
                        )}
                        {errors.value[section.group] && (
                          <div class="group-error" role="alert">
                            {errors.value[section.group]}
                            <button
                              class="text-button"
                              title="Refresh the inbox to retry loading pull requests"
                              onClick={() => {
                                forceFresh = true;
                                refresh.value++;
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
            <div class="inbox-footnote">
              <span class="status-dot" />
              {props.api ? 'Live GitHub data · Refresh to sync updates' : 'Sample data · No GitHub actions are sent'}
              <span>Built for a little more focus.</span>
            </div>
          </div>
        </main>
      </div>
    );
  },
  { props: ['api', 'info', 'onOpen', 'onOpenDialog', 'onConnect'] },
);

type Mark = { icon: typeof GitMerge; tone: 'green' | 'red' | 'amber' | 'muted'; label: string };
const checkMarks: Record<'success' | 'failure' | 'pending', Mark> = {
  success: { icon: checkIcons.success, tone: 'green', label: 'Checks passed' },
  failure: { icon: checkIcons.failure, tone: 'red', label: 'Checks failed' },
  pending: { icon: checkIcons.pending, tone: 'amber', label: 'Checks running' },
};
// Every cell keeps its width, even when empty, so the columns line up across rows.
function MarkCell(props: { name: string; mark?: Mark }) {
  const Icon = props.mark?.icon;
  return (
    <span class={`${styles.cell} ${styles[`cell-${props.name}`]}`}>
      {Icon && props.mark && (
        <span class={styles[`tone-${props.mark.tone}`]} role="img" aria-label={props.mark.label} title={props.mark.label}>
          <Icon size={14} />
        </span>
      )}
    </span>
  );
}
function RowIndicators(props: { item: InboxItem }) {
  const details = props.item.details;
  const participants = details?.participants ?? [];
  return (
    <>
      <span class={`${styles.cell} ${styles['cell-bubbles']}`} title={participants.map(user => user.login).join(', ')}>
        {participants.slice(0, 4).map(user => (
          <Avatar key={user.login} login={user.login} small src={user.avatarUrl} />
        ))}
        {!!details && details.participantCount > 4 && <span class={styles.more}>+{details.participantCount - 4}</span>}
      </span>
      <MarkCell name="checks" mark={details?.checks ? checkMarks[details.checks] : undefined} />
      <span class={`${styles.cell} ${styles['cell-changes']}`}>
        {!!details && (
          <span class={styles.changes} aria-label={`${details.additions} lines added, ${details.deletions} removed`}>
            <span class={styles['tone-green']}>+{details.additions}</span>
            <span class={styles['tone-red']}>−{details.deletions}</span>
          </span>
        )}
      </span>
    </>
  );
}

function repository(item: InboxItem) {
  return item.repository_url.replace('https://api.github.com/repos/', '');
}
