import { defineComponent, onMounted, onUnmounted, shallowRef, Teleport, watch } from 'vue';
import { motion } from 'motion-v';
import { pop } from './motion';
import { SmilePlus } from '@lucide/vue';
import { errorMessage, type GitHub, type PRRef, type ReactionContent, type ReactionSubject, type Reactions } from './github';
import type { Mutate } from './DetailsPanel';
import styles from './Reactions.module.css';

export const reactionChoices: { content: ReactionContent; emoji: string; label: string }[] = [
  { content: 'THUMBS_UP', emoji: '👍', label: 'thumbs up' },
  { content: 'THUMBS_DOWN', emoji: '👎', label: 'thumbs down' },
  { content: 'LAUGH', emoji: '😄', label: 'laugh' },
  { content: 'HOORAY', emoji: '🎉', label: 'hooray' },
  { content: 'CONFUSED', emoji: '😕', label: 'confused' },
  { content: 'HEART', emoji: '❤️', label: 'heart' },
  { content: 'ROCKET', emoji: '🚀', label: 'rocket' },
  { content: 'EYES', emoji: '👀', label: 'eyes' },
];
interface ReactionState extends Reactions {
  loading: boolean;
  loaded: boolean;
  busy: boolean;
  error: string;
}
export interface ReactionActions {
  state: (comment: ReactionSubject) => ReactionState;
  load: (comment: ReactionSubject, force?: boolean) => Promise<void>;
  toggle: (comment: ReactionSubject, content: ReactionContent) => Promise<void>;
}
const initial: ReactionState = { reactionGroups: [], viewerCanReact: false, loading: false, loaded: false, busy: false, error: '' };

export function createReactionActions(api: () => GitHub, ref: () => PRRef, viewerId: () => number, mutate: Mutate): ReactionActions {
  const states = shallowRef<Record<string, ReactionState>>({});
  const latestToggle = new Map<string, number>();
  let toggleId = 0;
  const key = (comment: ReactionSubject) => comment.node_id ?? String(comment.id);
  const state = (comment: ReactionSubject) => states.value[key(comment)] || initial;
  const update = (comment: ReactionSubject, patch: Partial<ReactionState>) => {
    states.value = { ...states.value, [key(comment)]: { ...(states.value[key(comment)] || initial), ...patch } };
  };
  return {
    state,
    async load(comment, force = false) {
      if (state(comment).loading || state(comment).busy || (state(comment).loaded && !force)) return;
      update(comment, { loading: true, error: '' });
      try {
        const result = await (force ? api().fresh() : api()).reactions(ref(), comment, viewerId());
        update(comment, { ...result, loaded: true });
      } catch (error) {
        update(comment, { error: errorMessage(error, 'Reactions could not be loaded.') });
      } finally {
        update(comment, { loading: false });
      }
    },
    async toggle(comment, content) {
      const current = state(comment);
      if (!current.loaded || !current.viewerCanReact) return;
      const mine = current.reactionGroups.find(group => group.content === content)?.viewerHasReacted || false;
      const desired = !mine;
      const sequence = ++toggleId;
      const toggleKey = `${key(comment)}:${content}`;
      latestToggle.set(toggleKey, sequence);
      const result = await mutate(
        async client => {
          const confirmed = await client.setReaction(ref(), comment, content, desired, viewerId(), state(comment));
          update(comment, latestToggle.get(toggleKey) === sequence ? { ...confirmed, busy: true } : { mine: confirmed.mine });
        },
        {
          toast: 'Reaction updated',
          refresh: 'none',
          apply: () => {
            update(comment, {
              reactionGroups: (() => {
                const groups = current.reactionGroups.filter(group => group.content !== content);
                const oldCount = current.reactionGroups.find(group => group.content === content)?.reactors.totalCount ?? 0;
                const count = Math.max(0, oldCount + (desired ? 1 : -1));
                if (count) groups.push({ content, viewerHasReacted: desired, reactors: { totalCount: count } });
                return groups;
              })(),
              busy: true,
              error: '',
            });
            return () => {
              if (latestToggle.get(toggleKey) !== sequence) return;
              update(comment, {
                reactionGroups: (() => {
                  const groups = state(comment).reactionGroups.filter(group => group.content !== content);
                  const count = Math.max(
                    0,
                    (state(comment).reactionGroups.find(group => group.content === content)?.reactors.totalCount ?? 0) + (mine ? 1 : -1),
                  );
                  if (count) groups.push({ content, viewerHasReacted: mine, reactors: { totalCount: count } });
                  return groups;
                })(),
              });
            };
          },
        },
      );
      if (latestToggle.get(toggleKey) === sequence)
        update(comment, {
          busy: false,
          ...(!result ? { error: 'Reaction could not be confirmed. Refresh reactions before trying again.' } : {}),
        });
    },
  };
}

