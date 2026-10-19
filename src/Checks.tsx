import { defineComponent } from 'vue';
import { ArrowUpRight, CircleCheck, CircleDashed, CircleMinus, CircleX, RefreshCw } from '@lucide/vue';
import type { CheckState, PRRef, StatusCheck } from './github';
import type { Run } from './DetailsPanel';
import { IconButton, Loader } from './ui';
import styles from './Checks.module.css';

const icons: Record<CheckState, typeof CircleCheck> = {
  success: CircleCheck,
  failure: CircleX,
  pending: CircleDashed,
  neutral: CircleMinus,
  skipped: CircleMinus,
};

export default defineComponent(
  (props: { checks?: StatusCheck[]; loading: boolean; connected: boolean; busy: boolean; prRef: PRRef; onRun: Run }) => {
    const rerun = (failedOnly: boolean) =>
      props.onRun(failedOnly ? 'Re-running failed checks' : 'Re-running all checks', api =>
        api.rerunChecks(props.prRef, props.checks!, failedOnly),
      );
    const jobs = (failedOnly: boolean) => props.checks!.some(check => check.job && (!failedOnly || check.state === 'failure'));
    return () =>
      props.loading ? (
        <Loader label="Loading checks…" />
      ) : !props.checks ? (
        <p class="load-error" role="alert">
          Checks could not be loaded.
        </p>
      ) : !props.checks.length ? (
        <p class={styles.empty}>{props.connected ? 'No checks reported for this commit.' : 'Connect GitHub to see CI checks.'}</p>
      ) : (
        <div class="reveal">
          <div class={styles.toolbar}>
            <button class="button small" disabled={props.busy || !jobs(true)} onClick={() => rerun(true)}>
              <RefreshCw size={13} />
              Re-run failed checks
            </button>
            <button class="button small" disabled={props.busy || !jobs(false)} onClick={() => rerun(false)}>
              Re-run all checks
            </button>
          </div>
          <ul class={styles.list} aria-label="Status checks">
            {props.checks.map(check => {
              const Icon = icons[check.state];
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
                    <ArrowUpRight size={13} class={styles.out} />
                  </a>
                  {!!check.job && (
                    <IconButton
                      label={`Re-run ${check.name}`}
                      disabled={props.busy}
                      onClick={() => props.onRun(`Re-running ${check.name}`, api => api.rerunJob(props.prRef, check.job!.id))}
                    >
                      <RefreshCw size={13} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      );
  },
  { props: ['checks', 'loading', 'connected', 'busy', 'prRef', 'onRun'] },
);
