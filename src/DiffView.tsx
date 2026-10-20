import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  onMounted,
  onUnmounted,
  render,
  shallowRef,
  watch,
  watchEffect,
  type AppContext,
  type VNodeChild,
} from 'vue';
import { themeById, type ThemeId } from './themes';
import { FileDiff, registerCustomTheme } from '@pierre/diffs';

const pierreVariants = {
  'pierre-light-soft': () => import('@pierre/theme/pierre-light-soft'),
  'pierre-light-vibrant': () => import('@pierre/theme/pierre-light-vibrant'),
  'pierre-light-protanopia-deuteranopia': () => import('@pierre/theme/pierre-light-protanopia-deuteranopia'),
  'pierre-light-tritanopia': () => import('@pierre/theme/pierre-light-tritanopia'),
};
for (const [name, load] of Object.entries(pierreVariants))
  registerCustomTheme(name, () => load().then(module => module.default as unknown as ThemeRegistration));
import type { DiffLineAnnotation, ExpansionDirections, FileDiffLoadedFiles, ThemeRegistration } from '@pierre/diffs';
import { errorMessage, type ChangedFile, type Comment, type ReviewThread } from './github';
import {
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  FileCode2,
  Maximize2,
  Minimize2,
  MessageSquare,
  Plus,
  Image as ImageIcon,
} from '@lucide/vue';
import { commentGroups, diffSideOf, metadataForFile, nearestContextDirection, textLineCount, type LineCounts } from './diff';
import { diffLinePreview, isBot, visibleThreads } from './comments';
import ReviewThreadCard, { type ReplyActions } from './ReviewThread';
import styles from './DiffView.module.css';

export interface DiffSettings {
  layout: 'split' | 'unified';
  theme: ThemeId;
  backgrounds: boolean;
  lineNumbers: boolean;
  wordWrap: boolean;
  indicators: 'classic' | 'bars' | 'none';
  commentPlacement: 'inline' | 'below';
  hideBotComments: boolean;
}

export interface LineComposer {
  line: number;
  side: 'LEFT' | 'RIGHT';
  render: () => VNodeChild;
}
export type ContextLoader = (file: ChangedFile) => Promise<FileDiffLoadedFiles>;
type Annotation = { comments: Comment[]; composer?: LineComposer };

type Side = 'LEFT' | 'RIGHT';
type Resolve = (id: string, resolved: boolean) => Promise<boolean>;
type ThreadAnchor = (id: number, element: HTMLElement | null) => void;
type DiffViewProps = {
  file: ChangedFile;
  settings: DiffSettings;
  collapsed: boolean;
  viewed: boolean;
  search: string;
  baseUrl: string;
  comments: Comment[];
  githubUrl: string;
  onToggle: () => void;
  onCopyName: () => void;
  onViewed: () => void;
  focused: boolean;
  onFocus: () => void;
  threads: ReviewThread[];
  selectedThreadId: number | null;
  onThreadAnchor: ThreadAnchor;
  onResolve: Resolve;
  onComment: (line: number, side: Side, start?: { line: number; side: Side }) => void;
  replies: ReplyActions;
  composer?: LineComposer;
  loadContext: ContextLoader;
  commentingEnabled?: boolean;
};

