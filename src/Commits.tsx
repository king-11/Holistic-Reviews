import { computed, defineComponent, shallowRef, watch } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import { pop } from './motion';
import { ArrowUpRight, ChevronDown, GitCommitHorizontal, X } from '@lucide/vue';
import type { Commit } from './github';
import { Avatar, IconButton, Spinner, Dismiss } from './ui';
import styles from './Commits.module.css';

export interface CommitRange {
  base: string;
  head: string;
}
interface CommitProps {
  commits: Commit[];
  loading: boolean;
  error: string;
  warning: string;
  base: string;
  head: string;
  value: CommitRange | null;
  busy: boolean;
  onRetry: () => void;
  onChange: (range: CommitRange | null) => Promise<boolean>;
}
const commitProps = ['commits', 'loading', 'error', 'warning', 'base', 'head', 'value', 'busy', 'onRetry', 'onChange'] as const;

export const CommitPicker = defineComponent(
  (props: CommitProps) => {
    const open = shallowRef(false);
    const base = shallowRef(props.base);
    const head = shallowRef(props.head);
    watch(
      () => [props.value, props.base, props.head],
      () => {
        base.value = props.value?.base || props.base;
        head.value = props.value?.head || props.head;
      },
    );
    const options = computed(() => {
      const rows = [
        { sha: props.base, title: 'Base', detail: props.base.slice(0, 7) },
        ...props.commits.map(commit => ({
          sha: commit.sha,
          title: commit.commit.message.split('\n')[0],
          detail: `${commit.sha.slice(0, 7)} · ${commit.commit.author ? new Date(commit.commit.author.date).toLocaleString() : 'Unknown date'}`,
        })),
      ];
      if (props.value && !rows.some(row => row.sha === props.value!.base))
        rows.splice(1, 0, { sha: props.value.base, title: 'Selected base', detail: props.value.base.slice(0, 7) });
      if (!rows.some(row => row.sha === props.head)) rows.push({ sha: props.head, title: 'Latest head', detail: props.head.slice(0, 7) });
      return rows;
    });
    const baseIndex = () => options.value.findIndex(row => row.sha === base.value);
    const headIndex = () => options.value.findIndex(row => row.sha === head.value);
    async function apply(all = false) {
      const range = all || (base.value === props.base && head.value === props.head) ? null : { base: base.value, head: head.value };
      open.value = false;
      await props.onChange(range);
    }
    const close = () => {
      open.value = false;
    };
    return () => (
      <div class="popover-anchor commit-picker-anchor">
        <button
          class={`button small ${styles['commit-picker-button']}`}
          title="Choose all PR changes, an individual commit, or a base-to-head commit range"
          aria-expanded={open.value}
          disabled={props.busy}
          onClick={() => {
            open.value = !open.value;
          }}
        >
          <GitCommitHorizontal size={15} />
          {props.value
            ? `${props.value.base === props.base ? 'Base' : props.value.base.slice(0, 7)} → ${props.value.head.slice(0, 7)}`
            : 'All commits'}
          <ChevronDown size={13} />
        </button>
        {open.value && <Dismiss onClose={close} />}
        <AnimatePresence>
          {open.value && (
            <motion.div key="commits" {...pop()} class="popover commit-popover" role="dialog" aria-label="Choose commits to compare">
              <div class={`${styles['commit-picker-heading']}`}>
                <div>
                  <strong>Commits</strong>
                  <p>Select the base on the left and head on the right.</p>
                </div>
                <IconButton label="Close commit selector" onClick={close}>
                  <X size={15} />
                </IconButton>
              </div>
              {props.loading && <Spinner text="Loading commits…" />}
              {props.error && (
                <p class="error-message" role="alert">
                  {props.error}{' '}
                  <button class="text-button" title="Retry loading the PR commit history" onClick={() => props.onRetry()}>
                    Retry
                  </button>
                </p>
              )}
              {props.warning && <p class="group-warning">{props.warning}</p>}
              <div class={`${styles['commit-range-labels']}`}>
                <span>Base</span>
                <span>Head</span>
                <span>Commit</span>
              </div>
              <div class={`max-h-100 overflow-y-auto rounded-xl border border-border`}>
                {options.value.map((row, index) => (
                  <div key={row.sha} class={`${styles['commit-range-row']}`}>
                    <label class={`${styles['commit-base-cell']}`}>
                      <input
                        type="radio"
                        name="commit-base"
                        aria-label={`Compare from ${row.title} ${row.sha.slice(0, 7)}`}
                        title={`Use ${row.sha.slice(0, 7)} as the base`}
                        checked={base.value === row.sha}
                        disabled={props.loading || index >= headIndex()}
                        onChange={() => {
                          base.value = row.sha;
                        }}
                      />
                    </label>
                    <label class={`${styles['commit-head-cell']}`}>
                      <input
                        type="radio"
                        name="commit-head"
                        aria-label={`Compare to ${row.title} ${row.sha.slice(0, 7)}`}
                        title={`Use ${row.sha.slice(0, 7)} as the head`}
                        checked={head.value === row.sha}
                        disabled={props.loading || index <= baseIndex()}
                        onChange={() => {
                          head.value = row.sha;
                        }}
                      />
                    </label>
                    <div class={`${styles['commit-range-info']}`}>
                      <strong>{row.title}</strong>
                      <small>{row.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div class="flex justify-between gap-4 pt-4">
                <button
                  class="button small"
                  title="Restore the complete, commentable pull request diff"
                  disabled={props.busy}
                  onClick={() => void apply(true)}
                >
                  All commits
                </button>
                <button
                  class="button primary small"
                  title="Show changes between the selected base and head"
                  disabled={props.loading || props.busy || baseIndex() < 0 || headIndex() <= baseIndex()}
                  onClick={() => void apply()}
                >
                  Compare changes
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
  { props: [...commitProps] },
);

export function CommitHistory(props: CommitProps) {
  return (
    <section class={`${styles['commit-history']}`}>
      <div class={`${styles['commit-history-heading']}`}>
        <div>
          <h3>Commits</h3>
          <p>Open an individual commit or select a range from the diff toolbar.</p>
        </div>
        <button
          class="button small"
          title="Reload the pull request commit history"
          disabled={props.loading || props.busy}
          onClick={() => props.onRetry()}
        >
          Refresh commits
        </button>
      </div>
      {props.loading && <Spinner text="Loading commits…" />}
      {props.error && (
        <p class="error-message" role="alert">
          {props.error}
        </p>
      )}
      {props.warning && <p class="warning-banner">{props.warning}</p>}
      {!props.loading && !props.error && !props.commits.length && <p>No commits were returned.</p>}
      {props.commits.map(commit => (
        <article key={commit.sha} class="commit-card">
          <GitCommitHorizontal size={19} />
          <div class="commit-card-info">
            <strong>{commit.commit.message.split('\n')[0]}</strong>
            <div class={`flex items-center gap-2 flex-wrap mt-2 text-muted text-xs`}>
              <Avatar login={commit.author?.login || commit.commit.author?.name || 'unknown'} src={commit.author?.avatar_url} small />
              <span>{commit.author?.login || commit.commit.author?.name || 'Unknown author'}</span>
              <time datetime={commit.commit.author?.date}>
                {commit.commit.author ? new Date(commit.commit.author.date).toLocaleString() : ''}
              </time>
              <code>{commit.sha.slice(0, 7)}</code>
            </div>
            {commit.commit.message.includes('\n') && (
              <details>
                <summary>Full commit message</summary>
                <pre>{commit.commit.message}</pre>
              </details>
            )}
          </div>
          <button
            class="button small"
            title={`View only the changes introduced by ${commit.sha.slice(0, 7)}`}
            disabled={props.busy}
            onClick={() => void props.onChange({ base: commit.parents[0]?.sha || props.base, head: commit.sha })}
          >
            View changes
          </button>
          <a
            href={commit.html_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this commit on GitHub"
            aria-label="Open commit on GitHub"
          >
            <ArrowUpRight size={15} />
          </a>
        </article>
      ))}
    </section>
  );
}
