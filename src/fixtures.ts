// Test-only sample data.
import type { ChangedFile, InboxGroup, InboxItem, PullRequest, PullRequestDetails, ReviewState, Workspace } from './github';

const author = { id: 202, login: 'alexchen' };
const repo = { id: 1, full_name: 'askscio/scio', private: true };
const now = new Date().toISOString();
const branch = (ref: string) => ({ ref, sha: 'e4c921f7a88630f3', repo });

function file(filename: string, old: string, next: string): ChangedFile {
  const before = old ? old.split('\n') : [];
  const after = next ? next.split('\n') : [];
  return {
    filename,
    status: before.length ? 'modified' : 'added',
    additions: after.length,
    deletions: before.length,
    changes: before.length + after.length,
    patch: `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@\n${before
      .map(line => `-${line}`)
      .concat(after.map(line => `+${line}`))
      .join('\n')}\n`,
  };
}

const files: ChangedFile[] = [
  file(
    'typescript/web/admin/datasources/components/CodaMCPSetupForm.tsx',
    '',
    `import { createSignal, Show } from 'solid-js';
import { Button, TextField } from '@/components';
import { useDatasource } from '../lib/useDatasource';
import type { CodaConnection } from '../types';

interface CodaMCPSetupFormProps {
  connection: CodaConnection;
  onComplete: () => void;
}

export function CodaMCPSetupForm(props: CodaMCPSetupFormProps) {
  const [apiToken, setApiToken] = createSignal('');
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const datasource = useDatasource();

  async function handleConnect(event: SubmitEvent) {
    event.preventDefault();
    if (!apiToken().trim()) return;

    setIsConnecting(true);
    setError(undefined);

    try {
      await datasource.connect({
        type: 'coda',
        token: apiToken().trim(),
        connectionId: props.connection.id,
      });
      props.onComplete();
    } catch {
      setError('Unable to connect. Check your API token and try again.');
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <form onSubmit={handleConnect}>
      <TextField
        label="Coda API token"
        type="password"
        value={apiToken()}
        onInput={setApiToken}
        autocomplete="off"
      />
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Button type="submit" disabled={isConnecting()}>
        {isConnecting() ? 'Connecting…' : 'Connect Coda'}
      </Button>
    </form>
  );
}`,
  ),
  file(
    'typescript/web/admin/datasources/components/CodaSetupPage.tsx',
    `import { CodaSetupForm } from './CodaSetupForm';

export function CodaSetupPage() {
  return <CodaSetupForm />;
}`,
    `import { Show } from 'solid-js';
import { CodaSetupForm } from './CodaSetupForm';
import { CodaMCPSetupForm } from './CodaMCPSetupForm';
import { useConnection } from '../lib/useConnection';

export function CodaSetupPage() {
  const connection = useConnection();

  return (
    <Show
      when={connection.mode === 'mcp'}
      fallback={<CodaSetupForm />}
    >
      <CodaMCPSetupForm
        connection={connection}
        onComplete={() => connection.refresh()}
      />
    </Show>
  );
}`,
  ),
  file(
    'typescript/web/admin/datasources/components/CodaSetupPage.spec.tsx',
    '',
    `import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { CodaSetupPage } from './CodaSetupPage';
import { ConnectionProvider } from '../lib/useConnection';

describe('CodaSetupPage', () => {
  it('shows the MCP setup form for an MCP connection', () => {
    render(() => (
      <ConnectionProvider mode="mcp">
        <CodaSetupPage />
      </ConnectionProvider>
    ));

    expect(screen.getByLabelText('Coda API token')).toBeVisible();
  });

  it('keeps the existing sync setup available', () => {
    render(() => (
      <ConnectionProvider mode="sync">
        <CodaSetupPage />
      </ConnectionProvider>
    ));

    expect(screen.getByText('Set up Coda sync')).toBeVisible();
  });
});`,
  ),
  file(
    'typescript/web/admin/datasources/components/CodaSyncForm.tsx',
    '',
    `import { createSignal } from 'solid-js';
import { Button } from '@/components';

export function CodaSyncForm() {
  const [syncEnabled, setSyncEnabled] = createSignal(true);

  return (
    <section>
      <h2>Set up Coda sync</h2>
      <label>
        <input
          type="checkbox"
          checked={syncEnabled()}
          onChange={(event) => setSyncEnabled(event.currentTarget.checked)}
        />
        Keep documents up to date
      </label>
      <Button>Save configuration</Button>
    </section>
  );
}`,
  ),
  file(
    'typescript/web/admin/datasources/lib/useUnifiedSetupRedirect.ts',
    `const supported = ['notion', 'slack', 'gdrive'];

export function supportsUnifiedSetup(type: string) {
  return supported.includes(type);
}`,
    `const supported = ['notion', 'slack', 'gdrive', 'coda'];

export function supportsUnifiedSetup(type: string) {
  return supported.includes(type);
}`,
  ),
  file(
    'typescript/web/admin/lib/instructions.ts',
    `export const instructions = {
  coda: '/meta/instructions/codaSetup.md',
};`,
    `export const instructions = {
  coda: '/meta/instructions/codaSetup.md',
  codaMcp: '/meta/instructions/codaMcpConnectSetup.md',
};`,
  ),
  file(
    'typescript/types/workspaceKeys.d.ts',
    `export type WorkspaceKey = 'slack' | 'gdrive' | 'notion';`,
    `export type WorkspaceKey = 'slack' | 'gdrive' | 'notion' | 'coda';`,
  ),
  file(
    'typescript/web/public/meta/instructions/codaMcpConnectSetup.md',
    '',
    `# Connect Coda

Connect your Coda workspace to make your documents available to agents.

## Create an API token

1. Open your Coda account settings.
2. Go to **API settings** and generate a new token.
3. Give the token access to the documents you want to connect.
4. Paste your token into the connection form.

Your token is used only to authenticate your Coda connection.`,
  ),
  {
    filename: 'typescript/storybook/.storybook/__snapshots__/coda-setup-page.png',
    status: 'added',
    additions: 0,
    deletions: 0,
    changes: 0,
  },
];

