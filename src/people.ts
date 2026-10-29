import { inject, onScopeDispose, shallowRef, watch, type InjectionKey } from 'vue';
import { errorMessage, type GitHub } from './github.ts';
import { local, tryStorage } from './storage.ts';

export type Person = { login: string; name?: string | null; avatarUrl?: string };
export type PeopleKind = 'assignable' | 'mentionable';
type Repo = { owner: string; repo: string };
type Client = Pick<GitHub, 'people' | 'user'>;
type Saved<T> = T & { at: number };
type Search = Saved<{ logins: string[]; complete: boolean }>;

export const peopleLimits: Record<PeopleKind, number> = { assignable: 20, mentionable: 10 };
export const peopleStoragePrefix = 'review.people.';
export const searchDelay = 250;
const maxAge = 7 * 24 * 60 * 60 * 1000;
const caps = { people: 2000, searches: 300 };
const saveDelay = 500;

const normal = (text: string) => text.trim().toLowerCase();
const plain = ({ login, name, avatarUrl }: Person): Person => ({ login, name, avatarUrl });
// A login prefix beats a prefix of any word in the name, which beats a substring of either; -1 is no match.
function rank(person: Person, query: string) {
  const login = person.login.toLowerCase();
  const name = person.name?.toLowerCase() ?? '';
  if (login.startsWith(query)) return 0;
  if (` ${name}`.includes(` ${query}`)) return 1;
  return login.includes(query) || name.includes(query) ? 2 : -1;
}
const evict = <T extends { at: number }>(entries: Map<string, T>, cap: number) => {
  for (const [key] of [...entries].sort((a, b) => a[1].at - b[1].at).slice(0, Math.max(0, entries.size - cap))) entries.delete(key);
};

// Profiles are the same in every repository, so one lookup per login serves the whole session.
const profiles = new Map<string, Promise<Person | undefined>>();
const unsaved = new Set<PeopleDirectory>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export class PeopleDirectory {
  client: Client;
  readonly repo: Repo;
  private readonly key: string;
  private readonly people = new Map<string, Saved<Person>>();
  private readonly searches = new Map<string, Search>();

  constructor(repo: Repo, client: Client) {
    this.repo = repo;
    this.client = client;
    this.key = `${peopleStoragePrefix}${repo.owner}/${repo.repo}`;
    const saved = tryStorage(() => JSON.parse(local.getItem(this.key) ?? 'null')) as {
      people?: Saved<Person>[];
      searches?: Record<string, Search>;
    } | null;
    const fresh = (at: unknown) => typeof at === 'number' && Date.now() - at < maxAge;
    for (const person of saved?.people ?? []) if (typeof person?.login === 'string' && fresh(person.at)) this.merge(person, person.at);
    for (const [key, search] of Object.entries(saved?.searches ?? {}))
      if (Array.isArray(search?.logins) && fresh(search.at)) this.searches.set(key, search);
  }

  seed(people: Person[]) {
    const at = Date.now();
    for (const person of people) this.merge(person, at);
    this.save();
  }

  // Equal ranks fall back to the most recently seen, so an empty query lists this PR's people first.
  matches(kind: PeopleKind, query: string): Person[] {
    const text = normal(query);
    const ranked = [...this.people.values()]
      .map(person => [rank(person, text), person] as const)
      .filter(([score]) => score >= 0)
      .sort(([a, x], [b, y]) => a - b || y.at - x.at || x.login.localeCompare(y.login))
      .map(([, person]) => person);
    // GitHub also matches on fields we don't keep, so a cached answer can name people the local ranking misses.
    const extra = (this.searches.get(`${kind}:${text}`)?.logins ?? [])
      .map(login => this.people.get(login.toLowerCase()))
      .filter(person => !!person && !ranked.includes(person)) as Saved<Person>[];
    return [...ranked, ...extra].slice(0, peopleLimits[kind]).map(plain);
  }

  async search(kind: PeopleKind, query: string, signal?: AbortSignal) {
    const text = normal(query);
    const limit = peopleLimits[kind];
    const local = this.matches(kind, text);
    if (text.length < 2 || local.length >= limit || this.covered(kind, text)) return local;
    const found = await this.client.people(this.repo, kind, text, limit, signal);
    const at = Date.now();
    for (const person of found) this.merge(person, at);
    this.searches.delete(`${kind}:${text}`);
    this.searches.set(`${kind}:${text}`, { logins: found.map(person => person.login), complete: found.length < limit, at });
    this.save();
    return this.matches(kind, text);
  }

  // A shorter query that returned fewer than the limit already holds every match for any longer one.
  private covered(kind: PeopleKind, text: string) {
    for (let end = text.length; end >= 2; end--) {
      const search = this.searches.get(`${kind}:${text.slice(0, end)}`);
      if (search && (end === text.length || search.complete)) return true;
    }
    return false;
  }

  known(login: string): Person | undefined {
    const person = this.people.get(login.toLowerCase());
    return person && plain(person);
  }

  // Seeded REST users carry no name; `null` means GitHub has none, so only `undefined` needs a lookup.
  async profile(login: string): Promise<Person> {
    const key = login.toLowerCase();
    const known = this.people.get(key);
    if (known && known.name !== undefined) return plain(known);
    // Failures are memoised too, so repeated hovers over an unknown login don't retry.
    if (!profiles.has(key))
      profiles.set(
        key,
        this.client.user(login).catch(() => undefined),
      );
    const person = await profiles.get(key);
    if (!person) return known ? plain(known) : { login };
    this.merge(person, Date.now());
    this.save();
    return plain(this.people.get(key)!);
  }

  private merge(person: Person, at: number) {
    const key = person.login.toLowerCase();
    const old = this.people.get(key);
    this.people.set(key, {
      login: person.login,
      name: person.name !== undefined ? person.name : old?.name,
      avatarUrl: person.avatarUrl || old?.avatarUrl,
      at: Math.max(at, old?.at ?? 0),
    });
  }

  // One shared timer batches writes, so typing and section updates don't thrash storage.
  private save() {
    unsaved.add(this);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      for (const directory of unsaved) directory.persist();
      unsaved.clear();
    }, saveDelay);
  }

  persist() {
    evict(this.people, caps.people);
    evict(this.searches, caps.searches);
    local.setItem(this.key, JSON.stringify({ people: [...this.people.values()], searches: Object.fromEntries(this.searches) }));
  }
}

