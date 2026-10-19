import { computed, defineComponent, shallowRef, watch } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
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
} from './github';
import { checkIcons } from './Checks';
import { pop } from './motion';
import { Avatar, IconButton, Loader, SearchField, useWidth, Dismiss } from './ui';
import styles from './DetailsPanel.module.css';

export type Run = <T>(
  label: string | ((result: T) => string),
  work: (api: GitHub) => Promise<T>,
  refresh?: boolean,
) => Promise<T | undefined>;

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
const teamKey = (pr: PullRequest, slug: string) => `${pr.base.repo?.full_name.split('/')[0]}/${slug}`;
// GitHub rejects review requests for the PR author and for bots.
const requestable = (pr: PullRequest, login: string) => login !== pr.user.login && !login.endsWith('[bot]');

// Unknown mergeability and queueable auto-merge stay clickable; GitHub has the final say on each attempt.
const mergeAvailable = (pr: PullRequest, autoMerge: boolean) =>
  mergeReady(pr) ||
  (!pr.draft &&
    pr.state === 'open' &&
    (mergeabilityPending(pr) || (autoMerge && !pr.auto_merge && !['dirty', 'draft'].includes(pr.mergeable_state ?? ''))));
const mergeHint = (pr: PullRequest, autoMerge: boolean) => {
  if (mergeReady(pr)) return undefined;
  if (!mergeAvailable(pr, autoMerge)) return (readiness[pr.mergeable_state ?? ''] ?? pendingReadiness)[0];
  return autoMerge
    ? 'GitHub will merge this once required checks and reviews pass.'
    : 'GitHub is still checking mergeability; merging will be attempted.';
};

