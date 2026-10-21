import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedLabel, priority, workingHours } from './priority.ts';

describe('workingHours', () => {
  for (const [name, from, to, expected] of [
    ['same day', new Date(2024, 0, 8, 10), new Date(2024, 0, 8, 12), 2],
    ['overnight', new Date(2024, 0, 8, 17), new Date(2024, 0, 9, 10), 1],
    ['across a weekend', new Date(2024, 0, 12, 16), new Date(2024, 0, 15, 10), 2],
    ['starting on Saturday', new Date(2024, 0, 13, 12), new Date(2024, 0, 15, 10), 1],
    ['from after to', new Date(2024, 0, 9, 12), new Date(2024, 0, 8, 12), 0],
  ] as const)
    it(name, () => assert.equal(workingHours(from, to), expected));
});

describe('priority', () => {
  const now = new Date(2024, 0, 8, 17);
  const input = {
    waitStart: new Date(2024, 0, 8, 9).toISOString(),
    stackedReady: 0,
    codeOwner: false,
    checks: null,
  } as const;

  it('caps stack points and awards the full waiting score after sixteen working hours', () => {
    const result = priority(
      { ...input, waitStart: new Date(2024, 0, 5, 9).toISOString(), stackedReady: 7, codeOwner: true, checks: 'success' },
      now,
    );
    assert.equal(result.score, 95);
    assert.equal(result.lane, 'now');
  });
  for (const [name, signals, expectedScore, expectedLane] of [
    ['no signals', {}, 0, 'later'],
    ['the soon threshold', { codeOwner: true }, 20, 'soon'],
    ['the now threshold', { stackedReady: 1, codeOwner: true, checks: 'success' }, 50, 'now'],
  ] as const)
    it(`assigns ${name} to ${expectedLane}`, () => {
      const result = priority({ ...input, waitStart: now.toISOString(), ...signals }, now);
      assert.equal(result.score, expectedScore);
      assert.equal(result.lane, expectedLane);
    });
  it('forces failing checks into Later regardless of score', () => {
    const result = priority({ ...input, stackedReady: 100, codeOwner: true, checks: 'failure' }, now);
    assert.equal(result.score >= 50, true);
    assert.equal(result.lane, 'later');
  });
});

describe('elapsedLabel', () => {
  const now = new Date(2024, 0, 8, 17);
  for (const [from, expected] of [
    [new Date(2024, 0, 8, 16, 30), '<1h'],
    [new Date(2024, 0, 8, 15), '2h'],
    [new Date(2024, 0, 6, 14), '2d 3h'],
    [new Date(2024, 0, 1, 17), '7d'],
    [new Date(2024, 0, 9, 17), '<1h'],
  ] as const)
    it(expected + ' from ' + from.toISOString(), () => assert.equal(elapsedLabel(from.toISOString(), now), expected));
});