export const demoPR: PullRequest = {
  id: 298557,
  node_id: 'demo-pr',
  number: 298557,
  title: 'Add Coda MCP setup and unified configuration',
  body: 'Adds a dedicated MCP connection flow for Coda while keeping the existing document-sync setup intact.\n\nChanges\n• Add a token-based connection form with validation and error handling\n• Route MCP connections through the unified setup page\n• Add setup instructions and regression coverage\n\nThis is sample content for exploring the review experience, not the live pull request.',
  html_url: 'https://github.com/askscio/scio/pull/298557',
  user: author,
  state: 'open',
  draft: false,
  merged: false,
  created_at: now,
  updated_at: now,
  head: branch('alex/coda-mcp-setup'),
  base: branch('alex/unified-connections'),
  additions: files.reduce((sum, f) => sum + f.additions, 0),
  deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  changed_files: files.length,
  commits: 3,
  comments: 1,
};

const parent: PullRequest = {
  ...demoPR,
  id: 298401,
  number: 298401,
  title: 'Unify datasource connection configuration',
  head: branch('alex/unified-connections'),
  base: branch('main'),
};
const child: PullRequest = {
  ...demoPR,
  id: 298612,
  number: 298612,
  title: 'Enable Coda tools in the agent builder',
  head: branch('alex/coda-tools'),
  base: branch('alex/coda-mcp-setup'),
};

export function demoWorkspace(pr = demoPR): Workspace {
  return {
    pr,
    pending: [],
    files,
    related: [parent, child, demoPR],
    reviews: [],
    inlineComments: [
      {
        id: 20,
        user: { id: 303, login: 'sarahkim' },
        created_at: now,
        path: files[0].filename,
        line: 18,
        side: 'RIGHT',
        body: '**Suggestion** — cover the empty-token case.\n\n`handleConnect` returns early when the token is empty. The behavior looks right; a regression test will keep this validation consistent.\n\n- [ ] Test an empty token\n- [ ] Test whitespace-only input\n\n<details><summary>Suggested test</summary>\n\n```ts\nexpect(connectWithToken("")).not.toHaveConnected();\n```\n\n</details>',
      },
    ],
    draftComments: [],
    reviewThreads: [{ id: 'demo-thread-20', rootCommentId: 20, resolved: false, canResolve: true, canUnresolve: false }],
    comments: [
      {
        id: 1,
        user: author,
        body: 'Ready for a look. The existing sync flow is unchanged; the new setup is only used for MCP connections.',
        created_at: now,
      },
    ],
    warnings: [],
    reviewsLoaded: true,
  };
}

function inboxItem(
  number: number,
  title: string,
  login: string,
  options: { draft?: boolean; repo?: string; label?: string; review?: ReviewState } = {},
): InboxItem {
  const repository = options.repo || 'askscio/scio';
  return {
    id: number,
    number,
    title,
    user: { id: login === 'you' ? 101 : 202, login },
    html_url: `https://github.com/${repository}/pull/${number}`,
    repository_url: `https://api.github.com/repos/${repository}`,
    draft: !!options.draft,
    state: 'open',
    created_at: now,
    updated_at: now,
    comments: number % 5,
    labels: options.label ? [{ name: options.label, color: '5b7cfa' }] : [],
    ...(options.review ? { review: options.review } : {}),
    details: demoDetails(number, login),
  };
}

// Varies every indicator across the sample PRs so tests can rely on each state appearing.
function demoDetails(number: number, login: string): PullRequestDetails {
  const people = ['alexchen', 'sarahkim', 'davidpark', 'maya', 'jordan'].filter(name => name !== login);
  const participants = people.slice(0, (number % people.length) + 1).map(name => ({ login: name, avatarUrl: '' }));
  return {
    additions: 14 + (number % 180),
    deletions: number % 45,
    createdAt: now,
    checks: ['success', 'pending', 'failure', null][number % 4] as PullRequestDetails['checks'],
    pendingComments: 0,
    participants,
    participantCount: participants.length + (number % 3 === 0 ? 2 : 0),
  };
}

export const demoInbox: Record<InboxGroup, InboxItem[]> = {
  requested: [
    inboxItem(298557, demoPR.title, 'alexchen', { label: 'frontend' }),
    inboxItem(298490, 'Improve search result ranking for exact matches', 'sarahkim', { label: 'search' }),
    inboxItem(298463, 'Add workspace-level connection health checks', 'davidpark'),
  ],
  authored: [
    inboxItem(298611, 'Simplify the agent configuration experience', 'you', { label: 'frontend', review: 'approved' }),
    inboxItem(298502, 'Cache repository metadata between allocations', 'you', { repo: 'askscio/devdock', review: 'returned' }),
    inboxItem(298520, 'Add retry budget to the sync worker', 'you', { review: 'waiting' }),
  ],
  drafts: [
    inboxItem(298630, 'Introduce keyboard navigation for command menus', 'you', { draft: true }),
    inboxItem(298599, 'Explore incremental sync for connected sources', 'you', { draft: true }),
  ],
  reviewed: [inboxItem(298401, parent.title, 'alexchen')],
  merged: [
    inboxItem(298350, 'Update connection status indicators', 'you'),
    inboxItem(298344, 'Tighten the connector retry budget', 'alexchen'),
    inboxItem(298341, 'Refresh onboarding copy for setup', 'sarahkim', { repo: 'askscio/devdock' }),
  ],
};
