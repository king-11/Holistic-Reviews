import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { priority, workingHours } from './priority.ts';

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
    newCommits: 0,
    moreThanTwentyNewCommits: false,
    reviewedWithoutNewCommits: false,
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
  it('does not award waiting points after a review with no new commits', () => {
    const result = priority({ ...input, waitStart: new Date(2024, 0, 1, 9).toISOString(), reviewedWithoutNewCommits: true }, now);
    assert.equal(result.score, 0);
    assert.deepEqual(result.reasons, []);
  });
  it('forces failing checks into Later regardless of score', () => {
    const result = priority({ ...input, stackedReady: 100, codeOwner: true, checks: 'failure' }, now);
    assert.equal(result.score >= 50, true);
    assert.equal(result.lane, 'later');
  });
  it('shows new-commit waiting age, stack, ownership, and green checks as reasons', () => {
    const result = priority(
      {
        ...input,
        waitStart: new Date(2024, 0, 8, 14, 30).toISOString(),
        newCommits: 3,
        stackedReady: 2,
        codeOwner: true,
        checks: 'success',
      },
      now,
    );
    assert.deepEqual(
      result.reasons.map(reason => reason.label),
      ['3 new commits since your review · 2h', '2 ready stacked on this', 'code owner', 'checks green'],
    );
    assert.match(result.reasons[0]!.title!, /2\.5 working hours \(weekdays, 09:00–17:00 local time\)/);
  });
  it('keeps ready age when there are no commits after the review', () => {
    const result = priority({ ...input, waitStart: new Date(2024, 0, 8, 15).toISOString() }, now);
    assert.equal(result.reasons[0]?.label, 'ready 2h ago');
    assert.match(result.reasons[0]!.title!, /2\.0 working hours/);
  });
  it('uses commit count and real elapsed time since the first new commit', () => {
    const result = priority(
      {
        ...input,
        waitStart: new Date(2024, 0, 8, 15).toISOString(),
        newCommits: 1,
      },
      now,
    );
    assert.equal(result.reasons[0]?.label, '1 new commit since your review · 2h');
  });
  it('labels an unlocated review commit as 20+ new commits', () => {
    const result = priority({ ...input, newCommits: 20, moreThanTwentyNewCommits: true }, now);
    assert.equal(result.reasons[0]?.label, '20+ new commits since your review · 8h');
  });
});
