import { defineComponent } from 'vue';
import { motion } from 'motion-v';
import { MessageSquare, Plus, X } from '@lucide/vue';
import { drop } from './motion';
import MentionField from './MentionField';
import { IconButton, Spinner } from './ui';
import type { CommentLocation } from './comments';
import styles from './InlineComposer.module.css';

export type InlineLocation = CommentLocation & { path: string };

const lineName = (line: number, side: InlineLocation['startSide']) => `${side === 'LEFT' ? 'old' : 'new'} line ${line}`;

export default defineComponent(
  (props: {
    location: InlineLocation;
    body: string;
    pending: boolean;
    busy: boolean;
    error: string;
    canComment: boolean;
    canStartReview: boolean;
    stale: boolean;
    onBody: (body: string) => void;
    onClose: () => void;
    onPost: (startReview: boolean) => void;
  }) =>
    () => {
      const { location, busy } = props;
      const empty = !props.body.trim();
      return (
        <motion.div {...drop()} class="inline-composer" role="group" aria-label="Line comment">
          <div class={styles.heading}>
            <MessageSquare size={15} />
            <strong>{props.pending ? 'Add to your review' : location.startLine ? 'Comment on these lines' : 'Comment on this line'}</strong>
            <IconButton label="Close line comment" onClick={props.onClose} disabled={busy}>
              <X size={15} />
            </IconButton>
          </div>
          <form
            onSubmit={e => {
              e.preventDefault();
              props.onPost(false);
            }}
          >
            <MentionField
              aria-label={`Comment on ${location.path}, ${location.startLine ? `${lineName(location.startLine, location.startSide)} to ` : ''}${lineName(location.line, location.side)}`}
              class="review-textarea"
              value={props.body}
              onInput={props.onBody}
              placeholder="Leave a helpful, specific comment…"
              maxlength={65000}
              disabled={busy}
            />
            {!props.canComment && (
              <p class="error-message" role="alert">
                {props.stale
                  ? 'Your pending review is on an older commit. Discard it before adding comments.'
                  : 'Refresh this PR to load its current reviews before commenting.'}
              </p>
            )}
            {!!props.error && (
              <p class="error-message" role="alert">
                {props.error}
              </p>
            )}
            <div class={`modal-footer ${styles.actions}`}>
              <button
                class="button"
                title="Close this composer without posting a comment"
                type="button"
                onClick={props.onClose}
                disabled={busy}
              >
                Cancel
              </button>
              {!props.pending && (
                <button
                  class="button"
                  title="Publish this line comment immediately, without starting a review"
                  type="submit"
                  disabled={busy || empty || !props.canComment}
                >
                  <MessageSquare size={14} />
                  Add single comment
                </button>
              )}
              {/* Closed and merged PRs still take single comments, but GitHub reviews start only on open ones. */}
              {(props.pending || props.canStartReview) && (
                <button
                  class="button primary"
                  title={
                    props.pending
                      ? 'Add this comment to your unpublished review'
                      : 'Start a pending review with this comment; publish it when you submit the review'
                  }
                  type="button"
                  onClick={() => props.onPost(true)}
                  disabled={busy || empty || !props.canComment}
                >
                  {busy ? (
                    <Spinner text="Saving…" />
                  ) : props.pending ? (
                    'Add review comment'
                  ) : (
                    <>
                      <Plus size={14} />
                      Start a review
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </motion.div>
      );
    },
  { props: ['location', 'body', 'pending', 'busy', 'error', 'canComment', 'canStartReview', 'stale', 'onBody', 'onClose', 'onPost'] },
);
