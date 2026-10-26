// Storage can be unavailable (private mode, quota); preferences must never break the app.
// Kept out of ui.tsx so plain modules stay loadable by the node test runner.

// When the real backend is blocked, a session-lifetime in-memory shim keeps reads
// and writes consistent instead of silently dropping state between calls.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

const usable = (storage: Storage) => {
  try {
    storage.setItem('__probe', '1');
    storage.removeItem('__probe');
    return true;
  } catch {
    return false;
  }
};

// Resolved lazily on first access so test runners and builds can install globals first.
const pick = (get: () => Storage | undefined) => {
  let chosen: { storage: Storage; real: boolean } | undefined;
  return () => {
    if (!chosen) {
      const storage = get();
      chosen = storage && usable(storage) ? { storage, real: true } : { storage: memoryStorage(), real: false };
    }
    return chosen;
  };
};
const pickLocal = pick(() => (typeof localStorage === 'undefined' ? undefined : localStorage));
const pickSession = pick(() => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage));

const wrap = (choose: () => { storage: Storage; real: boolean }): Storage => ({
  get length() {
    return choose().storage.length;
  },
  clear: () => choose().storage.clear(),
  getItem: key => choose().storage.getItem(key),
  key: index => choose().storage.key(index),
  removeItem: key => choose().storage.removeItem(key),
  setItem: (key, value) => choose().storage.setItem(key, value),
});

export const local = wrap(pickLocal);
export const session = wrap(pickSession);

// Settings keys carry the GitHub login so each identity keeps its own preferences.
export const scopedKey = (base: string, login?: string) => (login ? `${base}:${login}` : base);

// JSON.parse and other fallible calls around storage still need swallowing.
export function tryStorage<T>(action: () => T) {
  try {
    return action();
  } catch {
    return undefined;
  }
}
// True when the real browser storage is backing reads and writes; a memory shim means persistence is off.
export const localIsMemory = () => !pickLocal().real;
// The real localStorage instance (or undefined when blocked) for APIs that check `instanceof Storage`,
// like @vueuse useStorage's cross-tab `storage`-event wiring.
export const localInstance = () => pickLocal().storage;
