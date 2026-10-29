import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  provide,
  shallowRef,
  watch,
  watchEffect,
  type ComputedRef,
  type ShallowRef,
} from 'vue';
import { createShortcuts, modalOpen, step } from './shortcuts';
import { AnimatePresence, motion } from 'motion-v';
import { drop, rise } from './motion';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Columns2,
  GitCommitHorizontal,
  List,
  MessageSquare,
  MessagesSquare,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from '@lucide/vue';
import {
  branchRelations,
  errorMessage,
  mergeabilityPending,
  prPath,
  teamKey,
  type ChangedFile,
  type Comment,
  type Commit,
  type Comparison,
  type GitHub,
  type MergeMethod,
  type PRRef,
  type PullRequest,
  type Workspace,
  type Review,
  type ReviewCommentInput,
  type TokenInfo,
  type User,
  type WorkspaceSection,
} from './github';
import FileTree from './FileTree';
import Checks, { checksDone, checksTone } from './Checks';
import DetailsPanel, { MergeControls, MoreMenu, mergeOffered, reviewApproved, useDetails, type Details, type Mutate } from './DetailsPanel';
import DiffView, { type ContextLoader, type DiffSettings } from './DiffView';
import { IconButton, Loader, Modal, SearchField, Spinner, inputValue, update, Dismiss } from './ui';
import MentionField from './MentionField';
import { peopleDirectory, peopleKey } from './people';
import { markInboxStale, recordPR } from './inboxUpdates';
import { createChangeViews, createSnapshotStore } from './snapshots';
import { toggleViewedFiles, verifiedContextLines } from './diff';
import {
  commentEntries,
  commentLocationLabel,
  commentRange,
  diffLinePreview,
  commentAnchor,
  isBot,
  parseCommentAnchor,
  mergePendingComments,
  temporaryId,
  withThreadLocations,
  type CommentEntry,
  type LinePoint,
} from './comments';
import CommentsPanel from './CommentsPanel';
import InlineComposer, { type InlineLocation } from './InlineComposer';
import type { ReplyActions } from './ReviewThread';
import type { PRWorkspace } from './prWorkspace';
import { CommentActions, CommentBody, isReview, type EditActions, type Editable } from './CommentEditor';
import { createReactionActions, type ReactionActions } from './Reactions';
import PRHeader from './PRHeader';
import ConversationTab from './ConversationTab';
import { CommitHistory, CommitPicker, type CommitRange } from './Commits';
import { FileCodeIcon } from './FileIcon';
import { filterFiles, type FileStatus } from './file_filters';
import { enqueueMutation, mutationBusy, showMutationFailure } from './session';
import { registerPRCommands } from './commandRegistry';
import { commandDefinitions, type CommandContext } from './shortcuts';
import styles from './ReviewWorkspace.module.css';
import switchStyles from './switch.module.css';

type WrittenCommentChange = { removeId?: number; previousId?: number; comment?: Comment };
type WrittenReviewChange = { removeId?: number; previousId?: number; review?: Review };
const commentWrites = createSnapshotStore<{ comment: Comment; at: number }>();
const reviewWrites = createSnapshotStore<{ review: Review; at: number }>();
const removedComments = createSnapshotStore<{ at: number }>();
const commentViews = createChangeViews<WrittenCommentChange>();
const reviewViews = createChangeViews<WrittenReviewChange>();

const removedCommentIdsForPR = (url: string, now = Date.now()) => new Set(removedComments.live(url, now).map(([id]) => id));
const rememberRemovedComment = (url: string, id: number, at = Date.now()) => removedComments.set(url, id, { at });
const forgetRemovedComment = (url: string, id: number) => removedComments.remove(url, id);

const writtenReviewsForPR = (url: string, now = Date.now()) => reviewWrites.live(url, now).map(([, entry]) => entry);
const mergeWrittenReviews = (url: string, loaded: Review[]) => {
  const entries = writtenReviewsForPR(url);
  if (!entries.length) return loaded;
  const merged = [...loaded];
  for (const entry of entries) {
    const id = entry.review.id;
    const serverReview = loaded.find(review => review.id === id);
    if (serverReview) {
      // A lagging read can still list the just-submitted review as PENDING.
      if (serverReview.state === 'PENDING' && entry.review.state !== 'PENDING') merged[merged.indexOf(serverReview)] = entry.review;
      else if (serverReview !== entry.review) reviewWrites.remove(url, id);
      continue;
    }
    merged.push(entry.review);
  }
  return merged;
};
const recordWrittenReview = (url: string, review: Review, previousId?: number) => {
  if (previousId !== undefined) reviewWrites.remove(url, previousId);
  reviewWrites.set(url, review.id, { review, at: Date.now() });
  reviewViews.notify(url, { previousId, review });
};
const forgetWrittenReview = (url: string, id: number) => {
  reviewWrites.remove(url, id);
  reviewViews.notify(url, { removeId: id });
};

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
type Dialog = 'review' | 'inline' | 'discard' | null;

// What the layout shell shares with the header and tabs it renders; all PR data reads through `store`.
export interface PRView {
  store: PRWorkspace;
  api: GitHub;
  ws: () => Workspace;
  pr: () => PullRequest;
  ref: () => PRRef;
  prUrl: (number: number) => string;
  markdownBase: () => string;
  viewer: () => User;
  busy: ShallowRef<boolean>;
  mutate: Mutate;
  done: (message: string, warning?: string) => void;
  copy: (label: string, text: string) => Promise<void>;
  entered: Map<string, string>;
  entrance: (key: string) => string;
  details: Details;
  approved: () => boolean;
  relations: ComputedRef<ReturnType<typeof branchRelations>>;
  stalePending: () => boolean;
  pendingSection: (...sections: WorkspaceSection[]) => boolean;
  pending: ComputedRef<Review | undefined>;
  allComments: ComputedRef<Comment[]>;
  visibleConversation: ComputedRef<Comment[]>;
  visibleReviews: ComputedRef<Review[]>;
  shown: (item: { user: User }) => boolean;
  edits: EditActions;
  reactions: ReactionActions;
  recordWrittenComment: (comment: Comment, previousId?: number) => void;
  forgetWrittenComment: (comment: Comment) => void;
  replaceLocalComment: (temporary: Comment, comment: Comment) => Comment;
  displayFiles: ComputedRef<ChangedFile[]>;
  selectFile: (filename: string) => void;
}

type Props = {
  store: PRWorkspace;
  api: GitHub;
  info: TokenInfo;
  settings: DiffSettings;
  onSettings: (settings: DiffSettings) => void;
  onOpen: (url: string) => void;
  onBack: () => void;
  // The URL hash, which can point at a comment to open.
  hash: string;
};

