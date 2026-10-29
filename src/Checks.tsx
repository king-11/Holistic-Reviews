import { defineComponent, shallowRef } from 'vue';
import {
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleSlash,
  CircleStop,
  CircleX,
  RefreshCw,
} from '@lucide/vue';
import { blockingStates, checkOrder, type CheckState, type GitHub, type PRRef, type StatusCheck } from './github';
import type { Mutate } from './DetailsPanel';
import { IconButton, Loader } from './ui';
import styles from './Checks.module.css';

export const checkIcons: Record<CheckState, typeof CircleCheck> = {
  success: CircleCheck,
  failure: CircleX,
  cancelled: CircleStop,
  pending: CircleDashed,
  skipped: CircleSlash,
  neutral: CircleMinus,
};
const sectionLabels: Record<CheckState, string> = {
  failure: 'Failed',
  cancelled: 'Cancelled',
  pending: 'Running',
  neutral: 'Neutral',
  success: 'Passed',
  skipped: 'Skipped',
};

// The headline tone: red once anything blocks, amber while anything still runs.
export const checksTone = (checks: StatusCheck[]) =>
  checks.some(check => blockingStates.includes(check.state))
    ? 'failure'
    : checks.some(check => check.state === 'pending')
      ? 'pending'
      : 'success';
export const checksDone = (checks: StatusCheck[]) => `${checks.filter(check => check.state !== 'pending').length}/${checks.length}`;

const duration = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

export default defineComponent(
  (props: {
    checks?: StatusCheck[];
    loading: boolean;
    prRef: PRRef;
    onMutate: Mutate;
    onChecks: (checks: StatusCheck[]) => void;
    entrance: string;
  }) => {
    // Sections the user flipped away from their default, so defaults keep following the checks as they settle.
    const flipped = shallowRef(new Set<CheckState>());
    const urgent = () => props.checks!.some(check => check.state === 'pending' || blockingStates.includes(check.state));
    const open = (state: CheckState) =>
      (state === 'success' ? !urgent() : state !== 'neutral' && state !== 'skipped') !== flipped.value.has(state);
    const flip = (state: CheckState) => {
      const next = new Set(flipped.value);
      if (!next.delete(state)) next.add(state);
      flipped.value = next;
    };
    let nextRun = 0;
    const pendingRuns = new Map<string, number>();
    // Both re-run buttons share the optimistic "Queued to rerun" mark and its token-guarded undo.
    const markRerun = (affected: StatusCheck[], toast: string, work: (api: GitHub) => Promise<unknown>) => {
      const previous = new Map(affected.map(check => [check.id, check]));
      const token = ++nextRun;
      return props.onMutate(work, {
        toast,
        refresh: 'all',
        apply: () => {
          for (const check of affected) pendingRuns.set(check.id, token);
          props.onChecks(
            (props.checks ?? []).map(check => (previous.has(check.id) ? { ...check, state: 'pending', detail: 'Queued to rerun' } : check)),
          );
          return () => {
            for (const check of affected) if (pendingRuns.get(check.id) === token) pendingRuns.delete(check.id);
            props.onChecks(
              (props.checks ?? []).map(check =>
                previous.has(check.id) && !pendingRuns.has(check.id) && check.detail === 'Queued to rerun'
                  ? previous.get(check.id)!
                  : check,
              ),
            );
          };
        },
      });
    };
    const rerun = (failedOnly: boolean) => {
      const checks = props.checks!;
      const affected = checks.filter(check => check.job && (!failedOnly || blockingStates.includes(check.state)));
      return markRerun(affected, failedOnly ? 'Re-running failed checks' : 'Re-running all checks', api =>
        api.rerunChecks(props.prRef, checks, failedOnly),
      );
    };
    const jobs = (failedOnly: boolean) => props.checks!.some(check => check.job && (!failedOnly || blockingStates.includes(check.state)));
    const row = (check: StatusCheck) => {
      const Icon = checkIcons[check.state];
      return (
        <li key={check.id}>
          <a
            class={styles.row}
            data-state={check.state}
            href={check.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${check.name}`}
          >
            <Icon size={15} class={styles.icon} />
            <strong>{check.name}</strong>
            {!!check.detail && <span>{check.detail}</span>}
            {check.seconds !== undefined && <time class={styles.duration}>{duration(check.seconds)}</time>}
            <ArrowUpRight size={13} class={styles.out} />
          </a>
          {!!check.job && (
            <IconButton
              label={`Re-run ${check.name}`}
              onClick={() => markRerun([check], `Re-running ${check.name}`, api => api.rerunJob(props.prRef, check.job!.id))}
            >
              <RefreshCw size={13} />
            </IconButton>
          )}
        </li>
      );
    };
    return () => {
      if (props.loading) return <Loader label="Loading checks…" />;
      if (!props.checks)
        return (
          <p class="load-error" role="alert">
            Checks could not be loaded.
          </p>
        );
      if (!props.checks.length) return <p class={styles.empty}>No checks reported for this commit.</p>;
      const checks = props.checks;
      const sections = checkOrder
        .map(state => ({ state, checks: checks.filter(check => check.state === state) }))
        .filter(({ checks }) => checks.length);
      return (
        <div class={props.entrance}>
          <div class={styles.toolbar}>
            <strong class={styles.total} data-state={checksTone(checks)} title="Finished checks out of all checks">
              {checksDone(checks)}
            </strong>
            <div class={styles.bar} aria-hidden="true">
              {sections.map(({ state, checks: group }) => (
                <span key={state} data-state={state} style={{ flexGrow: group.length }} />
              ))}
            </div>
            <button class="button small" disabled={!jobs(true)} onClick={() => rerun(true)}>
              <RefreshCw size={13} />
              Re-run failed checks
            </button>
            <button class="button small" disabled={!jobs(false)} onClick={() => rerun(false)}>
              Re-run all checks
            </button>
          </div>
          <div class={styles.list} role="list" aria-label="Status checks">
            {sections.map(({ state, checks: group }) => {
              const Icon = checkIcons[state];
              return (
                <section key={state} role="listitem" data-state={state}>
                  <button class={styles.section} aria-expanded={open(state)} onClick={() => flip(state)}>
                    <ChevronRight size={13} class={`chevron ${open(state) ? 'rotated' : ''}`} />
                    <Icon size={15} class={styles.icon} />
                    {sectionLabels[state]}
                    <span>{group.length}</span>
                  </button>
                  {open(state) && <ul aria-label={`${sectionLabels[state]} checks`}>{group.map(row)}</ul>}
                </section>
              );
            })}
          </div>
        </div>
      );
    };
  },
  { props: ['checks', 'loading', 'prRef', 'onMutate', 'onChecks', 'entrance'] },
);
