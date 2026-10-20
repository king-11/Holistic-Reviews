import { Teleport, computed, defineComponent, onUnmounted, shallowRef, useId } from 'vue';
import { renderMarkdown } from './markdown';
import { usePeople, type Person } from './people';
import { Avatar } from './ui';

const hoverDelay = 300;
type Card = { anchor: HTMLAnchorElement; top: number; left: number; person?: Person; team?: string };

export default defineComponent(
  (props: { body: string; baseUrl?: string }) => {
    const html = computed(() => renderMarkdown(props.body, props.baseUrl));
    const people = usePeople();
    const id = useId();
    const card = shallowRef<Card | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mentionOf = (event: Event) => (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a.user-mention') ?? null;
    const hide = () => {
      clearTimeout(timer);
      card.value?.anchor.removeAttribute('aria-describedby');
      card.value = null;
    };
    const show = (anchor: HTMLAnchorElement, delay: number) => {
      if (card.value?.anchor === anchor) return;
      hide();
      timer = setTimeout(() => {
        const { bottom, left } = anchor.getBoundingClientRect();
        const login = anchor.dataset.login;
        card.value = { anchor, top: bottom + 6, left, team: anchor.dataset.team, person: login ? { login } : undefined };
        anchor.setAttribute('aria-describedby', id);
        if (login)
          void people()
            ?.profile(login)
            .then(person => {
              if (card.value?.anchor === anchor) card.value = { ...card.value, person };
            });
      }, delay);
    };
    onUnmounted(() => clearTimeout(timer));
    // One delegated listener per body; the HTML is replaced wholesale whenever the body changes.
    return () => (
      <>
        <div
          class="markdown-body"
          innerHTML={html.value}
          onMouseover={(event: MouseEvent) => {
            const anchor = mentionOf(event);
            if (anchor) show(anchor, hoverDelay);
          }}
          onMouseout={(event: MouseEvent) => {
            if (mentionOf(event) && !mentionOf({ target: event.relatedTarget } as Event)) hide();
          }}
          onFocusin={(event: FocusEvent) => {
            const anchor = mentionOf(event);
            if (anchor) show(anchor, 0);
          }}
          onFocusout={hide}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape' && card.value) {
              event.stopPropagation();
              hide();
            }
          }}
        />
        <Teleport to="body">
          {card.value && (
            <div id={id} role="tooltip" class="popover mention-card" style={{ top: `${card.value.top}px`, left: `${card.value.left}px` }}>
              {card.value.team ? (
                <strong>@{card.value.team}</strong>
              ) : (
                card.value.person && (
                  <>
                    <Avatar login={card.value.person.login} src={card.value.person.avatarUrl} />
                    <span>
                      {!!card.value.person.name && <strong>{card.value.person.name}</strong>}
                      <span class="muted">{card.value.person.login}</span>
                    </span>
                  </>
                )
              )}
            </div>
          )}
        </Teleport>
      </>
    );
  },
  { props: ['body', 'baseUrl'] },
);
