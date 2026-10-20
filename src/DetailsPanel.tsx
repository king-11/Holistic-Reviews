import { computed, defineComponent, shallowRef } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import {
  ArrowUpRight,
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
import { Avatar, IconButton, Loader, PersonLabel, SearchField, useWidth, Dismiss } from './ui';
import { usePeople, useSearch, type Person } from './people';
import styles from './DetailsPanel.module.css';
import switchStyles from './switch.module.css';

export type Run = <T>(label: string, work: (api: GitHub) => Promise<T>, refresh?: boolean) => Promise<T | undefined>;

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
const describeChecks = (checks?: StatusCheck[]) =>
  checkCounts(checks)
    .filter(([, count]) => count)
    .map(([kind, count]) => `${count} ${checkWords[kind]}`)
    .join(', ') || 'No checks';
// A review given on behalf of a requested team stands in for that team's request.
export function reviewerStates(pr: PullRequest, reviews: Review[], onBehalfOf: Record<string, string[]> = {}) {
  const covered = new Set(Object.values(onBehalfOf).flat());
  const latest = new Map<string, string>();
  for (const review of reviews) if (review.state !== 'PENDING') latest.set(review.user.login, review.state);
  for (const user of pr.requested_reviewers ?? []) latest.set(user.login, 'REQUESTED');
  for (const team of pr.requested_teams ?? []) if (!covered.has(teamKey(pr, team.slug))) latest.set(teamKey(pr, team.slug), 'REQUESTED');
  return [...latest];
}
// Approved means someone approved and nobody's latest review still requests changes.
export const reviewApproved = (pr: PullRequest, reviews: Review[], onBehalfOf?: Record<string, string[]>) => {
  const states = reviewerStates(pr, reviews, onBehalfOf).map(([, state]) => state);
  return states.includes('APPROVED') && !states.includes('CHANGES_REQUESTED');
};
const teamKey = (pr: PullRequest, slug: string) => `${pr.base.repo?.full_name.split('/')[0]}/${slug}`;
// GitHub rejects review requests for the PR author and for bots.
const requestable = (pr: PullRequest, login: string) => login !== pr.user.login && !login.endsWith('[bot]');

// On busy repositories GitHub can report `unknown` almost constantly, so an approved PR stays mergeable meanwhile.
const mergeOffered = (pr: PullRequest, approved: boolean) => mergeReady(pr) || (!pr.draft && mergeabilityPending(pr) && approved);
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
    prRef: PRRef;
    methods: MergeMethod[];
    autoMerge: boolean;
    approved: boolean;
    disabled: boolean;
    onRun: Run;
  }) => {
    const autoMergeMethod = () => props.pr.auto_merge?.merge_method ?? props.methods[0];
    const toggleAutoMerge = async (input: HTMLInputElement) => {
      const enable = input.checked;
      const method = autoMergeMethod();
      const saved = await props.onRun(enable ? 'Auto-merge enabled' : 'Auto-merge turned off', async api => {
        try {
          await api.setAutoMerge(props.pr, enable && method ? method : null);
          return true;
        } catch (error) {
          if (enable && error instanceof Error && /clean status/i.test(error.message))
            throw new Error('This pull request is already mergeable. Use Merge.');
          throw error;
        }
      });
      // A failed write leaves the PR unchanged, so the switch must not keep the rejected position.
      if (!saved) input.checked = !enable;
    };
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
                onChange={e => void toggleAutoMerge(e.target as HTMLInputElement)}
              />
            </label>
          )}
          <MergeMenu
            pr={pr}
            methods={props.methods}
            autoMerge={props.autoMerge}
            approved={props.approved}
            disabled={props.disabled}
            onMerge={method => props.onRun('Pull request merged', api => api.merge(props.prRef, pr.head.sha, method))}
          />
        </>
      );
    };
  },
  { props: ['pr', 'prRef', 'methods', 'autoMerge', 'approved', 'disabled', 'onRun'] },
);

