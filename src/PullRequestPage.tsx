import { defineComponent, onUnmounted, watch } from 'vue';
import { navigateTo, useHead, useRoute } from 'nuxt/app';
import { parsePRUrl } from './github';
import { createPRWorkspace } from './prWorkspace';
import ReviewWorkspace from './ReviewWorkspace';
import { api, changeSettings, info, mutationBusy, openPR, settings, showOpenDialog } from './session';
import { Github, Loader } from './ui';

const home = () => void navigateTo('/');

export default defineComponent(() => {
  const route = useRoute();
  const store = createPRWorkspace(
    () => parsePRUrl(`https://github.com${route.path}`),
    () => api.value,
  );
  useHead({
    title: () => {
      const pr = store.workspace.value?.pr;
      return pr && `#${pr.number} ${pr.title} · ${route.params.owner}/${route.params.repo}`;
    },
  });
  watch([() => route.path, api], () => void store.load(), { immediate: true });
  onUnmounted(store.dispose);

  return () =>
    store.loading.value ? (
      <main class="workspace-loading">
        <Loader label="Loading pull request…" />
        <button class="button small" title="Return to your inbox while this PR is loading" onClick={home}>
          Back to inbox
        </button>
      </main>
    ) : store.workspace.value && api.value && info.value ? (
      <ReviewWorkspace
        store={store}
        api={api.value}
        info={info.value}
        settings={settings.value}
        onSettings={changeSettings}
        onOpen={openPR}
        onBack={home}
        onBusy={value => {
          mutationBusy.value = value;
        }}
      />
    ) : (
      <main class="empty-state">
        <Github size={35} />
        <h2>Couldn’t open this pull request</h2>
        <p class="load-error" role="alert">
          {store.error.value}
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
