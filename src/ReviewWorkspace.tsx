import { computed, defineComponent, onMounted, onUnmounted, shallowRef, watch, watchEffect } from 'vue';
import { createShortcuts, modalOpen, step } from './shortcuts';
import { AnimatePresence, motion } from 'motion-v';
import { drop, rise } from './motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleX,
  Columns2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Layers,
  List,
  MessageSquare,
  MessagesSquare,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from '@lucide/vue';
import {
  blockingStates,
  branchRelations,
  errorMessage,
  mergeReady,
  type ChangedFile,
  type Comment,
  type Commit,
  type Comparison,
  type GitHub,
  type PRRef,
  type Review,
  type ReviewCommentInput,
  type TokenInfo,
  type User,
  type Workspace,
  type WorkspaceSection,
} from './github';
import FileTree from './FileTree';
import Checks from './Checks';
import DetailsPanel, { Information, MergeControls, MoreMenu, ReviewIcon, reviewerStates, useDetails, type Run } from './DetailsPanel';
import DiffView, { type ContextLoader, type DiffSettings } from './DiffView';
import {
  Avatar,
  CodeSnippet,
  IconButton,
  Loader,
  Modal,
  SearchField,
  Spinner,
  Timestamp,
  inputValue,
  timeAgo,
  fullDate,
  update,
  Dismiss,
} from './ui';
import Markdown from './MarkdownView';
import { toggleViewedFile, verifiedContextLines } from './diff';
import {
  commentEntries,
  commentRange,
  commentSnippet,
  diffLinePreview,
  isBot,
  withThreadLocations,
  type CommentEntry,
  type LinePoint,
} from './comments';
import CommentsPanel from './CommentsPanel';
import InlineComposer, { type InlineLocation } from './InlineComposer';
import type { ReplyActions } from './ReviewThread';
import { CommentActions, CommentBody, isReview, type EditActions, type Editable } from './CommentEditor';
import ReactionBar, { createReactionActions } from './Reactions';
import { CommitHistory, CommitPicker, type CommitRange } from './Commits';
import { filterFiles, type FileStatus } from './file_filters';
import styles from './ReviewWorkspace.module.css';
import switchStyles from './switch.module.css';

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
type Dialog = 'review' | 'inline' | 'discard' | null;

