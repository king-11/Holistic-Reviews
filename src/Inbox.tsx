import { computed, defineComponent, onUnmounted, shallowRef, watch } from 'vue';
import { createShortcuts, modalOpen, step } from './shortcuts';
import { AnimatePresence, motion } from 'motion-v';
import { fade } from './motion';
import {
  ArrowDown,
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
  Inbox as InboxIcon,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from '@lucide/vue';
import { type GitHub, type InboxGroup, type InboxItem, type InboxResult, type TokenInfo } from './github';
import { demoInbox } from './demo';
import { Avatar, IconButton, SearchField, Spinner, inputValue, timeAgo, Dismiss } from './ui';
import styles from './Inbox.module.css';

const groups: { id: InboxGroup; label: string; description: string }[] = [
  { id: 'requested', label: 'Needs your review', description: 'Ready-for-review pull requests where you are a requested reviewer' },
  { id: 'authored', label: 'Your pull requests', description: 'Your open, ready-for-review pull requests' },
  { id: 'drafts', label: 'Drafts', description: 'Work in progress, authored by you' },
  { id: 'reviewed', label: 'Reviewed by you', description: 'Open pull requests you have reviewed, including drafts' },
  { id: 'merged', label: 'Recently merged', description: 'Your merged pull requests, most recently updated first' },
];
const groupIcons = { requested: CircleDot, authored: GitPullRequest, drafts: FilePenLine, reviewed: CircleCheck, merged: GitMerge };

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
    const active = shallowRef<InboxGroup | 'all'>('all');
    const collapsed = shallowRef<Set<InboxGroup>>(new Set(['reviewed', 'merged']));
    const repoMenu = shallowRef(false);
    const selected = shallowRef<string[]>([]);
    const repoOptions = shallowRef<string[]>([]);
    const customRepo = shallowRef('');
    const repoError = shallowRef('');
    const refresh = shallowRef(0);
    const moreBusy = shallowRef<InboxGroup | null>(null);
    let request = 0;
    let controller: AbortController | undefined;
    watch(
      [() => props.api, () => props.info, selected, refresh],
      ([api, info, repos]) => {
        controller?.abort();
        const version = ++request;
        if (!api || !info) {
          data.value = Object.fromEntries(
            groups.map(group => {
              const items = demoInbox[group.id].filter(item => !repos.length || repos.includes(repository(item)));
              return [group.id, { items, total_count: items.length, incomplete_results: false }];
            }),
          );
          repoOptions.value = ['askscio/scio', 'askscio/devdock'];
          errors.value = {};
          loading.value = false;
          return;
        }
        const signal = (controller = new AbortController()).signal;
        loading.value = true;
        errors.value = {};
        data.value = {};
        void Promise.all(
          groups.map(async group => {
            try {
              const result = await api.inbox(group.id, info.user.login, repos, 1, signal);
              if (version !== request) return;
              data.value = { ...data.value, [group.id]: result };
              repoOptions.value = [...new Set([...repoOptions.value, ...result.items.map(repository)])].sort();
            } catch (error) {
              if (version === request && !signal.aborted)
                errors.value = { ...errors.value, [group.id]: error instanceof Error ? error.message : 'Could not load this section.' };
            }
          }),
        ).finally(() => {
          if (version === request) loading.value = false;
        });
      },
      { immediate: true },
    );
    onUnmounted(() => {
      request++;
      controller?.abort();
    });
    const items = (id: InboxGroup) =>
      (data.value[id]?.items || []).filter(item => {
        const q = query.value.toLowerCase();
        return `${item.title} ${item.number} ${item.user.login} ${repository(item)}`.toLowerCase().includes(q);
      });
    const visibleGroups = computed(() => groups.filter(group => active.value === 'all' || group.id === active.value));
    function toggleGroup(id: InboxGroup) {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    }
    async function loadMore(id: InboxGroup) {
      const api = props.api,
        info = props.info,
        current = data.value[id],
        version = request;
      if (!api || !info || !current || moreBusy.value) return;
      moreBusy.value = id;
      try {
        const next = await api.inbox(id, info.user.login, selected.value, Math.floor(current.items.length / 30) + 1, controller?.signal);
        if (version === request) data.value = { ...data.value, [id]: { ...next, items: [...current.items, ...next.items] } };
      } catch (error) {
        if (version === request) errors.value = { ...errors.value, [id]: error instanceof Error ? error.message : 'Could not load more.' };
      } finally {
        moreBusy.value = null;
      }
    }
    const count = (id: InboxGroup) => data.value[id]?.total_count ?? '–';
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
      repoOptions.value = [...new Set([...repoOptions.value, value])].sort();
      toggleRepo(value);
      customRepo.value = '';
      repoError.value = '';
    }
    const navItem = (id: InboxGroup | 'all', title: string, Icon: typeof InboxIcon, label: string, total: InboxGroup) => (
      <button
        class={`nav-item ${active.value === id ? 'selected' : ''}`}
        title={title}
        onClick={() => {
          active.value = id;
        }}
      >
        <Icon size={17} />
        {label}
        <span class="nav-count">{count(total)}</span>
      </button>
    );
    const allCollapsed = () => collapsed.value.size === groups.length;
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
          {navItem('all', 'Show all pull request inbox sections', InboxIcon, 'Inbox', 'requested')}
          {navItem(
            'requested',
            'Show ready-for-review PRs requesting your review, excluding drafts',
            CircleDot,
            'Review requests',
            'requested',
          )}
          {navItem('authored', 'Show your open, non-draft pull requests', GitPullRequest, 'Your pull requests', 'authored')}
          {navItem('drafts', 'Show your work-in-progress draft pull requests', FilePenLine, 'Drafts', 'drafts')}
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
                  {active.value === 'all' ? 'Inbox' : groups.find(group => group.id === active.value)?.label}
                  <span class="text-indigo">.</span>
                </h1>
                <p>A clear view of what needs your attention.</p>
              </div>
              <div class="inbox-summary">
                <span>
                  <strong>{count('requested')}</strong>to review
                </span>
                <span>
                  <strong>{count('authored')}</strong>in progress
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
                <button
                  class="button small"
                  title={allCollapsed() ? 'Expand every inbox section' : 'Collapse every inbox section'}
                  onClick={() => {
                    collapsed.value = allCollapsed() ? new Set() : new Set(groups.map(g => g.id));
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
              {visibleGroups.value.map(group => {
                const GroupIcon = groupIcons[group.id],
                  result = data.value[group.id],
                  open = !collapsed.value.has(group.id),
                  shown = items(group.id);
                return (
                  <section key={group.id} class={`mb-5 ${group.id}`}>
                    <button
                      class={`${styles['group-heading']}`}
                      title={`${open ? 'Collapse' : 'Expand'} ${group.label} — ${group.description}`}
                      aria-expanded={open}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <ChevronRight size={15} class={open ? 'rotated' : ''} />
                      <span class="group-status">
                        <GroupIcon size={15} />
                      </span>
                      <strong>{group.label}</strong>
                      <span
                        class={`text-xs text-muted bg-surface border border-border rounded-sm min-w-4 ${styles['py-px']} px-1 text-center`}
                      >
                        {query.value ? shown.length : count(group.id)}
                      </span>
                      <span class={`${styles['group-hint']}`}>{group.id === 'requested' ? 'YOUR TURN' : ''}</span>
                      <ArrowDown size={13} class={`${styles['group-sort']}`} />
                    </button>
                    {open && (
                      <>
                        {!result ? (
                          <div class={`${styles['group-empty']}`}>
                            {loading.value ? <Spinner text="Loading pull requests…" /> : 'Unable to load pull requests.'}
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
                                    <span class={`pr-row-status ${item.draft ? 'draft' : group.id === 'merged' ? 'merged' : ''}`}>
                                      {item.draft ? (
                                        <FilePenLine size={17} />
                                      ) : group.id === 'merged' ? (
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
                                    {item.comments > 0 && (
                                      <span class="row-comments">
                                        <MessageSquare size={13} />
                                        {item.comments}
                                      </span>
                                    )}
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
                                title={`Load the next page of ${group.label.toLowerCase()}`}
                                disabled={!!moreBusy.value}
                                onClick={() => void loadMore(group.id)}
                              >
                                {moreBusy.value === group.id ? (
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
                        {errors.value[group.id] && (
                          <div class="group-error" role="alert">
                            {errors.value[group.id]}
                            <button
                              class="text-button"
                              title="Refresh the inbox to retry loading pull requests"
                              onClick={() => {
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

function repository(item: InboxItem) {
  return item.repository_url.replace('https://api.github.com/repos/', '');
}
