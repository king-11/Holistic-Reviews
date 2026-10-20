import { defineComponent, type ShallowRef } from 'vue';
import { MessageSquare } from '@lucide/vue';
import type { Comment, Review } from './github';
import { ReviewIcon } from './DetailsPanel';
import { Avatar, CodeSnippet, Loader, Spinner, Timestamp } from './ui';
import Markdown from './MarkdownView';
import MentionField from './MentionField';
import { commentSnippet } from './comments';
import { CommentActions, CommentBody } from './CommentEditor';
import ReactionBar from './Reactions';
import { FileCodeIcon } from './FileIcon';
import type { PRView } from './ReviewWorkspace';
import styles from './ReviewWorkspace.module.css';

// The conversation and "Your review" tabs render the same review cards, filtered to everyone or just the viewer.
export default defineComponent(
  (props: { view: PRView; mode: 'conversation' | 'review'; draft: ShallowRef<string>; onChanges: () => void }) => {
    const {
      store,
      api,
      ws,
      ref,
      markdownBase,
      viewer,
      busy,
      mutate,
      done,
      entered,
      entrance,
      pending,
      allComments,
      visibleConversation,
      visibleReviews,
      shown,
      edits,
      reactions,
      displayFiles,
      selectFile,
      pendingSection,
    } = props.view;
    const draft = props.draft;
    async function postComment(e: SubmitEvent) {
      e.preventDefault();
      if (!draft.value.trim()) return;
      await mutate(async () => {
        const result = await api.comment(ref(), draft.value.trim());
        entered.set(`comment-${result.id}`, 'grow-in');
        store.edit('comments', prev => [...prev, result]);
        draft.value = '';
        done('Comment posted to GitHub.');
      });
    }

    const codeComment = (comment: Comment) => (
      <section class={styles['review-code-comment']}>
        <div class="flex items-center">
          <button
            class={styles['review-comment-location']}
            title={`Show the changed file ${comment.path || '(unavailable)'}`}
            onClick={() => selectFile(comment.path || '')}
          >
            <FileCodeIcon />
            {comment.path?.split('/').at(-1)}
            {comment.line ? `:${comment.line}` : ' · outdated'}
          </button>
          <CommentActions item={comment} actions={edits} />
        </div>
        <CodeSnippet
          rows={commentSnippet(
            comment,
            displayFiles.value.find(file => file.filename === comment.path),
          )}
        />
        <CommentBody item={comment} actions={edits} baseUrl={markdownBase()} />
        <ReactionBar
          comment={comment}
          actions={reactions}
          pending={!!pending.value && comment.pull_request_review_id === pending.value.id}
        />
      </section>
    );
    const reviewCard = (review: Review) => {
      const code = allComments.value.filter(comment => comment.pull_request_review_id === review.id && shown(comment));
      return (
        <div class={`conversation-comment ${entrance(`review-${review.id}`)}`} data-review-state={review.state}>
          <div class="comment-author">
            <Avatar login={review.user.login} src={review.user.avatar_url} small />
            <strong>{review.user.id === viewer().id ? 'You' : review.user.login}</strong>
            {review.state === 'PENDING' ? <span class="pending-badge">Pending</span> : <ReviewIcon review={review.state} />}
            {!!review.submitted_at && <Timestamp date={review.submitted_at} />}
            <CommentActions item={review} actions={edits} />
          </div>
          {(review.body || '').trim() ? (
            <>
              <CommentBody item={review} actions={edits} baseUrl={markdownBase()} />
              <ReactionBar comment={review} actions={reactions} pending={review.state === 'PENDING'} />
            </>
          ) : (
            review.state === 'PENDING' &&
            !code.length && <Markdown body="Review in progress. Add comments from the diff, then finish your review." />
          )}
          {code.map(codeComment)}
        </div>
      );
    };
    return () =>
      props.mode === 'review' ? (
        <div class="conversation own-review">
          <div class={styles['own-review-heading']}>
            <h3>Your review</h3>
            <p>
              {pending.value
                ? 'Your pending comments are private until you submit this review.'
                : 'Your feedback on this pull request, all in one place.'}
            </p>
          </div>
          {ws()
            .reviews.filter(review => review.user.id === viewer().id)
            .map(reviewCard)}
          {allComments.value
            .filter(
              comment => comment.user.id === viewer().id && !ws().reviews.some(review => review.id === comment.pull_request_review_id),
            )
            .map(comment => (
              <div class="conversation-comment">
                <div class="comment-author">
                  <Avatar login={comment.user.login} src={comment.user.avatar_url} small />
                  <strong>You</strong>
                  <Timestamp date={comment.created_at} />
                </div>
                {codeComment(comment)}
              </div>
            ))}
          {!ws().reviews.some(review => review.user.id === viewer().id) &&
            !allComments.value.some(comment => comment.user.id === viewer().id) && (
              <div class="empty-state">
                <MessageSquare size={26} />
                <h3>A fresh perspective starts here.</h3>
                <p>Click a line number in the diff to leave feedback, or start a review to save comments as a draft.</p>
                <button class="button" title="Return to the diff to add inline feedback" onClick={props.onChanges}>
                  Back to changes
                </button>
              </div>
            )}
        </div>
      ) : (
        <div class="conversation">
          {pendingSection('comments', 'reviews') && <Loader label="Loading conversation…" />}
          {visibleConversation.value.map(comment => (
            <div id={`conversation-comment-${comment.id}`} class={`conversation-comment ${entrance(`comment-${comment.id}`)}`}>
              <div class="comment-author">
                <Avatar login={comment.user.login} src={comment.user.avatar_url} small />
                <strong>{comment.user.login}</strong>
                <Timestamp date={comment.created_at} prefix="commented" />
                <CommentActions item={comment} actions={edits} />
              </div>
              <CommentBody item={comment} actions={edits} baseUrl={markdownBase()} />
              <ReactionBar comment={comment} actions={reactions} />
            </div>
          ))}
          {visibleReviews.value.filter(review => review.state !== 'PENDING').map(reviewCard)}
          <form class={styles['comment-form']} onSubmit={postComment}>
            <label for="pr-comment">Leave a comment</label>
            <MentionField
              id="pr-comment"
              placeholder="Share your thoughts on this pull request…"
              value={props.draft.value}
              onInput={value => (props.draft.value = value)}
              maxlength={65000}
              disabled={busy.value}
            />
            <div class={styles['comment-form-footer']}>
              <span>Posted publicly to this PR on GitHub.</span>
              <button
                class="button primary"
                title="Publish a comment to the PR conversation immediately"
                type="submit"
                disabled={busy.value || !props.draft.value.trim()}
              >
                {busy.value ? (
                  <Spinner text="Posting…" />
                ) : (
                  <>
                    <MessageSquare size={14} />
                    Comment
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      );
  },
  { props: ['view', 'mode', 'draft', 'onChanges'] },
);
