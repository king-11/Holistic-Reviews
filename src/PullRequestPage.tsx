import { defineComponent, onUnmounted, shallowRef, watch } from 'vue';
import { navigateTo, useHead, useRoute } from 'nuxt/app';
import { errorMessage, mergeabilityPending, parsePRUrl, type PRRef, type Workspace } from './github';
import { inboxChangedAt, isRecentlyMutated } from './inboxUpdates';
import ReviewWorkspace from './ReviewWorkspace';
import { api, changeSettings, info, mutationBusy, openPR, settings, showOpenDialog } from './session';
import { Github, Loader } from './ui';

const mergeRecheckDelays = [2000, 4000, 8000, 16000, 30000];
const home = () => void navigateTo('/');

export default defineComponent(() => {
  const route = useRoute();
  const workspace = shallowRef<Workspace | null>(null);
  const loading = shallowRef(true);
  const error = shallowRef('');
  let controller: AbortController | undefined;
  let loadVersion = 0;
  let mergeTimer: ReturnType<typeof setTimeout> | undefined;
  useHead({
    title: () => {
      const pr = workspace.value?.pr;
      return pr && `#${pr.number} ${pr.title} · ${route.params.owner}/${route.params.repo}`;
    },
  });

  // Only the PR is refetched; GitHub finishes computing mergeability in the background.
  function recheckMergeability(ref: PRRef, version: number, attempt = 0) {
    clearTimeout(mergeTimer);
    const delay = mergeRecheckDelays[attempt];
    if (delay === undefined || !workspace.value || !mergeabilityPending(workspace.value.pr)) return;
    mergeTimer = setTimeout(async () => {
      const client = api.value;
      const changedBefore = inboxChangedAt.value;
      if (!client || version !== loadVersion) return;
      try {
        const pr = await client.fresh().pullRequest(ref);
        // A write that landed while this poll was in flight already has newer PR state; don't overwrite it.
        if (version !== loadVersion || !workspace.value || mutationBusy.value || inboxChangedAt.value !== changedBefore) return;
        workspace.value = { ...workspace.value, pr };
        recheckMergeability(ref, version, attempt + 1);
      } catch {
        return;
      }
    }, delay);
  }
  // Reviews, comments and threads update in place after a write, but the PR's review requests and mergeability are
  // GitHub's to recompute, so only the PR is reread.
  async function refreshPR() {
    const client = api.value;
    if (!client || !workspace.value) return;
    const version = loadVersion;
    try {
      const ref = parsePRUrl(`https://github.com${route.path}`);
      const pr = await client.fresh().pullRequest(ref);
      if (version !== loadVersion || !workspace.value) return;
      workspace.value = { ...workspace.value, pr };
      recheckMergeability(ref, version);
    } catch {
      return;
    }
  }
  async function load(refresh = false) {
    const live = api.value;
    if (!live) return;
    controller?.abort();
    clearTimeout(mergeTimer);
    const signal = (controller = new AbortController()).signal;
    const version = ++loadVersion;
    error.value = '';
    if (!refresh) {
      workspace.value = null;
      loading.value = true;
    }
    // A refresh or a PR changed earlier in this session must not reuse a 60s cached read from before the write.
    const url = `https://github.com${route.path}`;
    const client = refresh || isRecentlyMutated(url) ? live.fresh() : live;
    try {
      const ref = parsePRUrl(url);
      const result = await client.workspace(
        ref,
        signal,
        value => {
          if (version !== loadVersion) return;
          workspace.value = value;
          loading.value = false;
        },
        refresh ? (workspace.value ?? undefined) : undefined,
      );
      if (version !== loadVersion) return;
      workspace.value = result;
      recheckMergeability(ref, version);
    } catch (failure) {
      if (version === loadVersion && !signal.aborted) {
        workspace.value = null;
        error.value = errorMessage(failure, 'Unable to load the pull request.');
      }
    } finally {
      if (version === loadVersion) loading.value = false;
    }
  }
  watch([() => route.path, api], () => void load(), { immediate: true });
  onUnmounted(() => {
    controller?.abort();
    clearTimeout(mergeTimer);
  });

  return () =>
    loading.value ? (
      <main class="workspace-loading">
        <Loader label="Loading pull request…" />
        <button class="button small" title="Return to your inbox while this PR is loading" onClick={home}>
          Back to inbox
        </button>
      </main>
    ) : workspace.value && api.value && info.value ? (
      <ReviewWorkspace
        workspace={workspace.value}
        api={api.value}
        info={info.value}
        settings={settings.value}
        onSettings={changeSettings}
        onOpen={openPR}
        onBack={home}
        onRefresh={() => void load(true)}
        onRefreshPR={() => void refreshPR()}
        onBusy={value => {
          mutationBusy.value = value;
        }}
      />
    ) : (
      <main class="empty-state">
        <Github size={35} />
        <h2>Couldn’t open this pull request</h2>
        <p class="load-error" role="alert">
          {error.value}
        </p>
        <button class="button" title="Return to your pull request inbox" onClick={home}>
          Back to inbox
        </button>
        <button class="text-button" title="Enter a different GitHub pull request URL" onClick={showOpenDialog}>
          Try another URL
        </button>
      </main>
    );
});
