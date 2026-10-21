import { defineComponent } from 'vue';
import {
  ChevronRight,
  CircleX,
  Clock,
  FilePenLine,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Layers,
  ShieldCheck,
  TriangleAlert,
} from '@lucide/vue';
import { navigateTo } from 'nuxt/app';
import { itemRepository, prPath, type InboxGroup, type InboxItem } from './github';
import { checkIcons } from './Checks';
import { Avatar, timeAgo } from './ui';
import type { PriorityReason, PriorityResult } from './priority';
import styles from './Inbox.module.css';

type Mark = { icon: typeof GitMerge; tone: 'green' | 'red' | 'amber' | 'muted'; label: string };
const checkMarks: Record<'success' | 'failure' | 'pending', Mark> = {
  success: { icon: checkIcons.success, tone: 'green', label: 'Checks passed' },
  failure: { icon: checkIcons.failure, tone: 'red', label: 'Checks failed' },
  pending: { icon: checkIcons.pending, tone: 'amber', label: 'Checks running' },
};

const reasonIcons: Record<Exclude<PriorityReason['kind'], 'checks'>, typeof GitMerge> = {
  wait: Clock,
  commits: GitCommitHorizontal,
  stack: Layers,
  owner: ShieldCheck,
};

// Every cell keeps its width, even when empty, so the columns line up across rows.
function MarkCell(props: { name: string; mark?: Mark }) {
  const Icon = props.mark?.icon;
  return (
    <span class={`${styles.cell} ${styles[`cell-${props.name}`]}`}>
      {Icon && props.mark && (
        <span class={styles[`tone-${props.mark.tone}`]} role="img" aria-label={props.mark.label} title={props.mark.label}>
          <Icon size={16} />
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
          <>
            <span class={styles.changes} aria-label={`${details.additions} lines added, ${details.deletions} removed`}>
              <span class={styles['tone-green']}>+{details.additions}</span>
              <span class={styles['tone-red']}>−{details.deletions}</span>
            </span>
          </>
        )}
      </span>
    </>
  );
}

type Props = { item: InboxItem; group: InboxGroup; viewerLogin: string; priority?: PriorityResult };

export default defineComponent(
  (props: Props) => () => {
    const { item, group } = props;
    const [owner, repo] = itemRepository(item).split('/');
    const href = prPath({ owner, repo, number: item.number });
    return (
      <a
        class="pr-row fade-in"
        href={href}
        title={`Review ${itemRepository(item)}#${item.number}: ${item.title}${item.draft ? ' (draft)' : ''}`}
        onClick={(event: MouseEvent) => {
          // Modified and middle clicks keep the browser's open-in-new-tab behaviour.
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          void navigateTo(href);
        }}
      >
        <span class={`pr-row-status ${item.draft ? 'draft' : group === 'merged' ? 'merged' : ''}`}>
          {item.draft ? <FilePenLine size={17} /> : group === 'merged' ? <GitMerge size={17} /> : <GitPullRequest size={17} />}
        </span>
        <div class="flex-1 min-w-0">
          <div class="pr-row-title">
            {item.title}
            {!!item.details?.pendingComments && <span class="pending-badge">{item.details.pendingComments} pending</span>}
            {item.labels.slice(0, 1).map(label => (
              <span key={label.name} class="pr-label">
                {label.name}
              </span>
            ))}
          </div>
          <div class="pr-row-meta">
            <span>{itemRepository(item).split('/').at(-1)}</span>
            <span>#{item.number}</span>
            <span class="text-xs">·</span>
            <span>{item.user.login === props.viewerLogin ? 'you' : item.user.login}</span>
            {group === 'authored' && item.review === 'returned' && (
              <span class={`${styles.blocker} ${styles['tone-red']}`} role="img" aria-label="Changes requested" title="Changes requested">
                <CircleX size={14} />
                {(item.details?.changesBy ?? []).map(login => (
                  <Avatar key={login} login={login} small src={item.details?.participants.find(user => user.login === login)?.avatarUrl} />
                ))}
              </span>
            )}
            {group === 'authored' && item.details?.conflict && (
              <span class={`${styles.blocker} ${styles['tone-red']}`} role="img" aria-label="Merge conflict" title="Merge conflict">
                <TriangleAlert size={14} />
              </span>
            )}
          </div>
          {props.priority && (
            <div class={styles['priority-reasons']}>
              {props.priority.reasons.map(reason => {
                // The checks column already shows check state.
                if (reason.kind === 'checks') return null;
                const Icon = reasonIcons[reason.kind];
                const label = reason.title ? `${reason.label}. ${reason.title}` : reason.label;
                return (
                  <span key={reason.kind} class={styles['priority-reason']} role="img" aria-label={reason.label} title={label}>
                    <Icon size={13} />
                    {reason.short}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <RowIndicators item={item} />
        <span class="row-time">{timeAgo(item.updated_at)}</span>
        <Avatar login={item.user.login} src={item.user.avatar_url} small />
        <ChevronRight class="row-arrow" size={15} />
      </a>
    );
  },
  { props: ['item', 'group', 'viewerLogin', 'priority'] },
);
