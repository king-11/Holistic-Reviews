import { defineComponent, onUnmounted, shallowRef, watch } from 'vue';
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Layers,
  Pencil,
  X,
} from '@lucide/vue';
import { blockingStates, mergeReady } from './github';
import { Information } from './DetailsPanel';
import { Avatar, IconButton, fullDate, inputValue, timeAgo } from './ui';
import Markdown from './MarkdownView';
import MentionField from './MentionField';
import { reduced } from './motion';
import type { PRView } from './ReviewWorkspace';
import styles from './ReviewWorkspace.module.css';

// Title, status, branches, stack and description: everything above the tabs that edits the PR itself.
export default defineComponent(
  (props: { view: PRView; onOpen: (url: string) => void }) => {
    const { ws, pr, ref, prUrl, markdownBase, busy, mutate, copy, details, approved, relations, stalePending } = props.view;
    const stackOpen = shallowRef(false);
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
      if (title && title !== pr().title) void mutate(api => api.editPR(ref(), { title }), { toast: 'Title updated', refresh: 'all' });
    };
    const bodyDraft = shallowRef<string | null>(null);
    const descriptionOpen = shallowRef(true);
    const saveBody = async () => {
      if (await mutate(api => api.editPR(ref(), { body: bodyDraft.value ?? '' }), { toast: 'Description updated', refresh: 'all' }))
        bodyDraft.value = null;
    };
    const prStatus = () => {
      const current = pr();
      const checks = ws().checks ?? [];
      if (current.merged) return ['Merged', GitMerge, 'merged'] as const;
      if (current.state === 'closed') return ['Closed', GitPullRequestClosed, 'blocked'] as const;
      if (current.draft) return ['Draft', CircleX, 'blocked'] as const;
      if (checks.some(check => blockingStates.includes(check.state))) return ['Checks failed', CircleX, 'blocked'] as const;
      if (mergeReady(current) && !checks.some(check => check.state === 'pending') && approved())
        return ['Ready to merge', CircleCheck, 'open'] as const;
      return ['Open', GitPullRequest, 'open'] as const;
    };
    // Celebrates a merge that happens while you watch, never one that was already done when the PR opened.
    const celebrating = shallowRef(false);
    let celebrationTimer: ReturnType<typeof setTimeout> | undefined;
    watch(
      () => pr().merged,
      (merged, was) => {
        if (!merged || was !== false) return;
        celebrating.value = true;
        clearTimeout(celebrationTimer);
        celebrationTimer = setTimeout(() => (celebrating.value = false), 900);
      },
    );
    onUnmounted(() => clearTimeout(celebrationTimer));

    return () => (
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
                <button class="pr-title-button" title="Edit title" disabled={busy.value} onClick={() => (titleDraft.value = pr().title)}>
                  {pr().title}
                </button>
              </h1>
            )}
            {(() => {
              const [label, Icon, tone] = prStatus();
              return (
                <span
                  class="pr-state"
                  data-tone={tone}
                  data-celebrate={celebrating.value ? '' : undefined}
                  role="img"
                  aria-label={label}
                  title={label}
                >
                  <Icon size={18} />
                  {celebrating.value && !reduced() && (
                    <span class="merge-burst" aria-hidden="true">
                      {Array.from({ length: 10 }, (_, index) => (
                        <i key={index} style={`--angle: ${index * 36}deg`} />
                      ))}
                    </span>
                  )}
                </span>
              );
            })()}
            {!!ws().draftComments.length && <span class="pending-badge">{ws().draftComments.length} pending</span>}
          </div>
          <div class="pr-details">
            <Avatar login={pr().user.login} src={pr().user.avatar_url} small />
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
          {!!(ws().nativeStack || relations.value.parents.length || relations.value.children.length) && (
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
                  <strong>{ws().nativeStack ? `GitHub stack #${ws().nativeStack!.number}` : 'Dependent pull requests'}</strong>
                  <ChevronRight size={13} class={`chevron ${stackOpen.value ? 'rotated' : ''}`} />
                </button>
                <span>{ws().nativeStack ? `${ws().nativeStack!.size} pull requests` : 'Linked by branch'}</span>
                {!!stackOpen.value && (
                  <IconButton label="Close stack panel" onClick={() => (stackOpen.value = false)}>
                    <X size={15} />
                  </IconButton>
                )}
              </div>
              {!!stackOpen.value && (
                <div id="dependency-entries">
                  {ws().nativeStack ? (
                    <>
                      {(ws().nativeStack?.entries ?? []).map(entry => (
                        <button
                          class={`dependency-row ${entry.number === pr().number ? styles['current-entry'] : ''}`}
                          title={`${entry.number === pr().number ? 'Current PR' : 'Open stacked PR'} #${entry.number}: ${entry.title}`}
                          disabled={busy.value || entry.number === pr().number}
                          onClick={() => props.onOpen(entry.url)}
                        >
                          <span class="dependency-position">
                            {entry.position}.<GitPullRequest size={13} />
                          </span>
                          <span>#{entry.number}</span>
                          <strong>{entry.title}</strong>
                          {entry.number === pr().number ? <span>Current</span> : <ChevronRight size={13} />}
                        </button>
                      ))}
                      {!!ws().nativeStack?.truncated && (
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
                          <span>#{parent.number}</span>
                          <strong>{parent.title}</strong>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                      <div class="dependency-current" aria-current="page">
                        <span>#{pr().number}</span>
                        <strong>{pr().title}</strong>
                      </div>
                      {relations.value.children.map(child => (
                        <button
                          class="dependency-row"
                          title={`Open child PR #${child.number}: ${child.title}`}
                          disabled={busy.value}
                          onClick={() => props.onOpen(prUrl(child.number))}
                        >
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
              <ChevronRight size={13} class={`chevron ${descriptionOpen.value ? 'rotated' : ''}`} />
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
              <MentionField
                aria-label="Pull request description"
                value={bodyDraft.value}
                maxlength={65000}
                disabled={busy.value}
                inputRef={focusOnce}
                onInput={value => (bodyDraft.value = value)}
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
    );
  },
  { props: ['view', 'onOpen'] },
);
