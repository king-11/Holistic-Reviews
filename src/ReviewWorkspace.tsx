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
  type ChangedFile,
  type Comment,
  type Commit,
  type Comparison,
  type GitHub,
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
import Checks from './Checks';
import DetailsPanel, { MergeControls, MoreMenu, reviewApproved, useDetails, type Details, type Mutate } from './DetailsPanel';
import DiffView, { type ContextLoader, type DiffSettings } from './DiffView';
import { IconButton, Loader, Modal, SearchField, Spinner, inputValue, update, Dismiss } from './ui';
import MentionField from './MentionField';
import { peopleDirectory, peopleKey } from './people';
import { markInboxStale, recordPR } from './inboxUpdates';
import { toggleViewedFile, verifiedContextLines } from './diff';
import { commentEntries, commentRange, diffLinePreview, isBot, withThreadLocations, type CommentEntry, type LinePoint } from './comments';
import CommentsPanel from './CommentsPanel';
import InlineComposer, { type InlineLocation } from './InlineComposer';
import type { ReplyActions } from './ReviewThread';
import type { PRWorkspace } from './prWorkspace';
import { isReview, type EditActions, type Editable } from './CommentEditor';
import { createReactionActions, type ReactionActions } from './Reactions';
import PRHeader from './PRHeader';
import ConversationTab from './ConversationTab';
import { CommitHistory, CommitPicker, type CommitRange } from './Commits';
import { FileCodeIcon } from './FileIcon';
import { filterFiles, type FileStatus } from './file_filters';
import { mutationBusy } from './session';
import styles from './ReviewWorkspace.module.css';
import switchStyles from './switch.module.css';

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
    // Submitting a review or single inline comment satisfies the viewer's request on GitHub, even before the PR reread catches up.
    const clearOwnRequest = () => {
      if (pr().requested_reviewers?.some(user => user.login === viewer().login))
        props.store.setPR({ requested_reviewers: pr().requested_reviewers!.filter(user => user.login !== viewer().login) });
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
    // The kept-alive inbox corrects this PR's row from what this page knows, ahead of GitHub search catching up.
    watchEffect(() => {
      if (ws().reviewsLoaded) recordPR(pr(), ws().reviews, ws().inlineComments, viewer().login, props.info.teams);
    });

    // One flag for every write: App also reads it to hold navigation until the write lands.
    const busy = mutationBusy;
    const error = shallowRef('');
    const notice = shallowRef('');
    onUnmounted(() => (busy.value = false));

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
    const copy = (label: string, text: string) =>
      navigator.clipboard.writeText(text).then(
        () => showToast(`Copied ${label}`),
        () => showToast('Clipboard unavailable in this browser', 'error'),
      );
    const mutate: Mutate = async (work, { toast, refresh = 'pr' } = {}) => {
      if (busy.value) return false;
      busy.value = true;
      error.value = '';
      notice.value = '';
      try {
        await work(props.api);
        markInboxStale(pr().html_url);
        if (toast) showToast(toast);
        if (active && refresh !== 'none') props.store.refresh(refresh);
        return true;
      } catch (failure) {
        const message = errorMessage(failure, 'GitHub could not complete this action.');
        if (toast) showToast(message, 'error');
        else if (active) error.value = message;
        return false;
      } finally {
        busy.value = false;
      }
    };

    let draftLoadVersion = 0;
    async function loadPendingComments(review: Review, fresh = false) {
      const version = ++draftLoadVersion;
      const result = await (fresh ? props.api.fresh() : props.api).reviewComments(ref(), review.id);
      if (active && version === draftLoadVersion && pending.value?.id === review.id) props.store.patch({ draftComments: result });
    }
    watchEffect(() => {
      const review = pending.value;
      if (review)
        void loadPendingComments(review).catch(error => {
          if (active) notice.value = `Pending comments could not be loaded: ${errorMessage(error, String(error))}`;
        });
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
    const changeComment = (item: Editable, body?: string) => {
      if (isReview(item)) props.store.edit('reviews', prev => withBody(prev, item.id, body));
      else if (!item.path && !item.pull_request_review_id) props.store.edit('comments', prev => withBody(prev, item.id, body));
      else {
        props.store.edit('inlineComments', prev => withBody(prev, item.id, body));
        props.store.edit('draftComments', prev => withBody(prev, item.id, body));
      }
    };
    const inPendingReview = (item: Editable) => !isReview(item) && !!pending.value && item.pull_request_review_id === pending.value.id;
    const edits: EditActions = {
      can: item =>
        (moderator.value || item.user.id === viewer().id) && (!isReview(item) || (item.state !== 'PENDING' && !!item.body?.trim())),
      disabled: () => busy.value,
      save: (item, text) =>
        mutate(async () => {
          const body = text.trim();
          await (isReview(item)
            ? props.api.editReview(ref(), item.id, body)
            : props.api.editComment(ref(), item, body, inPendingReview(item)));
          changeComment(item, body);
          done('Comment updated on GitHub.');
        }),
      remove: item =>
        mutate(async () => {
          const review = inPendingReview(item) ? pending.value : undefined;
          await props.api.deleteComment(ref(), item, !!review);
          changeComment(item);
          const removedByGitHub =
            !!review &&
            (await props.api
              .fresh()
              .reviewExists(ref(), review.id)
              .then(
                exists => !exists,
                () => false,
              ));
          if (removedByGitHub) {
            props.store.edit('reviews', prev => prev.filter(other => other.id !== review.id));
            props.store.patch({ draftComments: [] });
          }
          done(removedByGitHub ? 'Comment deleted. GitHub removed the now-empty pending review.' : 'Comment deleted from GitHub.');
        }),
    };
    const reactions = createReactionActions(
      () => props.api,
      ref,
      () => viewer().id,
    );

    const replyDrafts = shallowRef<Record<number, { body: string; error?: string }>>({});
    const replyActions: ReplyActions = {
      reactions,
      edits,
      get pendingReviewId() {
        return pending.value?.id;
      },
      get disabled() {
        return busy.value || !canReply();
      },
      get canStartReview() {
        return canReview();
      },
      draft: id => replyDrafts.value[id] || { body: '' },
      onChange: (id, body) => update(replyDrafts, prev => ({ ...prev, [id]: { body } })),
      onReply: replyToComment,
    };
    async function replyToComment(id: number, body: string, startReview = false) {
      const saved = await mutate(async () => {
        if (!canReply()) throw new Error('Refresh this PR and its active review before replying.');
        if (startReview && !canReview()) throw new Error('Reviews can only be started on open pull requests.');
        const root = allComments.value.find(comment => comment.id === id);
        if (!root) throw new Error('This comment is no longer loaded. Refresh before replying.');
        let current = pending.value;
        let thread = ws().reviewThreads.find(thread => thread.rootCommentId === id);
        if ((current || startReview) && !thread) {
          const result = await props.api.fresh().reviewThreads(ref());
          props.store.patch({ reviewThreads: result.items });
          thread = result.items.find(thread => thread.rootCommentId === id);
          if (!thread) throw new Error('Thread metadata is unavailable. Open this thread on GitHub or refresh before starting a review.');
        }
        const starting = startReview && !current;
        if (starting) {
          const started = await props.api.startReview(ref(), pr().head.sha);
          current = started;
          props.store.edit('reviews', prev => [...prev, started]);
        }
        const result = await props.api.reply(ref(), id, body, current, thread?.id);
        const comment = {
          ...result,
          path: root.path,
          line: root.line,
          side: root.side,
          pull_request_review_id: current?.id || result.pull_request_review_id,
        };
        if (current) {
          ++draftLoadVersion;
          props.store.edit('draftComments', prev => [...prev, comment]);
        } else {
          props.store.edit('inlineComments', prev => [...prev, comment]);
          clearOwnRequest();
        }
        update(replyDrafts, prev => ({ ...prev, [id]: { body: '' } }));
        done(
          starting
            ? 'Review started with this pending reply. Subsequent comments and replies join this review.'
            : current
              ? 'Reply added to your pending review. It will publish when you submit the review.'
              : 'Reply posted to GitHub.',
        );
      });
      if (!saved)
        update(replyDrafts, prev => ({
          ...prev,
          [id]: { body, error: error.value || 'Reply was not saved. Refresh before trying again.' },
        }));
      return saved;
    }
    async function resolveThread(id: string, resolved: boolean) {
      return mutate(async () => {
        const thread = ws().reviewThreads.find(item => item.id === id);
        if (!thread || !(resolved ? thread.canResolve : thread.canUnresolve))
          throw new Error('You do not have permission to change this thread.');
        const result = await props.api.setThreadResolved(id, resolved);
        props.store.edit('reviewThreads', prev => prev.map(item => (item.id === id ? { ...item, ...result } : item)));
        done(`Thread ${resolved ? 'resolved' : 'reopened'} on GitHub.`);
      });
    }

    const dialog = shallowRef<Dialog>(null);
    const event = shallowRef<ReviewEvent>('COMMENT');
    const reviewBody = shallowRef('');
    const reviewable = () => !busy.value && canReview() && !stalePending();
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
      if (!busy.value) {
        dialog.value = null;
        error.value = '';
      }
    }
    async function submitReview(e?: SubmitEvent) {
      e?.preventDefault();
      if (event.value !== 'APPROVE' && !reviewBody.value.trim() && !ws().draftComments.length) {
        error.value = 'Add a review summary or a pending inline comment.';
        return;
      }
      await mutate(async () => {
        const result = await props.api.submitReview(ref(), pr().head.sha, event.value, reviewBody.value.trim(), pending.value);
        const current = pending.value;
        entered.set(`review-${result.id}`, 'grow-in');
        props.store.edit('reviews', prev => [...prev.filter(review => review.id !== current?.id), result]);
        props.store.edit('inlineComments', prev => [...prev, ...ws().draftComments]);
        clearOwnRequest();
        props.store.patch({ draftComments: [] });
        reviewBody.value = '';
        dialog.value = null;
        done(`${event.value === 'APPROVE' ? 'Approval' : 'Review'} submitted to GitHub.`, await refreshThreads());
      });
    }
    const discardReview = () =>
      mutate(async () => {
        const current = pending.value;
        if (!current) return;
        const deleted = await props.api.discardReview(ref(), current.id);
        props.store.edit('reviews', prev => prev.filter(review => review.id !== current.id));
        props.store.patch({ draftComments: [] });
        dialog.value = null;
        done(deleted ? 'Pending review discarded.' : 'This pending review was already gone on GitHub; cleared it here.');
      });

    const inlineBody = shallowRef('');
    const inlineLocation = shallowRef<InlineLocation>({ path: '', line: 0, side: 'RIGHT' });
    function openInline(file: ChangedFile, end: LinePoint, start?: LinePoint) {
      if (busy.value || selectedRange.value || comparing.value) return;
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
      await mutate(async () => {
        if (selectedRange.value || comparing.value) throw new Error('Switch to All commits before adding a review comment.');
        const location = inlineLocation.value;
        const text = inlineBody.value.trim();
        const file = ws().files.find(file => file.filename === location.path);
        if (
          !file ||
          !commentRange(file, { line: location.startLine ?? location.line, side: location.startSide ?? location.side }, location)
        )
          throw new Error('Additional context is read-only. Select lines in one hunk of the original PR diff to comment.');
        const comment: ReviewCommentInput = {
          path: location.path,
          line: location.line,
          side: location.side,
          ...(location.startLine && location.startSide ? { start_line: location.startLine, start_side: location.startSide } : {}),
          body: text,
        };
        let current = pending.value;
        const starting = start && !current;
        let refreshWarning = '';
        if (starting) {
          const started = await props.api.startReview(ref(), pr().head.sha, comment);
          current = started;
          props.store.edit('reviews', prev => [...prev, started]);
        } else {
          await props.api.inlineComment(ref(), pr().head.sha, comment, current);
          if (!current) clearOwnRequest();
        }
        try {
          if (current) await loadPendingComments(current, true);
          else
            props.store.patch({
              inlineComments: (await props.api.fresh().pages<Comment>(`/repos/${ref().owner}/${ref().repo}/pulls/${ref().number}/comments`))
                .items,
            });
        } catch {
          refreshWarning = ' Comment saved, but comments could not be refreshed. Refresh the PR to see it; do not post it again.';
        }
        refreshWarning += await refreshThreads();
        inlineBody.value = '';
        dialog.value = null;
        done(
          starting
            ? 'Review started with this pending comment. Add more feedback, then finish your review to publish.'
            : current
              ? 'Comment added to your pending GitHub review.'
              : 'Inline comment posted to GitHub.',
          refreshWarning,
        );
      });
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
      if (next && !busy.value) props.onOpen(next.url);
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
        viewed.value = new Set<string>();
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
    const viewed = shallowRef<Set<string>>(new Set());
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
    function toggleViewed(filename: string) {
      const next = toggleViewedFile(filename, viewed.value, collapsed.value);
      viewed.value = next.viewed;
      collapsed.value = next.collapsed;
    }
    const toggleSelectedViewed = () => selected.value && toggleViewed(selected.value);
    const allCollapsed = () => files.value.length > 0 && files.value.every(file => collapsed.value.has(file.filename));
    const toggleAll = () => (collapsed.value = allCollapsed() ? new Set() : new Set(displayFiles.value.map(file => file.filename)));
    const setLayout = (layout: DiffSettings['layout']) => props.onSettings({ ...props.settings, layout });

    const commentsOpen = shallowRef(false);
    const selectedThreadId = shallowRef<number | null>(null);
    const threadAnchors = new Map<number, HTMLElement>();
    let wantedThreadId: number | null = null;
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
    }
    function navigateComment(entry: CommentEntry) {
      if (window.matchMedia('(max-width: 1100px)').matches) commentsOpen.value = false;
      if (entry.kind === 'conversation') {
        tab.value = 'conversation';
        requestAnimationFrame(() =>
          document.getElementById(`conversation-comment-${entry.comment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        );
        return;
      }
      if (!entry.file) return;
      const id = entry.root.in_reply_to_id || entry.root.id;
      wantedThreadId = id;
      selectedThreadId.value = id;
      selectFile(entry.file.filename, false);
      requestAnimationFrame(() => scrollToThread(id));
    }
    let commentCursor = -1;
    const moveComment = (delta: 1 | -1) => {
      const entries = panelEntries.value;
      const entry = step(entries, entries[commentCursor], delta);
      if (!entry) return;
      commentCursor = entries.indexOf(entry);
      navigateComment(entry);
    };

    const shortcuts: Record<string, () => void> = {
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
      'shift+mod+ArrowUp': () => openStacked(1),
      'shift+mod+ArrowDown': () => openStacked(-1),
      o: () => window.open(pr().html_url, '_blank', 'noopener,noreferrer'),
      'g i': () => props.onBack(),
      'r y': () => {
        if (!reviewable() || ownPR()) return;
        event.value = 'APPROVE';
        void submitReview();
      },
      'r a': () => review('APPROVE'),
      'r c': () => {
        tab.value = 'conversation';
        focusSoon('#pr-comment');
      },
      'r n': () => review('REQUEST_CHANGES'),
      'r r': () => review('COMMENT'),
      'c l': () => copy('link to PR', window.location.href),
      'c t': () => copy('title', pr().title),
      'c b': () => copy('branch name', pr().head.ref),
      'c c': () => copy('checkout command', `gh pr checkout ${pr().number} --repo ${ref().owner}/${ref().repo}`),
      'c g': () => copy('GitHub link', pr().html_url),
      'c s': () =>
        copy(
          'stack',
          stack()
            .map(entry => `${entry.number === pr().number ? '→ ' : ''}#${entry.number} ${entry.title} ${entry.url}`)
            .join('\n'),
        ),
      'c p': () => copy('PR', `[${pr().title} #${pr().number}](${pr().html_url})`),
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
              disabled={busy.value}
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
                    disabled={busy.value}
                    onClick={() => {
                      error.value = '';
                      dialog.value = 'discard';
                    }}
                  >
                    Discard pending
                  </button>
                  <button
                    class="button small"
                    title="Continue your pending review"
                    disabled={busy.value}
                    onClick={() => (tab.value = 'review')}
                  >
                    <Check size={14} />
                    Review in progress
                  </button>
                </>
              )}
              <button
                class="button small"
                title="Write a review, approve, or request changes"
                disabled={busy.value || !canReview() || stalePending()}
                onClick={() => openReview('COMMENT')}
              >
                Review changes
              </button>
              <MergeControls
                pr={pr()}
                prRef={ref()}
                methods={ws().mergeMethods ?? []}
                autoMerge={!!ws().autoMerge}
                approved={approved()}
                disabled={busy.value}
                onMutate={mutate}
              />
              <MoreMenu details={details} />
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
                busy={busy.value}
                prRef={ref()}
                onMutate={mutate}
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
                                      busy={busy.value}
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
                {!!ws().draftComments.length && (
                  <p class={`text-xs text-secondary flex items-center gap-1 ${styles['mt-4']}`}>
                    <MessageSquare size={14} />
                    Includes {ws().draftComments.length} pending inline {ws().draftComments.length === 1 ? 'comment' : 'comments'}.
                  </p>
                )}
                {!!error.value && (
                  <p class="error-message" role="alert">
                    {error.value}
                  </p>
                )}
                <div class="submission-note">
                  {`This will ${event.value === 'APPROVE' ? 'approve' : 'submit a review on'} #${pr().number} on GitHub as ${viewer().login}.`}
                </div>
                <div class="modal-footer">
                  <button
                    class="button"
                    title="Close without submitting your review"
                    type="button"
                    onClick={safeClose}
                    disabled={busy.value}
                  >
                    Cancel
                  </button>
                  <button
                    class="button primary"
                    title={`Submit your ${event.value === 'APPROVE' ? 'approval' : event.value === 'REQUEST_CHANGES' ? 'request for changes' : 'review feedback'} and pending comments to GitHub`}
                    type="submit"
                    disabled={
                      busy.value ||
                      stalePending() ||
                      (event.value === 'APPROVE' && (ownPR() || pr().draft)) ||
                      (event.value === 'REQUEST_CHANGES' && ownPR())
                    }
                  >
                    {busy.value ? (
                      <Spinner text="Submitting…" />
                    ) : (
                      <>
                        <CheckCheck size={15} />
                        Submit review
                      </>
                    )}
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
                <button class="button" title="Keep your pending review and unpublished comments" onClick={safeClose} disabled={busy.value}>
                  Keep review
                </button>
                <button
                  class="button danger"
                  title="Permanently delete your pending review and its unpublished comments"
                  disabled={busy.value}
                  onClick={() => void discardReview()}
                >
                  {busy.value ? <Spinner text="Discarding…" /> : 'Discard review'}
                </button>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
    );
  },
  { props: ['store', 'api', 'info', 'settings', 'onSettings', 'onOpen', 'onBack'] },
);