export const MergeMenu = defineComponent(
  (props: { pr: PullRequest; methods: MergeMethod[]; autoMerge: boolean; disabled: boolean; onMerge: (method: MergeMethod) => void }) => {
    const open = shallowRef(false);
    const confirming = shallowRef<MergeMethod | null>(null);
    const toggle = () => {
      open.value = !open.value;
      confirming.value = null;
    };
    return () =>
      props.pr.state !== 'open' ? (
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
          <button class={`button primary small ${styles.trigger}`} aria-haspopup="menu" aria-expanded={open.value} onClick={toggle}>
            Merge
            <ChevronDown size={13} />
          </button>
          {open.value && <Dismiss onClose={toggle} />}
          <AnimatePresence>
            {open.value && (
              <motion.div key="merge" {...pop()} class={`popover ${styles.menu}`} role="menu" aria-label="Merge options">
                {props.methods.map(method => (
                  <button
                    key={method}
                    role="menuitem"
                    class={styles.option}
                    disabled={props.disabled || !mergeAvailable(props.pr, props.autoMerge)}
                    title={mergeHint(props.pr, props.autoMerge)}
                    onClick={() => {
                      if (confirming.value !== method) return void (confirming.value = method);
                      open.value = false;
                      props.onMerge(method);
                    }}
                  >
                    <GitMerge size={14} />
                    {confirming.value === method ? `Confirm ${methodLabels[method].toLowerCase()}` : methodLabels[method]}
                  </button>
                ))}
                <a role="menuitem" class={styles.option} href={props.pr.html_url} target="_blank" rel="noopener noreferrer">
                  <ArrowUpRight size={14} />
                  Open in GitHub
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
  },
  { props: ['pr', 'methods', 'autoMerge', 'disabled', 'onMerge'] },
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
                    title={details.hint()}
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

type Option = { key: string; text: string; color?: string };
const Picker = defineComponent(
  (props: { label: string; load: () => Promise<Option[]>; selected: string[]; disabled: boolean; onPick: (key: string) => void }) => {
    const open = shallowRef(false);
    const options = shallowRef<Option[] | null>(null);
    const failure = shallowRef('');
    const query = shallowRef('');
    const toggle = () => {
      open.value = !open.value;
      query.value = '';
      if (open.value && !options.value)
        void props.load().then(
          value => (options.value = value),
          error => (failure.value = error instanceof Error ? error.message : 'Could not load options.'),
        );
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
              {failure.value ? (
                <p class={styles.muted}>{failure.value}</p>
              ) : !options.value ? (
                <Loader label="Loading…" />
              ) : (
                options.value
                  .filter(option => option.text.toLowerCase().includes(query.value.toLowerCase()))
                  .slice(0, 50)
                  .map(option => (
                    <button
                      key={option.key}
                      class={styles.option}
                      aria-pressed={props.selected.includes(option.key)}
                      onClick={() => props.onPick(option.key)}
                    >
                      {!!option.color && <i class={styles.swatch} style={{ background: `#${option.color}` }} />}
                      {option.text}
                      {props.selected.includes(option.key) && <Check size={14} class={styles.end} />}
                    </button>
                  ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    );
  },
  { props: ['label', 'load', 'selected', 'disabled', 'onPick'] },
);

export interface DetailsSource {
  pr: PullRequest;
  reviews: Review[];
  checks?: StatusCheck[];
  issues?: LinkedIssue[];
  codeOwners?: string[];
  onBehalfOf?: Record<string, string[]>;
  api: GitHub | null;
  prRef: PRRef;
  busy: boolean;
  onChecks: () => void;
  onRun: Run;
}

// Label and reviewer writes return the new values, so they patch locally instead of reloading the PR.
export function useDetails(source: () => DetailsSource) {
  const patch = shallowRef<Partial<PullRequest>>({});
  watch(
    () => source().pr,
    () => (patch.value = {}),
  );
  const pr = () => ({ ...source().pr, ...patch.value });
  const reviewers = computed(() => reviewerStates(pr(), source().reviews, source().onBehalfOf));
  const labels = () => pr().labels ?? [];
  const setLabels = (names: string[]) =>
    void source()
      .onRun('Labels updated', api => api.setLabels(source().prRef, names), false)
      .then(value => {
        if (value) patch.value = { ...patch.value, labels: value };
      });
  const request = (logins: string[], remove = false) =>
    void source()
      .onRun(
        `Review ${remove ? 'request removed' : 'requested'} from ${logins.join(', ')}`,
        api => api.requestReviewers(source().prRef, logins, remove),
        false,
      )
      .then(value => {
        if (value) patch.value = { ...patch.value, requested_reviewers: value.requested_reviewers, requested_teams: value.requested_teams };
      });
  return {
    source,
    pr,
    reviewers,
    labels,
    setLabels,
    request,
    disabled: () => source().busy || !source().api,
    hint: () => (source().api ? undefined : 'Connect GitHub to change this pull request'),
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
  const teams = details.source().onBehalfOf?.[login] ?? [];
  const codeOwners = details.source().codeOwners ?? [];
  return (
    <div class={styles.row}>
      {login.includes('/') ? (
        <span class="avatar small">
          <Users size={12} />
        </span>
      ) : (
        <Avatar login={login} small />
      )}
      <span class={styles.who}>
        <span class={styles.name}>{login}</span>
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

function ReviewerPicker(props: { details: Details }) {
  const { details } = props;
  return (
    <Picker
      label="Request reviewer"
      disabled={details.disabled()}
      selected={details.reviewers.value.map(([login]) => login)}
      load={async () => {
        const { api, prRef } = details.source();
        // Personal repos have no teams, and listing them needs org read access.
        const [users, teams] = await Promise.all([api!.assignableUsers(prRef), api!.repoTeams(prRef).catch(() => [])]);
        return [
          ...users.map(user => user.login).filter(login => requestable(details.pr(), login)),
          ...teams.map(team => teamKey(details.pr(), team.slug)),
        ].map(key => ({ key, text: key }));
      }}
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
        (await details.source().api!.repoLabels(details.source().prRef)).map(label => ({
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
          <Avatar login={user.login} small />
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
            <ChevronRight size={13} class={open.value ? 'rotated' : ''} />
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
                {!checks ? (
                  <>
                    <h3>Checks</h3>
                    <Loader label="Loading checks…" />
                  </>
                ) : (
                  <button
                    class={`${styles.checks} reveal`}
                    title="Open the Checks tab"
                    aria-label="Open the Checks tab"
                    onClick={details.source().onChecks}
                  >
                    <h3>
                      Checks<span>{describeChecks(checks)}</span>
                    </h3>
                    <span class={styles.bar}>
                      {checkCounts(checks).map(([kind, count]) => (
                        <span key={kind} data-state={kind} style={{ flexGrow: count }} />
                      ))}
                    </span>
                  </button>
                )}
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
