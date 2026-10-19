import { defineComponent, onMounted, onUnmounted, shallowRef } from 'vue';
import { Check, ChevronRight, MessageSquare, RotateCcw } from '@lucide/vue';
import { errorMessage, type Comment, type ReviewThread as Thread } from './github';
import { Avatar, inputValue, timeAgo } from './ui';
import { CommentActions, CommentBody, type EditActions } from './CommentEditor';
import ReactionBar, { type ReactionActions } from './Reactions';
import styles from './ReviewThread.module.css';

export interface ReplyActions {
  reactions: ReactionActions;
  edits: EditActions;
  pendingReviewId?: number;
  canStartReview: boolean;
  disabled: boolean;
  draft: (id: number) => { body: string; error?: string };
  onChange: (id: number, body: string) => void;
  onReply: (id: number, body: string, startReview: boolean) => Promise<boolean>;
}

type Props = {
  comments: Comment[];
  root?: Comment;
  thread?: Thread;
  replies: ReplyActions;
  baseUrl?: string;
  selected?: boolean;
  onAnchor?: (id: number, element: HTMLElement | null) => void;
  onResolve: (id: string, resolved: boolean) => Promise<boolean>;
};

export default defineComponent(
  (props: Props) => {
    const element = shallowRef<HTMLElement>();
    const open = shallowRef(!props.thread?.resolved);
    const replyOpen = shallowRef(false);
    const busy = shallowRef(false);
    const error = shallowRef('');
    const root = () => props.root || props.comments[0];
    const rootId = () => root().in_reply_to_id || root().id;
    const reply = () => props.replies.draft(rootId()).body;
    const setReply = (value: string) => props.replies.onChange(rootId(), value);
    onMounted(() => props.onAnchor?.(rootId(), element.value || null));
    onUnmounted(() => props.onAnchor?.(rootId(), null));
    const pending = (comment = root()) =>
      !!props.replies.pendingReviewId && comment.pull_request_review_id === props.replies.pendingReviewId;
    const location = () =>
      root().subject_type === 'file'
        ? 'this file'
        : root().line
          ? `${root().side === 'LEFT' ? 'old ' : ''}line ${root().line}`
          : root().outdated
            ? 'an outdated diff location'
            : 'a location outside this patch';
    const status = () =>
      pending() ? 'Pending review' : props.thread ? (props.thread.resolved ? 'Resolved thread' : 'Unresolved thread') : 'Thread';
    async function changeResolution() {
      const thread = props.thread;
      if (!thread || busy.value) return;
      const next = !thread.resolved;
      busy.value = true;
      error.value = '';
      try {
        if (await props.onResolve(thread.id, next)) open.value = !next;
        else error.value = 'Could not update this thread. Check the connection and your GitHub permissions.';
      } catch {
        error.value = 'Could not update this thread. Refresh before trying again.';
      } finally {
        busy.value = false;
      }
    }
    async function postReply(startReview = false) {
      if (!reply().trim() || busy.value || props.replies.disabled) return;
      busy.value = true;
      error.value = '';
      try {
        if (await props.replies.onReply(rootId(), reply().trim(), startReview)) {
          setReply('');
          replyOpen.value = false;
        }
      } catch (failure) {
        error.value = errorMessage(failure, 'Reply could not be confirmed. Refresh before posting it again.');
      } finally {
        busy.value = false;
      }
    }
    return () => {
      const expanded = replyOpen.value || !!reply().trim(),
        locked = busy.value || props.replies.disabled;
      return (
        <section
          ref={element}
          id={props.onAnchor ? `review-thread-${rootId()}` : undefined}
          tabindex={-1}
          class={`review-thread ${props.thread?.resolved ? 'thread-resolved' : ''} ${props.selected ? styles['thread-target'] : ''}`}
        >
          <div class="review-thread-heading">
            <button
              class="thread-toggle"
              title={`${open.value ? 'Collapse' : 'Expand'} the thread on ${location()}`}
              aria-expanded={open.value}
              onClick={() => {
                open.value = !open.value;
              }}
            >
              <ChevronRight size={15} class={open.value ? 'rotated' : ''} />
              <span>
                {status()} on {location()}
              </span>
              {!open.value && <span class="text-xs text-muted bg-subtle rounded-sm py-0 px-1">{props.comments.length}</span>}
            </button>
            {!pending() && props.thread && (props.thread.resolved ? props.thread.canUnresolve : props.thread.canResolve) && (
              <button
                class="thread-resolve"
                title={props.thread.resolved ? 'Reopen this thread on GitHub' : 'Mark this thread as resolved on GitHub'}
                disabled={busy.value}
                onClick={() => void changeResolution()}
              >
                {props.thread.resolved ? <RotateCcw size={15} /> : <Check size={16} />}
                {busy.value ? 'Saving…' : props.thread.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </div>
          {open.value && (
            <>
              {props.comments.map(comment => (
                <div key={comment.id} class="thread-comment">
                  <div class="thread-author">
                    <Avatar login={comment.user.login} small />
                    <strong>{comment.user.login}</strong>
                    <time datetime={comment.created_at} title={new Date(comment.created_at).toLocaleString()}>
                      {timeAgo(comment.created_at)}
                    </time>
                    {pending(comment) && <span class="pending-badge">Pending</span>}
                    <CommentActions item={comment} actions={props.replies.edits} />
                  </div>
                  <CommentBody item={comment} actions={props.replies.edits} baseUrl={props.baseUrl} />
                  <ReactionBar comment={comment} actions={props.replies.reactions} pending={pending(comment)} />
                </div>
              ))}
              {pending() && (
                <p class={`flex items-center gap-2 text-muted text-xs ${styles['pt-2']} pb-4 px-5`}>
                  <MessageSquare size={13} />
                  This comment stays private until you finish your review.
                </p>
              )}
              <form
                class="thread-reply"
                onSubmit={(event: Event) => {
                  event.preventDefault();
                  void postReply();
                }}
              >
                <textarea
                  aria-label={`Reply to thread on ${location()}`}
                  placeholder="Reply"
                  value={reply()}
                  onFocus={() => {
                    replyOpen.value = true;
                  }}
                  onInput={event => setReply(inputValue(event))}
                  disabled={locked}
                  maxlength={65000}
                  rows={expanded ? 3 : 1}
                />
                {expanded && (
                  <div class={`${styles['thread-reply-actions']}`} role="group" aria-label="Reply actions">
                    <span>
                      Markdown supported ·{' '}
                      {props.replies.pendingReviewId
                        ? 'Added to your pending review.'
                        : props.replies.canStartReview
                          ? 'Reply now, or start a review to batch feedback.'
                          : 'Replies post immediately.'}
                    </span>
                    <button
                      class="button small"
                      title="Discard this reply without posting it"
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        setReply('');
                        replyOpen.value = false;
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      class="button primary small"
                      title={
                        props.replies.pendingReviewId
                          ? 'Save this reply in your unpublished review'
                          : 'Publish this reply immediately without starting a review'
                      }
                      type="submit"
                      disabled={locked || !reply().trim()}
                    >
                      {busy.value ? 'Saving…' : props.replies.pendingReviewId ? 'Add review reply' : 'Reply'}
                    </button>
                    {!props.replies.pendingReviewId && props.replies.canStartReview && (
                      <button
                        class="button small"
                        title="Start a pending review with this reply and batch subsequent feedback"
                        type="button"
                        disabled={locked || !reply().trim()}
                        onClick={() => void postReply(true)}
                      >
                        Start a review
                      </button>
                    )}
                  </div>
                )}
              </form>
            </>
          )}
          {(props.replies.draft(rootId()).error || error.value) && (
            <p class={`pt-0 ${styles['pb-3']} px-5 error-message`} role="alert">
              {props.replies.draft(rootId()).error || error.value}
            </p>
          )}
        </section>
      );
    };
  },
  { props: ['comments', 'root', 'thread', 'replies', 'baseUrl', 'selected', 'onAnchor', 'onResolve'] },
);
