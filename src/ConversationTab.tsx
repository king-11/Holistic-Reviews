import { computed, defineComponent, shallowRef, type ShallowRef } from 'vue';
import {
  FilePenLine,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Link,
  MessageSquare,
  MessageSquareText,
  Pencil,
  Tag,
  UserMinus,
  UserPlus,
  Users,
} from '@lucide/vue';
import type { Comment, Review, TimelineEvent, User } from './github';
import { ReviewIcon } from './DetailsPanel';
import { Avatar, CodeSnippet, IconButton, Loader, Timestamp } from './ui';
import Markdown from './MarkdownView';
import MentionField from './MentionField';
import { commentAnchor, commentSnippet, temporaryId } from './comments';
import { CommentActions, CommentBody } from './CommentEditor';
import ReactionBar from './Reactions';
import { FileCodeIcon } from './FileIcon';
import type { PRView } from './ReviewWorkspace';
import styles from './ReviewWorkspace.module.css';

type Entry =
  | { kind: 'comment'; date: string; comment: Comment }
  | { kind: 'review'; date: string; review: Review }
  | { kind: 'events'; date: string; events: TimelineEvent[] };
// Commits pushed together, and one person's burst of review requests or labels, read as a single line.
const sameLine = (a: TimelineEvent, b: TimelineEvent) =>
  a.event === b.event &&
  (a.event === 'committed' ||
    (['labeled', 'unlabeled', 'review_requested', 'review_request_removed'].includes(a.event) &&
      a.actor?.id === b.actor?.id &&
      Math.abs(Date.parse(a.created_at) - Date.parse(b.created_at)) < 60_000));
const time = (date?: string) => (date ? Date.parse(date) : 0);

