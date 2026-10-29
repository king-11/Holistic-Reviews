import { computed, shallowRef } from 'vue';
import { navigateTo } from 'nuxt/app';
import { GitHub, errorMessage, parsePRUrl, prPath, type PRRef, type TokenInfo } from './github';
import { type DiffSettings } from './DiffView';
import { isTheme } from './themes';
import { clearPeople } from './people';
import { clearInboxSnapshots } from './inboxUpdates';
import { tryStorage } from './storage';

// The app is a client-only SPA, so module state is one session shared by the shell and every page.
const tokenKey = 'review.github-token';
const settingsKey = 'review.preferences';
const teamsKey = 'review.teams';
const readTeams = () => {
  const saved = tryStorage(() => JSON.parse(localStorage.getItem(teamsKey) ?? 'null'));
  return Array.isArray(saved) ? saved.filter((team): team is string => typeof team === 'string') : undefined;
};
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
    const saved = JSON.parse(localStorage.getItem(settingsKey) || '{}');
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

const token = shallowRef('');
export const info = shallowRef<TokenInfo | null>(null);
export const api = computed(() => (token.value ? new GitHub(token.value) : null));
export const restoring = shallowRef(false);
export const storageNotice = shallowRef('');
export const authOpen = shallowRef(false);
// Writes stay ordered across page changes.
export const mutationBusy = shallowRef(false);
export const mutationToast = shallowRef<{ id: number; message: string; path: string; pr: string } | null>(null);
let mutationQueue = Promise.resolve();
let queuedMutations = 0;
let mutationToastTimer: ReturnType<typeof setTimeout> | undefined;

export function enqueueMutation<T>(work: () => Promise<T>): Promise<T> {
  queuedMutations++;
  mutationBusy.value = true;
  const run = mutationQueue.then(work).finally(() => {
    queuedMutations--;
    mutationBusy.value = queuedMutations > 0;
  });
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function showMutationFailure(ref: PRRef, message: string) {
  const id = (mutationToast.value?.id ?? 0) + 1;
  mutationToast.value = { id, message, path: prPath(ref), pr: `${ref.owner}/${ref.repo}#${ref.number}` };
  clearTimeout(mutationToastTimer);
  mutationToastTimer = setTimeout(() => (mutationToast.value = null), Math.max(4000, message.length * 60));
}

export const settings = shallowRef<DiffSettings>(readSettings());
export function changeSettings(value: DiffSettings) {
  settings.value = value;
  tryStorage(() => localStorage.setItem(settingsKey, JSON.stringify(value)));
}

export function openPR(url: string) {
  let ref;
  try {
    ref = parsePRUrl(url);
  } catch {
    return;
  }
  openPRRef(ref);
}
export function openPRRef(ref: PRRef) {
  // The route waits behind the connect screen and renders once a token is in place.
  if (!api.value) authOpen.value = true;
  void navigateTo(prPath(ref));
}

// Session storage is per tab, so a tab opened with a modifier click asks tabs that are already connected for the token.
type SessionMessage = { type: 'request' } | { type: 'token'; token: string } | { type: 'disconnect' };
const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('review.session');
let handoff: ReturnType<typeof setTimeout> | undefined;
channel?.addEventListener('message', ({ data }: MessageEvent<SessionMessage>) => {
  if (data.type === 'request' && token.value) channel.postMessage({ type: 'token', token: token.value } satisfies SessionMessage);
  else if (data.type === 'token' && handoff) restoreToken(data.token);
  else if (data.type === 'disconnect' && token.value) disconnect();
});

let restore: AbortController | undefined;
export function connect(value: string, details: TokenInfo) {
  restore?.abort();
  const controller = (restore = new AbortController());
  token.value = value;
  info.value = { ...details, teams: details.teams ?? readTeams() };
  authOpen.value = false;
  if (
    !tryStorage(() => {
      sessionStorage.setItem(tokenKey, value);
      return true;
    })
  )
    storageNotice.value = 'Browser storage is unavailable. Your token is kept in memory only.';
  // Cached teams answer right away; refreshing on load picks up membership changes without delaying sign-in.
  void new GitHub(value)
    .userTeams(controller.signal)
    .then(teams => {
      if (controller.signal.aborted || !info.value) return;
      tryStorage(() => localStorage.setItem(teamsKey, JSON.stringify(teams)));
      info.value = { ...info.value, teams };
    })
    .catch(() => {});
}
export function disconnect() {
  if (mutationBusy.value) return;
  channel?.postMessage({ type: 'disconnect' } satisfies SessionMessage);
  restore?.abort();
  tryStorage(() => {
    sessionStorage.removeItem(tokenKey);
    localStorage.removeItem(teamsKey);
  });
  clearPeople();
  clearInboxSnapshots();
  token.value = '';
  info.value = null;
  void navigateTo('/');
}
export function restoreSession() {
  const saved = tryStorage(() => sessionStorage.getItem(tokenKey));
  if (saved) return restoreToken(saved);
  if (!channel) return;
  // No reply means no other tab is connected, so the connect screen only waits briefly.
  restoring.value = true;
  handoff = setTimeout(() => {
    handoff = undefined;
    restoring.value = false;
  }, 300);
  channel.postMessage({ type: 'request' } satisfies SessionMessage);
}
function restoreToken(saved: string) {
  clearTimeout(handoff);
  handoff = undefined;
  restoring.value = true;
  const controller = (restore = new AbortController());
  new GitHub(saved)
    .validate(controller.signal)
    .then(details => {
      if (!controller.signal.aborted) connect(saved, details);
    })
    .catch(error => {
      if (controller.signal.aborted) return;
      tryStorage(() => sessionStorage.removeItem(tokenKey));
      storageNotice.value = errorMessage(error, 'Reconnect to GitHub.');
    })
    .finally(() => (restoring.value = false));
}
