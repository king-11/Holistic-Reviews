import { defineComponent, shallowRef } from 'vue';
import { Pencil, Trash2 } from '@lucide/vue';
import type { Comment, Review } from './github';
import Markdown from './Markdown';
import { IconButton, inputValue } from './ui';

export type Editable = Comment | Review;
export interface EditActions {
  can: (item: Editable) => boolean;
  disabled: () => boolean;
  save: (item: Editable, body: string) => Promise<boolean>;
  remove: (item: Comment) => Promise<boolean>;
}

export const isReview = (item: Editable): item is Review => 'state' in item;
// Review and comment ids come from separate GitHub sequences, so they can collide.
const key = (item: Editable) => `${isReview(item) ? 'review' : 'comment'}-${item.id}`;
const editing = shallowRef<{ key: string; body: string } | null>(null);

export const CommentActions = defineComponent(
  (props: { item: Editable; actions: EditActions }) => {
    const confirming = shallowRef(false);
    return () =>
      props.actions.can(props.item) &&
      editing.value?.key !== key(props.item) && (
        <span class="comment-actions">
          <IconButton
            label="Edit comment"
            disabled={props.actions.disabled()}
            onClick={() => (editing.value = { key: key(props.item), body: props.item.body || '' })}
          >
            <Pencil size={14} />
          </IconButton>
          {/* Submitted reviews can't be deleted on GitHub, only their comments. */}
          {!isReview(props.item) &&
            (confirming.value ? (
              <button
                class="button small danger"
                disabled={props.actions.disabled()}
                onClick={() => void props.actions.remove(props.item as Comment).finally(() => (confirming.value = false))}
                onBlur={() => (confirming.value = false)}
              >
                Delete?
              </button>
            ) : (
              <IconButton label="Delete comment" disabled={props.actions.disabled()} onClick={() => (confirming.value = true)}>
                <Trash2 size={14} />
              </IconButton>
            ))}
        </span>
      );
  },
  { props: ['item', 'actions'] },
);

export const CommentBody = defineComponent(
  (props: { item: Editable; actions: EditActions; baseUrl?: string }) => {
    const save = async (body: string) => {
      if (await props.actions.save(props.item, body)) editing.value = null;
    };
    return () => {
      const draft = editing.value?.key === key(props.item) ? editing.value : null;
      return draft ? (
        <div class="description-editor comment-editor">
          <textarea
            aria-label="Edit comment"
            value={draft.body}
            maxlength={65000}
            disabled={props.actions.disabled()}
            ref={element => (element as HTMLTextAreaElement | null)?.focus()}
            onInput={event => (editing.value = { ...draft, body: inputValue(event) })}
          />
          <div>
            <button class="button small" onClick={() => (editing.value = null)}>
              Cancel
            </button>
            <button
              class="button small primary"
              disabled={props.actions.disabled() || !draft.body.trim()}
              onClick={() => void save(draft.body)}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <Markdown body={props.item.body} baseUrl={props.baseUrl} />
      );
    };
  },
  { props: ['item', 'actions', 'baseUrl'] },
);
