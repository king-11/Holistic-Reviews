import { computed, defineComponent, onActivated, onDeactivated, onUnmounted, shallowRef, watch } from 'vue';
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  Filter,
  GitMerge,
  GitPullRequest,
  Hourglass,
  Inbox as InboxIcon,
  Layers,
  PanelLeft,
  Plus,
  RefreshCw,
  Rocket,
  SlidersHorizontal,
  User,
  Users,
} from '@lucide/vue';
import {
  authoredSection,
  errorMessage,
  itemRepository,
  searchPageSize,
  searchResultCap,
  type GitHub,
  type AuthoredSection,
  type InboxGroup,
  type InboxItem,
  type InboxResult,
  type MergedFilter,
  type SearchOrder,
  type TokenInfo,
} from './github';
import {
  clientOrders,
  defaultSort,
  needsServerRefetch,
  rankCounts,
  readPreferences,
  savePreferences,
  serverOrder,
  sortOptions,
  type InboxSectionId,
  type SortChoice,
} from './inboxPreferences';
import InboxRow from './InboxRow';
import { priority, type PriorityResult } from './priority';
import { inboxChangedAt, inboxSnapshots, withSnapshots } from './inboxUpdates';
import { createShortcuts, modalOpen, step } from './shortcuts';
import { Dismiss, IconButton, SearchField, Spinner, inputValue } from './ui';
import styles from './Inbox.module.css';

// Each section is a view of one fetched group; your open PRs split by what has to happen next.
type Section = {
  id: InboxSectionId;
  group: InboxGroup;
  authored?: AuthoredSection;
  label: string;
  description: string;
  icon: typeof GitPullRequest;
};
const sections: Section[] = [
  {
    id: 'attention',
    group: 'authored',
    authored: 'attention',
    label: 'Needs your attention',
    description: 'Your pull requests with requested changes, failing checks or a merge conflict',
    icon: CircleAlert,
  },
  {
    id: 'requested',
    group: 'requested',
    label: 'Requested from you',
    description: 'Ready-for-review pull requests requesting your review by name',
    icon: User,
  },
  {
    id: 'team',
    group: 'team',
    label: 'Requested from your team',
    description: 'Ready-for-review pull requests requesting a review only from a team you are in',
    icon: Users,
  },
  {
    id: 'ready',
    group: 'authored',
    authored: 'ready',
    label: 'Ready to merge',
    description: 'Your approved pull requests with no failing checks or conflicts',
    icon: Rocket,
  },
  {
    id: 'waiting',
    group: 'authored',
    authored: 'waiting',
    label: 'Awaiting review',
    description: 'Your open pull requests waiting on reviewers',
    icon: Hourglass,
  },
  { id: 'drafts', group: 'drafts', label: 'Drafts', description: 'Work in progress, authored by you', icon: FilePenLine },
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
const priorityLanes: { id: PriorityResult['lane']; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'soon', label: 'Soon' },
  { id: 'later', label: 'Later' },
];
const visibleRowStep = 10;
// A team request lists every requested team; the viewer's own team names the group when known.
const teamOf = (item: InboxItem, teams: string[] = []) =>
  item.details?.teams?.find(team => teams.includes(team)) ?? item.details?.teams?.[0] ?? 'Team';

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

type Props = {
  api: GitHub;
  info: TokenInfo;
  onOpenCommandBar: () => void;
};

