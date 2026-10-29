import { shallowRef } from 'vue';
import { errorMessage, mergeabilityPending, prPath, type GitHub, type PRRef, type PullRequest, type Workspace } from './github.ts';
import { clearWrittenPRFields, inboxChangedAt, isRecentlyMutated, recordPRFields, writtenPRFields } from './inboxUpdates.ts';

const mergeRecheckDelays = [2000, 4000, 8000, 16000, 30000];
// Lists written locally while a section loads; the server copy may predate the write, so local-only items survive it.
const keyedLists = ['comments', 'inlineComments', 'reviews', 'reviewThreads'] as const;

// A snapshot replaces only the fields that changed since the previous one from the same load, so a later section
// settling never undoes a local write to a field that had already arrived.
export function mergeSnapshot(local: Workspace | null, incoming: Workspace, previous?: Workspace): Workspace {
  if (!local) return incoming;
  const next = { ...incoming } as Record<keyof Workspace, unknown>;
  for (const key of Object.keys(incoming) as (keyof Workspace)[])
    if (incoming[key] === local[key] || (previous && incoming[key] === previous[key])) next[key] = local[key];
  for (const key of keyedLists) {
    const fresh = incoming[key];
    if (next[key] !== fresh || !fresh) continue;
    const extra = (local[key] ?? []).filter(item => !fresh.some(other => other.id === item.id));
    if (extra.length) next[key] = [...fresh, ...extra];
  }
  return next as Workspace;
}

// The one place a loaded PR lives: progressive loads, refreshes and every local write go through it.
export function createPRWorkspace(prRef: () => PRRef, api: () => GitHub | null, mutationBusy: () => boolean) {
  const workspace = shallowRef<Workspace | null>(null);
  const loading = shallowRef(true);
  const error = shallowRef('');
  let controller: AbortController | undefined;
  let loadVersion = 0;
  let mergeTimer: ReturnType<typeof setTimeout> | undefined;
  let received: Workspace | undefined;
  const withWritten = (state: Workspace): Workspace => {
    const written = writtenPRFields(prRef());
    return {
      ...state,
      pr: { ...state.pr, ...written },
    };
  };

  const current = () => {
    if (!workspace.value) throw new Error('The pull request is not loaded.');
    return workspace.value;
  };
  function patch(change: Partial<Workspace> | ((current: Workspace) => Partial<Workspace>)) {
    if (!workspace.value) return;
    workspace.value = { ...workspace.value, ...(typeof change === 'function' ? change(workspace.value) : change) };
  }
  function setPR(change: Partial<PullRequest>) {
    recordPRFields(prRef(), change);
    patch(state => ({ pr: { ...state.pr, ...change } }));
  }
  // Apply fields optimistically and hand back the undo. rollbackPR restores them only if a later write to the same
  // field hasn't superseded this one, so an old failure never clobbers a newer value.
  function applyPR(change: Partial<PullRequest>) {
    const current = workspace.value?.pr;
    const previous: Partial<PullRequest> = {};
    for (const key of Object.keys(change) as (keyof PullRequest)[]) (previous as Record<string, unknown>)[key] = current?.[key];
    setPR(change);
    return () => rollbackPR(change, previous);
  }
  function rollbackPR(expected: Partial<PullRequest>, previous: Partial<PullRequest>) {
    const written = writtenPRFields(prRef());
    if (Object.entries(expected).every(([key, value]) => JSON.stringify(written[key as keyof PullRequest]) === JSON.stringify(value)))
      setPR(previous);
  }
  const edit = <K extends keyof Workspace>(key: K, next: (previous: Workspace[K]) => Workspace[K]) =>
    patch(state => ({ [key]: next(state[key]) }) as Partial<Workspace>);

  // GitHub finishes computing mergeability in the background, so only the PR is reread until it settles.
  function recheckMergeability(version: number, attempt = 0) {
    clearTimeout(mergeTimer);
    const delay = mergeRecheckDelays[attempt];
    if (delay === undefined || !workspace.value || !mergeabilityPending(workspace.value.pr)) return;
    mergeTimer = setTimeout(async () => {
      if (version !== loadVersion) return;
      // A write that lands while this poll is in flight already has newer PR state; don't overwrite it.
      const changedBefore = inboxChangedAt.value;
      if (await readPR(version, () => !mutationBusy() && inboxChangedAt.value === changedBefore)) recheckMergeability(version, attempt + 1);
    }, delay);
  }
  async function readPR(version: number, current = () => true) {
    const client = api();
    if (!client || !workspace.value) return false;
    try {
      const pr = await client.fresh().pullRequest(prRef());
      if (version !== loadVersion || !current()) return false;
      patch({ pr: { ...pr, ...writtenPRFields(prRef()) } });
      return true;
    } catch {
      return false;
    }
  }
  // Writes update reviews, comments and threads in place, but review requests and mergeability are GitHub's to
  // recompute, so a PR-only refresh rereads just the PR.
  async function refreshPR() {
    const version = loadVersion;
    if (await readPR(version)) recheckMergeability(version);
  }
  async function load(refresh = false) {
    const live = api();
    if (!live) return;
    controller?.abort();
    clearTimeout(mergeTimer);
    const signal = (controller = new AbortController()).signal;
    const version = ++loadVersion;
    received = undefined;
    error.value = '';
    if (!refresh) {
      workspace.value = null;
      loading.value = true;
    }
    const receive = (value: Workspace) => {
      if (version !== loadVersion) return;
      workspace.value = withWritten(mergeSnapshot(workspace.value, value, received));
      received = value;
      loading.value = false;
    };
    try {
      // A refresh, or a PR changed earlier in this session, must not reuse a 60s cached read from before the write.
      const fresh = refresh || isRecentlyMutated(`https://github.com${prPath(prRef())}`);
      receive(
        await (fresh ? live.fresh() : live).workspace(prRef(), signal, receive, refresh ? (workspace.value ?? undefined) : undefined),
      );
      if (version === loadVersion) recheckMergeability(version);
    } catch (failure) {
      if (version === loadVersion && !signal.aborted) {
        workspace.value = null;
        error.value = errorMessage(failure, 'Unable to load the pull request.');
      }
    } finally {
      if (version === loadVersion) loading.value = false;
    }
  }
  const refresh = (scope: 'pr' | 'all') => void (scope === 'pr' ? refreshPR() : load(true));
  const reload = () => {
    clearWrittenPRFields(prRef());
    refresh('all');
  };
  function dispose() {
    controller?.abort();
    clearTimeout(mergeTimer);
  }
  return { workspace, loading, error, current, patch, edit, setPR, applyPR, rollbackPR, load, refresh, reload, dispose };
}
export type PRWorkspace = ReturnType<typeof createPRWorkspace>;