// One directory per repository for the whole session, so moving between its PRs keeps what was learned.
const directories = new Map<string, PeopleDirectory>();
export function peopleDirectory(repo: Repo, client: Client) {
  const key = `${repo.owner}/${repo.repo}`.toLowerCase();
  let directory = directories.get(key);
  if (!directory) directories.set(key, (directory = new PeopleDirectory(repo, client)));
  directory.client = client;
  return directory;
}

// A different account may connect next, so nothing learned under this token may survive it.
export function clearPeople() {
  clearTimeout(saveTimer);
  unsaved.clear();
  directories.clear();
  profiles.clear();
  const keys = Array.from({ length: local.length }, (_, index) => local.key(index));
  for (const key of keys) if (key?.startsWith(peopleStoragePrefix)) local.removeItem(key);
}

export const peopleKey: InjectionKey<() => PeopleDirectory> = Symbol('people');
export function usePeople() {
  const provided = inject(peopleKey, null);
  return () => provided?.();
}

// One debounce and abort path for every people search, so typing never stacks requests or shows a superseded answer.
export function useSearch<T>(query: () => string | null, search?: (query: string, signal: AbortSignal) => Promise<T[]>) {
  const result = shallowRef<{ query: string | null; items: T[]; error: string }>({ query: null, items: [], error: '' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const stop = () => {
    clearTimeout(timer);
    controller?.abort();
  };
  watch(
    query,
    value => {
      stop();
      if (value === null || !search) return;
      // An empty query only lists known people, so it skips the debounce.
      timer = setTimeout(
        () => {
          const current = (controller = new AbortController());
          search(value, current.signal).then(
            items => {
              if (!current.signal.aborted) result.value = { query: value, items, error: '' };
            },
            error => {
              if (!current.signal.aborted) result.value = { query: value, items: [], error: errorMessage(error, 'Search failed.') };
            },
          );
        },
        value.trim() ? searchDelay : 0,
      );
    },
    { immediate: true },
  );
  onScopeDispose(stop);
  return () => (result.value.query === query() ? result.value : { items: [] as T[], error: '' });
}
