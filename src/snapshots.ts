// GitHub search and rereads lag local writes by about a minute; past this, the server's view wins again.
export const snapshotLifetime = 3 * 60_000;

// A per-PR store of stamped entries, keyed by id. Reads prune expired entries and drop a PR once it has none left,
// so a session that visits many pull requests doesn't hold on to them all.
export function createSnapshotStore<V extends { at: number }>() {
  const byPR = new Map<string, Map<number, V>>();
  const forPR = (url: string) => {
    let map = byPR.get(url);
    if (!map) byPR.set(url, (map = new Map()));
    return map;
  };
  const prune = (url: string, now = Date.now()) => {
    const map = byPR.get(url);
    if (!map) return;
    for (const [id, entry] of map) if (now - entry.at >= snapshotLifetime) map.delete(id);
    if (!map.size) byPR.delete(url);
  };
  const set = (url: string, id: number, value: V) => forPR(url).set(id, value);
  const remove = (url: string, id: number) => {
    const map = byPR.get(url);
    map?.delete(id);
    if (!map?.size) byPR.delete(url);
  };
  const get = (url: string, id: number, now = Date.now()) => {
    prune(url, now);
    return byPR.get(url)?.get(id);
  };
  const live = (url: string, now = Date.now()): [number, V][] => {
    prune(url, now);
    return [...(byPR.get(url) ?? new Map())];
  };
  const clear = () => byPR.clear();
  return { set, remove, get, live, clear };
}

// Per-PR listeners that fan a change out to every mounted view of that PR.
export function createChangeViews<C>() {
  const byPR = new Map<string, Set<(change: C) => void>>();
  const notify = (url: string, change: C) => byPR.get(url)?.forEach(view => view(change));
  const subscribe = (url: string, view: (change: C) => void) => {
    let views = byPR.get(url);
    if (!views) byPR.set(url, (views = new Set()));
    views.add(view);
    return () => {
      views.delete(view);
      if (!views.size) byPR.delete(url);
    };
  };
  return { notify, subscribe };
}
