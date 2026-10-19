import { defineComponent } from 'vue';
import { motion } from 'motion-v';
import { ChevronRight, FilePenLine, GitMerge, GitPullRequest } from '@lucide/vue';
import { itemRepository, type InboxGroup, type InboxItem } from './github';
import { checkIcons } from './Checks';
import { fade } from './motion';
import { Avatar, timeAgo } from './ui';
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
          <Icon size={14} />
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
          <span class={styles.changes} aria-label={`${details.additions} lines added, ${details.deletions} removed`}>
            <span class={styles['tone-green']}>+{details.additions}</span>
            <span class={styles['tone-red']}>−{details.deletions}</span>
          </span>
        )}
      </span>
    </>
  );
}

type Props = { item: InboxItem; group: InboxGroup; viewerLogin: string; onOpen: (url: string) => void };

export default defineComponent(
  (props: Props) => () => {
    const { item, group } = props;
    return (
      <motion.button
        {...fade()}
        class="pr-row"
        title={`Review ${itemRepository(item)}#${item.number}: ${item.title}${item.draft ? ' (draft)' : ''}`}
        onClick={() => props.onOpen(item.html_url)}
      >
        <span class={`pr-row-status ${item.draft ? 'draft' : group === 'merged' ? 'merged' : ''}`}>
          {item.draft ? <FilePenLine size={17} /> : group === 'merged' ? <GitMerge size={17} /> : <GitPullRequest size={17} />}
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
            <span>{itemRepository(item).split('/').at(-1)}</span>
            <span>#{item.number}</span>
            <span class="text-xs">·</span>
            <span>{item.user.login === props.viewerLogin ? 'you' : item.user.login}</span>
          </div>
        </div>
        <RowIndicators item={item} />
        <span class="row-time">{timeAgo(item.updated_at)}</span>
        <Avatar login={item.user.login} small />
        <ChevronRight class="row-arrow" size={15} />
      </motion.button>
    );
  },
  { props: ['item', 'group', 'viewerLogin', 'onOpen'] },
);