// The conversation and "Your review" tabs render the same review cards, filtered to everyone or just the viewer.
export default defineComponent(
  (props: { view: PRView; mode: 'conversation' | 'review'; draft: ShallowRef<string>; onChanges: () => void }) => {
    const {
      store,
      ws,
      ref,
      markdownBase,
      viewer,
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
    const commentsOnly = shallowRef(false);
    const history = computed(() =>
      [
        ...visibleConversation.value.map((comment): Entry => ({ kind: 'comment', date: comment.created_at, comment })),
        ...visibleReviews.value
          .filter(review => review.state !== 'PENDING')
          .map((review): Entry => ({ kind: 'review', date: review.submitted_at ?? '', review })),
        ...(commentsOnly.value ? [] : ws().timeline).map((event): Entry => ({ kind: 'events', date: event.created_at, events: [event] })),
      ]
        .sort((a, b) => time(a.date) - time(b.date))
        .reduce<Entry[]>((entries, entry) => {
          const last = entries.at(-1);
          if (entry.kind === 'events' && last?.kind === 'events' && sameLine(last.events[0], entry.events[0]))
            last.events.push(...entry.events);
          else entries.push(entry);
          return entries;
        }, []),
    );
    const sha = (oid: string) => (
      <a
        class={styles['history-sha']}
        href={`https://github.com/${ref().owner}/${ref().repo}/commit/${oid}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open commit ${oid}`}
      >
        {oid.slice(0, 7)}
      </a>
    );
    const person = (user: User) => (
      <span class={styles['history-person']}>
        <Avatar login={user.login} src={user.avatar_url} small />
        <strong>{user.login}</strong>
      </span>
    );
    function describe(events: TimelineEvent[]) {
      const [event] = events;
      switch (event.event) {
        case 'committed':
          return [
            GitCommitHorizontal,
            <details class={styles['history-commits']} open={events.length <= 3}>
              <summary>
                <strong>{event.commit!.author}</strong> added {events.length} {events.length === 1 ? 'commit' : 'commits'}
              </summary>
              <ul>
                {events.map(({ commit }) => (
                  <li key={commit!.sha}>
                    {sha(commit!.sha)}
                    <span>{commit!.message.split('\n')[0]}</span>
                  </li>
                ))}
              </ul>
            </details>,
          ] as const;
        case 'head_ref_force_pushed':
          return [
            GitCompareArrows,
            <>
              force-pushed
              {!!event.before_commit_id && (
                <>
                  {sha(event.before_commit_id)}
                  <span aria-label="to">→</span>
                </>
              )}
              {!!event.commit_id && sha(event.commit_id)}
            </>,
          ] as const;
        case 'labeled':
        case 'unlabeled':
          return [
            Tag,
            <>
              {event.event === 'labeled' ? 'added' : 'removed'}
              {events.map(({ label }) => (
                <span class={styles['history-label']} style={{ '--label-color': `#${label!.color}` }}>
                  {label!.name}
                </span>
              ))}
            </>,
          ] as const;
        case 'renamed':
          return [
            Pencil,
            <>
              changed the title <del>{event.rename!.from}</del>
              <span aria-label="to">→</span>
              <strong>{event.rename!.to}</strong>
            </>,
          ] as const;
        case 'review_requested':
        case 'review_request_removed':
          return [
            event.event === 'review_requested' ? UserPlus : UserMinus,
            <>
              {event.event === 'review_requested' ? 'requested review from' : 'removed the review request for'}
              {events.map(({ requested_reviewer, requested_team }) =>
                requested_reviewer ? (
                  person(requested_reviewer)
                ) : (
                  <span class={styles['history-person']}>
                    <Users size={14} />
                    <strong>{requested_team?.name}</strong>
                  </span>
                ),
              )}
            </>,
          ] as const;
        case 'merged':
          return [GitMerge, <>merged {!!event.commit_id && sha(event.commit_id)}</>] as const;
        case 'cross-referenced':
          return [
            Link,
            <>
              mentioned this in
              <a href={event.source?.issue?.html_url} target="_blank" rel="noopener noreferrer">
                {event.source?.issue?.title} #{event.source?.issue?.number}
              </a>
            </>,
          ] as const;
        case 'ready_for_review':
          return [GitPullRequest, 'marked this ready for review'] as const;
        case 'convert_to_draft':
          return [FilePenLine, 'marked this as draft'] as const;
        case 'closed':
          return [GitPullRequestClosed, 'closed this'] as const;
        case 'reopened':
          return [GitPullRequest, 'reopened this'] as const;
        case 'head_ref_deleted':
          return [GitBranch, 'deleted the head branch'] as const;
      }
    }
    const eventLine = (events: TimelineEvent[]) => {
      const [Icon, text] = describe(events);
      return (
        <li key={events[0].id} class={styles['history-event']} data-event={events[0].event}>
          <span class={styles['history-marker']}>
            <Icon size={14} />
          </span>
          <div class={styles['history-line']}>
            {!!events[0].actor && events[0].event !== 'committed' && person(events[0].actor)}
            {text}
            <Timestamp date={events.at(-1)!.created_at} />
          </div>
        </li>
      );
    };
    const card = (key: string, user: User, content: unknown) => (
      <li key={key} class={styles['history-card']}>
        <span class={styles['history-marker']}>
          <Avatar login={user.login} src={user.avatar_url} />
        </span>
        {content}
      </li>
    );
    async function postComment(e: SubmitEvent) {
      e.preventDefault();
      if (!draft.value.trim()) return;
      const text = draft.value.trim();
      const previous = draft.value;
      const optimistic: Comment = { id: temporaryId(), body: text, user: viewer(), created_at: new Date().toISOString() };
      await mutate(
        async github => {
          const result = await github.comment(ref(), text);
          props.view.replaceLocalComment(optimistic, result);
          entered.set(`comment-${result.id}`, 'grow-in');
          done('Comment posted to GitHub.');
        },
        {
          apply: () => {
            store.edit('comments', prev => [...prev, optimistic]);
            props.view.recordWrittenComment(optimistic);
            entered.set(`comment-${optimistic.id}`, 'grow-in');
            draft.value = '';
            return () => {
              store.edit('comments', prev => prev.filter(comment => comment.id !== optimistic.id));
              props.view.forgetWrittenComment(optimistic);
              if (!draft.value) draft.value = previous;
            };
          },
        },
      );
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
        <div id={commentAnchor(review)} class={`conversation-comment ${entrance(`review-${review.id}`)}`} data-review-state={review.state}>
          <div class="comment-author">
            <Avatar login={review.user.login} src={review.user.avatar_url} small />
            <strong>{review.user.id === viewer().id ? 'You' : review.user.login}</strong>
            {review.state === 'PENDING' ? <span class="pending-badge">Pending</span> : <ReviewIcon review={review.state} />}
            {!!review.submitted_at && <Timestamp date={review.submitted_at} href={edits.link(review)} />}
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
          <div class={styles['history-toolbar']}>
            <IconButton
              label={commentsOnly.value ? 'Show all activity' : 'Show only comments and reviews'}
              active={commentsOnly.value}
              onClick={() => (commentsOnly.value = !commentsOnly.value)}
            >
              <MessageSquareText size={14} />
            </IconButton>
          </div>
          <ol class={styles.history} aria-label="Pull request history">
            {history.value.map(entry =>
              entry.kind === 'events'
                ? eventLine(entry.events)
                : entry.kind === 'review'
                  ? card(`review-${entry.review.id}`, entry.review.user, reviewCard(entry.review))
                  : card(
                      `comment-${entry.comment.id}`,
                      entry.comment.user,
                      <div id={commentAnchor(entry.comment)} class={`conversation-comment ${entrance(`comment-${entry.comment.id}`)}`}>
                        <div class="comment-author">
                          <Avatar login={entry.comment.user.login} src={entry.comment.user.avatar_url} small />
                          <strong>{entry.comment.user.login}</strong>
                          <ReviewIcon review="COMMENTED" />
                          <Timestamp date={entry.comment.created_at} href={edits.link(entry.comment)} />
                          <CommentActions item={entry.comment} actions={edits} />
                        </div>
                        <CommentBody item={entry.comment} actions={edits} baseUrl={markdownBase()} />
                        <ReactionBar comment={entry.comment} actions={reactions} />
                      </div>,
                    ),
            )}
          </ol>
          <form class={styles['comment-form']} onSubmit={postComment}>
            <label for="pr-comment">Leave a comment</label>
            <MentionField
              id="pr-comment"
              placeholder="Share your thoughts on this pull request…"
              value={props.draft.value}
              onInput={value => (props.draft.value = value)}
              maxlength={65000}
            />
            <div class={styles['comment-form-footer']}>
              <span>Posted publicly to this PR on GitHub.</span>
              <button
                class="button primary"
                title="Publish a comment to the PR conversation immediately"
                type="submit"
                disabled={!props.draft.value.trim()}
              >
                <MessageSquare size={14} />
                Comment
              </button>
            </div>
          </form>
        </div>
      );
  },
  { props: ['view', 'mode', 'draft', 'onChanges'] },
);
