import { defineComponent, onMounted, onUnmounted, ref, shallowRef, watchEffect, type ShallowRef, type Slots } from 'vue';
import { DotLottieVue, setWasmUrl } from '@lottiefiles/dotlottie-vue';
import wasmUrl from '../node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm?url';
import loaderUrl from './assets/loader.lottie?url';
import { themeTokens, type ThemeId } from './themes';
import type { PatchLine } from './diff';
import { motion } from 'motion-v';
import { fade, pop } from './motion';
import { onKeyStroke, unrefElement, useEventListener, useLocalStorage } from '@vueuse/core';
import { X, LoaderCircle, Search, createLucideIcon } from '@lucide/vue';

// Lucide 1.x dropped brand icons; this is its former GitHub mark.
export const Github = createLucideIcon('github', [
  [
    'path',
    {
      d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      key: 'tonef',
    },
  ],
  ['path', { d: 'M9 18c-4.51 2-5-2-7-2', key: '9comsn' }],
]);

export const inputValue = (event: Event) => (event.target as HTMLInputElement).value;

export function SearchField(
  props: {
    label: string;
    placeholder: string;
    value: string;
    onInput: (value: string) => void;
    clearLabel?: string;
    id?: string;
    class?: string;
    inputRef?: (element: unknown) => void;
  },
  { slots }: { slots: Slots },
) {
  return (
    <div class={`search-input ${props.class ?? ''}`}>
      <Search size={14} />
      <input
        id={props.id}
        ref={props.inputRef}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        spellcheck={false}
        autocomplete="off"
        onInput={event => props.onInput(inputValue(event))}
      />
      {props.value ? (
        <button
          type="button"
          aria-label={props.clearLabel ?? 'Clear search'}
          title={props.clearLabel ?? 'Clear search'}
          onClick={() => props.onInput('')}
        >
          <X size={12} />
        </button>
      ) : (
        slots.default?.()
      )}
    </div>
  );
}
SearchField.inheritAttrs = false;

