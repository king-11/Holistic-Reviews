import { computed, defineComponent, onMounted, onUnmounted, shallowRef } from 'vue';
import { AnimatePresence } from 'motion-v';
import { ArrowRight, Check, ChevronDown, Command, Keyboard, KeyRound, LogOut, Palette, Search, ShieldCheck, X } from '@lucide/vue';
import { GitHub, errorMessage, mergeabilityPending, parsePRUrl, type PRRef, type TokenInfo, type Workspace } from './github';
import AuthDialog from './AuthDialog';
import { comboKeys, eventCombo, modalOpen, shortcutGroups } from './shortcuts';
import Inbox from './Inbox';
import ReviewWorkspace from './ReviewWorkspace';
import { type DiffSettings } from './DiffView';
import { Avatar, Github, IconButton, Loader, Modal, Spinner, inputValue, tryStorage, useTheme, Dismiss } from './ui';
import { isTheme, themes } from './themes';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import styles from './App.module.css';
import logoUrl from './assets/hermes-logo.png';

const defaults: DiffSettings = {
  layout: 'unified',
  theme: 'paper',
  backgrounds: true,
  lineNumbers: true,
  wordWrap: false,
  indicators: 'classic',
  commentPlacement: 'inline',
  hideBotComments: false,
};
// Blocked browser storage must not break the app; state then stays in memory.
function readSettings(): DiffSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('review.preferences') || '{}');
    return {
      layout: ['split', 'unified'].includes(saved.layout) ? saved.layout : defaults.layout,
      theme: isTheme(saved.theme) ? saved.theme : defaults.theme,
      backgrounds: typeof saved.backgrounds === 'boolean' ? saved.backgrounds : defaults.backgrounds,
      lineNumbers: typeof saved.lineNumbers === 'boolean' ? saved.lineNumbers : defaults.lineNumbers,
      wordWrap: typeof saved.wordWrap === 'boolean' ? saved.wordWrap : defaults.wordWrap,
      indicators: ['classic', 'bars', 'none'].includes(saved.indicators) ? saved.indicators : defaults.indicators,
      commentPlacement: saved.commentPlacement === 'below' ? 'below' : 'inline',
      hideBotComments: saved.hideBotComments === true,
    };
  } catch {
    return defaults;
  }
}

