import { computed, defineComponent, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { ArrowLeft, ArrowRight, Check } from '@lucide/vue';
import { parsePRCommandInput } from './commandBar';
import type { PRRef } from './github';
import { themes, type ThemeId } from './themes';
import { comboKeys, commandDefinitions, type CommandContext, type CommandEntry } from './shortcuts';
import { Modal, SearchField } from './ui';
import styles from './CommandBar.module.css';

type CommandOption = {
  id: string;
  label: string;
  enabled: () => string | undefined;
  entry?: CommandEntry;
  theme?: ThemeId;
};

export default defineComponent(
  (props: {
    open: boolean;
    context: CommandContext;
    theme: ThemeId;
    onClose: () => void;
    onTheme: (theme: ThemeId) => void;
    onOpenPR: (ref: PRRef) => void;
  }) => {
    const query = shallowRef('');
    const selected = shallowRef(0);
    const page = shallowRef<CommandEntry | null>(null);
    const recent = shallowRef<string[]>([]);
    const hold = shallowRef<{ label: string } | null>(null);
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const currentPR = computed(() => props.context.pr?.ref);
    const parsedPR = computed(() => parsePRCommandInput(query.value, currentPR.value));
    const available = computed(() => commandDefinitions.filter(command => command.inBar && (!command.prOnly || !!props.context.pr)));
    const filtered = computed(() => {
      const value = query.value.trim().toLowerCase();
      const entries = available.value.filter(command => !value || `${command.label} ${command.group}`.toLowerCase().includes(value));
      return [...entries].sort((a, b) => {
        const left = recent.value.indexOf(a.id);
        const right = recent.value.indexOf(b.id);
        return (left < 0 ? Number.MAX_SAFE_INTEGER : left) - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
      });
    });
    const groups = computed(() => {
      if (parsedPR.value) return [];
      const recentEntries = filtered.value.filter(command => recent.value.includes(command.id));
      const recentIds = new Set(recentEntries.map(command => command.id));
      const grouped = new Map<string, CommandEntry[]>();
      for (const command of filtered.value.filter(command => !recentIds.has(command.id))) {
        grouped.set(command.group, [...(grouped.get(command.group) ?? []), command]);
      }
      return [
        ...(recentEntries.length ? [{ title: 'Recent', entries: recentEntries }] : []),
        ...[...grouped].map(([title, entries]) => ({ title, entries })),
      ];
    });
    const options = computed<CommandOption[]>(() => {
      if (parsedPR.value)
        return [
          {
            id: 'open-pr',
            label: `Open ${parsedPR.value.owner}/${parsedPR.value.repo}#${parsedPR.value.number}`,
            enabled: () => undefined,
          },
        ];
      if (page.value?.page === 'approve')
        return [page.value, ...(page.value.children ?? [])].map(entry => ({
          id: entry.id,
          label: entry.label,
          enabled: () => entry.enabled(props.context),
          entry,
        }));
      if (page.value?.page === 'theme')
        return themes.map(theme => ({
          id: theme.id,
          label: theme.label,
          enabled: () => undefined,
          theme: theme.id,
        }));
      return groups.value
        .flatMap(group => group.entries)
        .map(entry => ({
          id: entry.id,
          label: entry.label,
          enabled: () => entry.enabled(props.context),
          entry,
        }));
    });
    const closeHold = () => {
      clearTimeout(holdTimer);
      holdTimer = undefined;
      hold.value = null;
    };
    const close = () => {
      closeHold();
      props.onClose();
    };
    const exitOnKeydown = (event: KeyboardEvent) => {
      if (!props.open || (event.key !== 'Escape' && !(event.key === 'Backspace' && !query.value))) return;
      event.preventDefault();
      event.stopPropagation();
      if (page.value) {
        page.value = null;
        query.value = '';
      } else close();
    };
    watch(
      () => props.open,
      open => {
        if (open) {
          query.value = '';
          selected.value = 0;
          page.value = null;
        } else closeHold();
      },
    );
    watch([query, page], () => (selected.value = 0));
    watch([page, () => props.open], async ([current, open]) => {
      if (!open) return;
      await nextTick();
      const target = current
        ? document.querySelector<HTMLElement>(`.${styles['command-row']}[data-selected="true"]`)
        : document.querySelector<HTMLInputElement>(`.${styles['command-bar']} input`);
      target?.focus();
    });
    watch(selected, () => {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`.${styles['command-row']}[data-selected="true"]`)?.scrollIntoView({ block: 'nearest' }),
      );
    });
    onMounted(() => document.addEventListener('keydown', exitOnKeydown, true));
    onUnmounted(() => {
      document.removeEventListener('keydown', exitOnKeydown, true);
      closeHold();
    });

    const remember = (id: string) => (recent.value = [id, ...recent.value.filter(item => item !== id)].slice(0, 4));
    const run = (entry: CommandEntry) => {
      const reason = entry.enabled(props.context);
      if (reason) return;
      if (entry.hold) {
        closeHold();
        hold.value = { label: entry.label };
        holdTimer = setTimeout(() => {
          hold.value = null;
          remember(entry.id);
          close();
          entry.run(props.context, 'bar');
        }, 3000);
        return;
      }
      remember(entry.id);
      close();
      entry.run(props.context, 'bar');
    };
    const choose = (index: number) => {
      const option = options.value[index];
      if (!option) return;
      if (parsedPR.value) {
        close();
        props.onOpenPR(parsedPR.value);
        return;
      }
      if (page.value?.page === 'theme' && option.theme) {
        remember(page.value.id);
        close();
        props.onTheme(option.theme);
        return;
      }
      if (page.value?.page === 'approve' && option.entry) {
        run(option.entry);
        return;
      }
      if (!page.value && option.entry) {
        if (option.entry.page) {
          page.value = option.entry;
          query.value = '';
        } else run(option.entry);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (hold.value && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        closeHold();
      } else if (event.key === 'ArrowDown' && options.value.length) {
        event.preventDefault();
        selected.value = Math.min(selected.value + 1, options.value.length - 1);
      } else if (event.key === 'ArrowUp' && options.value.length) {
        event.preventDefault();
        selected.value = Math.max(selected.value - 1, 0);
      } else if (event.key === 'ArrowRight') {
        const entry = options.value[selected.value]?.entry;
        if (!page.value && entry?.page) {
          event.preventDefault();
          page.value = entry;
          query.value = '';
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(selected.value);
      }
    };
    const renderShortcut = (entry: CommandEntry) =>
      entry.keys.map(combo => (
        <span key={combo} class={styles['shortcut-combo']}>
          {comboKeys(combo).map((step, index) => (
            <span key={index} class={styles['shortcut-step']}>
              {step.map(key => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          ))}
        </span>
      ));

    return () =>
      props.open ? (
        <Modal
          title={page.value?.label ?? 'Command bar'}
          subtitle={
            page.value?.page === 'approve'
              ? 'Choose an approval action.'
              : page.value?.page === 'theme'
                ? 'Choose a theme.'
                : 'Search commands or enter a pull request URL.'
          }
          onClose={close}
          wide
          instant
        >
          <div class={styles['command-bar']} onKeydown={keydown}>
            {page.value && (
              <button
                class={styles['back-button']}
                title="Back to commands"
                onClick={() => {
                  page.value = null;
                  query.value = '';
                }}
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            {!page.value && (
              <SearchField
                label="Search commands"
                placeholder="Type a command or pull request…"
                value={query.value}
                onInput={value => (query.value = value)}
                class="menu-search"
              />
            )}
            {page.value?.page === 'approve' && (
              <p class={styles['command-intro']}>
                Approves #{props.context.pr?.ref.number} as {props.context.pr?.login}
                {props.context.pr?.pendingComments
                  ? ` and posts ${props.context.pr.pendingComments} pending ${props.context.pr.pendingComments === 1 ? 'comment' : 'comments'}.`
                  : '.'}
              </p>
            )}
            {page.value?.page === 'theme' && <p class={styles['command-intro']}>Choose the theme for this workspace.</p>}
            {parsedPR.value ? (
              <button
                class={`${styles['command-row']} ${selected.value === 0 ? styles.selected : ''}`}
                data-selected={selected.value === 0}
                role="option"
                aria-selected={selected.value === 0}
                onClick={() => choose(0)}
              >
                <span>{`Open ${parsedPR.value.owner}/${parsedPR.value.repo}#${parsedPR.value.number}`}</span>
                <ArrowRight size={14} />
              </button>
            ) : page.value?.page === 'theme' ? (
              <div class={styles['command-list']} role="listbox" aria-label="Themes">
                {options.value.map((option, index) => (
                  <button
                    key={option.id}
                    class={`${styles['command-row']} ${selected.value === index ? styles.selected : ''}`}
                    data-selected={selected.value === index}
                    aria-selected={props.theme === option.id}
                    role="option"
                    onClick={() => choose(index)}
                  >
                    <span>{option.label}</span>
                    {props.theme === option.theme && (
                      <>
                        <span class={styles.current}>Current</span>
                        <Check size={14} />
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div class={styles['command-list']} role="listbox" aria-label={page.value ? page.value.label : 'Commands'}>
                {(page.value
                  ? [{ title: 'Review', entries: options.value.flatMap(option => (option.entry ? [option.entry] : [])) }]
                  : groups.value
                ).map((group, groupIndex) => {
                  let offset = groups.value.slice(0, groupIndex).reduce((count, item) => count + item.entries.length, 0);
                  return (
                    <section key={group.title} class={styles['command-group']}>
                      <h3>{group.title}</h3>
                      {group.entries.map((entry, index) => {
                        const itemIndex = page.value ? index : offset + index;
                        const reason = entry.enabled(props.context);
                        return (
                          <button
                            key={entry.id}
                            class={`${styles['command-row']} ${selected.value === itemIndex ? styles.selected : ''}`}
                            data-selected={selected.value === itemIndex}
                            role="option"
                            aria-selected={selected.value === itemIndex}
                            disabled={!!reason}
                            title={reason}
                            onClick={() => choose(itemIndex)}
                          >
                            <span>{entry.label}</span>
                            {reason && <span class={styles['command-reason']}>{reason}</span>}
                            <span class={styles['command-shortcuts']}>{renderShortcut(entry)}</span>
                            {entry.page && <ArrowRight size={14} />}
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
                {!options.value.length && <p class={styles['empty-results']}>No matching commands.</p>}
              </div>
            )}
            {!!hold.value && (
              <div class={styles['undo-toast']} role="status">
                <span>{hold.value.label} in 3 seconds</span>
                <button onClick={closeHold} title="Undo this action (z)">
                  Undo <kbd>z</kbd>
                </button>
              </div>
            )}
          </div>
        </Modal>
      ) : null;
  },
  { props: ['open', 'context', 'theme', 'onClose', 'onTheme', 'onOpenPR'] },
);