export function IconButton(
  props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean },
  { slots }: { slots: Slots },
) {
  return (
    <button
      type="button"
      class={`icon-button ${props.active ? 'active' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={() => props.onClick()}
      disabled={props.disabled}
    >
      {slots.default?.()}
    </button>
  );
}
// Vue would also bind the onClick prop as a fallthrough listener and fire it twice.
IconButton.inheritAttrs = false;

// `edge` is the side the drag handle sits on; dragging it outward widens the panel.
export function useWidth(key: string, initial: number, edge: 'left' | 'right') {
  const width = useLocalStorage(`review.${key}-width`, initial);
  const clamp = (value: number) => Math.round(Math.min(Math.max(value, 224), Math.min(640, window.innerWidth - 80)));
  let origin: [number, number] | null = null;
  const sign = edge === 'right' ? 1 : -1;
  const handle = (label: string) => (
    <div
      class="resize-handle"
      data-edge={edge}
      role="separator"
      tabindex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width.value}
      onPointerdown={(event: PointerEvent) => {
        event.preventDefault();
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        origin = [event.clientX, width.value];
      }}
      onPointermove={(event: PointerEvent) => {
        if (origin) width.value = clamp(origin[1] + sign * (event.clientX - origin[0]));
      }}
      onPointerup={() => (origin = null)}
      onKeydown={(event: KeyboardEvent) => {
        const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
        if (step) width.value = clamp(width.value + sign * step);
      }}
    />
  );
  return { width, handle };
}

export const Modal = defineComponent(
  (props: { title: string; subtitle?: string; onClose: () => void; wide?: boolean }, { slots }) => {
    const dialog = ref();
    const node = () => unrefElement(dialog) as HTMLElement | undefined;
    let previous: HTMLElement | null = null;
    onMounted(() => {
      previous = document.activeElement as HTMLElement;
      // The close button comes first in the markup; a dialog with a field should open ready to type.
      (node()?.querySelector<HTMLElement>('input, textarea') ?? node()?.querySelector<HTMLElement>('button'))?.focus();
    });
    onUnmounted(() => previous?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
      const element = node();
      if (event.key !== 'Tab' || !element) return;
      const nodes = [
        ...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href]'),
      ].filter(node => node.offsetParent !== null);
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    return () => (
      <motion.div
        {...fade()}
        class="modal-backdrop"
        onClick={(event: MouseEvent) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <motion.div
          ref={dialog}
          {...pop()}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          class={`modal ${props.wide ? 'wide' : ''}`}
          onKeydown={keydown}
        >
          <div class="modal-heading">
            <div>
              <h2>{props.title}</h2>
              {props.subtitle && <p>{props.subtitle}</p>}
            </div>
            <IconButton label="Close dialog" onClick={props.onClose}>
              <X size={18} />
            </IconButton>
          </div>
          {slots.default?.()}
        </motion.div>
      </motion.div>
    );
  },
  { props: ['title', 'subtitle', 'onClose', 'wide'] },
);

setWasmUrl(wasmUrl);

// One shared download; per-loader `src` fetches get aborted and logged whenever a section finishes before its loader does.
let loaderData: Promise<ArrayBuffer> | undefined;
// The file ends in a success check from frame 60; only the spinner half should loop while loading.
const loaderSpin: [number, number] = [0, 60];
const animation = shallowRef<ArrayBuffer>();

export const Loader = defineComponent(
  (props: { label: string }) => {
    loaderData ??= fetch(loaderUrl).then(response => response.arrayBuffer());
    void loaderData.then(data => (animation.value = data)).catch(() => {});
    return () => (
      <div class="loader" role="status">
        {animation.value ? (
          <DotLottieVue class="loader-animation" data={animation.value} segment={loaderSpin} autoplay loop />
        ) : (
          <span class="loader-animation" />
        )}
        <span>{props.label}</span>
      </div>
    );
  },
  { props: ['label'] },
);

export function Spinner(props: { text?: string }) {
  return (
    <span class="loading-inline">
      <LoaderCircle size={16} class="spin" />
      {props.text}
    </span>
  );
}

// GitHub serves full-size avatars by default; asking for a small one keeps lists light.
const sizedAvatar = (src: string) =>
  src.startsWith('https://avatars.githubusercontent.com/') ? `${src}${src.includes('?') ? '&' : '?'}s=64` : src;
export function Avatar(props: { login: string; small?: boolean; src?: string }) {
  if (props.src)
    return <img class={`avatar ${props.small ? 'small' : ''}`} src={sizedAvatar(props.src)} alt={props.login} title={props.login} />;
  return (
    <span
      title={props.login}
      class={`avatar ${props.small ? 'small' : ''}`}
      style={{ '--avatar-color': `hsl(${[...props.login].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360} 28% 47%)` }}
    >
      {props.login.slice(0, props.small ? 1 : 2).toUpperCase()}
    </span>
  );
}

// People rows lead with the name and mute the login, as GitHub's pickers do.
export function PersonLabel(props: { login: string; name?: string | null; avatar?: string }) {
  return (
    <>
      <Avatar login={props.login} src={props.avatar || undefined} small />
      <span class="person-label">
        <span>{props.name || props.login}</span>
        {!!props.name && <span class="muted">{props.login}</span>}
      </span>
    </>
  );
}

export const fullDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'long' });

export function Timestamp(props: { date: string; prefix?: string }) {
  return (
    <time datetime={props.date} title={fullDate(props.date)}>
      {[props.prefix, timeAgo(props.date)].filter(Boolean).join(' ')}
    </time>
  );
}

export function CodeSnippet(props: { rows: PatchLine[] }) {
  if (!props.rows.length) return null;
  return (
    <div class="code-snippet">
      {props.rows.map(row => (
        <div class={row.kind}>
          <span>{row.kind === 'deletion' ? row.LEFT : row.RIGHT}</span>
          <span>{row.kind === 'deletion' ? '−' : row.kind === 'addition' ? '+' : ' '}</span>
          <code>{row.text}</code>
        </div>
      ))}
    </div>
  );
}

export function timeAgo(date: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(date)) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function useTheme(theme: () => ThemeId) {
  watchEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme();
    for (const [name, value] of Object.entries(themeTokens(theme()))) root.style.setProperty(`--color-${name}`, value);
  });
}

export const update = <T,>(state: ShallowRef<T>, next: (previous: T) => T) => {
  state.value = next(state.value);
};

// Closes on outside pointerdown instead of a full-screen overlay, so the page keeps scrolling under an open popover.
export const Dismiss = defineComponent(
  (props: { onClose: () => void }) => {
    const marker = shallowRef<HTMLElement>();
    useEventListener(
      document,
      'pointerdown',
      (event: PointerEvent) => {
        const anchor = marker.value?.parentElement;
        if (anchor && !anchor.contains(event.target as Node)) props.onClose();
      },
      { capture: true },
    );
    onKeyStroke('Escape', () => props.onClose());
    return () => <span ref={marker} hidden />;
  },
  { props: ['onClose'] },
);
