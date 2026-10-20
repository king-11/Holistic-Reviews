import { computed, shallowRef } from 'vue';
import { navigateTo } from 'nuxt/app';
import { GitHub, errorMessage, parsePRUrl, prPath, type TokenInfo } from './github';
import { type DiffSettings } from './DiffView';
import { isTheme } from './themes';
import { clearPeople } from './people';
import { clearInboxSnapshots } from './inboxUpdates';
import { tryStorage } from './storage';

// The app is a client-only SPA, so module state is one session shared by the shell and every page.
const tokenKey = 'review.github-token';
const settingsKey = 'review.preferences';
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
// Set while a review write is in flight; the shell's route guard and header controls hold navigation until it settles.
export const mutationBusy = shallowRef(false);

export const settings = shallowRef<DiffSettings>(readSettings());
export function changeSettings(value: DiffSettings) {
  settings.value = value;
  tryStorage(() => localStorage.setItem(settingsKey, JSON.stringify(value)));
}

export const openDialog = shallowRef(false);
export const prUrl = shallowRef('');
export const openError = shallowRef('');
export function showOpenDialog() {
  if (mutationBusy.value) return;
  prUrl.value = '';
  openError.value = '';
  openDialog.value = true;
}
export function openPR(url: string) {
  let ref;
  try {
    ref = parsePRUrl(url);
  } catch (error) {
    openError.value = errorMessage(error, 'Invalid URL.');
    return;
  }
  openDialog.value = false;
  openError.value = '';
  // The route waits behind the connect screen and renders once a token is in place.
  if (!api.value) authOpen.value = true;
  void navigateTo(prPath(ref));
}

let restore: AbortController | undefined;
export function connect(value: string, details: TokenInfo) {
  restore?.abort();
  token.value = value;
  info.value = details;
  authOpen.value = false;
  if (
    !tryStorage(() => {
      sessionStorage.setItem(tokenKey, value);
      return true;
    })
  )
    storageNotice.value = 'Browser storage is unavailable. Your token is kept in memory only.';
}
export function disconnect() {
  if (mutationBusy.value) return;
  restore?.abort();
  tryStorage(() => sessionStorage.removeItem(tokenKey));
  clearPeople();
  clearInboxSnapshots();
  token.value = '';
  info.value = null;
  void navigateTo('/');
}
export function restoreSession() {
  const saved = tryStorage(() => sessionStorage.getItem(tokenKey));
  if (!saved) return;
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
