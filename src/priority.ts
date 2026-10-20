export type PriorityInput = {
  waitStart: string;
  newCommits: number;
  moreThanTwentyNewCommits: boolean;
  reviewedWithoutNewCommits: boolean;
  stackedReady: number;
  codeOwner: boolean;
  checks: 'success' | 'failure' | 'pending' | null;
};

export type PriorityReason = { label: string; title?: string };
export type PriorityResult = { score: number; lane: 'now' | 'soon' | 'later'; reasons: PriorityReason[] };

const hour = 60 * 60 * 1000;

export function workingHours(from: Date, to: Date): number {
  if (from >= to) return 0;
  let total = 0;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (day < to) {
    if (day.getDay() > 0 && day.getDay() < 6) {
      const start = new Date(day);
      start.setHours(9, 0, 0, 0);
      const end = new Date(day);
      end.setHours(17, 0, 0, 0);
      total += Math.max(0, Math.min(to.getTime(), end.getTime()) - Math.max(from.getTime(), start.getTime())) / hour;
    }
    day.setDate(day.getDate() + 1);
  }
  return total;
}

function elapsedLabel(from: string, now: Date): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 60_000));
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 1) return '<1h';
  if (elapsedHours < 48) return `${elapsedHours}h`;
  const days = Math.floor(elapsedHours / 24);
  const hours = elapsedHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

export function priority(input: PriorityInput, now: Date): PriorityResult {
  const stackPoints = Math.min(30, 15 * Math.log2(1 + Math.max(0, input.stackedReady)));
  const waitingPoints = input.reviewedWithoutNewCommits
    ? 0
    : Math.min(30, (30 * Math.log(1 + workingHours(new Date(input.waitStart), now))) / Math.log(17));
  const ownerPoints = input.codeOwner ? 20 : 0;
  const checksPoints = input.checks === 'success' ? 15 : 0;
  const score = stackPoints + waitingPoints + ownerPoints + checksPoints;
  const lane = input.checks === 'failure' ? 'later' : score >= 50 ? 'now' : score >= 20 ? 'soon' : 'later';
  const reasons: PriorityReason[] = [];

  if (!input.reviewedWithoutNewCommits) {
    const workingHourCount = workingHours(new Date(input.waitStart), now);
    const newCommitCount = input.moreThanTwentyNewCommits ? '20+' : String(input.newCommits);
    const newCommitLabel =
      input.newCommits > 0
        ? `${newCommitCount} new commit${input.newCommits === 1 && !input.moreThanTwentyNewCommits ? '' : 's'} since your review · ${elapsedLabel(input.waitStart, now)}`
        : undefined;
    reasons.push({
      label: newCommitLabel ?? `ready ${elapsedLabel(input.waitStart, now)} ago`,
      title: `Waiting score: ${waitingPoints.toFixed(1)} points from ${workingHourCount.toFixed(1)} working hours (weekdays, 09:00–17:00 local time).`,
    });
  }
  if (input.stackedReady > 0) reasons.push({ label: `${input.stackedReady} ready stacked on this` });
  if (input.codeOwner) reasons.push({ label: 'code owner' });
  if (input.checks === 'success') reasons.push({ label: 'checks green' });
  if (input.checks === 'failure') reasons.push({ label: 'checks failing' });
  if (input.checks === 'pending') reasons.push({ label: 'checks running' });

  return { score, lane, reasons };
}
