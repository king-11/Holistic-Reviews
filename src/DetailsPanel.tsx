import { computed, defineComponent, shallowRef } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import {
  ArrowUpRight,
  Code,
  Link,
  Check,
  ChevronDown,
  CircleAlert,
  TriangleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  ChevronRight,
  CircleSlash,
  Ellipsis,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldHalf,
  Users,
  X,
} from '@lucide/vue';
import {
  errorMessage,
  pullRequestReviewers,
  reviewDecision,
  teamKey,
  mergeabilityPending,
  mergeReady,
  type GitHub,
  type Label,
  type LinkedIssue,
  type MergeMethod,
  type PRRef,
  type PullRequest,
  type Review,
  type StatusCheck,
  type WorkspaceSection,
} from './github';
import type { PRWorkspace } from './prWorkspace';
import { checkIcons } from './Checks';
import { pop } from './motion';
import { Avatar, IconButton, Loader, PersonLabel, SearchField, Spinner, useWidth, Dismiss } from './ui';
import { usePeople, useSearch, type Person } from './people';
import styles from './DetailsPanel.module.css';
import switchStyles from './switch.module.css';

// `toast` announces the outcome in the toast, failures included; without it a failure shows in the page's error banner.
// `refresh` rereads after the write: GitHub recomputes review requests and mergeability, so most writes need `pr`.
export type MutateOptions = {
  toast?: string;
  refresh?: 'pr' | 'all' | 'none';
  apply?: () => () => void;
};
export type Mutate = (work: (api: GitHub) => Promise<unknown>, options?: MutateOptions) => Promise<boolean>;

const readiness: Record<string, [string, string]> = {
  clean: ['Ready to merge', 'All checks and approval requirements have been met'],
  has_hooks: ['Ready to merge', 'Merge hooks will run on GitHub'],
  unstable: ['Checks are failing', 'You can still merge; non-required checks did not pass'],
  blocked: ['Merging is blocked', 'Required reviews or checks are not satisfied yet'],
  behind: ['Branch is out of date', 'Update the branch with its base before merging'],
  dirty: ['Merge conflicts', 'Resolve conflicts on GitHub before merging'],
};
const pendingReadiness: [string, string] = ['Checking merge status…', 'GitHub is still computing mergeability'];
const reviewLabels: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Commented',
  REQUESTED: 'Review requested',
  DISMISSED: 'Dismissed',
};
const reviewGroups = [
  ['APPROVED', 'approved'],
  ['CHANGES_REQUESTED', 'requested changes'],
  ['COMMENTED', 'commented'],
  ['REQUESTED', 'waiting on review'],
] as const;
const methodLabels: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
};
const checkKinds = ['failure', 'cancelled', 'pending', 'success', 'skipped', 'neutral'] as const;
export const checkCounts = (checks: StatusCheck[] = []) =>
  checkKinds.map(kind => [kind, checks.filter(check => check.state === kind).length] as const);
const checkWords = {
  failure: 'failed',
  cancelled: 'cancelled',
  pending: 'pending',
  success: 'passed',
  skipped: 'skipped',
  neutral: 'neutral',
};
const checkKind = (check: StatusCheck) => checkKinds.find(kind => check.state === kind) ?? 'neutral';
export const reviewApproved = (pr: PullRequest, reviews: Review[], onBehalfOf?: Record<string, string[]>) =>
  reviewDecision(pullRequestReviewers(pr, reviews, onBehalfOf)) === 'APPROVED';
// GitHub rejects review requests for the PR author and for bots.
const requestable = (pr: PullRequest, login: string) => login !== pr.user.login && !login.endsWith('[bot]');

