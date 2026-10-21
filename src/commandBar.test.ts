import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePRCommandInput } from './commandBar.ts';
import type { PRRef } from './github.ts';
import { commandDefinitions, shortcutGroups, type CommandContext } from './shortcuts.ts';

const currentPR: PRRef = { owner: 'acme', repo: 'app', number: 42 };

describe('parsePRCommandInput', () => {
  for (const [input, expected, current] of [
    ['https://github.com/octo/tools/pull/7', { owner: 'octo', repo: 'tools', number: 7 }, undefined],
    [' https://www.github.com/o/r/pull/13/files ', { owner: 'o', repo: 'r', number: 13 }, undefined],
    ['octo/tools#7', { owner: 'octo', repo: 'tools', number: 7 }, undefined],
    ['#8', { owner: 'acme', repo: 'app', number: 8 }, currentPR],
    ['#8', null, undefined],
    ['acme/app#0', null, undefined],
    ['owner/repo/extra#7', null, undefined],
    ['not a pull request', null, currentPR],
    ['https://github.com/acme/app/issues/7', null, currentPR],
    ['octo/tools#9007199254740992', null, undefined],
  ] as const) {
    it(`parses ${JSON.stringify(input)}`, () => {
      assert.deepEqual(parsePRCommandInput(input, current), expected);
    });
  }
});

const context: CommandContext = {
  busy: false,
  pr: {
    ref: currentPR,
    login: 'reviewer',
    pendingComments: 2,
    ownPR: false,
    draft: false,
    open: true,
    busy: false,
    canReview: true,
    stale: false,
    mergeMethods: ['squash'],
    mergeAvailable: true,
    checksPending: false,
    autoMergeAvailable: true,
    autoMergeEnabled: false,
    upstackAvailable: true,
  },
  actions: {},
};

describe('commandDefinitions', () => {
  it('lists only the requested commands in the command bar', () => {
    assert.deepEqual(
      commandDefinitions.filter(command => command.inBar).map(command => command.label),
      [
        'Submit review',
        'Approve',
        'Request changes',
        'Squash and merge',
        'Merge when ready',
        'Copy branch name',
        'Theme',
        'Upstack',
        'Inbox',
      ],
    );
  });

  for (const [id, change, expected] of [
    ['approve', { ownPR: true }, 'You cannot approve your own pull request.'],
    ['approve', { draft: true }, 'Mark this pull request ready for review first.'],
    ['squash-merge', { checksPending: true }, 'Checks are still running.'],
    ['upstack', { upstackAvailable: false }, 'No pull request is stacked above this one.'],
  ] as const) {
    it(`keeps ${id} disabled with a reason`, () => {
      const command = commandDefinitions.find(entry => entry.id === id)!;
      const changed = { ...context, pr: { ...context.pr!, ...change } };
      assert.equal(command.enabled(changed), expected);
    });
  }

  it('labels the mod+k shortcut as opening the command bar', () => {
    assert.ok(shortcutGroups.flatMap(group => group.shortcuts).some(shortcut => shortcut.label === 'Open command bar'));
  });
});
