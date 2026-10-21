import { parsePRUrl, type PRRef } from './github.ts';

export function parsePRCommandInput(value: string, currentPR?: PRRef): PRRef | null {
  const input = value.trim();
  if (!input) return null;
  let parsed: PRRef | null;
  try {
    parsed = parsePRUrl(input);
  } catch {
    parsed = null;
  }
  if (parsed) return parsed;
  const shorthand = input.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)#([1-9]\d*)$/);
  if (shorthand && Number.isSafeInteger(Number(shorthand[3])))
    return { owner: shorthand[1]!, repo: shorthand[2]!, number: Number(shorthand[3]) };
  const localNumber = input.match(/^#([1-9]\d*)$/);
  if (localNumber && currentPR && Number.isSafeInteger(Number(localNumber[1])))
    return { owner: currentPR.owner, repo: currentPR.repo, number: Number(localNumber[1]) };
  return null;
}