export const MoreMenu = defineComponent(
  (props: { details: Details }) => {
    const open = shallowRef(false);
    return () => {
      const { details } = props;
      const pr = details.pr();
      const { onRun, prRef } = details.source();
      if (pr.merged) return null;
      const actions: [string, typeof GitPullRequest, () => void][] =
        pr.state === 'open'
          ? [
              [
                pr.draft ? 'Ready for review' : 'Convert to draft',
                pr.draft ? GitPullRequest : GitPullRequestDraft,
                () => onRun(pr.draft ? 'Marked ready for review' : 'Converted to draft', api => api.setDraft(pr, !pr.draft)),
              ],
              [
                'Close pull request',
                GitPullRequestClosed,
                () => onRun('Pull request closed', api => api.editPR(prRef, { state: 'closed' })),
              ],
            ]
          : [['Reopen pull request', GitPullRequest, () => onRun('Pull request reopened', api => api.editPR(prRef, { state: 'open' }))]];
      return (
        <div class="popover-anchor">
          <IconButton label="More pull request actions" active={open.value} onClick={() => (open.value = !open.value)}>
            <Ellipsis size={15} />
          </IconButton>
          {open.value && <Dismiss onClose={() => (open.value = false)} />}
          <AnimatePresence>
            {open.value && (
              <motion.div key="more" {...pop()} class={`popover ${styles.menu}`} role="menu" aria-label="Pull request actions">
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
  { props: ['details'] },
);

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
  onRun: Run;
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
  const reviewers = computed(() => reviewerStates(pr(), source().reviews, source().onBehalfOf));
  const labels = () => pr().labels ?? [];
  // Label and reviewer writes return the new values, so they patch the PR instead of rereading it.
  const setPR = (change: Partial<PullRequest>) => input().store.edit('pr', current => ({ ...current, ...change }));
  const setLabels = (names: string[]) =>
    void source()
      .onRun('Labels updated', api => api.setLabels(source().prRef, names), false)
      .then(value => value && setPR({ labels: value }));
  const request = (logins: string[], remove = false) =>
    void source()
      .onRun(
        `Review ${remove ? 'request removed' : 'requested'} from ${logins.join(', ')}`,
        api => api.requestReviewers(source().prRef, logins, remove),
        false,
      )
      .then(value => value && setPR({ requested_reviewers: value.requested_reviewers, requested_teams: value.requested_teams }));
  return {
    source,
    pr,
    reviewers,
    labels,
    setLabels,
    request,
    disabled: () => source().busy,
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
  const { pr, reviews, onBehalfOf, codeOwners = [] } = details.source();
  const teams = onBehalfOf?.[login] ?? [];
  const user = [...(pr.requested_reviewers ?? []), ...reviews.map(given => given.user)].find(user => user.login === login);
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
    <Loader label="Loading linked issues…" />
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
              <dt>Checks</dt>
              <dd>
                {!checks ? (
                  <Loader label="Loading checks…" />
                ) : (
                  <>
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
                    <button class={styles.chip} title="Open the Checks tab" onClick={details.source().onChecks}>
                      {checks.length ? 'View all' : 'No checks'}
                    </button>
                  </>
                )}
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
                {/* Loading keeps the same heading and bar so the counts fill in place instead of swapping layouts. */}
                <button
                  class={styles.checks}
                  title="Open the Checks tab"
                  aria-label="Open the Checks tab"
                  aria-busy={!checks}
                  disabled={!checks}
                  onClick={details.source().onChecks}
                >
                  <h3>
                    Checks<span>{checks ? describeChecks(checks) : 'Loading…'}</span>
                  </h3>
                  <span class={styles.bar} data-loading={!checks}>
                    {checkCounts(checks).map(([kind, count]) => (
                      <span key={kind} data-state={kind} style={{ flexGrow: count }} />
                    ))}
                  </span>
                </button>
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
