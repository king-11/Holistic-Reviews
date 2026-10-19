import { defineComponent, onUnmounted, ref } from 'vue';
import { ArrowUpRight, Check, CheckCheck, Copy, KeyRound, LockKeyhole, ShieldCheck } from '@lucide/vue';
import { GitHub, type TokenInfo } from './github';
import { Github, Modal, Spinner, inputValue } from './ui';
import styles from './AuthDialog.module.css';

export default defineComponent(
  (props: { onClose: () => void; onConnect: (token: string, info: TokenInfo) => void }) => {
    const token = ref('');
    const error = ref('');
    const busy = ref(false);
    const copied = ref(false);
    const controller = new AbortController();
    onUnmounted(() => controller.abort());
    async function connect(event: Event) {
      event.preventDefault();
      if (busy.value) return;
      const value = token.value.trim();
      if (!value || /\s/.test(value)) {
        error.value = 'Paste a token without spaces or line breaks.';
        return;
      }
      busy.value = true;
      error.value = '';
      try {
        const info = await new GitHub(value).validate(controller.signal);
        if (!controller.signal.aborted) props.onConnect(value, info);
      } catch (failure) {
        if (!controller.signal.aborted) error.value = failure instanceof Error ? failure.message : 'Unable to connect to GitHub.';
      } finally {
        busy.value = false;
      }
    }
    const command = 'gh auth login --scopes repo,read:org\n# If already logged in: gh auth refresh --scopes repo,read:org\ngh auth token';
    return () => (
      <Modal title="Connect to GitHub" subtitle="Your reviews, right where you need them." onClose={props.onClose}>
        <div class={`flex items-center gap-3 pt-0 ${styles['pb-6']} px-0 text-xs text-secondary leading-relaxed`}>
          <span class={`w-12 h-12 rounded-xl bg-subtle grid place-items-center shrink-0 text-text border border-border`}>
            <Github size={25} />
          </span>
          <p>Load your inbox, explore private diffs, and send comments and reviews as yourself.</p>
        </div>
        <div class={`${styles['setup-step']}`}>
          <span class={`${styles['step-number']}`}>1</span>
          <div>
            <h3>Get a token from the GitHub CLI</h3>
            <p>Run locally. Never share the output in chat.</p>
          </div>
        </div>
        <div class={`${styles['command-block']}`}>
          <pre>{command}</pre>
          <button
            aria-label="Copy GitHub CLI commands"
            title="Copy commands"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                copied.value = true;
              } catch {
                error.value = 'Clipboard unavailable. Copy the commands manually.';
              }
            }}
          >
            {copied.value ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <details class={`${styles['token-help']}`}>
          <summary>Using a fine-grained personal access token?</summary>
          <p>
            Select the repositories you want to review. Set <strong>Pull requests: Read and write</strong> and{' '}
            <strong>Contents: Read</strong> for surrounding file context. Metadata read is automatic. Classic tokens need <code>repo</code>{' '}
            for private repositories, or <code>public_repo</code> for public repositories only. Authorize organization SSO if required.
          </p>
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
            Create a token on GitHub <ArrowUpRight size={13} />
          </a>
        </details>
        <div class={`${styles['setup-step']}`}>
          <span class={`${styles['step-number']}`}>2</span>
          <div>
            <h3>Paste your token</h3>
            <p>We verify your identity and reported scopes before connecting.</p>
          </div>
        </div>
        <form onSubmit={connect}>
          <label class="input-label" for="github-token">
            GitHub access token
          </label>
          <div class="token-input">
            <KeyRound size={16} />
            <input
              id="github-token"
              type="password"
              value={token.value}
              onInput={event => {
                token.value = inputValue(event);
              }}
              placeholder="ghp_… or github_pat_…"
              autocomplete="off"
              spellcheck={false}
              required
              disabled={busy.value}
            />
          </div>
          {error.value && (
            <p class="error-message" role="alert">
              {error.value}
            </p>
          )}
          <button
            class="button primary full-width"
            title="Verify this token with GitHub and connect your account"
            type="submit"
            disabled={busy.value || !token.value.trim()}
          >
            {busy.value ? (
              <Spinner text="Verifying token…" />
            ) : (
              <>
                <Github size={16} /> Connect GitHub
              </>
            )}
          </button>
        </form>
        <div class={`${styles['security-note']}`}>
          <LockKeyhole size={14} />
          <p>
            Your token goes straight from this browser to api.github.com and stays in this tab’s session storage until you disconnect or
            close the tab. It is never sent to any other server.
          </p>
        </div>
        <div class={`${styles['permissions-note']}`}>
          <ShieldCheck size={14} />
          <span>
            Fine-grained write grants and organization policies cannot be fully preflighted; GitHub enforces them on every action.
          </span>
          <CheckCheck size={14} />
        </div>
      </Modal>
    );
  },
  { props: ['onClose', 'onConnect'] },
);
