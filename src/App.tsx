import { computed, defineComponent, onMounted, onUnmounted, shallowRef } from 'vue';
import { AnimatePresence } from 'motion-v';
import { ArrowRight, Check, ChevronDown, Command, Keyboard, KeyRound, LogOut, Palette, Search, ShieldCheck, X } from '@lucide/vue';
import { navigateTo } from 'nuxt/app';
import AuthDialog from './AuthDialog';
import { CommandBar } from './CommandBar';
import { commandDefinitions, comboKeys, createShortcuts, eventCombo, modalOpen, shortcutGroups, type CommandContext } from './shortcuts';
import { Avatar, Github, IconButton, Modal, Spinner, useTheme, Dismiss } from './ui';
import { themes, type ThemeId } from './themes';
import { commandBarOpen, openCommandBar, registeredPRCommands } from './commandRegistry';
import {
  api,
  authOpen,
  changeSettings,
  connect,
  disconnect,
  info,
  mutationBusy,
  mutationToast,
  openPRRef,
  restoreSession,
  restoring,
  settings,
  storageNotice,
} from './session';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import styles from './App.module.css';
import logoUrl from './assets/hermes-logo.png';

// The shell stays mounted across routes; app.vue renders the current page in its default slot once GitHub is connected.
export default defineComponent((_, { slots }) => {
  const shortcutsOpen = shallowRef(false);
  const accountOpen = shallowRef(false);
  const themeOpen = shallowRef(false);
  useTheme(() => settings.value.theme);
  const setTheme = (theme: ThemeId) => changeSettings({ ...settings.value, theme });
  const commandContext = computed<CommandContext>(() => {
    const registered = registeredPRCommands.value.at(-1)?.();
    return {
      ...registered,
      busy: mutationBusy.value,
      actions: {
        'open-command-bar': openCommandBar,
        theme: () => (themeOpen.value = true),
        inbox: () => void navigateTo('/'),
        ...registered?.actions,
      },
    };
  });
  const globalShortcuts = createShortcuts(
    () =>
      Object.fromEntries(
        commandDefinitions
          .filter(command => !command.prOnly && command.id !== 'open-command-bar' && (command.id !== 'inbox' || !commandContext.value.pr))
          .flatMap(command =>
            command.keys.map(key => [
              key,
              () => {
                const context = commandContext.value;
                if (!command.enabled(context)) command.run(context, 'shortcut');
              },
            ]),
          ),
      ),
    modalOpen,
  );
  onMounted(() => {
    restoreSession();
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !modalOpen()) {
        const command = commandDefinitions.find(entry => entry.id === 'open-command-bar');
        const context = commandContext.value;
        if (command && !command.enabled(context)) {
          event.preventDefault();
          command.run(context, 'shortcut');
        }
      }
      globalShortcuts(event);
      const combo = eventCombo(event, modalOpen());
      if (combo === '?') {
        event.preventDefault();
        shortcutsOpen.value = true;
      }
      if (event.key === 'Escape') {
        themeOpen.value = false;
        accountOpen.value = false;
      }
    };
    document.addEventListener('keydown', keyHandler);
    onUnmounted(() => document.removeEventListener('keydown', keyHandler));
  });
  const connectButton = (variant: string) => (
    <button
      class={`button ${variant}`}
      title="Connect your GitHub account to load PRs and submit feedback"
      disabled={restoring.value}
      onClick={() => (authOpen.value = true)}
    >
      {restoring.value ? (
        <Spinner text="Connecting…" />
      ) : (
        <>
          <Github size={15} />
          Connect GitHub
        </>
      )}
    </button>
  );
  return () => (
    <div class={`app min-h-screen bg-surface`}>
      <header class="global-header">
        <button class="brand" title="Return to your pull request inbox" onClick={() => void navigateTo('/')} aria-label="Review home">
          <img class={`${styles['brand-mark']}`} src={logoUrl} alt="" width={28} height={28} />
          <span>
            review<span class="text-indigo">.</span>
          </span>
        </button>
        <span class="header-divider" />
        <span class="header-subtitle">A little more focus.</span>
        <div class="header-right">
          <button class="quick-open" title="Open the command bar (⌘K or Ctrl+K)" onClick={openCommandBar}>
            <Search size={14} />
            <span>Command bar</span>
            <kbd>
              <Command size={10} /> K
            </kbd>
          </button>
          <div class="header-divider" />
          <IconButton label="Keyboard shortcuts (?)" onClick={() => (shortcutsOpen.value = true)}>
            <Keyboard size={17} />
          </IconButton>
          <div class="popover-anchor">
            <IconButton label="Appearance" active={themeOpen.value} onClick={() => (themeOpen.value = !themeOpen.value)}>
              <Palette size={17} />
            </IconButton>
            {!!themeOpen.value && (
              <>
                <>
                  <Dismiss onClose={() => (themeOpen.value = false)} />
                  <div class={`popover ${styles['theme-popover']}`}>
                    <div class="popover-title">Theme</div>
                    <div class={styles['theme-list']} role="listbox" aria-label="Theme">
                      {themes.map(theme => (
                        <button
                          key={theme.id}
                          role="option"
                          aria-selected={settings.value.theme === theme.id}
                          class={styles['menu-option']}
                          onClick={() => {
                            setTheme(theme.id);
                            themeOpen.value = false;
                          }}
                        >
                          <span class={styles.swatch} style={{ background: theme.palette.surface, borderColor: theme.palette.border }}>
                            <span style={{ background: theme.palette.accent }} />
                          </span>
                          {theme.label}
                          {settings.value.theme === theme.id && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              </>
            )}
          </div>
          {info.value ? (
            <>
              <div class="popover-anchor">
                <button
                  class="account-button"
                  title="View your GitHub connection and token options"
                  onClick={() => (accountOpen.value = !accountOpen.value)}
                >
                  <Avatar login={info.value!.user.login} src={info.value!.user.avatar_url} small />
                  <span>{info.value!.user.login}</span>
                  <ChevronDown size={12} />
                </button>
                {!!accountOpen.value && (
                  <>
                    <>
                      <Dismiss onClose={() => (accountOpen.value = false)} />
                      <div class={`popover ${styles['account-popover']}`}>
                        <div class="popover-title">
                          <Github size={16} />
                          GitHub connection<span class={`text-xs text-green bg-green-soft rounded-3xl py-1 px-1.5 ml-auto`}>Active</span>
                        </div>
                        <p>
                          <ShieldCheck size={14} />
                          Identity verified as <strong>{info.value?.user.login}</strong>
                        </p>
                        <p>
                          {info.value?.fineGrained
                            ? 'Fine-grained token. Repository grants and writes are enforced by GitHub on each request.'
                            : `Reported scopes: ${info.value?.scopes.join(', ')}`}
                        </p>
                        <button
                          class={`${styles['menu-option']}`}
                          title="Connect with a different GitHub token"
                          onClick={() => {
                            accountOpen.value = false;
                            authOpen.value = true;
                          }}
                        >
                          <KeyRound size={15} />
                          Replace token
                          <ArrowRight size={13} />
                        </button>
                        <button
                          class={`${styles['menu-option']} ${styles['disconnect-button']}`}
                          title="Disconnect and remove the token from this browser session"
                          onClick={() => {
                            accountOpen.value = false;
                            disconnect();
                          }}
                        >
                          <LogOut size={15} />
                          Disconnect and clear token
                        </button>
                      </div>
                    </>
                  </>
                )}
              </div>
            </>
          ) : (
            connectButton(styles['header-connect'])
          )}
        </div>
      </header>
      {!!storageNotice.value && (
        <>
          <div class={`${styles['py-2']} px-5 text-xs text-secondary bg-accent-soft flex justify-between`} role="status">
            {storageNotice.value}
            <button aria-label="Dismiss message" title="Dismiss this storage notice" onClick={() => (storageNotice.value = '')}>
              <X size={13} />
            </button>
          </div>
        </>
      )}
      {(!api.value || !info.value) && (
        <main class="empty-state">
          <Github size={35} />
          <h2>Connect GitHub to start reviewing</h2>
          <p>Your review requests, authored PRs, and drafts load straight from GitHub.</p>
          {connectButton('primary')}
        </main>
      )}
      {slots.default?.()}
      {!!mutationToast.value && (
        <div key={mutationToast.value.id} class={styles['mutation-toast']} role="alert">
          <span>
            Write failed for {mutationToast.value.pr}: {mutationToast.value.message}
          </span>
          <a
            href={mutationToast.value.path}
            onClick={event => {
              event.preventDefault();
              void navigateTo(mutationToast.value!.path);
            }}
          >
            Open PR
          </a>
        </div>
      )}
      <AnimatePresence>
        {!!authOpen.value && <AuthDialog key="auth" onClose={() => (authOpen.value = false)} onConnect={connect} />}
        <CommandBar
          open={commandBarOpen.value}
          context={commandContext.value}
          theme={settings.value.theme}
          onClose={() => (commandBarOpen.value = false)}
          onTheme={setTheme}
          onOpenPR={openPRRef}
        />
        {!!shortcutsOpen.value && (
          <Modal
            key="shortcuts"
            wide
            instant
            title="Keyboard shortcuts"
            subtitle="Shortcuts pause while you type in a field."
            onClose={() => (shortcutsOpen.value = false)}
          >
            <div class="shortcut-groups">
              {shortcutGroups.map(group => (
                <section key={group.title}>
                  <h3>{group.title}</h3>
                  <dl>
                    {group.shortcuts.map(shortcut => (
                      <div key={shortcut.label}>
                        <dt>{shortcut.label}</dt>
                        <dd>
                          {shortcut.combos.map((combo, index) => (
                            <span key={combo} class="shortcut-combo">
                              {index > 0 && <span class="shortcut-then">/</span>}
                              {comboKeys(combo).map((keys, at) => (
                                <span key={at} class="shortcut-combo">
                                  {at > 0 && <span class="shortcut-then">then</span>}
                                  {keys.map(key => (
                                    <kbd key={key}>{key}</kbd>
                                  ))}
                                </span>
                              ))}
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
});
