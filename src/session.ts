import { computed, shallowRef } from 'vue';
import { navigateTo } from 'nuxt/app';
import { useStorage } from '@vueuse/core';
import { GitHub, errorMessage, parsePRUrl, prPath, type PRRef, type TokenInfo } from './github';
import { type DiffSettings } from './DiffView';
import { isTheme } from './themes';
import { clearPeople } from './people';
import { clearInboxSnapshots } from './inboxUpdates';
import { local, localInstance, localIsMemory, scopedKey, session, tryStorage } from './storage';

// The app is a client-only SPA, so module state is one session shared by the shell and every page.
const tokenKey = 'review.github-token';
const identityKey = 'review.identity';
const settingsBase = 'review.preferences';
const inboxBase = 'review.inbox';
const teamsBase = 'review.teams';
const teamsKey = (login: string) => scopedKey(teamsBase, login);
const readTeams = (login: string) => {
  const saved = tryStorage(() => JSON.parse(local.getItem(teamsKey(login)) ?? 'null'));
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
const sanitizeSettings = (saved: unknown): DiffSettings => {
  const value = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  return {
    layout: value.layout === 'split' || value.layout === 'unified' ? value.layout : defaults.layout,
    theme: isTheme(value.theme) ? value.theme : defaults.theme,
    backgrounds: typeof value.backgrounds === 'boolean' ? value.backgrounds : defaults.backgrounds,
    lineNumbers: typeof value.lineNumbers === 'boolean' ? value.lineNumbers : defaults.lineNumbers,
    wordWrap: typeof value.wordWrap === 'boolean' ? value.wordWrap : defaults.wordWrap,
    indicators: value.indicators === 'classic' || value.indicators === 'bars' || value.indicators === 'none' ? value.indicators : defaults.indicators,
    commentPlacement: value.commentPlacement === 'below' ? 'below' : 'inline',
    hideBotComments: value.hideBotComments === true,
  };
};

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

// Settings keys are scoped per identity; the last-connected login answers before a session restores.
export const identity = shallowRef<string | undefined>(local.getItem(identityKey) ?? undefined);
export const settings = useStorage<DiffSettings>(
  () => scopedKey(settingsBase, info.value?.user.login ?? identity.value),
  defaults,
  localInstance(),
  { serializer: { read: raw => sanitizeSettings(tryStorage(() => JSON.parse(raw))), write: value => JSON.stringify(value) } },
);
export function changeSettings(value: DiffSettings) {
  settings.value = value;
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

// Other tabs observe token writes and removals through the storage event; localStorage is shared, so no handshake is needed.
if (typeof window !== 'undefined')
  window.addEventListener('storage', event => {
    if (event.key !== tokenKey || event.storageArea !== localInstance()) return;
    if (event.newValue) restoreToken(event.newValue);
    else disconnect();
  });

let restore: AbortController | undefined;
// Earlier versions kept these keys unscoped; the first identity to connect after the upgrade claims them.
const scopedBases = [settingsBase, inboxBase, teamsBase];
function migrate(login: string) {
  for (const base of scopedBases) {
    const legacy = local.getItem(base);
    if (legacy === null) continue;
    if (local.getItem(`${base}:${login}`) === null) local.setItem(`${base}:${login}`, legacy);
    local.removeItem(base);
  }
}
export function connect(value: string, details: TokenInfo) {
  restore?.abort();
  const controller = (restore = new AbortController());
  const login = details.user.login;
  token.value = value;
  migrate(login);
  local.setItem(identityKey, login);
  identity.value = login;
  info.value = { ...details, teams: details.teams ?? readTeams(login) };
  authOpen.value = false;
  local.setItem(tokenKey, value);
  if (localIsMemory()) storageNotice.value = 'Browser storage is unavailable. Your token and settings are kept in memory only.';
  // Cached teams answer right away; refreshing on load picks up membership changes without delaying sign-in.
  void new GitHub(value)
    .userTeams(controller.signal)
    .then(teams => {
      if (controller.signal.aborted || !info.value) return;
      local.setItem(teamsKey(login), JSON.stringify(teams));
      info.value = { ...info.value, teams };
    })
    .catch(() => {});
}
export function disconnect() {
  if (mutationBusy.value) return;
  restore?.abort();
  const login = info.value?.user.login;
  local.removeItem(tokenKey);
  if (login) local.removeItem(teamsKey(login));
  clearPeople();
  clearInboxSnapshots();
  token.value = '';
  info.value = null;
  void navigateTo('/');
}
export function restoreSession() {
  // The sessionStorage era: move a leftover tab token into shared storage once.
  const legacy = session.getItem(tokenKey);
  if (legacy !== null) {
    session.removeItem(tokenKey);
    if (local.getItem(tokenKey) === null) local.setItem(tokenKey, legacy);
  }
  const saved = local.getItem(tokenKey);
  if (saved) return restoreToken(saved);
}
function restoreToken(saved: string) {
  restoring.value = true;
  const controller = (restore = new AbortController());
  new GitHub(saved)
    .validate(controller.signal)
    .then(details => {
      if (!controller.signal.aborted) connect(saved, details);
    })
    .catch(error => {
      if (controller.signal.aborted) return;
      local.removeItem(tokenKey);
      storageNotice.value = errorMessage(error, 'Reconnect to GitHub.');
    })
    .finally(() => (restoring.value = false));
}
