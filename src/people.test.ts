import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, shallowRef } from 'vue';
import {
  PeopleDirectory,
  clearPeople,
  peopleDirectory,
  peopleLimits,
  searchDelay,
  useSearch,
  type PeopleKind,
  type Person,
} from './people.ts';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

const repo = { owner: 'acme', repo: 'app' };
const key = 'review.people.acme/app';
const day = 24 * 60 * 60 * 1000;
type Call = { kind: PeopleKind; search: string; first: number; signal?: AbortSignal };
function client(people: Person[] = [], failProfiles = false) {
  const calls: Call[] = [];
  const users: string[] = [];
  return {
    calls,
    users,
    people: async (_repo: unknown, kind: PeopleKind, search: string, first: number, signal?: AbortSignal) => {
      calls.push({ kind, search, first, signal });
      return people.filter(person => `${person.login} ${person.name}`.toLowerCase().includes(search)).slice(0, first);
    },
    user: async (login: string) => {
      users.push(login);
      if (failProfiles) throw new Error('Not Found');
      return { login, name: `Name of ${login}`, avatarUrl: `https://avatars/${login}` };
    },
  };
}
const logins = (people: Person[]) => people.map(person => person.login);
const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ login: `${prefix}${index}`, name: `${prefix} person ${index}` }));

beforeEach(() => {
  clearPeople();
  store.clear();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 * day });
});
// Node's timer mock removes a stale cleared timer by queue position, so pending saves must run before each reset.
afterEach(() => {
  mock.timers.runAll();
  mock.timers.reset();
});

describe('people directory', () => {
  const ranked = [
    { login: 'sam', name: 'Zed Allen' },
    { login: 'alsam', name: 'Bo Sam' },
    { login: 'xsamx', name: null },
    { login: 'other', name: 'Samantha Ray' },
  ];
  for (const [query, expected] of [
    ['sam', ['sam', 'alsam', 'other', 'xsamx']],
    ['  SAM ', ['sam', 'alsam', 'other', 'xsamx']],
    ['al', ['alsam', 'sam']],
    ['ray', ['other']],
    ['', ['alsam', 'other', 'sam', 'xsamx']],
  ] as const)
    it(`ranks "${query}" by login prefix, then name-word prefix, then substring`, () => {
      const directory = new PeopleDirectory(repo, client());
      directory.seed(ranked);
      assert.deepEqual(logins(directory.matches('assignable', query)), expected);
    });

  for (const [name, kind, query, seeded, requests] of [
    ['one character', 'mentionable', 'p', [], 0],
    ['one character after trimming', 'mentionable', '  p ', [], 0],
    ['local matches filling the mention limit', 'mentionable', 'pe', numbered('pe', 10), 0],
    ['local matches short of the picker limit', 'assignable', 'pe', numbered('pe', 10), 1],
    ['no local matches', 'mentionable', 'zz', [], 1],
  ] as const)
    it(`${requests ? 'searches GitHub' : 'stays local'} for ${name}`, async () => {
      const fake = client();
      const directory = new PeopleDirectory(repo, fake);
      directory.seed([...seeded]);
      await directory.search(kind, query);
      assert.equal(fake.calls.length, requests);
      if (requests) assert.deepEqual(fake.calls[0], { kind, search: query.trim(), first: peopleLimits[kind], signal: undefined });
    });

  it('caches each kind and query and merges results into local matches', async () => {
    const fake = client([{ login: 'zoe', name: 'Zoe Quinn', avatarUrl: 'z.png' }]);
    const directory = new PeopleDirectory(repo, fake);
    assert.deepEqual(await directory.search('mentionable', 'Quin'), [{ login: 'zoe', name: 'Zoe Quinn', avatarUrl: 'z.png' }]);
    await directory.search('mentionable', 'quin');
    await directory.search('assignable', 'quin');
    assert.deepEqual(
      fake.calls.map(call => [call.kind, call.search]),
      [
        ['mentionable', 'quin'],
        ['assignable', 'quin'],
      ],
    );
    assert.deepEqual(logins(directory.matches('mentionable', 'zo')), ['zoe']);
  });

  for (const [count, requests] of [
    [3, 1],
    [peopleLimits.mentionable, 2],
  ])
    it(`${requests === 1 ? 'filters a complete' : 'searches past an incomplete'} prefix of ${count} results`, async () => {
      const fake = client(numbered('zo', count));
      const directory = new PeopleDirectory(repo, fake);
      await directory.search('mentionable', 'zo');
      const longer = await directory.search('mentionable', 'zo1');
      assert.equal(fake.calls.length, requests);
      assert.ok(logins(longer).every(login => login.startsWith('zo1')));
    });

  for (const [name, failProfiles, expected] of [
    ['a fetched profile', false, { login: 'ann', name: 'Name of ann', avatarUrl: 'https://avatars/ann' }],
    ['a failed profile as unknown', true, { login: 'ann', name: undefined, avatarUrl: 'a.png' }],
  ] as const)
    it(`memoises ${name} for the session`, async () => {
      const fake = client([], failProfiles);
      const directory = new PeopleDirectory(repo, fake);
      directory.seed([{ login: 'ann', avatarUrl: 'a.png' }]);
      assert.deepEqual(await directory.profile('ann'), expected);
      assert.deepEqual(await directory.profile('ann'), expected);
      assert.deepEqual(fake.users, ['ann']);
    });

  it('returns known names without a profile request', async () => {
    const fake = client();
    const directory = new PeopleDirectory(repo, fake);
    directory.seed([{ login: 'kim', name: null }]);
    assert.deepEqual(await directory.profile('kim'), { login: 'kim', name: null, avatarUrl: undefined });
    assert.deepEqual(fake.users, []);
  });

  it('shares one directory per repository and uses the latest client', () => {
    const [first, second] = [client(), client()];
    const directory = peopleDirectory(repo, first);
    assert.equal(peopleDirectory({ owner: 'Acme', repo: 'App' }, second), directory);
    assert.equal(directory.client, second);
    assert.notEqual(peopleDirectory({ owner: 'acme', repo: 'other' }, first), directory);
  });
});