// On busy repositories GitHub can report `unknown` almost constantly, so an approved PR stays mergeable meanwhile.
export const mergeOffered = (pr: PullRequest, approved: boolean) => mergeReady(pr) || (!pr.draft && mergeabilityPending(pr) && approved);
// The most specific blocker we can name; branch protection details beyond approvals aren't exposed on the PR.
const notReadyReason = (pr: PullRequest, approved: boolean) => {
  if (pr.draft) return 'Draft pull requests can’t be merged';
  if (pr.mergeable_state === 'dirty') return 'This branch has conflicts that must be resolved';
  if (pr.mergeable_state === 'behind') return 'This branch is out of date with the base branch';
  if (!approved) return 'This PR needs more approvals';
  return 'Required reviews or checks aren’t satisfied yet';
};

const MergeMenu = defineComponent(
  (props: {
    pr: PullRequest;
    methods: MergeMethod[];
    autoMerge: boolean;
    approved: boolean;
    disabled: boolean;
    onMerge: (method: MergeMethod) => void;
  }) => {
    const open = shallowRef(false);
    const confirming = shallowRef<MergeMethod | null>(null);
    const toggle = () => {
      open.value = !open.value;
      confirming.value = null;
    };
    return () => {
      const offered = mergeOffered(props.pr, props.approved);
      const reason = offered ? undefined : notReadyReason(props.pr, props.approved);
      return props.pr.state !== 'open' ? (
        <a
          class="button small"
          title="Open this pull request on GitHub in a new tab"
          href={props.pr.html_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in GitHub
          <ArrowUpRight size={14} />
        </a>
      ) : (
        <div class="popover-anchor">
          <button
            class={`button small ${offered ? 'primary' : styles['not-ready']} ${styles.trigger}`}
            title={reason}
            aria-haspopup="menu"
            aria-expanded={open.value}
            onClick={toggle}
          >
            {offered ? (
              'Merge'
            ) : (
              <>
                <TriangleAlert size={14} />
                Not ready to merge
              </>
            )}
            <ChevronDown size={13} />
          </button>
          {open.value && <Dismiss onClose={toggle} />}
          <AnimatePresence>
            {open.value && (
              <motion.div key="merge" {...pop()} class={`popover ${styles.menu}`} role="menu" aria-label="Merge options">
                {offered ? (
                  props.methods.map(method => (
                    <button
                      key={method}
                      role="menuitem"
                      class={styles.option}
                      disabled={props.disabled}
                      title={
                        mergeReady(props.pr) ? undefined : 'GitHub is still checking mergeability; it has the final say when you merge.'
                      }
                      onClick={() => {
                        if (confirming.value !== method) return void (confirming.value = method);
                        open.value = false;
                        props.onMerge(method);
                      }}
                    >
                      <GitMerge size={14} />
                      {confirming.value === method ? `Confirm ${methodLabels[method].toLowerCase()}` : methodLabels[method]}
                    </button>
                  ))
                ) : (
                  <p class={styles['menu-note']} role="none">
                    <strong>{reason}</strong>
                    {props.autoMerge && !props.pr.draft && <span>Turn on auto-merge to merge once requirements pass.</span>}
                  </p>
                )}
                <a role="menuitem" class={styles.option} href={props.pr.html_url} target="_blank" rel="noopener noreferrer">
                  <ArrowUpRight size={14} />
                  Open in GitHub
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    };
  },
  { props: ['pr', 'methods', 'autoMerge', 'approved', 'disabled', 'onMerge'] },
);

export const MergeControls = defineComponent(
  (props: {
    pr: PullRequest;
    methods: MergeMethod[];
    autoMerge: boolean;
    approved: boolean;
    disabled: boolean;
    onMerge: (method: MergeMethod) => void;
    onAutoMerge: (enabled: boolean) => Promise<boolean>;
  }) => {
    const autoMergeMethod = () => props.pr.auto_merge?.merge_method ?? props.methods[0];
    return () => {
      const { pr } = props;
      return (
        <>
          {props.autoMerge && pr.state === 'open' && !pr.draft && (
            <label
              class={styles['auto-merge']}
              title={
                pr.mergeable_state === 'dirty'
                  ? 'Resolve merge conflicts first'
                  : pr.auto_merge
                    ? `Auto-merge (${pr.auto_merge.merge_method}) enabled by ${pr.auto_merge.enabled_by.login}. Turn off to cancel.`
                    : 'Merge automatically once required checks and reviews pass.'
              }
            >
              <span>Auto-merge</span>
              <input
                type="checkbox"
                role="switch"
                class={switchStyles.switch}
                checked={!!pr.auto_merge}
                disabled={props.disabled || pr.mergeable_state === 'dirty' || !autoMergeMethod()}
                onChange={e => {
                  const input = e.target as HTMLInputElement;
                  void props.onAutoMerge(input.checked);
                }}
              />
            </label>
          )}
          <MergeMenu
            pr={pr}
            methods={props.methods}
            autoMerge={props.autoMerge}
            approved={props.approved}
            disabled={props.disabled}
            onMerge={props.onMerge}
          />
        </>
      );
    };
  },
  { props: ['pr', 'methods', 'autoMerge', 'approved', 'disabled', 'onMerge', 'onAutoMerge'] },
);

export const MoreMenu = defineComponent(
  (props: { details: Details; onCommand: (id: (typeof copyActions)[number][0]) => void }) => {
    const open = shallowRef(false);
    return () => {
      const { details } = props;
      const pr = details.pr();
      const { onMutate, prRef } = details.source();
      const change = (toast: string, work: Parameters<Mutate>[0], apply: NonNullable<MutateOptions['apply']>) => () =>
        void onMutate(work, { toast, refresh: 'all', apply });
      const actions: [string, typeof GitPullRequest, () => void][] = pr.merged
        ? []
        : pr.state === 'open'
          ? [
              [
                pr.draft ? 'Ready for review' : 'Convert to draft',
                pr.draft ? GitPullRequest : GitPullRequestDraft,
                change(
                  pr.draft ? 'Marked ready for review' : 'Converted to draft',
                  api => api.setDraft(pr, !pr.draft),
                  () => {
                    const previous = pr.draft;
                    details.source().store.setPR({ draft: !previous });
                    open.value = false;
                    return () => {
                      if (details.pr().draft === !previous) details.source().store.rollbackPR({ draft: !previous }, { draft: previous });
                      open.value = true;
                    };
                  },
                ),
              ],
              [
                'Close pull request',
                GitPullRequestClosed,
                change(
                  'Pull request closed',
                  api => api.editPR(prRef, { state: 'closed' }),
                  () => {
                    const previous = pr.state;
                    details.source().store.setPR({ state: 'closed' });
                    open.value = false;
                    return () => {
                      if (details.pr().state === 'closed') details.source().store.rollbackPR({ state: 'closed' }, { state: previous });
                      open.value = true;
                    };
                  },
                ),
              ],
            ]
          : [
              [
                'Reopen pull request',
                GitPullRequest,
                change(
                  'Pull request reopened',
                  api => api.editPR(prRef, { state: 'open' }),
                  () => {
                    const previous = pr.state;
                    details.source().store.setPR({ state: 'open' });
                    open.value = false;
                    return () => {
                      if (details.pr().state === 'open') details.source().store.rollbackPR({ state: 'open' }, { state: previous });
                      open.value = true;
                    };
                  },
                ),
              ],
            ];
      return (
        <div class="popover-anchor">
          <IconButton label="More pull request actions" active={open.value} onClick={() => (open.value = !open.value)}>
            <Ellipsis size={15} />
          </IconButton>
          {open.value && <Dismiss onClose={() => (open.value = false)} />}
          <AnimatePresence>
            {open.value && (
              <motion.div key="more" {...pop()} class={`popover ${styles.menu}`} role="menu" aria-label="Pull request actions">
                {copyActions.map(([id, text, Icon, keys]) => (
                  <button
                    key={id}
                    role="menuitem"
                    class={styles.option}
                    onClick={() => {
                      open.value = false;
                      props.onCommand(id);
                    }}
                  >
                    <Icon size={14} />
                    {text}
                    <kbd class={styles.keys}>{keys}</kbd>
                  </button>
                ))}
                {!!actions.length && <hr class={styles.separator} />}
                {actions.map(([text, Icon, action]) => (
                  <button
                    key={text}
                    role="menuitem"
                    class={styles.option}
                    disabled={details.disabled()}
                    onClick={() => {
                      open.value = false;
                      action();
                    }}
                  >
                    <Icon size={14} />
                    {text}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    };
  },
  { props: ['details', 'onCommand'] },
);
const copyActions = [
  ['copy-link', 'Copy link', Link, 'c l'],
  ['copy-github-link', 'Copy GitHub link', ArrowUpRight, 'c g'],
  ['copy-markdown', 'Copy as Markdown', Code, 'c p'],
] as const;

type Option = { key: string; text: string; detail?: string | null; avatar?: string; color?: string };
// `load` fills a fixed list that is filtered locally; `search` adds debounced results for the typed query, listed first.
const Picker = defineComponent(
  (props: {
    label: string;
    load: () => Promise<Option[]>;
    search?: (query: string, signal: AbortSignal) => Promise<Option[]>;
    selected: string[];
    disabled: boolean;
    onPick: (key: string) => void;
  }) => {
    const open = shallowRef(false);
    const options = shallowRef<Option[] | null>(null);
    const failure = shallowRef('');
    const query = shallowRef('');
    const found = useSearch(() => (open.value ? query.value : null), props.search);
    const toggle = () => {
      open.value = !open.value;
      query.value = '';
      if (open.value && !options.value)
        void props.load().then(
          value => (options.value = value),
          error => (failure.value = errorMessage(error, 'Could not load options.')),
        );
    };
    const shown = () => {
      const text = query.value.toLowerCase();
      const local = (options.value ?? []).filter(option => [option.text, option.detail].some(field => field?.toLowerCase().includes(text)));
      const remote = found().items;
      return [...remote, ...local.filter(option => !remote.some(other => other.key === option.key))].slice(0, 50);
    };
    return () => (
      <span class="popover-anchor">
        <IconButton label={props.label} onClick={toggle} disabled={props.disabled}>
          <Plus size={14} />
        </IconButton>
        {open.value && <Dismiss onClose={toggle} />}
        <AnimatePresence>
          {open.value && (
            <motion.div key="picker" {...pop()} class={`popover ${styles.menu}`} role="dialog" aria-label={props.label}>
              <SearchField
                class="menu-search"
                label={`Filter: ${props.label}`}
                placeholder="Filter…"
                value={query.value}
                inputRef={element => (element as HTMLInputElement | null)?.focus()}
                onInput={value => (query.value = value)}
              />
              {shown().map(option => (
                <button
                  key={option.key}
                  class={styles.option}
                  aria-label={option.text}
                  aria-pressed={props.selected.includes(option.key)}
                  onClick={() => props.onPick(option.key)}
                >
                  {!!option.color && <i class={styles.swatch} style={{ background: `#${option.color}` }} />}
                  {option.avatar === undefined ? (
                    option.text
                  ) : (
                    <PersonLabel login={option.text} name={option.detail} avatar={option.avatar} />
                  )}
                  {props.selected.includes(option.key) && <Check size={14} class={styles.end} />}
                </button>
              ))}
              {(failure.value || found().error) && <p class={styles.muted}>{failure.value || found().error}</p>}
              {!options.value && !failure.value && <Loader label="Loading…" />}
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    );
  },
  { props: ['label', 'load', 'search', 'selected', 'disabled', 'onPick'] },
);

export interface DetailsInput {
  store: PRWorkspace;
  api: GitHub;
  prRef: PRRef;
  busy: boolean;
  onChecks: () => void;
  onMutate: Mutate;
}

// Sections still loading read as undefined so the panel shows their loaders; writes land in the PR store.
export function useDetails(input: () => DetailsInput) {
  const source = () => {
    const { store } = input();
    const workspace = store.current();
    const settled = (section: WorkspaceSection) => !workspace.pending.includes(section);
    return {
      ...input(),
      pr: workspace.pr,
      reviews: workspace.reviews,
      checks: settled('checks') ? (workspace.checks ?? []) : undefined,
      issues: settled('linkedIssues') ? (workspace.linkedIssues ?? []) : undefined,
      codeOwners: workspace.codeOwners,
      onBehalfOf: workspace.onBehalfOf,
    };
  };
  const pr = () => source().pr;
  const reviewers = computed(() =>
    pullRequestReviewers(pr(), source().reviews, source().onBehalfOf).map(
      row => [row.login, row.requested ? 'REQUESTED' : row.review!] as const,
    ),
  );
  const labels = () => pr().labels ?? [];
  // Label and reviewer writes return the new values; patching them keeps the sidebar right while GitHub's reread lags.
  const setPR = (change: Partial<PullRequest>) => input().store.setPR(change);
  const sameNames = (a: { login: string }[] = [], b: { login: string }[] = []) =>
    a
      .map(user => user.login)
      .sort()
      .join() ===
    b
      .map(user => user.login)
      .sort()
      .join();
  const sameTeams = (a: { slug: string }[] = [], b: { slug: string }[] = []) =>
    a
      .map(team => team.slug)
      .sort()
      .join() ===
    b
      .map(team => team.slug)
      .sort()
      .join();
  const setLabels = (names: string[]) => {
    const previous = labels();
    const optimistic = names.map(name => previous.find(label => label.name === name) ?? { name, color: 'ededed' });
    return source().onMutate(
      async api => {
        const confirmed = await api.setLabels(source().prRef, names);
        if (
          labels()
            .map(label => label.name)
            .sort()
            .join() === names.slice().sort().join()
        )
          setPR({ labels: confirmed });
      },
      {
        toast: 'Labels updated',
        refresh: 'pr',
        apply: () => {
          setPR({ labels: optimistic });
          return () => {
            if (
              labels()
                .map(label => label.name)
                .sort()
                .join() === names.slice().sort().join()
            )
              source().store.rollbackPR({ labels: optimistic }, { labels: previous });
          };
        },
      },
    );
  };
  const request = (logins: string[], remove = false) => {
    const currentPR = pr();
    const oldUsers = currentPR.requested_reviewers ?? [];
    const oldTeams = currentPR.requested_teams ?? [];
    const users = logins.filter(login => !login.includes('/'));
    const teams = logins.filter(login => login.includes('/')).map(login => login.split('/').at(-1)!);
    const optimisticUsers = remove
      ? oldUsers.filter(user => !users.includes(user.login))
      : [...oldUsers, ...users.filter(login => !oldUsers.some(user => user.login === login)).map(login => ({ id: 0, login }))];
    const optimisticTeams = remove
      ? oldTeams.filter(team => !teams.includes(team.slug))
      : [...oldTeams, ...teams.filter(slug => !oldTeams.some(team => team.slug === slug)).map(slug => ({ slug, name: slug }))];
    const stillOptimistic = () => sameNames(pr().requested_reviewers, optimisticUsers) && sameTeams(pr().requested_teams, optimisticTeams);
    return source().onMutate(
      async api => {
        const result = await api.requestReviewers(source().prRef, logins, remove);
        if (stillOptimistic()) setPR({ requested_reviewers: result.requested_reviewers, requested_teams: result.requested_teams });
      },
      {
        toast: `Review ${remove ? 'request removed' : 'requested'} from ${logins.join(', ')}`,
        refresh: 'pr',
        apply: () => {
          setPR({ requested_reviewers: optimisticUsers, requested_teams: optimisticTeams });
          return () => {
            if (stillOptimistic())
              source().store.rollbackPR(
                { requested_reviewers: optimisticUsers, requested_teams: optimisticTeams },
                { requested_reviewers: oldUsers, requested_teams: oldTeams },
              );
          };
        },
      },
    );
  };
  return {
    source,
    pr,
    reviewers,
    labels,
    setLabels,
    request,
    disabled: () => false,
    rerequestable: () => reviewers.value.map(([login]) => login).filter(login => requestable(pr(), login)),
  };
}
export type Details = ReturnType<typeof useDetails>;

export function ReviewIcon(props: { review: string; codeOwner?: boolean }) {
  const label = `${reviewLabels[props.review]}${props.codeOwner ? ' · code owner' : ''}`;
  const Icon =
    props.review === 'APPROVED'
      ? Check
      : props.review === 'CHANGES_REQUESTED'
        ? CircleX
        : props.review === 'COMMENTED'
          ? MessageSquareText
          : props.review === 'DISMISSED'
            ? CircleSlash
            : props.codeOwner
              ? ShieldHalf
              : null;
  return (
    <span class={styles.icon} data-review={props.review} role="img" aria-label={label} title={label}>
      {Icon && <Icon size={14} />}
    </span>
  );
}

function ReviewerRow(props: { details: Details; login: string; review: string }) {
  const { details, login, review } = props;
  const { reviews, onBehalfOf, codeOwners = [] } = details.source();
  const teams = onBehalfOf?.[login] ?? [];
  const user = [...(details.pr().requested_reviewers ?? []), ...reviews.map(given => given.user)].find(user => user.login === login);
  const name = usePeople()()?.known(login)?.name;
  return (
    <div class={styles.row}>
      {login.includes('/') ? (
        <span class="avatar small">
          <Users size={12} />
        </span>
      ) : (
        <Avatar login={login} src={user?.avatar_url} small />
      )}
      <span class={styles.who}>
        <span class={styles.name} title={name ? `${name} (${login})` : login}>
          {name || login}
        </span>
        {!!teams.length && <span class={`${styles.name} ${styles.team}`}>{teams.join(', ')}</span>}
      </span>
      <span class={`${styles.end} ${styles.hover}`}>
        {review === 'REQUESTED' ? (
          <IconButton
            label={`Remove review request from ${login}`}
            disabled={details.disabled()}
            onClick={() => details.request([login], true)}
          >
            <X size={12} />
          </IconButton>
        ) : (
          requestable(details.pr(), login) && (
            <IconButton label={`Re-request review from ${login}`} disabled={details.disabled()} onClick={() => details.request([login])}>
              <RefreshCw size={12} />
            </IconButton>
          )
        )}
      </span>
      <ReviewIcon review={review} codeOwner={[login, ...teams].some(key => codeOwners.includes(key))} />
    </div>
  );
}

const personOption = (person: Person): Option => ({
  key: person.login,
  text: person.login,
  detail: person.name,
  avatar: person.avatarUrl ?? '',
});
function ReviewerPicker(props: { details: Details }) {
  const { details } = props;
  const people = usePeople();
  return (
    <Picker
      label="Request reviewer"
      disabled={details.disabled()}
      selected={details.reviewers.value.map(([login]) => login)}
      load={async () => {
        const { api, prRef } = details.source();
        // Personal repos have no teams, and listing them needs org read access.
        const teams = await api.repoTeams(prRef).catch(() => []);
        return teams.map(team => teamKey(details.pr(), team.slug)).map(key => ({ key, text: key }));
      }}
      search={async (query, signal) =>
        ((await people()?.search('assignable', query, signal)) ?? [])
          .filter(person => requestable(details.pr(), person.login))
          .map(personOption)
      }
      onPick={login => details.request([login])}
    />
  );
}

function LabelPicker(props: { details: Details }) {
  const { details } = props;
  const names = () => details.labels().map(label => label.name);
  return (
    <Picker
      label="Edit labels"
      disabled={details.disabled()}
      selected={names()}
      load={async () =>
        (await details.source().api.repoLabels(details.source().prRef)).map(label => ({
          key: label.name,
          text: label.name,
          color: label.color,
        }))
      }
      onPick={name => details.setLabels(names().includes(name) ? names().filter(other => other !== name) : [...names(), name])}
    />
  );
}

function LabelChips(props: { details: Details }) {
  const { details } = props;
  return details.labels().length ? (
    <div class={styles.labels}>
      {details.labels().map((label: Label) => (
        <span key={label.name} class={styles.label}>
          <i class={styles.swatch} style={{ background: `#${label.color}` }} />
          {label.name}
          <button
            aria-label={`Remove label ${label.name}`}
            title={`Remove ${label.name}`}
            disabled={details.disabled()}
            onClick={() => details.setLabels(details.labels().flatMap(other => (other.name === label.name ? [] : [other.name])))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  ) : (
    <p class={styles.muted}>No labels</p>
  );
}

function Assignees(props: { details: Details }) {
  const assignees = props.details.pr().assignees ?? [];
  return assignees.length ? (
    <>
      {assignees.map(user => (
        <div key={user.login} class={styles.row}>
          <Avatar login={user.login} src={user.avatar_url} small />
          <span class={styles.name}>{user.login}</span>
        </div>
      ))}
    </>
  ) : (
    <p class={styles.muted}>No assignees</p>
  );
}

function Issues(props: { issues?: LinkedIssue[] }) {
  return !props.issues ? (
    <div class={styles.pending} role="status">
      <Spinner text="Loading linked issues…" />
    </div>
  ) : props.issues.length ? (
    <>
      {props.issues.map(issue => (
        <a key={issue.number} class={styles.row} href={issue.url} target="_blank" rel="noopener noreferrer">
          <CircleDot size={13} />
          <span class={styles.name}>
            #{issue.number} {issue.title}
          </span>
        </a>
      ))}
    </>
  ) : (
    <p class={styles.muted}>No linked issues</p>
  );
}

const SummaryGroup = defineComponent(
  (props: { label: string; state?: string }, { slots }) => {
    const open = shallowRef(false);
    return () => (
      <span class="popover-anchor">
        <button class={styles.chip} data-state={props.state} aria-expanded={open.value} onClick={() => (open.value = !open.value)}>
          {slots.chip?.()}
        </button>
        {open.value && <Dismiss onClose={() => (open.value = false)} />}
        <AnimatePresence>
          {open.value && (
            <motion.div key="group" {...pop()} class={`popover ${styles.menu} ${styles.left}`} role="dialog" aria-label={props.label}>
              {slots.default?.()}
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    );
  },
  { props: ['label', 'state'] },
);

const CheckSummary = defineComponent(
  (props: { checks?: StatusCheck[] }) => () => {
    const { checks } = props;
    if (!checks)
      return (
        <div class={styles.pending} role="status">
          <Spinner text="Loading checks…" />
        </div>
      );
    return (
      <div class={styles['check-summary']}>
        {checkCounts(checks)
          .filter(([, count]) => count)
          .map(([kind, count]) => {
            const Icon = checkIcons[kind];
            return (
              <SummaryGroup key={kind} label={`Checks ${checkWords[kind]}`} state={kind}>
                {{
                  chip: () => (
                    <>
                      <Icon size={14} />
                      {count} {checkWords[kind]}
                    </>
                  ),
                  default: () =>
                    checks
                      .filter(check => checkKind(check) === kind)
                      .map(check => (
                        <a key={check.id} class={styles.option} href={check.url} target="_blank" rel="noopener noreferrer">
                          <Icon size={14} />
                          <span class={styles.name}>{check.name}</span>
                        </a>
                      )),
                }}
              </SummaryGroup>
            );
          })}
        {!checks.length && <span class={styles.muted}>No checks</span>}
      </div>
    );
  },
  { props: ['checks'] },
);

// Graphite's succinct summary, shown in place of the side panel when it is hidden.
export const Information = defineComponent(
  (props: { details: Details }) => {
    const open = shallowRef(true);
    return () => {
      const { details } = props;
      const { checks } = details.source();
      return (
        <section class={styles.info} aria-label="Pull request information">
          <button class="section-heading" aria-expanded={open.value} onClick={() => (open.value = !open.value)}>
            <ChevronRight size={13} class={`chevron ${open.value ? 'rotated' : ''}`} />
            Information
          </button>
          {open.value && (
            <dl class={styles.grid}>
              <dt>
                <button class={styles['checks-label']} title="Open the Checks tab" onClick={details.source().onChecks}>
                  Checks
                </button>
              </dt>
              <dd>
                <CheckSummary checks={checks} />
              </dd>
              <dt>Reviewers</dt>
              <dd>
                {reviewGroups.map(([state, text]) => {
                  const logins = details.reviewers.value.filter(([, review]) => review === state).map(([login]) => login);
                  return (
                    !!logins.length && (
                      <SummaryGroup key={state} label={`Reviewers who ${text}`}>
                        {{
                          chip: () => (
                            <>
                              {state === 'REQUESTED' ? (
                                <span class={styles.icon}>
                                  <CircleDashed size={14} />
                                </span>
                              ) : (
                                <ReviewIcon review={state} codeOwner={false} />
                              )}
                              {logins.length} {text}
                            </>
                          ),
                          default: () => logins.map(login => <ReviewerRow key={login} details={details} login={login} review={state} />),
                        }}
                      </SummaryGroup>
                    )
                  );
                })}
                {!details.reviewers.value.length && <span class={styles.muted}>No reviewers</span>}
                <span class={styles.left}>
                  <ReviewerPicker details={details} />
                </span>
              </dd>
              <dt>Assignees</dt>
              <dd>
                <Assignees details={details} />
              </dd>
              <dt>Labels</dt>
              <dd>
                <LabelChips details={details} />
                <span class={styles.left}>
                  <LabelPicker details={details} />
                </span>
              </dd>
              <dt>Links</dt>
              <dd>
                <Issues issues={details.source().issues} />
              </dd>
            </dl>
          )}
        </section>
      );
    };
  },
  { props: ['details'] },
);

export default defineComponent(
  (props: { details: Details }) => {
    const { width, handle } = useWidth('details', 288, 'left');
    return () => {
      const { details } = props;
      const pr = details.pr();
      const { checks } = details.source();
      return (
        <>
          <aside class={styles.panel} aria-label="Pull request details" style={{ width: `${width.value}px` }}>
            {handle('Resize pull request details')}
            <div class={styles.scroll}>
              {!!(pr.state === 'open' && !pr.draft) && (
                <section class={styles.card}>
                  {(() => {
                    const [title, detail] = readiness[pr.mergeable_state ?? ''] ?? pendingReadiness;
                    return (
                      <>
                        <div class={styles.title} data-ready={mergeReady(pr)}>
                          {mergeReady(pr) ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
                          {title}
                        </div>
                        <p class={styles.muted}>{detail}</p>
                      </>
                    );
                  })()}
                </section>
              )}
              <section class={styles.section}>
                <h3>
                  <button class={styles['checks-label']} title="Open the Checks tab" onClick={details.source().onChecks}>
                    Checks
                  </button>
                </h3>
                <CheckSummary checks={checks} />
              </section>
              <section class={styles.section}>
                <h3>
                  Reviewers
                  <span class={styles.tools}>
                    <IconButton
                      label="Re-request all reviews"
                      disabled={details.disabled() || !details.rerequestable().length}
                      onClick={() => details.request(details.rerequestable())}
                    >
                      <RefreshCw size={13} />
                    </IconButton>
                    <ReviewerPicker details={details} />
                  </span>
                </h3>
                {details.reviewers.value.length ? (
                  details.reviewers.value.map(([login, review]) => (
                    <ReviewerRow key={login} details={details} login={login} review={review} />
                  ))
                ) : (
                  <p class={styles.muted}>No reviewers</p>
                )}
              </section>
              <section class={styles.section}>
                <h3>
                  Labels
                  <LabelPicker details={details} />
                </h3>
                <LabelChips details={details} />
              </section>
              <section class={styles.section}>
                <h3>Assignees</h3>
                <Assignees details={details} />
              </section>
              <section class={styles.section}>
                <h3>Development</h3>
                <Issues issues={details.source().issues} />
              </section>
            </div>
          </aside>
        </>
      );
    };
  },
  { props: ['details'] },
);