export default defineComponent(
  (props: DiffViewProps) => {
    const lineCounts = shallowRef<LineCounts>();
    const name = () => props.file.filename.split('/').at(-1) || props.file.filename;
    const directory = () => props.file.filename.slice(0, -name().length);
    const matches = computed(() =>
      !props.search
        ? []
        : (props.file.patch || '')
            .split('\n')
            .filter(line => !line.startsWith('@@') && line.toLowerCase().includes(props.search.toLowerCase())),
    );
    const belowComments = computed(() =>
      props.settings.commentPlacement === 'below' ? props.comments : commentGroups(props.file, props.comments, lineCounts.value).below,
    );
    const visibleCommentCount = computed(
      () => props.comments.filter(comment => !props.settings.hideBotComments || !isBot(comment.user)).length,
    );
    return () => (
      <article class={`${styles['diff-file']} ${props.viewed ? 'file-viewed' : ''}`} id={`file-${encodeURIComponent(props.file.filename)}`}>
        <header
          class="diff-file-header"
          onClick={event => !(event.target as Element).closest('button, a, input, label, .popover') && props.onToggle()}
        >
          <button
            class="text-muted py-0.5 px-0 flex"
            title={props.collapsed ? 'Expand diff' : 'Collapse diff'}
            aria-expanded={!props.collapsed}
            aria-label={`${props.collapsed ? 'Expand' : 'Collapse'} ${name()}`}
            onClick={() => props.onToggle()}
          >
            <ChevronRight size={15} class={props.collapsed ? '' : 'rotated'} />
          </button>
          <span class={`file-status-icon ${props.file.status}`}>
            {props.file.status === 'added' ? <Plus size={13} /> : <FileCode2 size={14} />}
          </span>
          <button class="diff-filename" title={`Copy ${props.file.filename}`} onClick={() => props.onCopyName()}>
            <span>{directory()}</span>
            <strong>{name()}</strong>
          </button>
          {props.file.previous_filename && (
            <span class={`text-xs text-muted`} title={props.file.previous_filename}>
              renamed
            </span>
          )}
          {visibleCommentCount.value > 0 && (
            <span class="inline-flex items-center gap-1 text-xs text-muted">
              <MessageSquare size={12} />
              {visibleCommentCount.value}
            </span>
          )}
          <span class="diff-stats">
            <span class="additions">+{props.file.additions}</span>
            <span class="deletions">−{props.file.deletions}</span>
          </span>
          <button
            class={`${styles['file-focus-button']}`}
            aria-label={props.focused ? 'Restore all files' : `Expand ${name()} to full width`}
            title={props.focused ? 'Restore all files' : 'Expand this file to full width'}
            aria-pressed={props.focused}
            onClick={() => props.onFocus()}
          >
            {props.focused ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{props.focused ? 'Restore' : 'Expand'}</span>
          </button>
          <button
            class={`viewed-button ${props.viewed ? 'checked' : ''}`}
            title={props.viewed ? 'Mark as unviewed and expand file' : 'Mark as viewed and collapse file (local to this tab)'}
            aria-pressed={props.viewed}
            onClick={() => props.onViewed()}
          >
            <CircleCheck size={14} />
            <span>Viewed</span>
          </button>
        </header>
        {!props.collapsed && (
          <>
            {matches.value.length > 0 && (
              <div class={`${styles['diff-search-results']}`}>
                <SearchMatches lines={matches.value.slice(0, 5)} query={props.search} />
                <span>{matches.value.length} matching lines in patch</span>
              </div>
            )}
            {props.file.patch ? (
              <DiffRenderer
                file={props.file}
                settings={props.settings}
                onComment={props.onComment}
                comments={props.comments}
                replies={props.replies}
                composer={props.composer}
                threads={props.threads}
                onResolve={props.onResolve}
                baseUrl={props.baseUrl}
                selectedThreadId={props.selectedThreadId}
                onThreadAnchor={props.onThreadAnchor}
                loadContext={props.loadContext}
                commentingEnabled={props.commentingEnabled}
                lineCounts={lineCounts.value}
                onContextLoaded={(counts: LineCounts) => {
                  lineCounts.value = counts;
                }}
              />
            ) : (
              <div class={`${styles['binary-placeholder']}`}>
                <ImageIcon size={27} />
                <strong>{/\.(png|jpg|webp|gif|svg)$/.test(name()) ? 'Image or binary file' : 'No text patch available'}</strong>
                <p>GitHub omits patches for binary files and some large changes.</p>
                <a href={props.githubUrl} target="_blank" rel="noopener noreferrer">
                  View full change on GitHub <ArrowUpRight size={13} />
                </a>
              </div>
            )}
            {visibleThreads(belowComments.value, props.settings.hideBotComments).length > 0 && (
              <div class={`pt-4 ${styles['pb-0']} px-5 border-t border-t-border bg-sidebar`}>
                <CommentThreads
                  comments={belowComments.value}
                  threads={props.threads}
                  replies={props.replies}
                  onResolve={props.onResolve}
                  baseUrl={props.baseUrl}
                  hideBotComments={props.settings.hideBotComments}
                  selectedThreadId={props.selectedThreadId}
                  onThreadAnchor={props.onThreadAnchor}
                />
              </div>
            )}
          </>
        )}
      </article>
    );
  },
  {
    props: [
      'file',
      'settings',
      'collapsed',
      'viewed',
      'search',
      'baseUrl',
      'comments',
      'githubUrl',
      'onToggle',
      'onCopyName',
      'onViewed',
      'focused',
      'onFocus',
      'threads',
      'selectedThreadId',
      'onThreadAnchor',
      'onResolve',
      'onComment',
      'replies',
      'composer',
      'loadContext',
      'commentingEnabled',
    ],
  },
);

type RendererProps = {
  file: ChangedFile;
  settings: DiffSettings;
  onComment: DiffViewProps['onComment'];
  comments: Comment[];
  replies: ReplyActions;
  composer?: LineComposer;
  threads: ReviewThread[];
  onResolve: Resolve;
  baseUrl: string;
  selectedThreadId: number | null;
  onThreadAnchor: ThreadAnchor;
  loadContext: ContextLoader;
  commentingEnabled?: boolean;
  lineCounts?: LineCounts;
  onContextLoaded: (counts: LineCounts) => void;
};

const DiffRenderer = defineComponent(
  (props: RendererProps) => {
    const container = shallowRef<HTMLDivElement>();
    const error = shallowRef('');
    const contextError = shallowRef('');
    const contextLoading = shallowRef(false);
    const expanding = shallowRef(false);
    const renderer = shallowRef<FileDiff<Annotation> | null>(null);
    const disposers = new Map<string, () => void>();
    // Annotations mount as separate Vue roots; handing them this component's provides keeps injected context, like the
    // people directory behind @mention completion and hover cards, working inside diff threads.
    const instance = getCurrentInstance()!;
    const annotationContext = { ...instance.appContext, provides: (instance as unknown as { provides: AppContext['provides'] }).provides };
    const metadata = computed(() => {
      try {
        return metadataForFile(props.file);
      } catch {
        return undefined;
      }
    });
    let teardown = () => {};
    onUnmounted(() => teardown());
    onMounted(() =>
      watch(
        [metadata, () => props.settings],
        ([fileDiff, settings], _, onCleanup) => {
          if (!fileDiff) {
            error.value = 'This patch could not be rendered. The raw patch is available below.';
            return;
          }
          const element = container.value!;
          const loadContext = props.loadContext,
            file = props.file,
            onContextLoaded = props.onContextLoaded,
            onComment = props.onComment;
          const commenting = props.commentingEnabled !== false;
          let disposed = false;
          let expansionBusy = false;
          const setExpansionBusy = (value: boolean) => {
            expansionBusy = value;
            if (!disposed) {
              expanding.value = value;
              element.setAttribute('aria-busy', String(value));
            }
          };
          async function reveal(
            instance: FileDiff<Annotation>,
            expand: FileDiff<Annotation>['expandHunk'],
            index: number,
            direction: ExpansionDirections,
            count?: number,
          ) {
            if (disposed || expansionBusy) return;
            setExpansionBusy(true);
            try {
              if (instance.fileDiff?.isPartial) await instance.prepareForEditing();
              if (!disposed && instance.fileDiff)
                expand(index, nearestContextDirection(index, instance.fileDiff.hunks.length, direction, count), count);
            } catch (failure) {
              if (!disposed && !contextError.value) contextError.value = errorMessage(failure, 'Context could not be expanded.');
            } finally {
              setExpansionBusy(false);
            }
          }
          const utilityButton = document.createElement('button');
          utilityButton.type = 'button';
          utilityButton.className = 'line-comment-add';
          utilityButton.textContent = '+';
          utilityButton.title = 'Add a review comment on this diff line';
          utilityButton.setAttribute('aria-label', 'Add a review comment');
          let rangeOpenedAt = -Infinity;
          const instance = new FileDiff<Annotation>({
            theme: { light: themeById(settings.theme).code, dark: themeById(settings.theme).code },
            themeType: 'light',
            diffStyle: settings.layout,
            disableFileHeader: true,
            disableBackground: !settings.backgrounds,
            disableLineNumbers: !settings.lineNumbers,
            overflow: settings.wordWrap ? 'wrap' : 'scroll',
            diffIndicators: settings.indicators,
            hunkSeparators: 'line-info',
            expansionLineCount: 20,
            loadDiffFiles: async () => {
              if (!disposed) {
                contextLoading.value = true;
                contextError.value = '';
              }
              try {
                const files = await loadContext(file);
                if (!disposed)
                  onContextLoaded({
                    LEFT: files.oldFile ? textLineCount(files.oldFile.contents) : 0,
                    RIGHT: textLineCount(files.newFile.contents),
                  });
                return files;
              } catch (failure) {
                if (!disposed) contextError.value = errorMessage(failure, 'Context could not be loaded. Try expanding again.');
                throw failure;
              } finally {
                if (!disposed) contextLoading.value = false;
              }
            },
            lineDiffType: 'word-alt',
            enableGutterUtility: commenting,
            enableLineSelection: true,
            renderGutterUtility: () => utilityButton,
            onLineEnter: line => {
              const allowed = commenting && !!diffLinePreview(file, line.lineNumber, diffSideOf(line.annotationSide));
              utilityButton.disabled = !allowed;
              utilityButton.title = allowed
                ? 'Add a review comment on this diff line'
                : 'Additional context is read-only; comment on a line in the original PR diff';
            },
            onLineNumberClick: line => {
              if (commenting && performance.now() - rangeOpenedAt > 400) onComment(line.lineNumber, diffSideOf(line.annotationSide));
            },
            onLineSelectionEnd: range => {
              if (!commenting || !range) return;
              const startSide = diffSideOf(range.side),
                endSide = diffSideOf(range.endSide ?? range.side);
              if (range.start !== range.end || startSide !== endSide) rangeOpenedAt = performance.now();
              onComment(range.end, endSide, { line: range.start, side: startSide });
            },
            renderAnnotation: annotation => {
              const host = document.createElement('div');
              host.className = 'annotation-container';
              const key = `${annotation.side}:${annotation.lineNumber}`;
              disposers.get(key)?.();
              const { comments, composer } = annotation.metadata;
              // Annotations live in the renderer's shadow DOM, outside this component tree.
              const annotationRoot = h(
                defineComponent(() => () => (
                  <>
                    {comments.length > 0 && (
                      <CommentThreads
                        comments={comments}
                        threads={props.threads}
                        onResolve={props.onResolve}
                        baseUrl={props.baseUrl}
                        replies={props.replies}
                        hideBotComments={props.settings.hideBotComments}
                        selectedThreadId={props.selectedThreadId}
                        onThreadAnchor={props.onThreadAnchor}
                      />
                    )}
                    {composer?.render()}
                  </>
                )),
              );
              annotationRoot.appContext = annotationContext;
              render(annotationRoot, host);
              if (composer)
                requestAnimationFrame(() => {
                  if (!host.isConnected) return;
                  host.querySelector<HTMLElement>('.inline-composer textarea')?.focus({ preventScroll: true });
                  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
              disposers.set(key, () => render(null, host));
              return host;
            },
            unsafeCSS:
              ':host { --diffs-light-bg: var(--color-surface); --diffs-font-family: var(--font-mono); --diffs-font-size: 12px; --diffs-line-height: 22px; } [data-gutter-utility-slot] { z-index: 2; pointer-events: none; }',
          });
          const expand = instance.expandHunk;
          instance.expandHunk = (index, direction, count) => {
            void reveal(instance, expand, index, direction, count);
          };
          try {
            instance.render({ fileDiff, containerWrapper: element });
            renderer.value = instance;
            error.value = '';
          } catch {
            error.value = 'Unable to render this patch. The raw diff is shown below.';
          }
          // Unmounting annotation roots flushes Vue's post queue, so the annotation effect must already see no renderer.
          teardown = () => {
            if (disposed) return;
            disposed = true;
            renderer.value = null;
            instance.cleanUp();
            disposers.forEach(dispose => dispose());
            disposers.clear();
          };
          onCleanup(() => teardown());
        },
        { immediate: true },
      ),
    );
    let hadComposer = false;
    // Rebuilding annotations remounts every thread card and line composer, dropping focus and cutting animations short.
    // Cards read thread status and settings reactively, so only a change in what they were built from needs a rebuild.
    let rendered: { instance: FileDiff<Annotation>; signature: string } | null = null;
    watchEffect(
      () => {
        const instance = renderer.value;
        if (!instance) return;
        if (hadComposer && !props.composer) instance.setSelectedLines(null);
        hadComposer = !!props.composer;
        const groups =
          props.settings.commentPlacement === 'inline'
            ? commentGroups(props.file, props.comments, props.lineCounts).inline
            : new Map<string, Comment[]>();
        const composer = props.composer;
        const composerKey = composer ? `${composer.side}:${composer.line}` : '';
        if (composer && !groups.has(composerKey)) groups.set(composerKey, []);
        const annotations: DiffLineAnnotation<Annotation>[] = [...groups.entries()]
          .filter(([key, comments]) => key === composerKey || visibleThreads(comments, props.settings.hideBotComments).length > 0)
          .map(([key, comments]) => {
            const [side, line] = key.split(':');
            return {
              lineNumber: Number(line),
              side: side === 'LEFT' ? 'deletions' : 'additions',
              metadata: { comments, composer: key === composerKey ? composer : undefined },
            };
          });
        const signature = JSON.stringify(
          annotations.map(({ side, lineNumber, metadata }) => [
            side,
            lineNumber,
            !!metadata.composer,
            metadata.comments.map(comment => [comment.id, comment.body, comment.pull_request_review_id]),
          ]),
        );
        if (rendered?.instance === instance && rendered.signature === signature) return;
        rendered = { instance, signature };
        const keys = new Set(annotations.map(annotation => `${annotation.side}:${annotation.lineNumber}`));
        for (const [key, dispose] of disposers)
          if (!keys.has(key)) {
            dispose();
            disposers.delete(key);
          }
        instance.render({ lineAnnotations: annotations });
      },
      { flush: 'post' },
    );
    return () => (
      <>
        {(contextLoading.value || expanding.value) && (
          <div class="diff-context-notice" role="status">
            Loading surrounding lines…
          </div>
        )}
        {contextError.value && (
          <div class="diff-context-notice error-message" role="alert">
            {contextError.value} Try expanding again to retry.
          </div>
        )}
        <div class={`${styles['diff-renderer']}`} ref={container} />
        {error.value && (
          <>
            <div class={`text-xs ${styles['p-4']} text-red`}>{error.value}</div>
            <pre class={`text-xs leading-relaxed ${styles['p-4']} overflow-auto`}>{props.file.patch}</pre>
          </>
        )}
      </>
    );
  },
  {
    props: [
      'file',
      'settings',
      'onComment',
      'comments',
      'replies',
      'composer',
      'threads',
      'onResolve',
      'baseUrl',
      'selectedThreadId',
      'onThreadAnchor',
      'loadContext',
      'commentingEnabled',
      'lineCounts',
      'onContextLoaded',
    ],
  },
);

function CommentThreads(props: {
  comments: Comment[];
  threads: ReviewThread[];
  replies: ReplyActions;
  baseUrl: string;
  onResolve: Resolve;
  hideBotComments: boolean;
  selectedThreadId: number | null;
  onThreadAnchor: ThreadAnchor;
}) {
  return (
    <>
      {visibleThreads(props.comments, props.hideBotComments).map(group => (
        <ReviewThreadCard
          key={group.root.id}
          comments={group.comments}
          root={group.root}
          thread={props.threads.find(
            thread => thread.rootCommentId === group.root.id || thread.rootCommentId === group.root.in_reply_to_id,
          )}
          replies={props.replies}
          onResolve={props.onResolve}
          baseUrl={props.baseUrl}
          selected={props.selectedThreadId === (group.root.in_reply_to_id || group.root.id)}
          onAnchor={props.onThreadAnchor}
        />
      ))}
    </>
  );
}

function SearchMatches(props: { lines: string[]; query: string }) {
  return (
    <>
      {props.lines.map(line => {
        const index = line.toLowerCase().indexOf(props.query.toLowerCase());
        return (
          <code>
            {line.slice(0, index)}
            <mark>{line.slice(index, index + props.query.length)}</mark>
            {line.slice(index + props.query.length)}
          </code>
        );
      })}
    </>
  );
}