export default defineComponent(
  (props: Props) => {
    const ws = () => props.store.current();
    const pr = () => ws().pr;
    const ref = (): PRRef => {
      const [owner, repo] = (pr().base.repo?.full_name || '').split('/');
      return { owner, repo, number: pr().number };
    };
    const prUrl = (number: number) => `https://github.com/${ref().owner}/${ref().repo}/pull/${number}`;
    const markdownBase = () => `${pr().html_url.replace(/\/pull\/\d+(?:\/.*)?$/, '')}/blob/${pr().head.sha}/`;
    const viewer = () => props.info.user;
    // Submitting a review or single inline comment satisfies direct and team requests before GitHub's reread catches up.
    const clearOwnRequest = () => {
      const requestedReviewers = pr().requested_reviewers;
      const requestedTeams = pr().requested_teams;
      const nextReviewers = requestedReviewers?.filter(user => user.login !== viewer().login);
      const teams = props.info.teams ?? [];
      const nextTeams = requestedTeams?.filter(entry => !teams.includes(teamKey(pr(), entry.slug)));
      const cleared: Partial<PullRequest> = {};
      if (requestedReviewers && nextReviewers?.length !== requestedReviewers.length) cleared.requested_reviewers = nextReviewers;
      if (requestedTeams && nextTeams?.length !== requestedTeams.length) cleared.requested_teams = nextTeams;
      if (Object.keys(cleared).length) return props.store.applyPR(cleared);
    };
    const ownPR = () => pr().user.id === viewer().id;
    const pendingSection = (...sections: WorkspaceSection[]) => sections.some(section => ws().pending.includes(section));
    const tab = shallowRef<'changes' | 'conversation' | 'review' | 'commits' | 'checks'>('changes');
    let active = true;
    onUnmounted(() => (active = false));

    const people = computed(() => peopleDirectory(ref(), props.api));
    provide(peopleKey, () => people.value);
    // Everyone already on this PR is who reviewers and mentions most likely want, before any search.
    watchEffect(() =>
      people.value.seed(
        [
          pr().user,
          ...(pr().requested_reviewers ?? []),
          ...(pr().assignees ?? []),
          ...[...ws().comments, ...ws().inlineComments, ...ws().reviews].map(item => item.user),
          viewer(),
        ].map(user => ({ login: user.login, avatarUrl: user.avatar_url })),
      ),
    );
    const pending = computed(() => ws().reviews.find(review => review.user.id === viewer().id && review.state === 'PENDING'));
    const stalePending = () => !!pending.value && pending.value?.commit_id !== pr().head.sha;
    const canReview = () => ws().reviewsLoaded && pr().state === 'open';
    const canReply = () => ws().reviewsLoaded && !stalePending();
    const mergeReviews = (loaded: Review[]) => {
      const merged = mergeWrittenReviews(pr().html_url, loaded);
      if (merged.length !== loaded.length || merged.some((review, index) => review !== loaded[index]))
        props.store.patch({ reviews: merged });
      return merged;
    };
    const unregisterWrittenReviewView = reviewViews.subscribe(pr().html_url, change => {
      if (change.removeId !== undefined) props.store.edit('reviews', previous => previous.filter(review => review.id !== change.removeId));
      if (change.previousId !== undefined)
        props.store.edit('reviews', previous => previous.filter(review => review.id !== change.previousId));
      if (change.review)
        props.store.edit('reviews', previous =>
          previous.some(review => review.id === change.review!.id)
            ? previous.map(review => (review.id === change.review!.id ? change.review! : review))
            : [...previous, change.review!],
        );
      const reviews = mergeReviews(ws().reviews);
      if (ws().reviewsLoaded) recordPR(pr(), reviews, ws().inlineComments, viewer().login, props.info.teams);
    });
    onUnmounted(unregisterWrittenReviewView);
    // The kept-alive inbox corrects this PR's row from what this page knows, ahead of GitHub search catching up.
    watchEffect(() => {
      if (ws().reviewsLoaded) {
        const reviews = mergeReviews(ws().reviews);
        recordPR(pr(), reviews, ws().inlineComments, viewer().login, props.info.teams);
      }
    });

    // One flag for every write: App also reads it to hold navigation until the write lands.
    const busy = mutationBusy;
    const error = shallowRef('');
    const notice = shallowRef('');
    const syncInbox = () => {
      if (ws().reviewsLoaded) recordPR(pr(), ws().reviews, ws().inlineComments, viewer().login, props.info.teams);
    };

    const toast = shallowRef({ id: 0, message: '', tone: 'ok' as 'ok' | 'error' });
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const showToast = (message: string, tone: 'ok' | 'error' = 'ok') => {
      // A fresh key per message makes each one enter again, so a repeated action visibly registers.
      toast.value = { id: toast.value.id + 1, message, tone };
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.value = { ...toast.value, message: '' }), Math.max(2000, message.length * 60));
    };
    // Confirmations float in the toast so nothing in the page shifts; only warnings stay in the banner until dismissed.
    const done = (message: string, warning = '') => (warning ? (notice.value = message + warning) : showToast(message));
    // Content fades in when its data first arrives; revisiting a tab shows it as it was.
    const entered = new Map<string, string>();
    const entrance = (key: string) => (entered.has(key) ? entered.get(key)! : (entered.set(key, 'reveal'), 'reveal'));
    watch(tab, () => entered.forEach((_, key) => entered.set(key, '')));
    onUnmounted(() => clearTimeout(toastTimer));
    const appLink = () => window.location.origin + prPath(ref());
    const copy = (label: string, text: string) =>
      navigator.clipboard.writeText(text).then(
        () => showToast(`Copied ${label}`),
        () => showToast('Clipboard unavailable in this browser', 'error'),
      );
    const mutate: Mutate = (work, { toast, refresh = 'pr', apply } = {}) => {
      let undo: (() => void) | undefined;
      try {
        error.value = '';
        notice.value = '';
        undo = apply?.();
        syncInbox();
      } catch (failure) {
        const message = errorMessage(failure, 'GitHub could not complete this action.');
        if (toast) showToast(message, 'error');
        else if (active) error.value = message;
        return Promise.resolve(false);
      }
      return enqueueMutation(async () => {
        try {
          await work(props.api);
          markInboxStale(pr().html_url);
          if (toast && active) showToast(toast);
          if (active && refresh !== 'none') props.store.refresh(refresh);
          return true;
        } catch (failure) {
          undo?.();
          syncInbox();
          const message = errorMessage(failure, 'GitHub could not complete this action.');
          if (!active) showMutationFailure(ref(), message);
          else if (toast) showToast(message, 'error');
          else if (active) error.value = message;
          return false;
        }
      });
    };

    const editedPendingBodies = new Map<number, string>();
    const recordWrittenComment = (comment: Comment, previousId?: number, at = Date.now()) => {
      if (previousId !== undefined) commentWrites.remove(pr().html_url, previousId);
      commentWrites.set(pr().html_url, comment.id, { comment, at });
      commentViews.notify(pr().html_url, { previousId, comment });
    };
    const sameTemporaryComment = (temporary: Comment, comment: Comment) =>
      temporary.id < 0 &&
      temporary.path === comment.path &&
      temporary.body === comment.body &&
      (temporary.line === comment.line || comment.line == null);
    function writtenCommentsFor(loaded: Comment[]) {
      const url = pr().html_url;
      for (const [id, entry] of commentWrites.live(url)) {
        const match =
          loaded.find(comment => comment.id === entry.comment.id) ||
          (entry.comment.id < 0 ? loaded.find(comment => sameTemporaryComment(entry.comment, comment)) : undefined);
        if (!match) continue;
        const confirmed =
          entry.comment.id < 0
            ? {
                ...entry.comment,
                ...match,
                id: match.id,
                path: match.path ?? entry.comment.path,
                line: match.line ?? entry.comment.line,
                side: match.side ?? entry.comment.side,
                start_line: match.start_line ?? entry.comment.start_line,
                start_side: match.start_side ?? entry.comment.start_side,
                pull_request_review_id: match.pull_request_review_id ?? entry.comment.pull_request_review_id,
              }
            : { ...match, ...entry.comment, id: match.id };
        if (match.id !== id) commentWrites.remove(url, id);
        commentWrites.set(url, match.id, { comment: confirmed, at: entry.at });
      }
      return commentWrites.live(url).map(([, entry]) => entry);
    }
    const forgetWrittenComments = (reviewId: number) => {
      const url = pr().html_url;
      for (const [id, entry] of commentWrites.live(url))
        if (entry.comment.pull_request_review_id === reviewId) {
          commentWrites.remove(url, id);
          commentViews.notify(url, { removeId: id });
        }
    };
    let draftLoadVersion = 0;
    async function loadPendingComments(review: Review, fresh = false) {
      if (review.id < 0) return;
      const version = ++draftLoadVersion;
      const result = await (fresh ? props.api.fresh() : props.api).reviewComments(review);
      if (active && version === draftLoadVersion && pending.value?.id === review.id) {
        const written = writtenCommentsFor(result).filter(entry => entry.comment.pull_request_review_id === review.id);
        props.store.patch({
          draftComments: mergePendingComments(
            result,
            ws().draftComments,
            editedPendingBodies,
            written,
            removedCommentIdsForPR(pr().html_url),
          ),
        });
      }
    }
    watchEffect(() => {
      const review = pending.value;
      if (review)
        void loadPendingComments(review).catch(error => {
          if (active) notice.value = `Pending comments could not be loaded: ${errorMessage(error, String(error))}`;
        });
    });
    const unregisterWrittenComments = commentViews.subscribe(pr().html_url, change => {
      if (change.removeId !== undefined)
        for (const key of ['draftComments', 'inlineComments', 'comments'] as const)
          props.store.edit(key, prev => prev.filter(comment => comment.id !== change.removeId));
      if (change.previousId !== undefined && change.comment)
        for (const key of ['draftComments', 'inlineComments', 'comments'] as const)
          props.store.edit(key, prev => prev.map(comment => (comment.id === change.previousId ? change.comment! : comment)));
      const loadedDrafts = ws().draftComments;
      const pendingReview = pending.value;
      if (pendingReview) {
        const written = writtenCommentsFor(loadedDrafts).filter(entry => entry.comment.pull_request_review_id === pendingReview.id);
        props.store.patch({
          draftComments: mergePendingComments(
            loadedDrafts,
            loadedDrafts,
            editedPendingBodies,
            written,
            removedCommentIdsForPR(pr().html_url),
          ),
        });
      }
      const loadedInline = ws().inlineComments;
      const pendingId = pending.value?.id;
      const written = writtenCommentsFor(loadedInline).filter(
        entry => !entry.comment.pull_request_review_id || entry.comment.pull_request_review_id !== pendingId,
      );
      props.store.patch({
        inlineComments: mergePendingComments(
          loadedInline,
          loadedInline,
          editedPendingBodies,
          written,
          removedCommentIdsForPR(pr().html_url),
        ),
      });
    });
    onUnmounted(unregisterWrittenComments);
    watchEffect(() => {
      const loaded = ws().inlineComments;
      const currentPending = pending.value?.id;
      const written = writtenCommentsFor(loaded).filter(
        entry => !entry.comment.pull_request_review_id || entry.comment.pull_request_review_id !== currentPending,
      );
      const merged = mergePendingComments(loaded, loaded, editedPendingBodies, written, removedCommentIdsForPR(pr().html_url));
      if (merged.length !== loaded.length || merged.some((comment, index) => comment.id !== loaded[index]?.id))
        props.store.patch({ inlineComments: merged });
    });
    watchEffect(() => {
      const loaded = ws().comments;
      const written = writtenCommentsFor(loaded).filter(entry => !entry.comment.path && !entry.comment.pull_request_review_id);
      const merged = mergePendingComments(loaded, loaded, editedPendingBodies, written, removedCommentIdsForPR(pr().html_url));
      if (merged.length !== loaded.length || merged.some((comment, index) => comment.id !== loaded[index]?.id))
        props.store.patch({ comments: merged });
    });
    async function refreshThreads() {
      try {
        const result = await props.api.fresh().reviewThreads(ref());
        if (active) props.store.patch({ reviewThreads: result.items });
        return result.truncated ? ' Some thread statuses are unavailable. Open GitHub for the rest.' : '';
      } catch {
        return ' Feedback saved, but thread status could not be refreshed. Refresh the PR before resolving new threads.';
      }
    }

    const allComments = computed(() =>
      withThreadLocations(
        [...ws().draftComments, ...ws().inlineComments].filter(
          (item, index, array) => array.findIndex(other => other.id === item.id) === index,
        ),
        ws().reviewThreads,
      ),
    );
    const pendingComments = computed(() => withThreadLocations(ws().draftComments, ws().reviewThreads));
    const shown = (item: { user: User }) => !props.settings.hideBotComments || !isBot(item.user);
    const panelEntries = computed(() =>
      commentEntries(ws().files, allComments.value, ws().comments, ws().reviewThreads, props.settings.hideBotComments),
    );
    const visibleConversation = computed(() => ws().comments.filter(shown));
    const visibleReviews = computed(() => ws().reviews.filter(shown));

    const moderator = shallowRef(false);
    onMounted(
      () =>
        void props.api.canModerate(ref()).then(
          value => (moderator.value = value),
          () => {},
        ),
    );
    const withBody = <T extends { id: number }>(list: T[], id: number, body?: string) =>
      body === undefined ? list.filter(item => item.id !== id) : list.map(item => (item.id === id ? { ...item, body } : item));
    const currentBody = (item: Editable) => {
      const list = isReview(item) ? ws().reviews : [...ws().comments, ...ws().inlineComments, ...ws().draftComments];
      return list.find(other => other.id === item.id)?.body;
    };
    const changeComment = (item: Editable, body?: string) => {
      if (isReview(item)) props.store.edit('reviews', prev => withBody(prev, item.id, body));
      else if (!item.path && !item.pull_request_review_id) props.store.edit('comments', prev => withBody(prev, item.id, body));
      else {
        props.store.edit('inlineComments', prev => withBody(prev, item.id, body));
        props.store.edit('draftComments', prev => withBody(prev, item.id, body));
      }
    };
    const forgetWrittenComment = (comment: Comment) => {
      commentWrites.remove(pr().html_url, comment.id);
      commentViews.notify(pr().html_url, { removeId: comment.id });
    };
    const removeLocalComment = (comment: Comment) => {
      for (const key of ['draftComments', 'inlineComments', 'comments'] as const)
        props.store.edit(key, prev => prev.filter(other => other.id !== comment.id));
      forgetWrittenComment(comment);
    };
    const replaceLocalComment = (temporary: Comment, comment: Comment) => {
      const confirmed = { ...temporary, ...comment, user: comment.user ?? temporary.user };
      for (const key of ['draftComments', 'inlineComments', 'comments'] as const)
        props.store.edit(key, prev => prev.map(other => (other.id === temporary.id ? confirmed : other)));
      recordWrittenComment(confirmed, temporary.id);
      return confirmed;
    };
    const updateWrittenComments = (updateComment: (comment: Comment) => Comment) => {
      const url = pr().html_url;
      for (const [id, entry] of commentWrites.live(url)) commentWrites.set(url, id, { ...entry, comment: updateComment(entry.comment) });
    };
    const inPendingReview = (item: Editable) => !isReview(item) && !!pending.value && item.pull_request_review_id === pending.value.id;
    const edits: EditActions = {
      can: item =>
        (moderator.value || item.user.id === viewer().id) && (!isReview(item) || (item.state !== 'PENDING' && !!item.body?.trim())),
      disabled: () => false,
      save: (item, text) => {
        const body = text.trim();
        const pendingEdit = inPendingReview(item);
        const previousBody = item.body;
        return mutate(
          async api => {
            await (isReview(item) ? api.editReview(ref(), item.id, body) : api.editComment(ref(), item, body, pendingEdit));
            done('Comment updated on GitHub.');
          },
          {
            apply: () => {
              if (pendingEdit) {
                ++draftLoadVersion;
                editedPendingBodies.set(item.id, body);
              }
              changeComment(item, body);
              return () => {
                if (currentBody(item) !== body) return;
                if (pendingEdit) {
                  ++draftLoadVersion;
                  if (previousBody === undefined) editedPendingBodies.delete(item.id);
                  else editedPendingBodies.set(item.id, previousBody);
                }
                changeComment(item, previousBody);
              };
            },
          },
        );
      },
      remove: item => {
        const review = inPendingReview(item) ? pending.value : undefined;
        const comment = isReview(item) ? undefined : item;
        const commentUrl = pr().html_url;
        return mutate(
          async api => {
            await api.deleteComment(ref(), item, !!review);
            if (comment) rememberRemovedComment(commentUrl, comment.id);
            const removedByGitHub =
              !!review &&
              (await api
                .fresh()
                .reviewExists(ref(), review.id)
                .then(
                  exists => !exists,
                  () => false,
                ));
            if (removedByGitHub) {
              props.store.edit('reviews', prev => prev.filter(other => other.id !== review.id));
              props.store.edit('draftComments', prev => prev.filter(other => other.pull_request_review_id !== review.id));
            }
            done(removedByGitHub ? 'Comment deleted. GitHub removed the now-empty pending review.' : 'Comment deleted from GitHub.');
          },
          {
            apply: () => {
              const sources = {
                comments: ws().comments.some(other => other.id === item.id),
                inlineComments: ws().inlineComments.some(other => other.id === item.id),
                draftComments: ws().draftComments.some(other => other.id === item.id),
              };
              const written = comment && commentWrites.get(commentUrl, comment.id);
              const editedBody = comment && editedPendingBodies.get(comment.id);
              if (review) ++draftLoadVersion;
              changeComment(item);
              if (comment) {
                rememberRemovedComment(commentUrl, comment.id);
                editedPendingBodies.delete(comment.id);
                forgetWrittenComment(comment);
              }
              return () => {
                for (const key of Object.keys(sources) as (keyof typeof sources)[])
                  if (sources[key] && !ws()[key].some(other => other.id === item.id))
                    props.store.edit(key, prev => [...prev, item as Comment]);
                if (comment) {
                  forgetRemovedComment(commentUrl, comment.id);
                  if (editedBody !== undefined) editedPendingBodies.set(comment.id, editedBody);
                  if (written) {
                    commentWrites.set(commentUrl, comment.id, written);
                    commentViews.notify(commentUrl, { comment: written.comment });
                  } else recordWrittenComment(editedBody === undefined ? comment : { ...comment, body: editedBody });
                }
              };
            },
          },
        );
      },
      link: item =>
        (isReview(item) ? item.state === 'PENDING' : inPendingReview(item)) ? undefined : `${appLink()}#${commentAnchor(item)}`,
      copyLink: item => void copy(isReview(item) ? 'link to review' : 'link to comment', edits.link(item)!),
    };
    const reactions = createReactionActions(
      () => props.api,
      ref,
      () => viewer().id,
      mutate,
    );

    const replyDrafts = shallowRef<Record<number, { body: string; error?: string }>>({});
    const replyDraftTokens = new Map<number, number>();
    const replyActions: ReplyActions = {
      reactions,
      edits,
      get pendingReviewId() {
        return pending.value?.id;
      },
      get disabled() {
        return !canReply();
      },
      get canStartReview() {
        return canReview();
      },
      draft: id => replyDrafts.value[id] || { body: '' },
      onChange: (id, body) => {
        replyDraftTokens.delete(id);
        update(replyDrafts, prev => ({ ...prev, [id]: { body } }));
      },
      onReply: replyToComment,
    };
    // A pending review is created lazily: the first comment that starts one carries a temporary review, and every
    // later comment joins it. These two helpers give the inline composer and the thread reply that same scaffolding.
    const startOptimisticReview = (starting: boolean) => {
      const id = starting ? temporaryId() : undefined;
      const review: Review | undefined = starting
        ? { id: id!, node_id: '', user: viewer(), state: 'PENDING', body: '', commit_id: pr().head.sha }
        : undefined;
      return { id, review };
    };
    const placeOptimistic = (optimistic: Comment, review: Review | undefined, inPending: boolean) => {
      if (review) props.store.edit('reviews', prev => [...prev, review]);
      props.store.edit(inPending ? 'draftComments' : 'inlineComments', prev => [...prev, optimistic]);
      recordWrittenComment(optimistic);
      return () => {
        removeLocalComment(optimistic);
        if (review) props.store.edit('reviews', prev => prev.filter(item => item.id !== review.id));
      };
    };
    // Swap the temporary review for GitHub's once it exists, repointing the comments that joined it.
    const confirmStartedReview = (startId: number, review: Review, repoint: (comment: Comment) => boolean) => {
      props.store.edit('reviews', prev =>
        prev.some(item => item.id === startId) ? prev.map(item => (item.id === startId ? review : item)) : [...prev, review],
      );
      props.store.edit('draftComments', prev => prev.map(item => (repoint(item) ? { ...item, pull_request_review_id: review.id } : item)));
      updateWrittenComments(item => (repoint(item) ? { ...item, pull_request_review_id: review.id } : item));
    };
    function replyToComment(id: number, body: string, startReview = false) {
      const root = allComments.value.find(comment => comment.id === id);
      if (!root) return Promise.resolve(false);
      const current = pending.value;
      const starting = startReview && !current;
      const { id: startId, review: optimisticReview } = startOptimisticReview(starting);
      const optimistic: Comment = {
        id: temporaryId(),
        body,
        user: viewer(),
        created_at: new Date().toISOString(),
        path: root.path,
        line: root.line,
        side: root.side,
        ...(starting ? { pull_request_review_id: startId } : current ? { pull_request_review_id: current.id } : {}),
        in_reply_to_id: id,
      };
      const previousDraft = replyDrafts.value[id]?.body ?? body;
      const saved = mutate(
        async api => {
          if (!canReply()) throw new Error('Refresh this PR and its active review before replying.');
          if (startReview && !canReview()) throw new Error('Reviews can only be started on open pull requests.');
          let review = pending.value;
          let thread = ws().reviewThreads.find(item => item.rootCommentId === id);
          if ((review || startReview) && !thread) {
            const result = await api.fresh().reviewThreads(ref());
            thread = result.items.find(item => item.rootCommentId === id);
            if (!thread) throw new Error('Thread metadata is unavailable. Open this thread on GitHub or refresh before starting a review.');
          }
          if (starting) {
            review = await api.startReview(ref(), pr().head.sha);
            confirmStartedReview(startId!, review, item => item.id === optimistic.id || item.pull_request_review_id === startId);
            review = pending.value;
          }
          if (review?.id && review.id < 0) review = undefined;
          const result = await api.reply(ref(), id, body, review, thread?.id);
          const comment = replaceLocalComment(optimistic, {
            ...result,
            path: root.path,
            line: root.line,
            side: root.side,
            pull_request_review_id: review?.id || result.pull_request_review_id,
          });
          if (review) {
            props.store.edit('inlineComments', prev => prev.filter(item => item.id !== comment.id));
            props.store.edit('draftComments', prev => (prev.some(item => item.id === comment.id) ? prev : [...prev, comment]));
            ++draftLoadVersion;
          } else {
            props.store.edit('draftComments', prev => prev.filter(item => item.id !== comment.id));
            props.store.edit('inlineComments', prev => (prev.some(item => item.id === comment.id) ? prev : [...prev, comment]));
            clearOwnRequest();
          }
          replyDraftTokens.delete(id);
          done(
            starting
              ? 'Review started with this pending reply. Subsequent comments and replies join this review.'
              : review
                ? 'Reply added to your pending review. It will publish when you submit the review.'
                : 'Reply posted to GitHub.',
          );
        },
        {
          apply: () => {
            const undo = placeOptimistic(optimistic, optimisticReview, !!(current || starting));
            replyDraftTokens.set(id, optimistic.id);
            update(replyDrafts, prev => ({ ...prev, [id]: { body: '' } }));
            return () => {
              undo();
              if (replyDraftTokens.get(id) === optimistic.id) {
                replyDraftTokens.delete(id);
                update(replyDrafts, prev => ({ ...prev, [id]: { body: previousDraft } }));
              }
            };
          },
        },
      );
      void saved.then(ok => {
        if (!ok && !replyDraftTokens.has(id) && replyDrafts.value[id]?.body === previousDraft)
          update(replyDrafts, prev => ({
            ...prev,
            [id]: { body: previousDraft, error: error.value || 'Reply was not saved. Refresh before trying again.' },
          }));
      });
      return saved;
    }
    async function resolveThread(id: string, resolved: boolean) {
      const original = ws().reviewThreads.find(item => item.id === id);
      return mutate(
        async api => {
          if (!original || !(resolved ? original.canResolve : original.canUnresolve))
            throw new Error('You do not have permission to change this thread.');
          const result = await api.setThreadResolved(id, resolved);
          props.store.edit('reviewThreads', prev =>
            prev.map(item => (item.id === id && item.resolved === resolved ? { ...item, ...result } : item)),
          );
          done(`Thread ${resolved ? 'resolved' : 'reopened'} on GitHub.`);
        },
        {
          apply: () => {
            if (!original || !(resolved ? original.canResolve : original.canUnresolve)) return () => {};
            props.store.edit('reviewThreads', prev => prev.map(item => (item.id === id ? { ...item, resolved } : item)));
            return () =>
              props.store.edit('reviewThreads', prev => prev.map(item => (item.id === id && item.resolved === resolved ? original : item)));
          },
        },
      );
    }

    const dialog = shallowRef<Dialog>(null);
    const event = shallowRef<ReviewEvent>('COMMENT');
    const reviewBody = shallowRef('');
    const reviewable = () => canReview() && !stalePending();
    const focusSoon = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
    function openReview(value: ReviewEvent) {
      event.value = value;
      error.value = '';
      dialog.value = 'review';
    }
    const review = (value: ReviewEvent) => {
      if (!reviewable()) return;
      openReview(value);
      focusSoon('#review-body');
    };
    function safeClose() {
      dialog.value = null;
      error.value = '';
    }
    async function submitReview(e?: SubmitEvent) {
      e?.preventDefault();
      if (event.value !== 'APPROVE' && !reviewBody.value.trim() && !ws().draftComments.length) {
        error.value = 'Add a review summary or a pending inline comment.';
        return;
      }
      const reviewEvent = event.value;
      const summary = reviewBody.value.trim();
      const optimistic: Review = {
        id: temporaryId(),
        node_id: '',
        user: viewer(),
        state: reviewEvent === 'APPROVE' ? 'APPROVED' : reviewEvent === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED',
        body: summary,
        commit_id: pr().head.sha,
        submitted_at: new Date().toISOString(),
      };
      const pendingAtCall = pending.value;
      const comments = [...ws().draftComments];
      const commentIds = new Set(comments.map(comment => comment.id));
      const reviewUrl = pr().html_url;
      await mutate(
        async api => {
          const current = pendingAtCall;
          const result = await api.submitReview(ref(), pr().head.sha, reviewEvent, summary, current);
          recordWrittenReview(reviewUrl, result, optimistic.id);
          entered.set(`review-${result.id}`, 'grow-in');
          props.store.edit('reviews', prev => [
            ...prev.filter(review => review.id !== optimistic.id && review.id !== current?.id && review.id !== result.id),
            result,
          ]);
          done(`${reviewEvent === 'APPROVE' ? 'Approval' : 'Review'} submitted to GitHub.`, await refreshThreads());
        },
        {
          apply: () => {
            entered.set(`review-${optimistic.id}`, 'grow-in');
            props.store.edit('reviews', prev => [...prev.filter(review => review.id !== pendingAtCall?.id), optimistic]);
            recordWrittenReview(reviewUrl, optimistic);
            props.store.edit('inlineComments', prev => [
              ...prev,
              ...comments.filter(comment => !prev.some(other => other.id === comment.id)),
            ]);
            props.store.edit('draftComments', prev => prev.filter(comment => !commentIds.has(comment.id)));
            const requestChange = clearOwnRequest();
            reviewBody.value = '';
            dialog.value = null;
            return () => {
              forgetWrittenReview(reviewUrl, optimistic.id);
              props.store.edit('reviews', prev => [
                ...prev.filter(review => review.id !== optimistic.id),
                ...(pendingAtCall && !prev.some(review => review.id === pendingAtCall.id) ? [pendingAtCall] : []),
              ]);
              props.store.edit('inlineComments', prev => prev.filter(comment => !commentIds.has(comment.id)));
              props.store.edit('draftComments', prev => [
                ...prev,
                ...comments.filter(comment => !prev.some(other => other.id === comment.id)),
              ]);
              if (requestChange) requestChange();
              if (!dialog.value) {
                event.value = reviewEvent;
                reviewBody.value = summary;
                dialog.value = 'review';
              }
            };
          },
        },
      );
    }
    const discardReview = () => {
      const pendingAtCall = pending.value;
      if (!pendingAtCall) return Promise.resolve(true);
      const comments = ws().draftComments.filter(comment => comment.pull_request_review_id === pendingAtCall.id);
      return mutate(
        async api => {
          const current = pendingAtCall;
          if (current.id < 0) return;
          const deleted = await api.discardReview(ref(), current.id);
          props.store.edit('reviews', prev => prev.filter(review => review.id !== current.id));
          props.store.edit('draftComments', prev => prev.filter(comment => comment.pull_request_review_id !== current.id));
          forgetWrittenComments(current.id);
          done(deleted ? 'Pending review discarded.' : 'This pending review was already gone on GitHub; cleared it here.');
        },
        {
          apply: () => {
            props.store.edit('reviews', prev => prev.filter(review => review.id !== pendingAtCall.id));
            props.store.edit('draftComments', prev => prev.filter(comment => comment.pull_request_review_id !== pendingAtCall.id));
            dialog.value = null;
            return () => {
              props.store.edit('reviews', prev => (prev.some(review => review.id === pendingAtCall.id) ? prev : [...prev, pendingAtCall]));
              props.store.edit('draftComments', prev => [
                ...prev,
                ...comments.filter(comment => !prev.some(other => other.id === comment.id)),
              ]);
              comments.forEach(comment => recordWrittenComment(comment));
              if (!dialog.value) dialog.value = 'review';
            };
          },
        },
      );
    };

    const inlineBody = shallowRef('');
    const inlineLocation = shallowRef<InlineLocation>({ path: '', line: 0, side: 'RIGHT' });
    function openInline(file: ChangedFile, end: LinePoint, start?: LinePoint) {
      if (selectedRange.value || comparing.value) return;
      const location = commentRange(file, start ?? end, end);
      if (!location) {
        notice.value =
          diffLinePreview(file, end.line, end.side) && (!start || diffLinePreview(file, start.line, start.side))
            ? 'Multi-line comments must stay within one diff hunk.'
            : 'Additional context is read-only. GitHub only accepts these review comments on lines in the PR diff.';
        return;
      }
      inlineLocation.value = { path: file.filename, ...location };
      error.value = '';
      dialog.value = 'inline';
    }
    async function postInline(start = false) {
      if (!inlineBody.value.trim() || !canReply() || (start && !pending.value && !canReview())) return;
      const location = inlineLocation.value;
      const text = inlineBody.value.trim();
      const file = ws().files.find(file => file.filename === location.path);
      if (
        selectedRange.value ||
        comparing.value ||
        !file ||
        !commentRange(file, { line: location.startLine ?? location.line, side: location.startSide ?? location.side }, location)
      ) {
        error.value =
          selectedRange.value || comparing.value
            ? 'Switch to All commits before adding a review comment.'
            : 'Additional context is read-only. Select lines in one hunk of the original PR diff to comment.';
        return;
      }
      const input: ReviewCommentInput = {
        path: location.path,
        line: location.line,
        side: location.side,
        ...(location.startLine && location.startSide ? { start_line: location.startLine, start_side: location.startSide } : {}),
        body: text,
      };
      const pendingAtCall = pending.value;
      const starting = start && !pendingAtCall;
      const { id: startId, review: optimisticReview } = startOptimisticReview(starting);
      const optimistic: Comment = {
        id: temporaryId(),
        body: text,
        user: viewer(),
        created_at: new Date().toISOString(),
        path: location.path,
        line: location.line,
        side: location.side,
        ...(location.startLine && location.startSide ? { start_line: location.startLine, start_side: location.startSide } : {}),
        ...(starting ? { pull_request_review_id: startId } : pendingAtCall ? { pull_request_review_id: pendingAtCall.id } : {}),
      };
      await mutate(
        async api => {
          let current = pending.value;
          let refreshWarning = '';
          if (starting) {
            current = await api.startReview(ref(), pr().head.sha, input);
            confirmStartedReview(startId!, current, comment => comment.id === optimistic.id);
          } else {
            if (current?.id && current.id < 0) current = undefined;
            const result = await api.inlineComment(ref(), pr().head.sha, input, current);
            const confirmed = replaceLocalComment(optimistic, { ...result, user: result.user ?? optimistic.user });
            if (current) {
              props.store.edit('draftComments', prev =>
                prev.map(comment => (comment.id === confirmed.id ? { ...confirmed, pull_request_review_id: current!.id } : comment)),
              );
            } else {
              props.store.edit('draftComments', prev => prev.filter(comment => comment.id !== confirmed.id));
              props.store.edit('inlineComments', prev => (prev.some(comment => comment.id === confirmed.id) ? prev : [...prev, confirmed]));
              clearOwnRequest();
            }
          }
          if (current) {
            try {
              await loadPendingComments(current, true);
            } catch {
              refreshWarning = ' Comment saved, but comments could not be refreshed. Refresh the PR to see it; do not post it again.';
            }
          }
          refreshWarning += await refreshThreads();
          done(
            starting
              ? 'Review started with this pending comment. Add more feedback, then finish your review to publish.'
              : current
                ? 'Comment added to your pending GitHub review.'
                : 'Inline comment posted to GitHub.',
            refreshWarning,
          );
        },
        {
          apply: () => {
            const undo = placeOptimistic(optimistic, optimisticReview, !!(pendingAtCall || starting));
            inlineBody.value = '';
            dialog.value = null;
            error.value = '';
            return () => {
              undo();
              if (!inlineBody.value) {
                inlineLocation.value = location;
                inlineBody.value = text;
                dialog.value = 'inline';
              }
            };
          },
        },
      );
    }

    const body = shallowRef('');
    const approved = () => reviewApproved(pr(), ws().reviews, ws().onBehalfOf);

    const relations = computed(() => branchRelations(pr(), ws().related));
    const stack = () =>
      ws().nativeStack
        ? [...ws().nativeStack!.entries].sort((a, b) => a.position - b.position)
        : [...relations.value.parents, pr(), ...relations.value.children].map(entry => ({ ...entry, url: prUrl(entry.number) }));
    const openStacked = (delta: 1 | -1) => {
      const entries = stack();
      const index = entries.findIndex(entry => entry.number === pr().number);
      const next = index < 0 ? undefined : entries[index + delta];
      if (next) props.onOpen(next.url);
    };
    const mergePR = (method: MergeMethod) => {
      const optimistic = { state: 'closed' as const, merged: true };
      return mutate(
        async api => {
          const result = await api.merge(ref(), pr().head.sha, method);
          if (!result.merged) throw new Error(result.message || 'GitHub could not merge this pull request.');
        },
        {
          toast: 'Pull request merged',
          refresh: 'all',
          apply: () => props.store.applyPR(optimistic),
        },
      );
    };
    const setAutoMerge = (enable: boolean) => {
      const method = pr().auto_merge?.merge_method ?? ws().mergeMethods?.[0];
      const optimistic = enable && method ? { merge_method: method, enabled_by: viewer() } : null;
      return mutate(
        async api => {
          if (enable && !method) throw new Error('No merge method is available for auto-merge.');
          try {
            await api.setAutoMerge(pr(), enable ? method! : null);
          } catch (error) {
            if (enable && error instanceof Error && /clean status/i.test(error.message))
              throw new Error('This pull request is already mergeable. Use Merge.');
            throw error;
          }
        },
        {
          toast: enable ? 'Auto-merge enabled' : 'Auto-merge turned off',
          refresh: 'all',
          apply: () => props.store.applyPR({ auto_merge: optimistic }),
        },
      );
    };

    const details = useDetails(() => ({
      store: props.store,
      api: props.api,
      prRef: ref(),
      busy: busy.value,
      onChecks: () => {
        tab.value = 'checks';
        requestAnimationFrame(() => document.querySelector('.review-tabs-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      },
      onMutate: mutate,
    }));

    const commitList = shallowRef<Commit[]>([]);
    const commitsLoading = shallowRef(false);
    const commitsError = shallowRef('');
    const commitsWarning = shallowRef('');
    let commitsAbort: AbortController | undefined;
    async function loadCommits() {
      if (commitsLoading.value) return;
      commitsAbort = new AbortController();
      commitsLoading.value = true;
      commitsError.value = '';
      try {
        const result = await props.api.commits(ref(), commitsAbort.signal);
        if (!active) return;
        commitList.value = result.items;
        commitsWarning.value =
          result.truncated || result.items.length < pr().commits
            ? 'GitHub limits PR commit history to 250 entries. Some commits may be missing; All commits still shows the complete PR diff.'
            : '';
      } catch (error) {
        if (active && !commitsAbort.signal.aborted) commitsError.value = errorMessage(error, 'Commit history could not be loaded.');
      } finally {
        if (active) commitsLoading.value = false;
      }
    }
    onMounted(() => void loadCommits());

    const selectedRange = shallowRef<CommitRange | null>(null);
    const comparison = shallowRef<Comparison | null>(null);
    const comparing = shallowRef(false);
    const comparisonError = shallowRef('');
    let comparisonVersion = 0;
    let comparisonAbort: AbortController | undefined;
    onUnmounted(() => {
      comparisonAbort?.abort();
      commitsAbort?.abort();
    });
    function restoreAllChanges() {
      ++comparisonVersion;
      comparisonAbort?.abort();
      selectedRange.value = null;
      comparison.value = null;
      comparing.value = false;
      comparisonError.value = '';
    }
    async function changeRange(range: CommitRange | null): Promise<boolean> {
      if (busy.value) return false;
      if (inlineBody.value.trim() && !window.confirm('Discard the unsaved line comment and change the commit range?')) return false;
      inlineBody.value = '';
      if (dialog.value === 'inline') dialog.value = null;
      const version = ++comparisonVersion;
      comparisonAbort?.abort();
      if (!range) {
        restoreAllChanges();
        tab.value = 'changes';
        clearFilters();
        return true;
      }
      const controller = new AbortController();
      comparisonAbort = controller;
      comparing.value = true;
      comparisonError.value = '';
      try {
        const result = await props.api.compare(ref(), range.base, range.head, controller.signal);
        if (!active || comparisonVersion !== version) return false;
        comparison.value = result;
        selectedRange.value = range;
        tab.value = 'changes';
        clearFilters();
        collapsed.value = new Set<string>();
        rangeViewed.value = new Set<string>();
        return true;
      } catch (error) {
        if (active && !controller.signal.aborted) comparisonError.value = errorMessage(error, 'Commit comparison failed.');
        return false;
      } finally {
        if (active && comparisonVersion === version) comparing.value = false;
      }
    }
    const commitProps = {
      get commits() {
        return commitList.value;
      },
      get loading() {
        return commitsLoading.value;
      },
      get error() {
        return commitsError.value;
      },
      get warning() {
        return commitsWarning.value;
      },
      get base() {
        return pr().base.sha;
      },
      get head() {
        return pr().head.sha;
      },
      get value() {
        return selectedRange.value;
      },
      get busy() {
        return busy.value || comparing.value;
      },
      onRetry: () => void loadCommits(),
      onChange: changeRange,
    };
    let defaultBase: Promise<string> | undefined;
    const loadContext: ContextLoader = async file => {
      const api = props.api;
      const range = selectedRange.value;
      const selectedComparison = comparison.value;
      const head = range?.head || pr().head.sha;
      if (!range && !defaultBase) {
        defaultBase = api
          .compare(ref(), pr().base.sha, pr().head.sha)
          .then(result => result.mergeBase)
          .catch(error => {
            defaultBase = undefined;
            throw error;
          });
      }
      const base = range ? selectedComparison!.mergeBase : await defaultBase!;
      const result = await api.diffContents(ref(), file, base, head, pr().head.repo?.full_name || `${ref().owner}/${ref().repo}`);
      verifiedContextLines(file, result.oldFile.contents, result.newFile.contents);
      return result;
    };

    const sidebar = shallowRef(false);
    const settingsOpen = shallowRef(false);
    const filenameQuery = shallowRef('');
    const contentQuery = shallowRef('');
    const statusFilters = shallowRef<FileStatus[]>([]);
    const focusedFile = shallowRef<string | null>(null);
    const selected = shallowRef(ws().files[0]?.filename || '');
    watch(
      () => ws().files,
      value => (selected.value ||= value[0]?.filename || ''),
    );
    const collapsed = shallowRef<Set<string>>(new Set());
    const rangeViewed = shallowRef<Set<string>>(new Set());
    const prViewed = computed(() => new Set(ws().viewedFiles));
    const viewed = computed(() => (comparison.value ? rangeViewed.value : prViewed.value));
    let viewedFilesSettledFor = '';
    watch(
      () => [pr().node_id, pendingSection('viewedFiles'), ws().viewedFiles] as const,
      ([pullRequestId, pending, files]) => {
        if (pending || viewedFilesSettledFor === pullRequestId) return;
        viewedFilesSettledFor = pullRequestId;
        collapsed.value = new Set([...collapsed.value, ...files]);
      },
      { immediate: true },
    );
    const displayFiles = computed(() => comparison.value?.files || ws().files);
    const files = computed(() =>
      filterFiles(displayFiles.value, { filename: filenameQuery.value, content: contentQuery.value, statuses: statusFilters.value }),
    );
    const visibleFiles = computed(() => files.value.filter(file => !focusedFile.value || file.filename === focusedFile.value));
    function clearFilters() {
      filenameQuery.value = '';
      contentQuery.value = '';
      statusFilters.value = [];
      focusedFile.value = null;
    }
    const toggleCollapsed = (filename: string, force = !collapsed.value.has(filename)) =>
      update(collapsed, prev => {
        const next = new Set(prev);
        if (force) next.add(filename);
        else next.delete(filename);
        return next;
      });
    function revealFile(filename: string, scroll: ScrollBehavior | false = 'smooth') {
      focusedFile.value = null;
      tab.value = 'changes';
      selected.value = filename;
      toggleCollapsed(filename, false);
      if (scroll)
        requestAnimationFrame(() =>
          document.getElementById(`file-${encodeURIComponent(filename)}`)?.scrollIntoView({ behavior: scroll, block: 'start' }),
        );
    }
    function selectFile(filename: string, scrollToFile = true) {
      if (selectedRange.value || comparing.value) restoreAllChanges();
      clearFilters();
      revealFile(filename, scrollToFile && 'smooth');
    }
    function focusFile(filename: string | null) {
      focusedFile.value = filename;
      if (filename) {
        filenameQuery.value = '';
        contentQuery.value = '';
        selected.value = filename;
        toggleCollapsed(filename, false);
      }
      requestAnimationFrame(() =>
        document.getElementById(`file-${encodeURIComponent(filename || selected.value)}`)?.scrollIntoView({ block: 'start' }),
      );
    }
    const moveFile = (delta: 1 | -1) => {
      const filename = step(
        files.value.map(file => file.filename),
        selected.value,
        delta,
      );
      if (filename) revealFile(filename, 'auto');
    };
    function toggleViewed(...filenames: string[]) {
      const currentViewed = comparison.value ? rangeViewed.value : prViewed.value;
      const next = toggleViewedFiles(filenames, currentViewed, collapsed.value);
      collapsed.value = next.collapsed;
      if (comparison.value) {
        rangeViewed.value = next.viewed;
        return;
      }
      const changed = filenames.filter(filename => next.viewed.has(filename) !== currentViewed.has(filename));
      if (!changed.length) return;
      const pullRequestId = pr().node_id;
      const isViewed = next.viewed.has(changed[0]!);
      props.store.edit('viewedFiles', () => [...next.viewed]);
      void props.api.setFilesViewed(pullRequestId, changed, isViewed).catch(() => {
        if (ws().pr.node_id !== pullRequestId) return;
        // Revert only this toggle so later toggles that did save are kept.
        props.store.edit('viewedFiles', prev =>
          isViewed ? prev.filter(filename => !changed.includes(filename)) : [...new Set([...prev, ...changed])],
        );
        if (active) showToast('Could not update viewed files on GitHub.', 'error');
      });
    }
    const toggleSelectedViewed = () => selected.value && toggleViewed(selected.value);
    const allCollapsed = () => files.value.length > 0 && files.value.every(file => collapsed.value.has(file.filename));
    const toggleAll = () => (collapsed.value = allCollapsed() ? new Set() : new Set(displayFiles.value.map(file => file.filename)));
    const setLayout = (layout: DiffSettings['layout']) => props.onSettings({ ...props.settings, layout });

    const commentsOpen = shallowRef(false);
    const selectedThreadId = shallowRef<number | null>(null);
    const threadAnchors = new Map<number, HTMLElement>();
    let wantedThreadId: number | null = null;
    let wantedAnchor: string | undefined;
    // Rings the comment a link pointed at, so it's clear why the page jumped.
    const highlight = (element: Element | null | undefined) => {
      element?.classList.remove('comment-linked');
      void (element as HTMLElement | undefined)?.offsetWidth;
      element?.classList.add('comment-linked');
    };
    function onThreadAnchor(id: number, element: HTMLElement | null) {
      if (!element) {
        threadAnchors.delete(id);
        return;
      }
      threadAnchors.set(id, element);
      if (wantedThreadId === id) requestAnimationFrame(() => scrollToThread(id));
    }
    function scrollToThread(id: number) {
      const element = threadAnchors.get(id);
      if (!element?.isConnected || wantedThreadId !== id) return;
      wantedThreadId = null;
      const toggle = element.querySelector<HTMLButtonElement>('.thread-toggle');
      if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      element.focus({ preventScroll: true });
      if (wantedAnchor) highlight(document.getElementById(wantedAnchor));
      wantedAnchor = undefined;
    }
    function showInConversation(anchor: string, linked: boolean) {
      tab.value = 'conversation';
      requestAnimationFrame(() => {
        const element = document.getElementById(anchor);
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (linked) highlight(element);
      });
    }
    function navigateComment(entry: CommentEntry, linked?: string) {
      if (window.matchMedia('(max-width: 1100px)').matches) commentsOpen.value = false;
      if (entry.kind === 'conversation') return showInConversation(commentAnchor(entry.comment), !!linked);
      if (!entry.file) return;
      const id = entry.root.in_reply_to_id || entry.root.id;
      wantedThreadId = id;
      wantedAnchor = linked;
      selectedThreadId.value = id;
      selectFile(entry.file.filename, false);
      requestAnimationFrame(() => scrollToThread(id));
    }
    function navigatePendingComment(comment: Comment) {
      dialog.value = null;
      const entry = panelEntries.value.find(item => item.kind === 'thread' && item.comments.some(candidate => candidate.id === comment.id));
      if (entry) navigateComment(entry);
    }
    function openLink(hash: string) {
      const target = parseCommentAnchor(hash);
      if (!target) return;
      const anchor = hash.slice(1);
      const entry = panelEntries.value.find(item =>
        target.kind === 'discussion_r'
          ? item.kind === 'thread' && !!item.file && item.comments.some(comment => comment.id === target.id)
          : target.kind === 'issuecomment-' && item.kind === 'conversation' && item.comment.id === target.id,
      );
      if (entry) navigateComment(entry, anchor);
      else if (target.kind === 'pullrequestreview-' && visibleReviews.value.some(review => review.id === target.id))
        showInConversation(anchor, true);
      else showToast('That comment is no longer on this pull request.', 'error');
    }
    // Waits for the comments to load, then opens each new hash once, so a reload or Back lands on the comment again.
    let openedHash = '';
    watch(
      () => [props.hash, pendingSection('files', 'comments', 'inlineComments', 'reviews')] as const,
      ([hash, loading]) => {
        if (loading || hash === openedHash) return;
        openedHash = hash;
        if (hash) requestAnimationFrame(() => openLink(hash));
      },
      { immediate: true },
    );
    let commentCursor = -1;
    const moveComment = (delta: 1 | -1) => {
      const entries = panelEntries.value;
      const entry = step(entries, entries[commentCursor], delta);
      if (!entry) return;
      commentCursor = entries.indexOf(entry);
      navigateComment(entry);
    };

    const approvePR = () => {
      if (!reviewable() || ownPR()) return;
      event.value = 'APPROVE';
      void submitReview();
    };
    const commandActions: CommandContext['actions'] = {
      'submit-review': () => review('COMMENT'),
      approve: approvePR,
      'approve-comment': () => review('APPROVE'),
      'request-changes': () => review('REQUEST_CHANGES'),
      'squash-merge': () => void mergePR('squash'),
      'merge-when-ready': () => void setAutoMerge(true),
      'copy-link': () => copy('link to PR', appLink()),
      'copy-title': () => copy('title', pr().title),
      'copy-branch-name': () => copy('branch name', pr().head.ref),
      'copy-checkout': () => copy('checkout command', `gh pr checkout ${pr().number} --repo ${ref().owner}/${ref().repo}`),
      'copy-github-link': () => copy('GitHub link', pr().html_url),
      'copy-stack': () =>
        copy(
          'stack',
          stack()
            .map(entry => `${entry.number === pr().number ? '→ ' : ''}#${entry.number} ${entry.title} ${entry.url}`)
            .join('\n'),
        ),
      'copy-markdown': () => copy('PR', `[${pr().title} #${pr().number}](${pr().html_url})`),
      upstack: () => openStacked(1),
      inbox: props.onBack,
    };
    const commandContext = (): CommandContext => {
      const currentPR = pr();
      const mergeMethods = ws().mergeMethods ?? [];
      const checksPending = (ws().checks ?? []).some(check => check.state === 'pending');
      const mergeAvailable = mergeOffered(currentPR, approved());
      const autoMergeAvailable =
        !!ws().autoMerge && currentPR.state === 'open' && !currentPR.draft && currentPR.mergeable_state !== 'dirty';
      const mergeReason =
        currentPR.mergeable_state === 'dirty'
          ? 'Resolve merge conflicts first.'
          : mergeabilityPending(currentPR)
            ? 'GitHub is still checking mergeability.'
            : 'Required checks or approvals are not satisfied.';
      const autoMergeReason =
        currentPR.mergeable_state === 'dirty'
          ? 'Resolve merge conflicts first.'
          : !ws().autoMerge
            ? 'Auto-merge is not enabled for this repository.'
            : !mergeMethods.length
              ? 'No merge method is available.'
              : undefined;
      const entries = stack();
      const stackIndex = entries.findIndex(entry => entry.number === currentPR.number);
      return {
        busy: busy.value,
        pr: {
          ref: ref(),
          login: viewer().login,
          pendingComments: ws().draftComments.length,
          ownPR: ownPR(),
          draft: currentPR.draft,
          open: currentPR.state === 'open',
          busy: busy.value,
          canReview: canReview(),
          stale: stalePending(),
          mergeMethods,
          mergeAvailable,
          mergeReason,
          checksPending,
          autoMergeAvailable,
          autoMergeEnabled: !!currentPR.auto_merge,
          autoMergeReason,
          upstackAvailable: stackIndex > 0,
        },
        actions: commandActions,
      };
    };
    onUnmounted(registerPRCommands(commandContext));
    const commandBindings = Object.fromEntries(
      commandDefinitions
        .filter(command => command.id !== 'open-command-bar')
        .flatMap(command => [command, ...(command.children ?? [])])
        .flatMap(command =>
          command.keys.map(key => [
            key,
            () => {
              const context = commandContext();
              if (!command.enabled(context)) command.run(context, 'shortcut');
            },
          ]),
        ),
    );
    const shortcuts: Record<string, () => void> = {
      ...commandBindings,
      '/': () => {
        focusedFile.value = null;
        sidebar.value = true;
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#file-search')?.focus());
      },
      Escape: () => {
        settingsOpen.value = false;
        focusedFile.value = null;
      },
      j: () => moveFile(1),
      k: () => moveFile(-1),
      'mod+ArrowDown': () => moveFile(1),
      'mod+ArrowUp': () => moveFile(-1),
      n: () => moveComment(1),
      p: () => moveComment(-1),
      f: () => {
        focusedFile.value = null;
        sidebar.value = !sidebar.value;
      },
      C: () => (commentsOpen.value = !commentsOpen.value),
      v: toggleSelectedViewed,
      'mod+Enter': toggleSelectedViewed,
      x: () => selected.value && toggleCollapsed(selected.value),
      X: () => toggleAll(),
      u: () => setLayout('unified'),
      s: () => setLayout('split'),
      '1': () => (tab.value = 'changes'),
      '2': () => (tab.value = 'commits'),
      '3': () => (tab.value = 'conversation'),
      '4': () => (tab.value = 'review'),
      '5': () => (tab.value = 'checks'),
      'shift+mod+ArrowDown': () => openStacked(-1),
      o: () => window.open(pr().html_url, '_blank', 'noopener,noreferrer'),
      'r c': () => {
        tab.value = 'conversation';
        focusSoon('#pr-comment');
      },
    };
    const shortcutHandler = createShortcuts(
      () => shortcuts,
      () => !!dialog.value || modalOpen(),
    );
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog.value === 'inline') {
        safeClose();
        return;
      }
      shortcutHandler(e);
    };
    document.addEventListener('keydown', keyHandler);
    onUnmounted(() => document.removeEventListener('keydown', keyHandler));
    const unsaved = (e: BeforeUnloadEvent) => {
      if (
        body.value.trim() ||
        reviewBody.value.trim() ||
        inlineBody.value.trim() ||
        Object.values(replyDrafts.value).some(draft => draft.body.trim())
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', unsaved);
    onUnmounted(() => window.removeEventListener('beforeunload', unsaved));

    const view: PRView = {
      store: props.store,
      api: props.api,
      ws,
      pr,
      ref,
      prUrl,
      markdownBase,
      viewer,
      busy,
      mutate,
      done,
      copy,
      entered,
      entrance,
      details,
      approved,
      relations,
      stalePending,
      pendingSection,
      pending,
      allComments,
      visibleConversation,
      visibleReviews,
      shown,
      edits,
      reactions,
      recordWrittenComment,
      forgetWrittenComment,
      replaceLocalComment,
      displayFiles,
      selectFile,
    };

    return () => (
      <div class={`review-layout ${commentsOpen.value ? 'comments-open' : ''}`} aria-busy={!!ws().pending.length}>
        {!!(sidebar.value && !focusedFile.value) && (
          <FileTree
            loading={pendingSection('files')}
            files={files.value}
            allFiles={displayFiles.value}
            selected={selected.value}
            viewed={viewed.value}
            onViewed={filenames => toggleViewed(...filenames)}
            onSelect={filename => revealFile(filename)}
            query={filenameQuery.value}
            onQuery={value => {
              filenameQuery.value = value;
            }}
            statuses={statusFilters.value}
            onStatuses={value => {
              statusFilters.value = value;
            }}
            onClearFilters={clearFilters}
            onClose={() => (sidebar.value = false)}
          />
        )}
        <main class={`flex-1 min-w-0 flex ${styles['flex-col']} ${styles['overflow-hidden']}`}>
          <div class="page-breadcrumb review-breadcrumb">
            <button
              class="inline-flex items-center gap-2 text-secondary py-1 px-0 text-xs"
              title="Return to your pull request inbox"
              onClick={() => props.onBack()}
            >
              <ArrowLeft size={14} />
              Inbox
            </button>
            <ChevronRight size={13} />
            <span>
              {ref().owner} / {ref().repo}
            </span>
            <ChevronRight size={13} />
            <strong>#{pr().number}</strong>
            <div class="breadcrumb-actions">
              {!!pending.value && (
                <>
                  <button
                    class="text-button muted"
                    title="Discard your unpublished review and its pending comments"
                    onClick={() => {
                      error.value = '';
                      dialog.value = 'discard';
                    }}
                  >
                    Discard pending
                  </button>
                  <button class="button small" title="Continue your pending review" onClick={() => (tab.value = 'review')}>
                    <Check size={14} />
                    Review in progress
                  </button>
                </>
              )}
              <button
                class="button small"
                title="Write a review, approve, or request changes"
                disabled={!canReview() || stalePending()}
                onClick={() => review('COMMENT')}
              >
                Review changes
              </button>
              <MergeControls
                pr={pr()}
                methods={ws().mergeMethods ?? []}
                autoMerge={!!ws().autoMerge}
                approved={approved()}
                disabled={false}
                onMerge={mergePR}
                onAutoMerge={setAutoMerge}
              />
              <MoreMenu details={details} onCommand={id => commandActions[id]?.('bar')} />
              <span class="header-divider" />
              {!commentsOpen.value && (
                <button
                  class={`button small ${styles['comments-toggle']}`}
                  aria-label="Show comments panel"
                  title="Show review threads and PR conversation comments"
                  aria-expanded={false}
                  onClick={() => (commentsOpen.value = true)}
                >
                  <MessagesSquare size={15} />
                  <span>{panelEntries.value.length}</span>
                </button>
              )}
              <IconButton label="Refresh pull request" onClick={props.store.reload} disabled={busy.value || !!ws().pending.length}>
                <RefreshCw size={15} class={ws().pending.length ? 'spin' : ''} />
              </IconButton>
            </div>
          </div>
          <div class={styles['review-scroll']}>
            <div class="pr-top">
              <PRHeader view={view} onOpen={props.onOpen} />
              {!commentsOpen.value && <DetailsPanel details={details} />}
            </div>
            <div class="review-tabs-bar">
              <div class="review-tabs">
                <button
                  class={tab.value === 'changes' ? 'selected' : ''}
                  title="Browse changed files and inline review comments"
                  onClick={() => (tab.value = 'changes')}
                >
                  <FileCodeIcon />
                  Changes<span>{displayFiles.value.length}</span>
                </button>
                <button
                  class={tab.value === 'commits' ? 'selected' : ''}
                  title="Browse commit history and open an individual commit diff"
                  onClick={() => (tab.value = 'commits')}
                >
                  <GitCommitHorizontal size={14} />
                  Commits<span>{pr().commits}</span>
                </button>
                <button
                  class={tab.value === 'conversation' ? 'selected' : ''}
                  title="Read the PR description, conversation, and submitted reviews"
                  onClick={() => (tab.value = 'conversation')}
                >
                  <MessageSquare size={14} />
                  Conversation
                  <span>{visibleConversation.value.length + visibleReviews.value.filter(r => r.state !== 'PENDING').length}</span>
                </button>
                <button
                  class={tab.value === 'review' ? 'selected' : ''}
                  title="See your pending comments and review history"
                  onClick={() => (tab.value = 'review')}
                >
                  <CheckCheck size={14} />
                  Your review
                  {!!ws().draftComments.length && <span>{ws().draftComments.length}</span>}
                </button>
                <button
                  class={tab.value === 'checks' ? 'selected' : ''}
                  title="See CI status checks for the latest commit and open their runs"
                  onClick={() => (tab.value = 'checks')}
                >
                  <ShieldCheck size={14} />
                  Checks
                  {!!ws().checks?.length && <span data-state={checksTone(ws().checks!)}>{checksDone(ws().checks!)}</span>}
                </button>
              </div>
            </div>
            <AnimatePresence>
              {!!notice.value && (
                <motion.div key="notice" {...drop()} class={styles['notice-banner']} role="status">
                  <CircleCheck size={15} />
                  <span>{notice.value}</span>
                  <button aria-label="Dismiss notification" title="Dismiss this notification" onClick={() => (notice.value = '')}>
                    <X size={14} />
                  </button>
                </motion.div>
              )}
              {!!(error.value && !dialog.value) && (
                <motion.div key="error" {...drop()} class={styles['error-banner']} role="alert">
                  {error.value}
                </motion.div>
              )}
              {!!comparisonError.value && (
                <motion.div key="comparison-error" {...drop()} class={styles['error-banner']} role="alert">
                  {comparisonError.value}
                </motion.div>
              )}
            </AnimatePresence>
            {!!comparing.value && (
              <div class="diff-context-notice" role="status">
                <Spinner text="Loading commit comparison…" />
              </div>
            )}
            {tab.value === 'commits' && <CommitHistory {...commitProps} />}
            {tab.value === 'checks' && (
              <Checks
                checks={ws().checks}
                loading={pendingSection('checks')}
                prRef={ref()}
                onMutate={mutate}
                onChecks={checks => props.store.edit('checks', () => checks)}
                entrance={entrance('checks')}
              />
            )}
            {(tab.value === 'review' || tab.value === 'conversation') && (
              <ConversationTab view={view} mode={tab.value} draft={body} onChanges={() => (tab.value = 'changes')} />
            )}
            {tab.value === 'changes' && (
              <>
                <div class="diff-toolbar">
                  {(!sidebar.value || focusedFile.value) && (
                    <>
                      <button
                        class="sidebar-toggle button small"
                        aria-label="Show file sidebar"
                        title={
                          focusedFile.value
                            ? 'Exit expanded file view and show the changed files sidebar'
                            : 'Show the changed files sidebar'
                        }
                        aria-expanded={false}
                        onClick={() => {
                          focusedFile.value = null;
                          sidebar.value = true;
                        }}
                      >
                        <PanelLeftOpen size={16} />
                        Files
                      </button>
                      <span class="divider" />
                    </>
                  )}
                  <CommitPicker {...commitProps} />
                  <SearchField
                    class="content-search"
                    label="Search diff content"
                    placeholder="Find in changes…"
                    clearLabel="Clear diff search"
                    value={contentQuery.value}
                    onInput={value => {
                      focusedFile.value = null;
                      contentQuery.value = value;
                    }}
                  />
                  {!!(filenameQuery.value || contentQuery.value || statusFilters.value.length) && (
                    <span class="text-xs text-muted">{files.value.length} files</span>
                  )}
                  <div class="spacer" />
                  <IconButton label={allCollapsed() ? 'Expand all diffs' : 'Collapse all diffs'} onClick={toggleAll}>
                    {allCollapsed() ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
                  </IconButton>
                  <div class="segmented layout-switch">
                    <IconButton label="Unified diff" active={props.settings.layout === 'unified'} onClick={() => setLayout('unified')}>
                      <List size={15} />
                    </IconButton>
                    <IconButton label="Split diff" active={props.settings.layout === 'split'} onClick={() => setLayout('split')}>
                      <Columns2 size={15} />
                    </IconButton>
                  </div>
                  <div class="popover-anchor">
                    <IconButton
                      label="Diff display settings"
                      active={settingsOpen.value}
                      onClick={() => (settingsOpen.value = !settingsOpen.value)}
                    >
                      <Settings2 size={16} />
                    </IconButton>
                    {!!settingsOpen.value && (
                      <>
                        <Dismiss onClose={() => (settingsOpen.value = false)} />
                        <div class={`popover ${styles['settings-popover']}`}>
                          <div class="popover-title">Diff preferences</div>
                          {(
                            [
                              ['backgrounds', 'Change backgrounds'],
                              ['lineNumbers', 'Line numbers'],
                              ['wordWrap', 'Word wrap'],
                            ] as const
                          ).map(([key, label]) => (
                            <label class={styles['setting-row']}>
                              <span>{label}</span>
                              <input
                                type="checkbox"
                                role="switch"
                                class={switchStyles.switch}
                                checked={props.settings[key]}
                                onChange={e => props.onSettings({ ...props.settings, [key]: (e.target as HTMLInputElement).checked })}
                              />
                            </label>
                          ))}
                          <label class={styles['setting-row']}>
                            <span>Indicators</span>
                            <select
                              aria-label="Diff indicator style"
                              value={props.settings.indicators}
                              onChange={e =>
                                props.onSettings({ ...props.settings, indicators: inputValue(e) as DiffSettings['indicators'] })
                              }
                            >
                              <option value="classic">+ / −</option>
                              <option value="bars">Bars</option>
                              <option value="none">None</option>
                            </select>
                          </label>
                          <label class={styles['setting-row']}>
                            <span>Comment placement</span>
                            <select
                              aria-label="Comment placement"
                              value={props.settings.commentPlacement}
                              onChange={e =>
                                props.onSettings({
                                  ...props.settings,
                                  commentPlacement: inputValue(e) as DiffSettings['commentPlacement'],
                                })
                              }
                            >
                              <option value="inline">Inline on diff</option>
                              <option value="below">Below each file</option>
                            </select>
                          </label>
                          <label class={styles['setting-row']}>
                            <span>Hide bot comments</span>
                            <input
                              type="checkbox"
                              role="switch"
                              class={switchStyles.switch}
                              checked={props.settings.hideBotComments}
                              onChange={e =>
                                props.onSettings({ ...props.settings, hideBotComments: (e.target as HTMLInputElement).checked })
                              }
                            />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {!!selectedRange.value && (
                  <div class="flex items-center justify-between gap-4 py-3 px-5 text-xs text-secondary bg-accent-soft">
                    <span>
                      Comparing {selectedRange.value!.base.slice(0, 7)} → {selectedRange.value!.head.slice(0, 7)} · Read-only range. Switch
                      to All commits to comment on the current PR diff.
                    </span>
                    <button
                      class="button small"
                      title="Restore the full PR diff and its inline review comments"
                      disabled={busy.value}
                      onClick={() => void changeRange(null)}
                    >
                      All commits
                    </button>
                  </div>
                )}
                {!!comparison.value?.truncated && (
                  <div class="warning-banner">
                    GitHub comparisons include at most 300 changed files. This range may be incomplete; open GitHub for the full comparison.
                  </div>
                )}
                {!!focusedFile.value && (
                  <div class="file-focus-banner">
                    <FileCodeIcon />
                    <span>Expanded file · {focusedFile.value}</span>
                    <button class="button small" title="Exit expanded file view and restore the file list" onClick={() => focusFile(null)}>
                      <X size={13} />
                      Back to all files
                    </button>
                  </div>
                )}
                <div class="diff-list">
                  {pendingSection('files') ? (
                    <Loader label="Loading changed files…" />
                  ) : visibleFiles.value.length ? (
                    <>
                      {visibleFiles.value.map((file, index) => (
                        <DiffView
                          class={entrance(`file-${file.filename}`)}
                          style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
                          file={file}
                          settings={props.settings}
                          collapsed={collapsed.value.has(file.filename)}
                          viewed={viewed.value.has(file.filename)}
                          search={contentQuery.value}
                          githubUrl={
                            selectedRange.value
                              ? `${pr().html_url.replace(/\/pull\/\d+$/, '')}/compare/${selectedRange.value!.base}...${selectedRange.value!.head}`
                              : `${pr().html_url}/files`
                          }
                          baseUrl={markdownBase()}
                          focused={focusedFile.value === file.filename}
                          onFocus={() => focusFile(focusedFile.value ? null : file.filename)}
                          comments={selectedRange.value ? [] : allComments.value.filter(comment => comment.path === file.filename)}
                          pendingCommentCount={
                            selectedRange.value ? 0 : ws().draftComments.filter(comment => comment.path === file.filename).length
                          }
                          threads={ws().reviewThreads}
                          onResolve={resolveThread}
                          replies={replyActions}
                          loadContext={loadContext}
                          commentingEnabled={!selectedRange.value && !comparing.value}
                          composer={
                            dialog.value === 'inline' && inlineLocation.value.path === file.filename
                              ? {
                                  line: inlineLocation.value.line,
                                  side: inlineLocation.value.side,
                                  render: () => (
                                    <InlineComposer
                                      location={inlineLocation.value}
                                      body={inlineBody.value}
                                      pending={!!pending.value}
                                      busy={false}
                                      error={error.value}
                                      canComment={canReply()}
                                      canStartReview={canReview()}
                                      stale={stalePending()}
                                      onBody={value => (inlineBody.value = value)}
                                      onClose={safeClose}
                                      onPost={start => void postInline(start)}
                                    />
                                  ),
                                }
                              : undefined
                          }
                          onToggle={() => toggleCollapsed(file.filename)}
                          onCopyName={() => copy('file path', file.filename)}
                          onViewed={() => toggleViewed(file.filename)}
                          selectedThreadId={selectedThreadId.value}
                          onThreadAnchor={onThreadAnchor}
                          onComment={(line, side, start) => openInline(file, { line, side }, start)}
                        />
                      ))}
                    </>
                  ) : (
                    <div class="empty-state">
                      <Search size={28} />
                      <h3>{selectedRange.value && !displayFiles.value.length ? 'No changes in this range' : 'No matching files'}</h3>
                      <p>Try another range, Git status, file name, or search term.</p>
                      <button class="button" title="Clear Git status, filename, and diff-content filters" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                <div class="diff-footer">
                  <ShieldCheck size={13} />
                  <span>
                    {`${selectedRange.value ? 'Viewing' : 'Reviewing'} commit ${(selectedRange.value?.head || pr().head.sha).slice(0, 7)}`}
                  </span>
                  <span>
                    {selectedRange.value
                      ? 'Historical comparison · Read-only'
                      : 'Expand hidden lines above/below hunks · Click a line number or + to comment'}
                  </span>
                </div>
              </>
            )}
          </div>
        </main>
        {!!commentsOpen.value && (
          <CommentsPanel
            loading={pendingSection('comments', 'inlineComments', 'reviewThreads')}
            entries={panelEntries.value}
            selectedId={selectedThreadId.value}
            hideBots={props.settings.hideBotComments}
            replies={replyActions}
            baseUrl={markdownBase()}
            onClose={() => (commentsOpen.value = false)}
            onNavigate={navigateComment}
            onResolve={resolveThread}
          />
        )}
        <AnimatePresence>
          {!!toast.value.message && (
            <motion.div key={`toast-${toast.value.id}`} {...rise()} class={styles.toast} data-tone={toast.value.tone} role="status">
              <span aria-hidden="true">{toast.value.tone === 'error' ? <CircleX size={13} /> : <Check size={13} />}</span>
              {toast.value.message}
            </motion.div>
          )}
          {dialog.value === 'review' && (
            <Modal key="review" title="Submit your review" subtitle={`${ref().owner}/${ref().repo} #${pr().number}`} onClose={safeClose}>
              <form onSubmit={submitReview}>
                {!!pendingComments.value.length && (
                  <div class={styles['pending-comment-list']} aria-label="Pending review comments">
                    {pendingComments.value.map(comment => (
                      <section class={styles['pending-comment']} key={comment.id}>
                        <div class="flex items-center gap-2">
                          <button
                            class={styles['pending-comment-location']}
                            title={`Jump to ${commentLocationLabel(comment)}`}
                            onClick={() => navigatePendingComment(comment)}
                            type="button"
                          >
                            {commentLocationLabel(comment)}
                          </button>
                          <CommentActions item={comment} actions={edits} />
                        </div>
                        <CommentBody item={comment} actions={edits} baseUrl={markdownBase()} />
                      </section>
                    ))}
                  </div>
                )}
                <label class="input-label" for="review-body">
                  Review summary <span class="muted">{event.value === 'APPROVE' ? '(optional)' : ''}</span>
                </label>
                <MentionField
                  id="review-body"
                  class="review-textarea"
                  placeholder="What would you like the author to know?"
                  value={reviewBody.value}
                  onInput={value => (reviewBody.value = value)}
                  maxlength={65000}
                  disabled={busy.value}
                />
                <div class="review-options">
                  <label class={`review-option ${event.value === 'COMMENT' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="event"
                      value="COMMENT"
                      checked={event.value === 'COMMENT'}
                      onChange={() => (event.value = 'COMMENT')}
                    />
                    <MessageSquare size={17} />
                    <span>
                      <strong>Comment</strong>
                      <small>Submit general feedback without approving.</small>
                    </span>
                  </label>
                  <label class={`review-option ${event.value === 'APPROVE' ? 'selected' : ''} ${ownPR() || pr().draft ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="event"
                      value="APPROVE"
                      checked={event.value === 'APPROVE'}
                      disabled={ownPR() || pr().draft}
                      onChange={() => (event.value = 'APPROVE')}
                    />
                    <CircleCheck size={17} />
                    <span>
                      <strong>Approve</strong>
                      <small>
                        {ownPR()
                          ? 'You cannot approve your own pull request.'
                          : pr().draft
                            ? 'Mark this PR ready for review on GitHub first.'
                            : 'Looks good. This change is ready to go.'}
                      </small>
                    </span>
                  </label>
                  <label class={`review-option ${event.value === 'REQUEST_CHANGES' ? 'selected' : ''} ${ownPR() ? 'disabled' : ''}`}>
                    <input
                      type="radio"
                      name="event"
                      value="REQUEST_CHANGES"
                      checked={event.value === 'REQUEST_CHANGES'}
                      disabled={ownPR()}
                      onChange={() => (event.value = 'REQUEST_CHANGES')}
                    />
                    <RefreshCw size={17} />
                    <span>
                      <strong>Request changes</strong>
                      <small>
                        {ownPR() ? 'You cannot request changes on your own PR.' : 'Suggest changes that should be addressed first.'}
                      </small>
                    </span>
                  </label>
                </div>
                {!!error.value && (
                  <p class="error-message" role="alert">
                    {error.value}
                  </p>
                )}
                <div class="submission-note">
                  {`This will ${event.value === 'APPROVE' ? 'approve' : 'submit a review on'} #${pr().number} on GitHub as ${viewer().login}.`}
                </div>
                <div class="modal-footer">
                  <button class="button" title="Close without submitting your review" type="button" onClick={safeClose}>
                    Cancel
                  </button>
                  <button
                    class="button primary"
                    title={`Submit your ${event.value === 'APPROVE' ? 'approval' : event.value === 'REQUEST_CHANGES' ? 'request for changes' : 'review feedback'} and pending comments to GitHub`}
                    type="submit"
                    disabled={
                      stalePending() ||
                      (event.value === 'APPROVE' && (ownPR() || pr().draft)) ||
                      (event.value === 'REQUEST_CHANGES' && ownPR())
                    }
                  >
                    <CheckCheck size={15} />
                    Submit review
                  </button>
                </div>
              </form>
            </Modal>
          )}
          {dialog.value === 'discard' && (
            <Modal key="discard" title="Discard pending review?" subtitle="This cannot be undone." onClose={safeClose}>
              <p class="text-xs text-secondary leading-loose">
                This deletes your pending review and all its unpublished comments from GitHub. Already published comments stay unchanged.
              </p>
              {!!error.value && (
                <p class="error-message" role="alert">
                  {error.value}
                </p>
              )}
              <div class="modal-footer">
                <button class="button" title="Keep your pending review and unpublished comments" onClick={safeClose}>
                  Keep review
                </button>
                <button
                  class="button danger"
                  title="Permanently delete your pending review and its unpublished comments"
                  onClick={() => void discardReview()}
                >
                  Discard review
                </button>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
    );
  },
  { props: ['store', 'api', 'info', 'settings', 'onSettings', 'onOpen', 'onBack', 'hash'] },
);