type Props = {
  workspace: Workspace;
  api: GitHub;
  info: TokenInfo;
  settings: DiffSettings;
  onSettings: (settings: DiffSettings) => void;
  onOpen: (url: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onBusy: (busy: boolean) => void;
};

export default defineComponent(
  (props: Props) => {
    const pr = () => props.workspace.pr;
    const ref = (): PRRef => {
      const [owner, repo] = (pr().base.repo?.full_name || '').split('/');
      return { owner, repo, number: pr().number };
    };
    const prUrl = (number: number) => `https://github.com/${ref().owner}/${ref().repo}/pull/${number}`;
    const markdownBase = () => `${pr().html_url.replace(/\/pull\/\d+(?:\/.*)?$/, '')}/blob/${pr().head.sha}/`;
    const viewer = () => props.info.user;
    const ownPR = () => pr().user.id === viewer().id;
    const pendingSection = (...sections: WorkspaceSection[]) => sections.some(section => props.workspace.pending.includes(section));
    const tab = shallowRef<'changes' | 'conversation' | 'review' | 'commits' | 'checks'>('changes');
    let active = true;
    onUnmounted(() => (active = false));

    // Sections arrive after mount; keep anything posted locally that the server snapshot doesn't include yet.
    const mirror = <T extends { id: number | string }>(source: () => T[] | undefined) => {
      const state = shallowRef(source() ?? []);
      watch(source, incoming => {
        const next = incoming ?? [];
        state.value = [...next, ...state.value.filter(item => !next.some(other => other.id === item.id))];
      });
      return state;
    };
    const comments = mirror(() => props.workspace.comments);
    const inlineComments = mirror(() => props.workspace.inlineComments);
    const reviews = mirror(() => props.workspace.reviews);
    const threads = mirror(() => props.workspace.reviewThreads);
    const draftComments = shallowRef<Comment[]>([]);
    const pending = computed(() => reviews.value.find(review => review.user.id === viewer().id && review.state === 'PENDING'));
    const stalePending = () => !!pending.value && pending.value?.commit_id !== pr().head.sha;
    const canReview = () => props.workspace.reviewsLoaded && pr().state === 'open';
    const canReply = () => props.workspace.reviewsLoaded && !stalePending();

    const busy = shallowRef(false);
    const error = shallowRef('');
    const notice = shallowRef('');
    watchEffect(() => props.onBusy(busy.value));
    onUnmounted(() => props.onBusy(false));
    async function action(work: () => Promise<void>) {
      if (busy.value) return false;
      busy.value = true;
      error.value = '';
      notice.value = '';
      try {
        await work();
        return true;
      } catch (failure) {
        if (active) error.value = errorMessage(failure, 'GitHub could not complete this action.');
        return false;
      } finally {
        if (active) busy.value = false;
      }
    }

    const toast = shallowRef('');
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const showToast = (message: string) => {
      toast.value = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.value = ''), 2000);
    };
    onUnmounted(() => clearTimeout(toastTimer));
    const copy = (label: string, text: string) =>
      navigator.clipboard.writeText(text).then(
        () => showToast(`Copied ${label}`),
        () => showToast('Clipboard unavailable in this browser'),
      );
    // Kept apart from `busy`, which also blocks App from reloading the PR after the write.
    const acting = shallowRef(false);
    const run: Run = async (label, work, refresh = true) => {
      if (acting.value) return;
      acting.value = true;
      try {
        const result = await work(props.api);
        showToast(typeof label === 'function' ? label(result) : label);
        if (refresh) props.onRefresh();
        return result;
      } catch (failure) {
        showToast(errorMessage(failure, 'GitHub could not complete this action.'));
      } finally {
        acting.value = false;
      }
    };

    let draftLoadVersion = 0;
    async function loadPendingComments(review: Review, fresh = false) {
      const version = ++draftLoadVersion;
      const result = await (fresh ? props.api.fresh() : props.api).reviewComments(ref(), review.id);
      if (active && version === draftLoadVersion && pending.value?.id === review.id) draftComments.value = result;
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
        if (active) threads.value = result.items;
        return result.truncated ? ' Some thread statuses are unavailable. Open GitHub for the rest.' : '';
      } catch {
        return ' Feedback saved, but thread status could not be refreshed. Refresh the PR before resolving new threads.';
      }
    }

    const allComments = computed(() =>
      withThreadLocations(
        [...draftComments.value, ...inlineComments.value].filter(
          (item, index, array) => array.findIndex(other => other.id === item.id) === index,
        ),
        threads.value,
      ),
    );
    const shown = (item: { user: User }) => !props.settings.hideBotComments || !isBot(item.user);
    const panelEntries = computed(() =>
      commentEntries(props.workspace.files, allComments.value, comments.value, threads.value, props.settings.hideBotComments),
    );
    const visibleConversation = computed(() => comments.value.filter(shown));
    const visibleReviews = computed(() => reviews.value.filter(shown));

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
      if (isReview(item)) update(reviews, prev => withBody(prev, item.id, body));
      else if (!item.path && !item.pull_request_review_id) update(comments, prev => withBody(prev, item.id, body));
      else {
        update(inlineComments, prev => withBody(prev, item.id, body));
        update(draftComments, prev => withBody(prev, item.id, body));
      }
    };
    const inPendingReview = (item: Editable) => !isReview(item) && !!pending.value && item.pull_request_review_id === pending.value.id;
    const edits: EditActions = {
      can: item =>
        (moderator.value || item.user.id === viewer().id) && (!isReview(item) || (item.state !== 'PENDING' && !!item.body?.trim())),
      disabled: () => busy.value,
      save: (item, text) =>
        action(async () => {
          const body = text.trim();
          await (isReview(item)
            ? props.api.editReview(ref(), item.id, body)
            : props.api.editComment(ref(), item, body, inPendingReview(item)));
          changeComment(item, body);
          notice.value = 'Comment updated on GitHub.';
        }),
      remove: item =>
        action(async () => {
          const review = inPendingReview(item) ? pending.value : undefined;
          await props.api.deleteComment(ref(), item, !!review);
          changeComment(item);
          notice.value = 'Comment deleted from GitHub.';
          if (!review) return;
          const removedByGitHub = await props.api
            .fresh()
            .reviewExists(ref(), review.id)
            .then(
              exists => !exists,
              () => false,
            );
          if (!removedByGitHub) return;
          update(reviews, prev => prev.filter(other => other.id !== review.id));
          draftComments.value = [];
          notice.value = 'Comment deleted. GitHub removed the now-empty pending review.';
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
      const saved = await action(async () => {
        if (!canReply()) throw new Error('Refresh this PR and its active review before replying.');
        if (startReview && !canReview()) throw new Error('Reviews can only be started on open pull requests.');
        const root = allComments.value.find(comment => comment.id === id);
        if (!root) throw new Error('This comment is no longer loaded. Refresh before replying.');
        let current = pending.value;
        let thread = threads.value.find(thread => thread.rootCommentId === id);
        if ((current || startReview) && !thread) {
          const result = await props.api.fresh().reviewThreads(ref());
          threads.value = result.items;
          thread = result.items.find(thread => thread.rootCommentId === id);
          if (!thread) throw new Error('Thread metadata is unavailable. Open this thread on GitHub or refresh before starting a review.');
        }
        const starting = startReview && !current;
        if (starting) {
          const started = await props.api.startReview(ref(), pr().head.sha);
          current = started;
          update(reviews, prev => [...prev, started]);
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
          update(draftComments, prev => [...prev, comment]);
        } else update(inlineComments, prev => [...prev, comment]);
        update(replyDrafts, prev => ({ ...prev, [id]: { body: '' } }));
        notice.value = starting
          ? 'Review started with this pending reply. Subsequent comments and replies join this review.'
          : current
            ? 'Reply added to your pending review. It will publish when you submit the review.'
            : 'Reply posted to GitHub.';
      });
      if (!saved)
        update(replyDrafts, prev => ({
          ...prev,
          [id]: { body, error: error.value || 'Reply was not saved. Refresh before trying again.' },
        }));
      return saved;
    }
    async function resolveThread(id: string, resolved: boolean) {
      return action(async () => {
        const thread = threads.value.find(item => item.id === id);
        if (!thread || !(resolved ? thread.canResolve : thread.canUnresolve))
          throw new Error('You do not have permission to change this thread.');
        const result = await props.api.setThreadResolved(id, resolved);
        update(threads, prev => prev.map(item => (item.id === id ? { ...item, ...result } : item)));
        notice.value = `Thread ${resolved ? 'resolved' : 'reopened'} on GitHub.`;
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
      if (event.value !== 'APPROVE' && !reviewBody.value.trim() && !draftComments.value.length) {
        error.value = 'Add a review summary or a pending inline comment.';
        return;
      }
      await action(async () => {
        const result = await props.api.submitReview(ref(), pr().head.sha, event.value, reviewBody.value.trim(), pending.value);
        const current = pending.value;
        update(reviews, prev => [...prev.filter(review => review.id !== current?.id), result]);
        update(inlineComments, prev => [...prev, ...draftComments.value]);
        draftComments.value = [];
        reviewBody.value = '';
        dialog.value = null;
        const threadWarning = await refreshThreads();
        notice.value = `${event.value === 'APPROVE' ? 'Approval' : 'Review'} submitted to GitHub.${threadWarning}`;
      });
    }
    const discardReview = () =>
      action(async () => {
        const current = pending.value;
        if (!current) return;
        const deleted = await props.api.discardReview(ref(), current.id);
        update(reviews, prev => prev.filter(review => review.id !== current.id));
        draftComments.value = [];
        dialog.value = null;
        notice.value = deleted ? 'Pending review discarded.' : 'This pending review was already gone on GitHub; cleared it here.';
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
      if (!inlineBody.value.trim() || !canReview() || stalePending()) return;
      await action(async () => {
        if (selectedRange.value || comparing.value) throw new Error('Switch to All commits before adding a review comment.');
        const location = inlineLocation.value;
        const text = inlineBody.value.trim();
        const file = props.workspace.files.find(file => file.filename === location.path);
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
          update(reviews, prev => [...prev, started]);
        } else await props.api.inlineComment(ref(), pr().head.sha, comment, current);
        try {
          if (current) await loadPendingComments(current, true);
          else
            inlineComments.value = (
              await props.api.fresh().pages<Comment>(`/repos/${ref().owner}/${ref().repo}/pulls/${ref().number}/comments`)
            ).items;
        } catch {
          refreshWarning = ' Comment saved, but comments could not be refreshed. Refresh the PR to see it; do not post it again.';
        }
        refreshWarning += await refreshThreads();
        inlineBody.value = '';
        dialog.value = null;
        notice.value =
          (starting
            ? 'Review started with this pending comment. Add more feedback, then finish your review to publish.'
            : current
              ? 'Comment added to your pending GitHub review.'
              : 'Inline comment posted to GitHub.') + refreshWarning;
      });
    }

    const body = shallowRef('');
    async function postComment(e: SubmitEvent) {
      e.preventDefault();
      if (!body.value.trim()) return;
      await action(async () => {
        const result = await props.api.comment(ref(), body.value.trim());
        update(comments, prev => [...prev, result]);
        body.value = '';
        notice.value = 'Comment posted to GitHub.';
      });
    }

    const focused = new WeakSet<Element>();
    // Function refs rerun on every patch; focus each editor only when it first mounts.
    const focusOnce = (el: unknown) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || focused.has(el)) return;
      focused.add(el);
      if (el instanceof HTMLInputElement) el.select();
      else el.focus();
    };
    const titleDraft = shallowRef<string | null>(null);
    const saveTitle = () => {
      const title = titleDraft.value?.trim();
      titleDraft.value = null;
      if (title && title !== pr().title) void run('Title updated', api => api.editPR(ref(), { title }));
    };
    const bodyDraft = shallowRef<string | null>(null);
    const descriptionOpen = shallowRef(true);
    const saveBody = async () => {
      if (await run('Description updated', api => api.editPR(ref(), { body: bodyDraft.value ?? '' }))) bodyDraft.value = null;
    };
    const prStatus = () => {
      const current = pr();
      const checks = props.workspace.checks ?? [];
      const states = reviewerStates(current, reviews.value, props.workspace.onBehalfOf).map(([, state]) => state);
      if (current.merged) return ['Merged', GitMerge, 'merged'] as const;
      if (current.state === 'closed') return ['Closed', GitPullRequestClosed, 'blocked'] as const;
      if (current.draft) return ['Draft', CircleX, 'blocked'] as const;
      if (checks.some(check => blockingStates.includes(check.state))) return ['Checks failed', CircleX, 'blocked'] as const;
      if (
        mergeReady(current) &&
        !checks.some(check => check.state === 'pending') &&
        states.includes('APPROVED') &&
        !states.includes('CHANGES_REQUESTED')
      )
        return ['Ready to merge', CircleCheck, 'open'] as const;
      return ['Open', GitPullRequest, 'open'] as const;
    };

    const stackOpen = shallowRef(false);
    const relations = computed(() => branchRelations(pr(), props.workspace.related));
    const stack = () =>
      props.workspace.nativeStack
        ? [...props.workspace.nativeStack.entries].sort((a, b) => a.position - b.position)
        : [...relations.value.parents, pr(), ...relations.value.children].map(entry => ({ ...entry, url: prUrl(entry.number) }));
    const openStacked = (delta: 1 | -1) => {
      const entries = stack();
      const index = entries.findIndex(entry => entry.number === pr().number);
      const next = index < 0 ? undefined : entries[index + delta];
      if (next && !busy.value) props.onOpen(next.url);
    };

    const details = useDetails(() => ({
      pr: pr(),
      reviews: reviews.value,
      checks: pendingSection('checks') ? undefined : (props.workspace.checks ?? []),
      issues: pendingSection('linkedIssues') ? undefined : (props.workspace.linkedIssues ?? []),
      codeOwners: props.workspace.codeOwners,
      onBehalfOf: props.workspace.onBehalfOf,
      api: props.api,
      prRef: ref(),
      busy: acting.value,
      onChecks: () => {
        tab.value = 'checks';
        requestAnimationFrame(() => document.querySelector('.review-tabs-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      },
      onRun: run,
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
    const selected = shallowRef(props.workspace.files[0]?.filename || '');
    watch(
      () => props.workspace.files,
      value => (selected.value ||= value[0]?.filename || ''),
    );
    const collapsed = shallowRef<Set<string>>(new Set());
    const viewed = shallowRef<Set<string>>(new Set());
    const displayFiles = computed(() => comparison.value?.files || props.workspace.files);
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
        <div class="conversation-comment reveal" data-review-state={review.state}>
          <div class="comment-author">
            <Avatar login={review.user.login} small />
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

    return () => (
      <div class={`review-layout ${commentsOpen.value ? 'comments-open' : ''}`} aria-busy={!!props.workspace.pending.length}>
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
                methods={props.workspace.mergeMethods ?? []}
                autoMerge={!!props.workspace.autoMerge}
                disabled={acting.value}
                onRun={run}
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
              <IconButton label="Refresh pull request" onClick={props.onRefresh} disabled={busy.value || !!props.workspace.pending.length}>
                <RefreshCw size={15} class={props.workspace.pending.length ? 'spin' : ''} />
              </IconButton>
            </div>
          </div>
          <div class={styles['review-scroll']}>
            <div class="pr-top">
              <section class="pr-heading-section">
                <div class="pr-heading-inner">
                  <div class="pr-title-row">
                    {titleDraft.value !== null ? (
                      <input
                        class="pr-title-input"
                        aria-label="Pull request title"
                        value={titleDraft.value}
                        maxlength={256}
                        ref={focusOnce}
                        onInput={e => (titleDraft.value = inputValue(e))}
                        onBlur={saveTitle}
                        onKeydown={(e: KeyboardEvent) => {
                          if (e.key === 'Enter') saveTitle();
                          if (e.key === 'Escape') titleDraft.value = null;
                        }}
                      />
                    ) : (
                      <h1>
                        <button
                          class="pr-title-button"
                          title="Edit title"
                          disabled={busy.value}
                          onClick={() => (titleDraft.value = pr().title)}
                        >
                          {pr().title}
                        </button>
                      </h1>
                    )}
                    {(() => {
                      const [label, Icon, tone] = prStatus();
                      return (
                        <span class="pr-state" data-tone={tone} role="img" aria-label={label} title={label}>
                          <Icon size={18} />
                        </span>
                      );
                    })()}
                  </div>
                  <div class="pr-details">
                    <Avatar login={pr().user.login} small />
                    <strong>{pr().user.login}</strong>
                    <span>
                      {pr().merged ? 'merged' : pr().state === 'closed' ? 'wanted to merge' : 'wants to merge'} {pr().commits}{' '}
                      {pr().commits === 1 ? 'commit' : 'commits'} into
                    </span>
                    {[pr().base.ref, null, pr().head.ref].map(branch =>
                      branch === null ? (
                        <ArrowLeft key="arrow" size={12} />
                      ) : (
                        <button key={branch} class="pr-branch" title={`Copy ${branch}`} onClick={() => copy('branch name', branch)}>
                          {branch}
                        </button>
                      ),
                    )}
                  </div>
                  <div class="pr-meta">
                    <time title={fullDate(pr().created_at)}>Opened {timeAgo(pr().created_at)}</time>·
                    <time title={fullDate(pr().updated_at)}>Updated {timeAgo(pr().updated_at)}</time>·
                    <span>
                      {pr().changed_files} {pr().changed_files === 1 ? 'file' : 'files'}
                    </span>
                    <span class="additions">+{pr().additions}</span>
                    <span class="deletions">−{pr().deletions}</span>
                  </div>
                  {!!(props.workspace.nativeStack || relations.value.parents.length || relations.value.children.length) && (
                    <div class={`reveal border border-border rounded-lg mt-5 ${styles['overflow-hidden']}`}>
                      <div class="dependency-heading">
                        <Layers size={14} />
                        <button
                          class="flex items-center gap-2 py-0.5 px-0 text-left"
                          title={stackOpen.value ? 'Hide dependent pull requests' : 'Show the PR stack or branch-based dependencies'}
                          aria-expanded={stackOpen.value}
                          aria-controls="dependency-entries"
                          onClick={() => (stackOpen.value = !stackOpen.value)}
                        >
                          <strong>
                            {props.workspace.nativeStack
                              ? `GitHub stack #${props.workspace.nativeStack.number}`
                              : 'Dependent pull requests'}
                          </strong>
                          <ChevronRight size={13} class={stackOpen.value ? 'rotated' : ''} />
                        </button>
                        <span>
                          {props.workspace.nativeStack ? `${props.workspace.nativeStack.size} pull requests` : 'Linked by branch'}
                        </span>
                        {!!stackOpen.value && (
                          <IconButton label="Close stack panel" onClick={() => (stackOpen.value = false)}>
                            <X size={15} />
                          </IconButton>
                        )}
                      </div>
                      {!!stackOpen.value && (
                        <div id="dependency-entries">
                          {props.workspace.nativeStack ? (
                            <>
                              {(props.workspace.nativeStack?.entries ?? []).map(entry => (
                                <button
                                  class={`dependency-row ${entry.number === pr().number ? styles['current-entry'] : ''}`}
                                  title={`${entry.number === pr().number ? 'Current PR' : 'Open stacked PR'} #${entry.number}: ${entry.title}`}
                                  disabled={busy.value || entry.number === pr().number}
                                  onClick={() => props.onOpen(entry.url)}
                                >
                                  <span class="dependency-kind">
                                    {entry.position}.<GitPullRequest size={13} />
                                  </span>
                                  <span>#{entry.number}</span>
                                  <strong>{entry.title}</strong>
                                  {entry.number === pr().number ? <span>Current</span> : <ChevronRight size={13} />}
                                </button>
                              ))}
                              {!!props.workspace.nativeStack?.truncated && (
                                <p class="group-warning">Showing the first 100 stack entries. Open GitHub for the full stack.</p>
                              )}
                            </>
                          ) : (
                            <>
                              {relations.value.parents.map(parent => (
                                <button
                                  class="dependency-row"
                                  title={`Open parent PR #${parent.number}: ${parent.title}`}
                                  disabled={busy.value}
                                  onClick={() => props.onOpen(prUrl(parent.number))}
                                >
                                  <span class="dependency-kind">
                                    <GitBranch size={13} />
                                    Parent
                                  </span>
                                  <span>#{parent.number}</span>
                                  <strong>{parent.title}</strong>
                                  <ChevronRight size={13} />
                                </button>
                              ))}
                              <div class="dependency-current">
                                <span class="dependency-node" />
                                <span>#{pr().number}</span>
                                <strong>{pr().title}</strong>
                                <span>Current</span>
                              </div>
                              {relations.value.children.map(child => (
                                <button
                                  class="dependency-row"
                                  title={`Open child PR #${child.number}: ${child.title}`}
                                  disabled={busy.value}
                                  onClick={() => props.onOpen(prUrl(child.number))}
                                >
                                  <span class="dependency-kind">
                                    <GitBranch size={13} />
                                    Child
                                  </span>
                                  <span>#{child.number}</span>
                                  <strong>{child.title}</strong>
                                  <ChevronRight size={13} />
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <Information details={details} />
                  <div class={`description-heading ${styles['mt-4']}`}>
                    <button
                      class="section-heading"
                      aria-expanded={descriptionOpen.value}
                      onClick={() => (descriptionOpen.value = !descriptionOpen.value)}
                    >
                      <ChevronRight size={13} class={descriptionOpen.value ? 'rotated' : ''} />
                      Description
                    </button>
                    {bodyDraft.value === null && (
                      <button
                        class="button small"
                        disabled={busy.value}
                        onClick={() => {
                          descriptionOpen.value = true;
                          bodyDraft.value = pr().body ?? '';
                        }}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                  {bodyDraft.value !== null ? (
                    <div class="description-editor">
                      <textarea
                        aria-label="Pull request description"
                        value={bodyDraft.value}
                        maxlength={65000}
                        disabled={busy.value}
                        ref={focusOnce}
                        onInput={e => (bodyDraft.value = inputValue(e))}
                      />
                      <div class={styles['comment-form-footer']}>
                        <span>Markdown supported</span>
                        <div class="flex gap-2">
                          <button class="button small" onClick={() => (bodyDraft.value = null)}>
                            Cancel
                          </button>
                          <button class="button small primary" disabled={busy.value} onClick={saveBody}>
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    descriptionOpen.value && (
                      <div class={styles['pr-description']}>
                        <Markdown body={pr().body || 'No description provided.'} baseUrl={markdownBase()} />
                      </div>
                    )
                  )}
                  {!!stalePending() && (
                    <div class="warning-banner">
                      Your pending review targets an older commit. Discard it before starting a new review on these changes.
                    </div>
                  )}
                </div>
              </section>
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
                  {!!draftComments.value.length && <span>{draftComments.value.length}</span>}
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
              <Checks checks={props.workspace.checks} loading={pendingSection('checks')} busy={acting.value} prRef={ref()} onRun={run} />
            )}
            {tab.value === 'review' && (
              <div class="conversation own-review">
                <div class={styles['own-review-heading']}>
                  <h3>Your review</h3>
                  <p>
                    {pending.value
                      ? 'Your pending comments are private until you submit this review.'
                      : 'Your feedback on this pull request, all in one place.'}
                  </p>
                </div>
                {reviews.value.filter(review => review.user.id === viewer().id).map(reviewCard)}
                {allComments.value
                  .filter(
                    comment =>
                      comment.user.id === viewer().id && !reviews.value.some(review => review.id === comment.pull_request_review_id),
                  )
                  .map(comment => (
                    <div class="conversation-comment">
                      <div class="comment-author">
                        <Avatar login={comment.user.login} small />
                        <strong>You</strong>
                        <Timestamp date={comment.created_at} />
                      </div>
                      {codeComment(comment)}
                    </div>
                  ))}
                {!reviews.value.some(review => review.user.id === viewer().id) &&
                  !allComments.value.some(comment => comment.user.id === viewer().id) && (
                    <div class="empty-state">
                      <MessageSquare size={26} />
                      <h3>A fresh perspective starts here.</h3>
                      <p>Click a line number in the diff to leave feedback, or start a review to save comments as a draft.</p>
                      <button class="button" title="Return to the diff to add inline feedback" onClick={() => (tab.value = 'changes')}>
                        Back to changes
                      </button>
                    </div>
                  )}
              </div>
            )}
            {tab.value === 'conversation' && (
              <div class="conversation">
                {pendingSection('comments', 'reviews') && <Loader label="Loading conversation…" />}
                {visibleConversation.value.map(comment => (
                  <div id={`conversation-comment-${comment.id}`} class="conversation-comment reveal">
                    <div class="comment-author">
                      <Avatar login={comment.user.login} small />
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
                  <textarea
                    id="pr-comment"
                    placeholder="Share your thoughts on this pull request…"
                    value={body.value}
                    onInput={e => (body.value = inputValue(e))}
                    maxlength={65000}
                    disabled={busy.value}
                  />
                  <div class={styles['comment-form-footer']}>
                    <span>Posted publicly to this PR on GitHub.</span>
                    <button
                      class="button primary"
                      title="Publish a comment to the PR conversation immediately"
                      type="submit"
                      disabled={busy.value || !body.value.trim()}
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
                <div class={`diff-list ${focusedFile.value ? styles['focused-diff-list'] : ''}`}>
                  {pendingSection('files') ? (
                    <Loader label="Loading changed files…" />
                  ) : visibleFiles.value.length ? (
                    <>
                      {visibleFiles.value.map((file, index) => (
                        <DiffView
                          class="reveal"
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
                          threads={threads.value}
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
                                      canReview={canReview()}
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
          {!!toast.value && (
            <motion.div key="toast" {...rise()} class={styles.toast} role="status">
              <Check size={14} />
              {toast.value}
            </motion.div>
          )}
          {dialog.value === 'review' && (
            <Modal key="review" title="Submit your review" subtitle={`${ref().owner}/${ref().repo} #${pr().number}`} onClose={safeClose}>
              <form onSubmit={submitReview}>
                <label class="input-label" for="review-body">
                  Review summary <span class="muted">{event.value === 'APPROVE' ? '(optional)' : ''}</span>
                </label>
                <textarea
                  id="review-body"
                  class="review-textarea"
                  placeholder="What would you like the author to know?"
                  value={reviewBody.value}
                  onInput={e => (reviewBody.value = inputValue(e))}
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
                {!!draftComments.value.length && (
                  <p class={`text-xs text-secondary flex items-center gap-1 ${styles['mt-4']}`}>
                    <MessageSquare size={14} />
                    Includes {draftComments.value.length} pending inline {draftComments.value.length === 1 ? 'comment' : 'comments'}.
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
  { props: ['workspace', 'api', 'info', 'settings', 'onSettings', 'onOpen', 'onBack', 'onRefresh', 'onBusy'] },
);

function FileCodeIcon() {
  return (
    <span class="changes-icon">
      <ArrowRight size={12} />
      <Plus size={9} />
    </span>
  );
}
