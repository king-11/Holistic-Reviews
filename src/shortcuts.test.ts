import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comboKeys, createShortcuts, eventCombo, step } from './shortcuts.ts';

const event = (key: string, target: object = { tagName: 'BODY' }, modifiers: Record<string, boolean> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...modifiers,
  composedPath: () => [target as EventTarget],
  preventDefault: () => {},
});

for (const [name, input, blocked, expected] of [
  ['plain key on the page', event('j'), false, 'j'],
  ['shifted key', event('?'), false, '?'],
  ['shifted letter', event('X', undefined, { shiftKey: true }), false, 'X'],
  ['meta chord', event('ArrowDown', undefined, { metaKey: true }), false, 'mod+ArrowDown'],
  ['ctrl chord', event('K', undefined, { ctrlKey: true }), false, 'mod+k'],
  ['shift meta chord', event('ArrowUp', undefined, { metaKey: true, shiftKey: true }), false, 'shift+mod+ArrowUp'],
  ['typing in an input', event('j', { tagName: 'INPUT' }), false, null],
  ['mod chord while typing in a textarea', event('Enter', { tagName: 'TEXTAREA' }, { metaKey: true }), false, null],
  ['typing in a select', event('j', { tagName: 'SELECT' }), false, null],
  ['typing in contenteditable', event('j', { tagName: 'DIV', isContentEditable: true }), false, null],
  ['alt chord', event('j', undefined, { altKey: true }), false, null],
  ['already handled', event('j', undefined, { defaultPrevented: true }), false, null],
  ['dialog open', event('j'), true, null],
] as const)
  test(`eventCombo: ${name}`, () => assert.equal(eventCombo(input, blocked), expected));

for (const [presses, expected] of [
  [['r', 'y'], ['r y']],
  [['r', 'r'], ['r r']],
  [['j'], ['j']],
  [['r', 'j'], []],
  [['q', 'j'], ['j']],
  [['c', 'Shift', 'C'], []],
] as const)
  test(`createShortcuts runs ${JSON.stringify(expected)} for ${presses.join(' then ')}`, () => {
    const ran: string[] = [];
    const bindings = Object.fromEntries(['r y', 'r r', 'j', 'c l'].map(combo => [combo, () => ran.push(combo)]));
    const handler = createShortcuts(
      () => bindings,
      () => false,
    );
    for (const key of presses) handler(event(key, undefined, { shiftKey: key === 'Shift' || key === 'C' }));
    assert.deepEqual(ran, expected);
  });

test('createShortcuts drops a pending sequence after the timeout', async () => {
  const ran: string[] = [];
  const handler = createShortcuts(
    () => ({ 'r y': () => ran.push('r y') }),
    () => false,
    5,
  );
  handler(event('r'));
  await new Promise(resolve => setTimeout(resolve, 20));
  handler(event('y'));
  assert.deepEqual(ran, []);
});

for (const [combo, mac, expected] of [
  ['r y', true, [['R'], ['Y']]],
  ['mod+ArrowDown', true, [['⌘', '↓']]],
  ['shift+mod+ArrowUp', false, [['⇧', 'Ctrl', '↑']]],
  ['mod+Enter', true, [['⌘', '⏎']]],
  ['X', true, [['⇧', 'X']]],
  ['?', true, [['?']]],
  ['Escape', true, [['Esc']]],
] as const)
  test(`comboKeys ${combo}`, () => assert.deepEqual(comboKeys(combo, mac), expected));

for (const [items, current, delta, expected] of [
  [['a', 'b', 'c'], 'a', 1, 'b'],
  [['a', 'b', 'c'], 'b', -1, 'a'],
  [['a', 'b', 'c'], 'c', 1, 'c'],
  [['a', 'b', 'c'], 'a', -1, 'a'],
  [['a', 'b', 'c'], 'z', 1, 'a'],
  [['a', 'b', 'c'], undefined, -1, 'c'],
  [[], 'a', 1, undefined],
] as const)
  test(`step ${JSON.stringify(current)} by ${delta} in ${JSON.stringify(items)}`, () =>
    assert.equal(step([...items] as string[], current, delta), expected));
