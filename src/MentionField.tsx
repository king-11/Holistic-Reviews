import { Teleport, computed, defineComponent, mergeProps, shallowRef, useId, type TextareaHTMLAttributes } from 'vue';
import { useEventListener } from '@vueuse/core';
import { mentionQuery } from './markdown';
import { peopleLimits, usePeople, useSearch, type Person } from './people';
import { PersonLabel, inputValue } from './ui';

// A markdown textarea that completes `@login` from the repository's people; every other attribute reaches the textarea.
export default defineComponent(
  (
    props: { value: string; onInput: (value: string) => void; inputRef?: (element: unknown) => void } & Omit<
      TextareaHTMLAttributes,
      'value' | 'onInput'
    >,
    { attrs },
  ) => {
    const people = usePeople();
    const id = useId();
    const textarea = shallowRef<HTMLTextAreaElement>();
    const token = shallowRef<{ start: number; query: string } | null>(null);
    const active = shallowRef(0);
    const place = shallowRef<Record<string, string>>({});
    // The token Escape dismissed stays closed until the caret leaves it.
    let dismissed = -1;
    const found = useSearch(
      () => token.value?.query ?? null,
      (query, signal) => people()?.search('mentionable', query, signal) ?? Promise.resolve([]),
    );
    const items = computed(() => {
      if (!token.value) return [];
      const local = people()?.matches('mentionable', token.value.query) ?? [];
      const remote = found().items.filter(person => !local.some(other => other.login === person.login));
      return [...local, ...remote].slice(0, peopleLimits.mentionable);
    });
    const open = () => !!token.value && (!!items.value.length || !!found().error);

    function sync() {
      const element = textarea.value;
      const next =
        element && element === document.activeElement && element.selectionStart === element.selectionEnd
          ? mentionQuery(element.value, element.selectionStart)
          : null;
      if (!next) dismissed = -1;
      if (!next || next.start === dismissed) return void (token.value = null);
      if (next.start !== token.value?.start || next.query !== token.value.query) active.value = 0;
      token.value = next;
      // Opens upward when the textarea sits too low for the list to fit beneath it.
      const { top, bottom, left, width } = element!.getBoundingClientRect();
      const below = window.innerHeight - bottom;
      place.value = {
        left: `${left}px`,
        maxWidth: `${width}px`,
        ...(below < 320 && top > below ? { top: 'auto', bottom: `${window.innerHeight - top + 4}px` } : { top: `${bottom + 4}px` }),
      };
    }
    function insert(person: Person) {
      const element = textarea.value;
      if (!element || !token.value) return;
      element.setRangeText(`@${person.login} `, token.value.start, element.selectionStart, 'end');
      token.value = null;
      props.onInput(element.value);
    }
    function keydown(event: KeyboardEvent) {
      if (!open()) return;
      const count = items.value.length;
      const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
        event.preventDefault();
        active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      } else if ((event.key === 'Enter' || event.key === 'Tab') && plain && items.value[active.value]) {
        event.preventDefault();
        event.stopPropagation();
        insert(items.value[active.value]);
      } else if (event.key === 'Escape') {
        // Stops a surrounding dialog from closing along with the list.
        event.preventDefault();
        event.stopPropagation();
        dismissed = token.value!.start;
        token.value = null;
      }
    }
    useEventListener(window, ['scroll', 'resize'], () => token.value && sync(), { capture: true, passive: true });

    return () => {
      const listId = `${id}-list`;
      const optionId = (index: number) => `${id}-option-${index}`;
      const shown = open();
      return (
        <>
          <textarea
            {...mergeProps(attrs, {
              ref: (element: unknown) => {
                textarea.value = (element as HTMLTextAreaElement | null) ?? undefined;
                props.inputRef?.(element);
              },
              value: props.value,
              'aria-autocomplete': 'list',
              'aria-controls': shown ? listId : undefined,
              'aria-activedescendant': shown && items.value.length ? optionId(active.value) : undefined,
              onInput: (event: Event) => {
                props.onInput(inputValue(event));
                sync();
              },
              onKeydown: keydown,
              onKeyup: (event: KeyboardEvent) => {
                if (!(shown && ['ArrowDown', 'ArrowUp'].includes(event.key))) sync();
              },
              onClick: sync,
              onBlur: () => (token.value = null),
            })}
          />
          <Teleport to="body">
            {shown && (
              <div
                class="popover mention-list"
                style={place.value}
                // Keeps focus in the textarea so a click can insert at the caret.
                onPointerdown={(event: PointerEvent) => event.preventDefault()}
              >
                <div id={listId} role="listbox" aria-label="Mention suggestions">
                  {items.value.map((person, index) => (
                    <div
                      key={person.login}
                      id={optionId(index)}
                      role="option"
                      tabindex={-1}
                      aria-selected={index === active.value}
                      aria-label={person.name ? `${person.name} ${person.login}` : person.login}
                      onClick={() => insert(person)}
                      onPointerenter={() => (active.value = index)}
                    >
                      <PersonLabel login={person.login} name={person.name} avatar={person.avatarUrl} />
                    </div>
                  ))}
                </div>
                {!!found().error && <p class="muted">{found().error}</p>}
              </div>
            )}
          </Teleport>
        </>
      );
    };
  },
  { props: ['value', 'onInput', 'inputRef'], inheritAttrs: false },
);
