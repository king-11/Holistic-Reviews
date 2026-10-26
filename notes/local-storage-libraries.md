# localStorage libraries — research notes

Surveyed 2026-10-26 for the per-identity settings + persistent-token refactor.
Requirements: sync API, JSON serialization, per-login key namespacing, blocked-storage
in-memory fallback (hard requirement — blocked storage must not break the app),
cross-tab sync, TypeScript types.

Weekly downloads from api.npmjs.org (window 2026-10-16 → 2026-10-22).

## Candidates

### `@vueuse/core` `useStorage`/`useLocalStorage` — installed (15.0.0), ~8.0M dl/wk
Source: installed `node_modules/@vueuse/core/dist/index.js` (`useStorage`, ~line 1882);
docs https://vueuse.org/core/useStorage/

- **Sync API**, returns a `Ref` — already used for `useWidth` in `src/ui.tsx:92`.
- **Cross-tab sync built in**: listens to `storage` events by default
  (`listenToStorageChanges = true`, ~line 1919).
- **Serialization**: JSON for objects, pluggable `serializer`, `mergeDefaults` option.
- **Blocked storage**: `if (!storage) return data` (~line 1894) — degrades to an
  in-memory ref. A `setItem` that throws (private mode, quota) is caught and routed
  to `onError` (~line 1952); the ref still updates, only persistence fails.
  One gap: a `window.localStorage` *property access* that throws happens before the
  try/catch — covered by probing once ourselves and passing `storage` explicitly.
- **Custom backends**: the `storage` option accepts any `Storage`-compatible object;
  non-native backends get same-document sync via a dispatched `CustomEvent`
  (~lines 1921, 1936).

### `store2` (nbubna/store) — v2.14.4 (2024-12-26), ~1.49M dl/wk
https://github.com/nbubna/store

- Sync API, JSON built-in, real **namespaces** (`store.namespace('review.inbox')`),
  plugin system (expire/TTL, events, deep ops).
- **Fakes storage when unavailable** — the one feature vueuse lacks natively
  (README: "If localStorage or sessionStorage are unavailable, they will be faked
  to prevent errors"; `store.isFake()`, `store.overflow` plugin).
- Effectively feature-frozen; stable but low development activity.

### `localforage` — v1.10.0 (2022-06), ~5.1M dl/wk
Async-only Promise API over IndexedDB/WebSQL. Wrong fit — settings are read
synchronously at module init; data is ~5 small keys.

### `idb-keyval` — v6.3.0 (2026-07), ~6.6M dl/wk
Async IndexedDB. Rejected on the same grounds as localforage.

### `local-storage` (bevacqua) — v2.0.0 (2022-06), ~59K dl/wk
Sync API, JSON, per-key change events + cross-tab via `storage` events, graceful
no-op when storage is unavailable. Stale; no namespacing or TTL.

### `lscache` — v1.3.2 (2022-06), ~30K dl/wk
Sync API, JSON, per-item TTL, prefix support. Its only edge (TTL) is already
implemented manually in `src/people.ts`. Stale.

### `web-storage-cache` — v1.1.1 (2022-06), ~5K dl/wk
TTL-focused, unmaintained. Rejected.

### `superjson` — ~8.1M dl/wk
Serializer, not storage. Unneeded — persisted payloads are plain JSON.

## Recommendation

**No new dependency.** Use `useStorage`/`useLocalStorage` from the already-installed
`@vueuse/core` where a reactive ref is wanted, backed by a single probed
storage-or-memory object from `src/storage.ts`:

```ts
const probe = (s: Storage) => { try { s.setItem('__p', '1'); s.removeItem('__p'); return true; } catch { return false; } };
export const local = probe(localStorage) ? localStorage : memoryShim(); // ~15 lines, satisfies Storage
export const session = probe(sessionStorage) ? sessionStorage : memoryShim();
```

- `useStorage(key, defaults, local)` → cross-tab sync + JSON + `mergeDefaults` for free.
- The memory shim closes the gap `tryStorage` has today (a blocked write then a
  blocked read loses state mid-session; a Map shim keeps it working in-memory).
- Per-login scoping stays plain key strings (`review.inbox:<login>`) — no library
  needed; store2's namespace feature doesn't justify a dependency.
- Validated readers (`readSettings`, `readPreferences`) keep field-by-field
  validation over `local.getItem` — `useStorage`'s serializer would bypass it anyway.