describe('people persistence', () => {
  it('round-trips people and cached searches after a debounced write', async () => {
    const fake = client([{ login: 'zoe', name: 'Zoe Quinn' }]);
    const directory = new PeopleDirectory(repo, fake);
    directory.seed([{ login: 'ann', avatarUrl: 'a.png' }]);
    await directory.search('assignable', 'quin');
    assert.equal(store.has(key), false);
    mock.timers.tick(500);
    const restored = new PeopleDirectory(repo, fake);
    assert.deepEqual(await restored.search('assignable', 'quin'), [{ login: 'zoe', name: 'Zoe Quinn', avatarUrl: undefined }]);
    assert.deepEqual(logins(restored.matches('assignable', '')), ['ann', 'zoe']);
    assert.equal(fake.calls.length, 1);
  });

  it('drops people and searches saved more than seven days ago', () => {
    const now = Date.now();
    store.set(
      key,
      JSON.stringify({
        people: [
          { login: 'fresh', at: now - 6 * day },
          { login: 'stale', at: now - 8 * day },
        ],
        searches: {
          'assignable:fr': { logins: ['fresh'], complete: true, at: now - 6 * day },
          'assignable:st': { logins: ['stale'], complete: true, at: now - 8 * day },
        },
      }),
    );
    const directory = new PeopleDirectory(repo, client());
    directory.persist();
    const saved = JSON.parse(store.get(key)!);
    assert.deepEqual(logins(saved.people), ['fresh']);
    assert.deepEqual(Object.keys(saved.searches), ['assignable:fr']);
  });

  it('keeps only the newest 2,000 people and 300 searches', () => {
    const now = Date.now();
    store.set(
      key,
      JSON.stringify({
        people: Array.from({ length: 2010 }, (_, index) => ({ login: `p${index}`, at: now - 2010 + index })),
        searches: Object.fromEntries(
          Array.from({ length: 310 }, (_, index) => [`mentionable:q${index}`, { logins: [], complete: true, at: now - 310 + index }]),
        ),
      }),
    );
    new PeopleDirectory(repo, client()).persist();
    const saved = JSON.parse(store.get(key)!);
    assert.equal(saved.people.length, 2000);
    assert.equal(
      saved.people.some((person: Person) => person.login === 'p9'),
      false,
    );
    assert.equal(Object.keys(saved.searches).length, 300);
    assert.equal('mentionable:q9' in saved.searches, false);
  });

  it('clears every stored directory and any pending write on disconnect', () => {
    store.set('review.people.acme/other', '{}');
    store.set('review.preferences', '{}');
    const directory = peopleDirectory(repo, client());
    directory.seed([{ login: 'ann' }]);
    clearPeople();
    mock.timers.tick(500);
    assert.deepEqual([...store.keys()], ['review.preferences']);
    assert.notEqual(peopleDirectory(repo, client()), directory);
  });
});

describe('debounced people search', () => {
  it('debounces typing and aborts a superseded search', async () => {
    const signals: [string, AbortSignal][] = [];
    const answers: Record<string, (people: Person[]) => void> = {};
    const query = shallowRef<string | null>('a');
    const scope = effectScope();
    const results = scope.run(() =>
      useSearch(
        () => query.value,
        (value, signal) => {
          signals.push([value, signal]);
          return new Promise<Person[]>(resolve => (answers[value] = resolve));
        },
      ),
    )!;
    for (const value of ['al', 'ali']) {
      mock.timers.tick(searchDelay - 1);
      query.value = value;
      await nextTick();
    }
    mock.timers.tick(searchDelay);
    query.value = 'alic';
    await nextTick();
    mock.timers.tick(searchDelay);
    assert.deepEqual(
      signals.map(([value, signal]) => [value, signal.aborted]),
      [
        ['ali', true],
        ['alic', false],
      ],
    );
    answers.ali([{ login: 'stale' }]);
    answers.alic([{ login: 'alice' }]);
    await nextTick();
    assert.deepEqual(results().items, [{ login: 'alice' }]);
    scope.stop();
    assert.equal(signals[1][1].aborted, true);
  });
});