export default defineComponent(
  (props: Props) => {
    const preferences = readPreferences();
    const rail = shallowRef(preferences.rail ?? false);

    const query = shallowRef('');
    const search = shallowRef<HTMLInputElement>();
    const move = (delta: 1 | -1) =>
      step([...document.querySelectorAll<HTMLElement>('.pr-row')], document.activeElement as HTMLElement, delta)?.focus();
    const keydown = createShortcuts(() => ({ '/': () => search.value?.focus(), j: () => move(1), k: () => move(-1) }), modalOpen);
    // The inbox stays alive behind a PR page, so its keys must stop while it is hidden; re-adding the same listener is a no-op.
    const listen = () => document.addEventListener('keydown', keydown);
    const unlisten = () => document.removeEventListener('keydown', keydown);
    listen();
    onActivated(listen);
    onDeactivated(unlisten);
    onUnmounted(unlisten);

    const selected = shallowRef<string[]>(preferences.repos ?? []);
    // Until a first unfiltered load picks the most-used repository, the choice is not saved, so it can still default.
    let repoDefaulted = preferences.repos !== undefined;
    const repoCounts = shallowRef(rankCounts(preferences.known ?? []));
    const customRepos = shallowRef<string[]>([]);
    const repoOptions = computed(() => {
      const counts = repoCounts.value;
      return [...new Set([...counts.keys(), ...customRepos.value, ...selected.value])].sort(
        (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
      );
    });
    const repoMenu = shallowRef(false);
    const customRepo = shallowRef('');
    const repoError = shallowRef('');
    // Unfiltered loads define how many PRs each repository has; filtered loads only add repositories not yet seen.
    const countRepos = (items: InboxItem[], unfiltered: boolean) => {
      const counts = new Map(repoCounts.value);
      for (const item of items) counts.set(itemRepository(item), (counts.get(itemRepository(item)) ?? 0) + (unfiltered ? 1 : 0));
      repoCounts.value = counts;
    };
    function applyDefaultRepo() {
      if (repoDefaulted) return;
      repoDefaulted = true;
      const [first] = repoOptions.value;
      if (first) selected.value = [first];
    }
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

    const sorts = shallowRef(preferences.sorts ?? {});
    const sortMenu = shallowRef<InboxSectionId | null>(null);
    const sortChoice = (section: InboxSectionId) => sorts.value[section] ?? defaultSort(section);
    const visibleLimits = shallowRef<Record<string, number>>({});
    const visibleLimit = (id: string) => visibleLimits.value[id] ?? visibleRowStep;
    const mergedFilter = shallowRef<MergedFilter>(preferences.merged ?? 'all');
    const mergedLoading = shallowRef(false);
    watch(selected, () => (visibleLimits.value = {}));
    watch([selected, sorts, repoOptions, mergedFilter, rail], ([repos, savedSorts, known, merged, collapsedRail]) =>
      savePreferences({ repos: repoDefaulted ? repos : undefined, sorts: savedSorts, known, merged, rail: collapsedRail || undefined }),
    );

    // Each merged load (full reload or filter change) bumps this so only the newest one may write its result.
    let mergedVersion = 0;
    const groupVersions: Record<InboxGroup, number> = { requested: 0, team: 0, authored: 0, drafts: 0, merged: 0 };
    const groupOrders: Partial<Record<InboxGroup, SearchOrder>> = {};
    const initialGroupOrder = (group: InboxGroup) => {
      const choices = sections.filter(section => section.group === group).map(section => sortChoice(section.id));
      const firstChoice = choices[0] ?? 'updated-desc';
      const choice = choices.every(candidate => candidate === firstChoice) ? firstChoice : 'updated-desc';
      return serverOrder(choice);
    };

    const data = shallowRef<Partial<Record<InboxGroup, InboxResult>>>({});
    const errors = shallowRef<Partial<Record<InboxGroup, string>>>({});
    const loading = shallowRef(false);
    const refresh = shallowRef(0);
    const moreBusy = shallowRef<InboxGroup | null>(null);
    let request = 0;
    let forceFresh = false;
    // A quiet reload keeps the current rows on screen and swaps each section in as its fresh results arrive.
    let quiet = false;
    let fetchedAt = 0;
    let controller: AbortController | undefined;
    const reload = (background = false) => {
      forceFresh = true;
      quiet = background;
      refresh.value++;
    };
    // Returning from a PR you changed refetches, since the inbox stayed alive with results from before the change.
    onActivated(() => {
      if (inboxChangedAt.value > fetchedAt) reload(true);
    });
    const stale = (group: InboxGroup, version: number, stamp: number, groupVersion: number) =>
      version !== request || groupVersion !== groupVersions[group] || (group === 'merged' && stamp !== mergedVersion);
    watch(
      [() => props.api, () => props.info.user.login, () => selected.value, () => refresh.value],
      ([api, login, repos]) => {
        controller?.abort();
        const version = ++request;
        if (!repos.length) repoCounts.value = new Map();
        const signal = (controller = new AbortController()).signal;
        const client = forceFresh ? api.fresh() : api;
        const background = quiet;
        forceFresh = quiet = false;
        fetchedAt = Date.now();
        const mergedStamp = ++mergedVersion;
        mergedLoading.value = false;
        if (!background) {
          visibleLimits.value = {};
          loading.value = true;
          errors.value = {};
          data.value = {};
        }
        void Promise.all(
          fetchedGroups.map(async group => {
            const groupVersion = ++groupVersions[group];
            const order = initialGroupOrder(group);
            groupOrders[group] = order;
            try {
              const result = await client.inbox(group, { login, repos, merged: mergedFilter.value, order }, signal);
              if (stale(group, version, mergedStamp, groupVersion)) return;
              data.value = { ...data.value, [group]: result };
              errors.value = { ...errors.value, [group]: undefined };
              countRepos(result.items, !repos.length);
            } catch (error) {
              // A failed background refetch keeps the rows already shown rather than replacing them with an error.
              if (!stale(group, version, mergedStamp, groupVersion) && !signal.aborted && !(background && data.value[group]))
                errors.value = { ...errors.value, [group]: errorMessage(error, 'Could not load this section.') };
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
    function reloadGroup(group: InboxGroup, order: SearchOrder) {
      const version = request;
      const mergedStamp = mergedVersion;
      const groupVersion = ++groupVersions[group];
      groupOrders[group] = order;
      errors.value = { ...errors.value, [group]: undefined };
      if (group === 'merged') mergedLoading.value = true;
      props.api.inbox(group, { login: props.info.user.login, repos: selected.value, merged: mergedFilter.value, order }).then(
        result => {
          if (stale(group, version, mergedStamp, groupVersion)) return;
          data.value = { ...data.value, [group]: result };
          if (group === 'merged') mergedLoading.value = false;
        },
        error => {
          if (stale(group, version, mergedStamp, groupVersion)) return;
          errors.value = { ...errors.value, [group]: errorMessage(error, 'Could not load this section.') };
          if (group === 'merged') mergedLoading.value = false;
        },
      );
    }
    function setSortChoice(section: Section, choice: SortChoice) {
      sortMenu.value = null;
      if (sortChoice(section.id) === choice) return;
      sorts.value = { ...sorts.value, [section.id]: choice };
      visibleLimits.value = { ...visibleLimits.value, [section.id]: visibleRowStep };
      const result = data.value[section.group];
      if (result && needsServerRefetch(choice, result.items.length, result.total_count)) {
        const order = serverOrder(choice);
        const currentOrder = groupOrders[section.group];
        if (!currentOrder || currentOrder.sort !== order.sort || currentOrder.order !== order.order) reloadGroup(section.group, order);
      }
    }
    // Only the merged group reloads on a filter change; the other sections keep their results.
    function reloadMerged() {
      visibleLimits.value = { ...visibleLimits.value, merged: visibleRowStep };
      const version = ++mergedVersion;
      const groupVersion = ++groupVersions.merged;
      const order = serverOrder(sortChoice('merged'));
      groupOrders.merged = order;
      errors.value = { ...errors.value, merged: undefined };
      mergedLoading.value = true;
      data.value = { ...data.value, merged: undefined };
      props.api.inbox('merged', { login: props.info.user.login, repos: selected.value, merged: mergedFilter.value, order }).then(
        result => {
          if (version !== mergedVersion || groupVersion !== groupVersions.merged) return;
          data.value = { ...data.value, merged: result };
          mergedLoading.value = false;
        },
        error => {
          if (version !== mergedVersion || groupVersion !== groupVersions.merged) return;
          errors.value = { ...errors.value, merged: errorMessage(error, 'Could not load this section.') };
          mergedLoading.value = false;
        },
      );
    }
    watch(mergedFilter, reloadMerged);
    onUnmounted(() => {
      request++;
      controller?.abort();
    });
    async function loadMore(id: InboxGroup) {
      const current = data.value[id],
        version = request,
        stamp = mergedVersion,
        groupVersion = groupVersions[id];
      if (!current || moreBusy.value) return false;
      moreBusy.value = id;
      let loaded = false;
      try {
        const next = await props.api.inbox(
          id,
          {
            login: props.info.user.login,
            repos: selected.value,
            page: Math.floor(current.items.length / searchPageSize) + 1,
            merged: mergedFilter.value,
            order: groupOrders[id] ?? initialGroupOrder(id),
          },
          controller?.signal,
        );
        if (!stale(id, version, stamp, groupVersion)) {
          data.value = { ...data.value, [id]: { ...next, items: [...current.items, ...next.items] } };
          countRepos(next.items, !selected.value.length);
          loaded = true;
        }
      } catch (error) {
        if (!stale(id, version, stamp, groupVersion)) errors.value = { ...errors.value, [id]: errorMessage(error, 'Could not load more.') };
      } finally {
        moreBusy.value = null;
      }
      return loaded;
    }
    async function revealMore(section: Section) {
      const nextLimit = visibleLimit(section.id) + visibleRowStep;
      const result = data.value[section.group];
      if (!result) return;
      if (
        nextLimit > items(section).length &&
        result.items.length < Math.min(result.total_count, searchResultCap) &&
        !(await loadMore(section.group))
      )
        return;
      visibleLimits.value = { ...visibleLimits.value, [section.id]: nextLimit };
    }

    const active = shallowRef('all');
    const visibleSections = computed(() => sections.filter(section => active.value === 'all' || section.id === active.value));
    // Search lags writes, so each group's rows are corrected with what PR pages saw since it loaded.
    const corrected = computed(() => {
      const loaded = Object.values(data.value).flatMap(result => result?.items ?? []);
      const known = new Map(loaded.map(item => [item.html_url, item]));
      const view = { login: props.info.user.login, repos: selected.value, merged: mergedFilter.value, now: Date.now() };
      return Object.fromEntries(
        fetchedGroups.flatMap(group => {
          const result = data.value[group];
          return result ? [[group, withSnapshots(group, result.items, inboxSnapshots(), view, known)]] : [];
        }),
      ) as Partial<Record<InboxGroup, ReturnType<typeof withSnapshots>>>;
    });
    const sectionItems = (section: Section) =>
      (corrected.value[section.group]?.items ?? []).filter(item => !section.authored || authoredSection(item) === section.authored);
    const items = (section: Section): { item: InboxItem; priority?: PriorityResult }[] => {
      const q = query.value.toLowerCase();
      const choice = sortChoice(section.id);
      const filtered = sectionItems(section).filter(item =>
        `${item.title} ${item.number} ${item.user.login} ${itemRepository(item)}`.toLowerCase().includes(q),
      );
      if (section.id === 'requested' && choice === 'priority') {
        const now = new Date();
        return filtered
          .map(item => ({
            item,
            priority: priority(
              item.details?.priority ?? {
                waitStart: item.details?.createdAt ?? item.created_at,
                newCommits: 0,
                moreThanTwentyNewCommits: false,
                reviewedWithoutNewCommits: false,
                stackedReady: 0,
                codeOwner: false,
                checks: item.details?.checks ?? null,
              },
              now,
            ),
          }))
          .sort((a, b) => b.priority.score - a.priority.score || clientOrders['size-asc'](a.item, b.item));
      }
      return filtered.sort(clientOrders[choice]).map(item => ({ item }));
    };
    const groupTotal = (group: InboxGroup) => {
      const result = data.value[group];
      return result ? result.total_count + (corrected.value[group]?.delta ?? 0) : '–';
    };
    // Review sections count loaded items; a trailing + means more authored pages can still arrive.
    const sectionCount = (section: Section) => {
      const result = data.value[section.group];
      if (!result || !section.authored) return groupTotal(section.group);
      return `${sectionItems(section).length}${result.items.length < result.total_count ? '+' : ''}`;
    };

    const collapsed = shallowRef<Set<string>>(new Set(['merged']));
    const allCollapsed = () => collapsed.value.size === sections.length;
    function toggleGroup(id: string) {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    }

    const navItem = (id: string, title: string, Icon: typeof InboxIcon, label: string, total: Section) => (
      <button
        class={`nav-item ${active.value === id ? 'selected' : ''}`}
        title={rail.value ? label : title}
        aria-label={label}
        onClick={() => {
          active.value = id;
        }}
      >
        <Icon size={17} />
        <span class={styles['nav-label']}>{label}</span>
        <span class="nav-count">{sectionCount(total)}</span>
      </button>
    );
    const sectionNav = (ids: InboxSectionId[]) =>
      ids.map(id => {
        const section = sectionById(id);
        return navItem(
          id,
          `Show ${section.description.charAt(0).toLowerCase()}${section.description.slice(1)}`,
          section.icon,
          section.label,
          section,
        );
      });
    return () => (
      <div class={`inbox-layout ${rail.value ? styles['rail-layout'] : ''}`}>
        <aside class={`app-sidebar ${rail.value ? styles.rail : ''}`}>
          <div class={`${styles['workspace-label']}`}>
            <span class={`grid place-items-center w-7 h-7 bg-accent-soft text-indigo ${styles['font-display']} text-xs rounded-lg border`}>
              {props.info.user.login.slice(0, 1).toUpperCase()}
            </span>
            <span>
              {props.info.user.login}
              <small>Personal workspace</small>
            </span>
          </div>
          <div class={`${styles['nav-caption']}`}>WORKSPACE</div>
          {navItem('all', 'Show all pull request inbox sections', InboxIcon, 'Inbox', sectionById('requested'))}
          <div class={`${styles['nav-caption']} ${styles['nav-group']}`}>YOUR PRS</div>
          {sectionNav(['attention', 'ready', 'waiting', 'drafts'])}
          <div class={`${styles['nav-caption']} ${styles['nav-group']}`}>REVIEWS</div>
          {sectionNav(['requested', 'team'])}
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
          <button
            class={`nav-item ${styles['rail-toggle']}`}
            title={rail.value ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
            aria-label="Collapse sidebar"
            aria-pressed={rail.value}
            onClick={() => (rail.value = !rail.value)}
          >
            <PanelLeft size={17} />
            <span class={styles['nav-label']}>Collapse</span>
          </button>
          <div class={`border-t border-t-border py-3 px-2 flex items-center gap-1.5 text-muted text-xs ${styles['sidebar-status']}`}>
            <span class="status-dot" />
            Connected to GitHub
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
              <IconButton label="Refresh inbox" onClick={() => reload()} disabled={loading.value}>
                <RefreshCw size={15} class={loading.value ? 'spin' : ''} />
              </IconButton>
              <span class="divider" />
              <button class="button small" title="Open the command bar" onClick={props.onOpenCommandBar}>
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
                  {active.value === 'all' ? 'Inbox' : sectionById(active.value).label}
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
                  allRows = items(section),
                  limit = visibleLimit(section.id),
                  shown = allRows.slice(0, limit),
                  prioritized = section.id === 'requested' && sortChoice(section.id) === 'priority';
                return (
                  <section key={section.id} data-section={section.id} class={`mb-5 ${section.group}`}>
                    <div class={styles['group-row']}>
                      <button
                        class={`${styles['group-heading']}`}
                        title={`${open ? 'Collapse' : 'Expand'} ${section.label} — ${section.description}`}
                        aria-expanded={open}
                        onClick={() => toggleGroup(section.id)}
                      >
                        <ChevronRight size={15} class={`chevron ${open ? 'rotated' : ''}`} />
                        <span class="group-status">
                          <GroupIcon size={15} />
                        </span>
                        <strong>{section.label}</strong>
                        <span
                          class={`text-xs text-muted bg-surface border border-border rounded-sm min-w-4 ${styles['py-px']} px-1 text-center`}
                        >
                          {query.value ? shown.length : sectionCount(section)}
                        </span>
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
                      <div class="popover-anchor">
                        <IconButton
                          label={`Sort ${section.label}`}
                          active={sortMenu.value === section.id}
                          onClick={() => (sortMenu.value = sortMenu.value === section.id ? null : section.id)}
                        >
                          <ArrowDownWideNarrow size={15} />
                        </IconButton>
                        {sortMenu.value === section.id && (
                          <>
                            <Dismiss onClose={() => (sortMenu.value = null)} />
                            <div class={`popover ${styles['sort-popover']}`} role="menu" aria-label={`Sort ${section.label} by`}>
                              <div class="popover-title">Sort by</div>
                              {sortOptions
                                .filter(option => section.id === 'requested' || !('value' in option) || option.value !== 'priority')
                                .map(option => {
                                  if ('value' in option) {
                                    const checked = sortChoice(section.id) === option.value;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={checked}
                                        class={styles['sort-option']}
                                        onClick={() => setSortChoice(section, option.value)}
                                      >
                                        <span class={styles['sort-label']} data-sort-label={option.label}>
                                          {option.label}
                                        </span>
                                        {checked && <Check size={14} />}
                                      </button>
                                    );
                                  }
                                  return (
                                    <div key={option.label} class={styles['sort-field']} role="group" aria-label={`Sort ${option.label}`}>
                                      <span class={styles['sort-label']} data-sort-label={option.label}>
                                        {option.label}
                                      </span>
                                      <div class={styles['sort-directions']}>
                                        {option.directions.map(direction => {
                                          const checked = sortChoice(section.id) === direction.value;
                                          const Icon = direction.direction === 'up' ? ArrowUp : ArrowDown;
                                          return (
                                            <button
                                              key={direction.value}
                                              type="button"
                                              role="menuitemradio"
                                              aria-checked={checked}
                                              aria-label={direction.ariaLabel}
                                              title={direction.title}
                                              class={styles['sort-direction']}
                                              onClick={() => setSortChoice(section, direction.value)}
                                            >
                                              <Icon size={14} />
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </>
                        )}
                      </div>
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
                            {prioritized ? (
                              priorityLanes.map(lane => {
                                const laneRows = shown.filter(row => row.priority?.lane === lane.id);
                                return (
                                  <div key={lane.id} class={styles['priority-lane']} data-priority-lane={lane.id}>
                                    <div class={styles['priority-lane-heading']}>
                                      <strong>{lane.label}</strong>
                                      <span>{laneRows.length}</span>
                                    </div>
                                    {laneRows.map(row => (
                                      <InboxRow
                                        key={row.item.id}
                                        item={row.item}
                                        group={section.group}
                                        viewerLogin={props.info.user.login}
                                        priority={row.priority}
                                      />
                                    ))}
                                    {lane.id === 'now' && !laneRows.length && (
                                      <div class={styles['priority-empty']}>Nothing is waiting on you.</div>
                                    )}
                                  </div>
                                );
                              })
                            ) : section.id === 'team' && shown.length ? (
                              [...new Set(shown.map(row => teamOf(row.item, props.info.teams)))].map(team => {
                                const teamRows = shown.filter(row => teamOf(row.item, props.info.teams) === team);
                                return (
                                  <div key={team} class={styles['priority-lane']} data-team={team}>
                                    <div class={styles['priority-lane-heading']}>
                                      <Users size={13} />
                                      <strong>@{team}</strong>
                                      <span>{teamRows.length}</span>
                                    </div>
                                    {teamRows.map(row => (
                                      <InboxRow
                                        key={row.item.id}
                                        item={row.item}
                                        group={section.group}
                                        viewerLogin={props.info.user.login}
                                      />
                                    ))}
                                  </div>
                                );
                              })
                            ) : shown.length ? (
                              shown.map(row => (
                                <InboxRow key={row.item.id} item={row.item} group={section.group} viewerLogin={props.info.user.login} />
                              ))
                            ) : (
                              <div class={`${styles['group-empty']}`}>
                                <Check size={16} />
                                {query.value ? 'No loaded PRs match your search.' : 'Nothing here. You’re all caught up.'}
                              </div>
                            )}
                            {allRows.length > limit || result.items.length < Math.min(result.total_count, searchResultCap) ? (
                              <button
                                class="py-3 px-5 text-xs text-accent"
                                title={`Load the next page of ${section.label.toLowerCase()}`}
                                disabled={!!moreBusy.value}
                                onClick={() => void revealMore(section)}
                              >
                                {moreBusy.value === section.group ? (
                                  <Spinner text="Loading…" />
                                ) : (
                                  `Load more · ${shown.length} of ${query.value ? allRows.length : result.total_count}`
                                )}
                              </button>
                            ) : null}
                            {(result.incomplete_results || result.total_count > searchResultCap) && (
                              <p class="group-warning">GitHub search may be incomplete and caps results at 1,000. Narrow by repository.</p>
                            )}
                          </>
                        )}
                        {errors.value[section.group] && (
                          <div class="group-error" role="alert">
                            {errors.value[section.group]}
                            <button class="text-button" title="Refresh the inbox to retry loading pull requests" onClick={() => reload()}>
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
              Live GitHub data · Refresh to sync updates
              <span>Built for a little more focus.</span>
            </div>
          </div>
        </main>
      </div>
    );
  },
  { props: ['api', 'info', 'onOpenCommandBar'] },
);
