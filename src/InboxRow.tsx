import { defineComponent } from 'vue';
import { ChevronRight, CircleX, GitMerge, Layers, ShieldCheck, TriangleAlert, User, Users } from '@lucide/vue';
import { navigateTo } from 'nuxt/app';
import { itemRepository, prPath, type InboxGroup, type InboxItem } from './github';
import { checkIcons } from './Checks';
import { Avatar, timeAgo } from './ui';
import { elapsedLabel, type PriorityResult } from './priority';
import styles from './Inbox.module.css';

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
          <Icon size={16} />
        </span>
      )}
    </span>
  );
}

function RowIndicators(props: { item: InboxItem; group: InboxGroup }) {
  const details = props.item.details;
  const participants = details?.participants ?? [];
  const stacked = details?.priority.stackedReady ?? 0;
  const label = `${stacked} ready stacked on this`;
  return (
    <>
      {props.group === 'authored' && (
        <span class={`${styles.cell} ${styles['cell-bubbles']}`} title={participants.map(user => user.login).join(', ')}>
          {participants.slice(0, 4).map(user => (
            <Avatar key={user.login} login={user.login} small src={user.avatarUrl} />
          ))}
          {!!details && details.participantCount > 4 && <span class={styles.more}>+{details.participantCount - 4}</span>}
        </span>
      )}
      <span class={`${styles.cell} ${styles['cell-stack']}`}>
        {stacked > 0 && (
          <span class={styles['priority-reason']} role="img" aria-label={label} title={label}>
            <Layers size={14} />
            {stacked}
          </span>
        )}
      </span>
      <span class={`${styles.cell} ${styles['cell-owner']}`}>
        {details?.priority.codeOwner && (
          <span class={styles['priority-reason']} role="img" aria-label="Code owner" title="Code owner">
            <ShieldCheck size={14} />
          </span>
        )}
      </span>
      <span class={`${styles.cell} ${styles['cell-changes']}`}>
        {!!details && (
          <span class={styles.changes} aria-label={`${details.additions} lines added, ${details.deletions} removed`}>
            <span class={styles['tone-green']}>+{details.additions}</span>
            <span class={styles['tone-red']}>−{details.deletions}</span>
          </span>
        )}
      </span>
      <MarkCell name="checks" mark={details?.checks ? checkMarks[details.checks] : undefined} />
    </>
  );
}

type Props = { item: InboxItem; group: InboxGroup; viewerLogin: string; priority?: PriorityResult };

export default defineComponent(
  (props: Props) => () => {
    const { item, group } = props;
    const [owner, repo] = itemRepository(item).split('/');
    const href = prPath({ owner, repo, number: item.number });
    const details = item.details;
    const waiting = props.priority && details ? `Review requested ${elapsedLabel(details.priority.waitStart, new Date())} ago` : undefined;
    const RequestedIcon = group === 'team' ? Users : User;
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
        <Avatar login={item.user.login} src={item.user.avatar_url} />
        <div class="flex-1 min-w-0">
          <div class="pr-row-title">
            <span class="pr-row-title-text">{item.title}</span>
            {item.labels.slice(0, 1).map(label => (
              <span key={label.name} class="pr-label">
                {label.name}
              </span>
            ))}
          </div>
          <div class="pr-row-meta">
            <span>{item.user.login === props.viewerLogin ? 'you' : item.user.login}</span>
            <span class="text-xs">·</span>
            <span>
              {itemRepository(item).split('/').at(-1)} #{item.number}
            </span>
            <span class="text-xs">·</span>
            {waiting ? (
              <span class={styles['priority-reason']} role="img" aria-label={waiting} title={waiting}>
                <RequestedIcon size={13} />
                {elapsedLabel(details!.priority.waitStart, new Date())}
              </span>
            ) : (
              <span title={`Updated ${timeAgo(item.updated_at)}`}>{timeAgo(item.updated_at)}</span>
            )}
          </div>
        </div>
        {group === 'authored' && item.review === 'returned' && (
          <span class={`${styles.blocker} ${styles['tone-red']}`} role="img" aria-label="Changes requested" title="Changes requested">
            <CircleX size={14} />
            {(details?.changesBy ?? []).map(login => (
              <Avatar key={login} login={login} small src={details?.participants.find(user => user.login === login)?.avatarUrl} />
            ))}
          </span>
        )}
        {group === 'authored' && details?.conflict && (
          <span class={`${styles.blocker} ${styles['tone-red']}`} role="img" aria-label="Merge conflict" title="Merge conflict">
            <TriangleAlert size={14} />
          </span>
        )}
        <RowIndicators item={item} group={group} />
        <ChevronRight class="row-arrow" size={15} />
      </a>
    );
  },
  { props: ['item', 'group', 'viewerLogin', 'priority'] },
);