export default defineComponent(() => {
  const token = shallowRef('');
  const info = shallowRef<TokenInfo | null>(null);
  const page = shallowRef<'inbox' | 'review'>('inbox');
  const workspace = shallowRef<Workspace | null>(null);
  const authOpen = shallowRef(false);
  const openDialog = shallowRef(false);
  const shortcutsOpen = shallowRef(false);
  const accountOpen = shallowRef(false);
  const themeOpen = shallowRef(false);
  const settings = shallowRef<DiffSettings>(readSettings());
  const prUrl = shallowRef('');
  const openError = shallowRef('');
  const loading = shallowRef(false);
  const restoring = shallowRef(false);
  const error = shallowRef('');
  const mutationBusy = shallowRef(false);
  const storageNotice = shallowRef('');
  const api = computed(() => (token.value ? new GitHub(token.value) : null));
  let controller: AbortController | undefined;
  let loadVersion = 0;
  let mergeTimer: ReturnType<typeof setTimeout> | undefined;
  const mergeRecheckDelays = [2000, 4000, 8000, 16000, 30000];
  // Only the PR is refetched; GitHub finishes computing mergeability in the background.
  function recheckMergeability(ref: PRRef, version: number, attempt = 0) {
    clearTimeout(mergeTimer);
    const delay = mergeRecheckDelays[attempt];
    if (delay === undefined || !workspace.value || !mergeabilityPending(workspace.value.pr)) return;
    mergeTimer = setTimeout(async () => {
      const client = api.value;
      if (!client || version !== loadVersion) return;
      try {
        const pr = await client.fresh().pullRequest(ref);
        if (version !== loadVersion || !workspace.value) return;
        workspace.value = { ...workspace.value, pr };
        recheckMergeability(ref, version, attempt + 1);
      } catch {
        return;
      }
    }, delay);
  }
  useTheme(() => settings.value.theme);
  const changeSettings = (value: DiffSettings) => {
    settings.value = value;
    tryStorage(() => localStorage.setItem('review.preferences', JSON.stringify(value)));
  };
  function back() {
    if (mutationBusy.value) return;
    controller?.abort();
    clearTimeout(mergeTimer);
    loadVersion++;
    page.value = 'inbox';
    workspace.value = null;
    error.value = '';
    loading.value = false;
    window.history.replaceState(null, '', window.location.pathname);
  }
  async function openPR(url: string, refresh = false) {
    if (mutationBusy.value) return;
    let ref;
    try {
      ref = parsePRUrl(url);
    } catch (error) {
      openError.value = errorMessage(error, 'Invalid URL.');
      return;
    }
    openDialog.value = false;
    openError.value = '';
    error.value = '';
    // connect() opens the remembered PR once a token is in place.
    const live = api.value;
    if (!live) {
      window.history.replaceState(null, '', `${window.location.pathname}?pr=${encodeURIComponent(url)}`);
      authOpen.value = true;
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const version = ++loadVersion;
    page.value = 'review';
    if (!refresh) {
      workspace.value = null;
      loading.value = true;
    }
    // A refresh follows a write or a manual click, so it must not reuse a cached read.
    const client = refresh ? live.fresh() : live;
    try {
      const result = await client.workspace(ref, controller.signal, value => {
        if (version !== loadVersion) return;
        workspace.value = value;
        loading.value = false;
      });
      if (version !== loadVersion) return;
      workspace.value = result;
      recheckMergeability(ref, version);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?pr=${encodeURIComponent(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`)}`,
      );
    } catch (failure) {
      if (version === loadVersion && !controller.signal.aborted) {
        workspace.value = null;
        error.value = errorMessage(failure, 'Unable to load the pull request.');
      }
    } finally {
      if (version === loadVersion) loading.value = false;
    }
  }
  function connect(value: string, details: TokenInfo) {
    controller?.abort();
    loadVersion++;
    {
      token.value = value;
      info.value = details;
      authOpen.value = false;
      accountOpen.value = false;
    }
    workspace.value = null;
    page.value = 'inbox';
    loading.value = false;
    error.value = '';
    if (
      !tryStorage(() => {
        sessionStorage.setItem('review.github-token', value);
        return true;
      })
    )
      storageNotice.value = 'Browser storage is unavailable. Your token is kept in memory only.';
    const desired = new URLSearchParams(window.location.search).get('pr');
    if (desired) void openPR(desired);
  }
  function disconnect() {
    if (mutationBusy.value) return;
    controller?.abort();
    loadVersion++;
    tryStorage(() => sessionStorage.removeItem('review.github-token'));
    {
      token.value = '';
      info.value = null;
      accountOpen.value = false;
    }
    back();
  }
  onMounted(() => {
    const saved = tryStorage(() => sessionStorage.getItem('review.github-token')) || '';
    if (saved) {
      restoring.value = true;
      const restore = new AbortController();
      controller = restore;
      new GitHub(saved)
        .validate(restore.signal)
        .then(details => {
          if (!restore.signal.aborted) connect(saved, details);
        })
        .catch(error => {
          if (restore.signal.aborted) return;
          tryStorage(() => sessionStorage.removeItem('review.github-token'));
          storageNotice.value = errorMessage(error, 'Reconnect to GitHub.');
        })
        .finally(() => (restoring.value = false));
    }
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !mutationBusy.value) {
        event.preventDefault();
        prUrl.value = '';
        openError.value = '';
        openDialog.value = true;
      }
      if (eventCombo(event, modalOpen()) === '?') {
        event.preventDefault();
        shortcutsOpen.value = true;
      }
      if (event.key === 'Escape') {
        themeOpen.value = false;
        accountOpen.value = false;
      }
    };
    document.addEventListener('keydown', keyHandler);
    onUnmounted(() => {
      controller?.abort();
      clearTimeout(mergeTimer);
      document.removeEventListener('keydown', keyHandler);
    });
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
        <button
          class="brand"
          title="Return to your pull request inbox"
          onClick={back}
          disabled={mutationBusy.value}
          aria-label="Review home"
        >
          <img class={`${styles['brand-mark']}`} src={logoUrl} alt="" width={28} height={28} />
          <span>
            review<span class="text-indigo">.</span>
          </span>
        </button>
        <span class="header-divider" />
        <span class="header-subtitle">A little more focus.</span>
        <div class="header-right">
          <button
            class="quick-open"
            title="Open a GitHub pull request by URL (⌘K or Ctrl+K)"
            onClick={() => {
              if (!mutationBusy.value) {
                prUrl.value = '';
                openError.value = '';
                openDialog.value = true;
              }
            }}
            disabled={mutationBusy.value}
          >
            <Search size={14} />
            <span>Open a pull request</span>
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
                            changeSettings({ ...settings.value, theme: theme.id });
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
                  disabled={mutationBusy.value}
                  onClick={() => (accountOpen.value = !accountOpen.value)}
                >
                  <Avatar login={info.value!.user.login} small />
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
                          onClick={disconnect}
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
      {!api.value || !info.value ? (
        <main class="empty-state">
          <Github size={35} />
          <h2>Connect GitHub to start reviewing</h2>
          <p>Your review requests, authored PRs, and drafts load straight from GitHub.</p>
          {connectButton('primary')}
        </main>
      ) : page.value === 'review' ? (
        <>
          {!loading.value ? (
            <>
              {workspace.value ? (
                <>
                  <ReviewWorkspace
                    workspace={workspace.value!}
                    api={api.value}
                    info={info.value}
                    settings={settings.value}
                    onSettings={changeSettings}
                    onOpen={url => void openPR(url)}
                    onBack={back}
                    onRefresh={() => void openPR(workspace.value!.pr.html_url, true)}
                    onBusy={value => {
                      mutationBusy.value = value;
                    }}
                  />
                </>
              ) : (
                <main class="empty-state">
                  <Github size={35} />
                  <h2>Couldn’t open this pull request</h2>
                  <p class="load-error" role="alert">
                    {error.value}
                  </p>
                  <button class="button" title="Return to your pull request inbox" onClick={back}>
                    Back to inbox
                  </button>
                  <button class="text-button" title="Enter a different GitHub pull request URL" onClick={() => (openDialog.value = true)}>
                    Try another URL
                  </button>
                </main>
              )}
            </>
          ) : (
            <main class="workspace-loading">
              <Loader label="Loading pull request…" />
              <button class="button small" title="Return to your inbox while this PR is loading" onClick={back}>
                Back to inbox
              </button>
            </main>
          )}
        </>
      ) : (
        <Inbox
          api={api.value}
          info={info.value}
          onOpen={url => void openPR(url)}
          onOpenDialog={() => {
            prUrl.value = '';
            openError.value = '';
            openDialog.value = true;
          }}
        />
      )}
      <AnimatePresence>
        {!!authOpen.value && <AuthDialog key="auth" onClose={() => (authOpen.value = false)} onConnect={connect} />}
        {!!openDialog.value && (
          <Modal
            key="open-pr"
            title="Open a pull request"
            subtitle="Bring a little context to your code review."
            onClose={() => (openDialog.value = false)}
          >
            <form
              onSubmit={event => {
                event.preventDefault();
                void openPR(prUrl.value);
              }}
            >
              <label class="input-label" for="pr-url">
                GitHub pull request URL
              </label>
              <div class="url-input">
                <Github size={16} />
                <input
                  id="pr-url"
                  type="url"
                  placeholder="https://github.com/owner/repo/pull/123"
                  value={prUrl.value}
                  onInput={e => (prUrl.value = inputValue(e))}
                  required
                />
              </div>
              {!!openError.value && (
                <>
                  <p class="error-message" role="alert">
                    {openError.value}
                  </p>
                </>
              )}
              <p class="submission-note">
                {api.value
                  ? 'Uses your connected GitHub token. Private repository and SSO access may be required.'
                  : 'You’ll connect GitHub next, then this pull request opens.'}
              </p>
              <div class="modal-footer">
                <button
                  class="button primary"
                  title={
                    api.value ? 'Load this pull request using your GitHub connection' : 'Connect to GitHub before opening this pull request'
                  }
                  type="submit"
                >
                  {api.value ? 'Open pull request' : 'Continue to GitHub'}
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>
          </Modal>
        )}
        {!!shortcutsOpen.value && (
          <Modal
            key="shortcuts"
            wide
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
