import { computed, defineComponent, shallowRef, watchEffect } from 'vue';
import { motion } from 'motion-v';
import { slide } from './motion';
import { ChevronDown, FileCode2, MessageSquare, PanelRightClose } from '@lucide/vue';
import type { CommentEntry, CommentFilter } from './comments';
import { commentSnippet, filterCommentEntries } from './comments';
import Markdown from './MarkdownView';
import ReviewThreadCard, { type ReplyActions } from './ReviewThread';
import { Avatar, CodeSnippet, IconButton, Loader, inputValue, timeAgo, useWidth } from './ui';
import ReactionBar from './Reactions';
import styles from './CommentsPanel.module.css';

type Props = {
  loading: boolean;
  entries: CommentEntry[];
  selectedId: number | null;
  replies: ReplyActions;
  baseUrl: string;
  hideBots: boolean;
  onClose: () => void;
  onNavigate: (entry: CommentEntry) => void;
  onResolve: (id: string, resolved: boolean) => Promise<boolean>;
};

export default defineComponent(
  (props: Props) => {
    const status = shallowRef<CommentFilter>('open');
    const reviewer = shallowRef('all');
    const reviewers = computed(() =>
      [
        ...new Set(
          props.entries.flatMap(entry =>
            entry.kind === 'thread' ? entry.comments.map(comment => comment.user.login) : [entry.comment.user.login],
          ),
        ),
      ].sort(),
    );
    watchEffect(() => {
      if (reviewer.value !== 'all' && !reviewers.value.includes(reviewer.value)) reviewer.value = 'all';
    });
    const entries = computed(() =>
      filterCommentEntries(props.entries, status.value).filter(
        entry =>
          reviewer.value === 'all' ||
          (entry.kind === 'thread'
            ? entry.comments.some(comment => comment.user.login === reviewer.value)
            : entry.comment.user.login === reviewer.value),
      ),
    );
    const hidden = () => props.entries.length - entries.value.length;
    const basename = (path: string) => path.split('/').at(-1) || path;
    const reset = () => {
      status.value = 'all';
      reviewer.value = 'all';
    };
    const thread = (entry: Extract<CommentEntry, { kind: 'thread' }>) => {
      return (
        <section
          key={entry.root.id}
          class={`comments-panel-entry ${props.selectedId === (entry.root.in_reply_to_id || entry.root.id) ? 'selected' : ''}`}
        >
          <div class={`${styles['comments-panel-location']}`}>
            <button
              title={
                entry.location === 'missing'
                  ? `File unavailable: ${entry.root.path}`
                  : `Jump to ${entry.root.path}${entry.location === 'diff' ? `:${entry.root.line}` : ' (outside the current patch)'}`
              }
              disabled={!entry.file}
              onClick={() => props.onNavigate(entry)}
            >
              <FileCode2 size={14} />
              <span>{basename(entry.root.path || 'File unavailable')}</span>
              {entry.root.line && (
                <span>
                  line {entry.root.side === 'LEFT' ? '−' : '+'}
                  {entry.root.line}
                </span>
              )}
            </button>
            {entry.location === 'missing' ? (
              <span class={`${styles['off-patch-label']}`}>File unavailable</span>
            ) : (
              entry.location === 'below' && <span class={`${styles['off-patch-label']}`}>Outside this patch</span>
            )}
            <span
              class={`comment-status-dot ${!entry.thread ? 'unknown' : entry.thread.resolved ? 'resolved' : 'open'}`}
              title={entry.thread ? (entry.thread.resolved ? 'Resolved' : 'Open') : 'Thread status unavailable'}
            />
          </div>
          <CodeSnippet rows={commentSnippet(entry.root, entry.file, 1)} />
          <div class="comments-panel-card">
            <ReviewThreadCard
              comments={entry.comments}
              root={entry.root}
              thread={entry.thread}
              replies={props.replies}
              baseUrl={props.baseUrl}
              onResolve={props.onResolve}
            />
          </div>
        </section>
      );
    };
    const { width, handle } = useWidth('comments', 408, 'left');
    return () => (
      <motion.aside {...slide(8)} class="comments-sidebar" aria-label="Pull request comments" style={{ width: `${width.value}px` }}>
        {handle('Resize comments panel')}
        <div class={`${styles['comments-panel-title']}`}>
          <div>
            <MessageSquare size={16} />
            <strong>Comments</strong>
            <span>{props.entries.length}</span>
          </div>
          <IconButton label="Hide comments panel" onClick={props.onClose}>
            <PanelRightClose size={16} />
          </IconButton>
        </div>
        <div class={`${styles['comments-panel-filters']}`}>
          <label>
            <span class="sr-only">Reviewer</span>
            <select
              aria-label="Reviewer"
              title="Filter comments by reviewer"
              value={reviewer.value}
              onChange={event => {
                reviewer.value = inputValue(event);
              }}
            >
              <option value="all">All reviewers</option>
              {reviewers.value.map(login => (
                <option key={login} value={login}>
                  {login}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label>
            <span class="sr-only">Comment status</span>
            <select
              aria-label="Comment status"
              title="Show open, resolved, or all comments"
              value={status.value}
              onChange={event => {
                status.value = inputValue(event) as CommentFilter;
              }}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        {(hidden() > 0 || props.hideBots) && (
          <div class={`${styles['comments-panel-filter-note']}`}>
            <span>
              {hidden() > 0
                ? `${hidden()} ${hidden() === 1 ? 'comment' : 'comments'} hidden by filters`
                : 'Bot comments hidden in diff settings'}
            </span>
            {hidden() > 0 && (
              <button title="Show comments from all reviewers, including resolved threads" onClick={reset}>
                Clear filters
              </button>
            )}
          </div>
        )}
        <div class={`${styles['comments-panel-list']}`}>
          {entries.value.length ? (
            entries.value.map(entry =>
              entry.kind === 'thread' ? (
                thread(entry)
              ) : (
                <section key={`c${entry.comment.id}`} class="comments-panel-entry">
                  <div class={`${styles['comments-panel-location']}`}>
                    <button title="Jump to this comment in the PR conversation" onClick={() => props.onNavigate(entry)}>
                      <MessageSquare size={14} />
                      <span>PR conversation</span>
                      <span>· {entry.comment.user.login}</span>
                    </button>
                  </div>
                  <div class="comments-panel-conversation">
                    <div class="thread-author">
                      <Avatar login={entry.comment.user.login} small />
                      <strong>{entry.comment.user.login}</strong>
                      <span>{timeAgo(entry.comment.created_at)}</span>
                    </div>
                    <Markdown body={entry.comment.body} baseUrl={props.baseUrl} />
                    <ReactionBar comment={entry.comment} actions={props.replies.reactions} />
                  </div>
                </section>
              ),
            )
          ) : props.loading ? (
            <Loader label="Loading comments…" />
          ) : (
            <div class={`${styles['comments-panel-empty']}`}>
              <MessageSquare size={23} />
              <p>No comments match these filters.</p>
              <button title="Reset the reviewer and status filters" onClick={reset}>
                Show all comments
              </button>
            </div>
          )}
        </div>
      </motion.aside>
    );
  },
  { props: ['loading', 'entries', 'selectedId', 'replies', 'baseUrl', 'hideBots', 'onClose', 'onNavigate', 'onResolve'] },
);