export default defineComponent(
  (props: { comment: ReactionSubject; actions: ReactionActions; pending?: boolean }) => {
    const element = shallowRef<HTMLDivElement>();
    const visible = shallowRef(false);
    const open = shallowRef(false);
    const position = shallowRef({ left: 0, top: 0 });
    const state = () => props.actions.state(props.comment);
    const pending = () => !!props.pending || props.comment.id < 0;
    const disabled = () => pending() || !state().loaded || !state().viewerCanReact;
    let observer: IntersectionObserver | undefined;
    onMounted(() => {
      if (!('IntersectionObserver' in window)) {
        visible.value = true;
        return;
      }
      observer = new IntersectionObserver(
        entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            visible.value = true;
            observer?.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(element.value!);
    });
    onUnmounted(() => observer?.disconnect());
    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') open.value = false;
      };
      document.addEventListener('keydown', escape);
      onCleanup(() => document.removeEventListener('keydown', escape));
    });
    watch(
      () => [visible.value, pending(), props.comment.id] as const,
      ([isVisible, isPending, id]) => {
        if (isVisible && !isPending && id >= 0) void props.actions.load(props.comment);
      },
      { immediate: true },
    );
    function react(content: ReactionContent) {
      open.value = false;
      void props.actions.toggle(props.comment, content);
    }
    function togglePicker(event: MouseEvent) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      position.value = {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 60)),
      };
      open.value = !open.value;
    }
    return () => (
      <div ref={element} class="comment-reactions">
        {reactionChoices.map(choice => {
          const group = state().reactionGroups.find(group => group.content === choice.content);
          return (
            (group?.reactors.totalCount || 0) > 0 && (
              <button
                key={choice.content}
                class={`reaction-pill ${group?.viewerHasReacted ? 'mine' : ''}`}
                title={`${group?.viewerHasReacted ? 'Remove your' : 'Add a'} ${choice.label} reaction`}
                aria-label={`${choice.label}: ${group?.reactors.totalCount} reactions`}
                aria-pressed={group?.viewerHasReacted || false}
                disabled={disabled()}
                onClick={() => react(choice.content)}
              >
                <span class="emoji" aria-hidden="true">
                  {choice.emoji}
                </span>
                {group?.reactors.totalCount}
              </button>
            )
          );
        })}
        <div class={`relative ${styles['reaction-anchor']}`}>
          <button
            class={`${styles['reaction-add']}`}
            title={
              pending()
                ? 'Reactions are available after this review is published'
                : state().loaded && !state().viewerCanReact
                  ? 'GitHub does not allow reactions on this comment'
                  : 'Add a reaction'
            }
            aria-label="Add a reaction"
            aria-expanded={open.value}
            disabled={disabled()}
            onClick={togglePicker}
          >
            <SmilePlus size={15} />
          </button>
          {open.value && (
            <Teleport to="body">
              <motion.div
                {...pop()}
                class={`${styles['reaction-picker']}`}
                style={{ transformOrigin: 'top left', position: 'fixed', left: `${position.value.left}px`, top: `${position.value.top}px` }}
                role="group"
                aria-label="Choose a reaction"
              >
                {reactionChoices.map(choice => (
                  <button
                    key={choice.content}
                    class="emoji"
                    title={`React with ${choice.label}`}
                    aria-label={`React with ${choice.label}`}
                    disabled={disabled()}
                    onClick={() => react(choice.content)}
                  >
                    {choice.emoji}
                  </button>
                ))}
              </motion.div>
              <button
                class={`fixed inset-0 z-99 bg-transparent cursor-default`}
                aria-label="Close reaction picker"
                title="Close reaction picker"
                onClick={() => {
                  open.value = false;
                }}
              />
            </Teleport>
          )}
        </div>
        {(state().busy || state().loading) && (
          <span class="sr-only" role="status">
            {state().busy ? 'Saving reaction…' : 'Loading reactions…'}
          </span>
        )}
        {state().error && (
          <span class={`${styles['reaction-error']}`} role="alert">
            {state().error}
            <button
              class="text-button"
              title="Reload reaction counts and your current reaction state"
              disabled={state().loading || state().busy}
              onClick={() => void props.actions.load(props.comment, true)}
            >
              Refresh reactions
            </button>
          </span>
        )}
      </div>
    );
  },
  { props: ['comment', 'actions', 'pending'] },
);
