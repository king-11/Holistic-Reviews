// Storage can be unavailable (private mode, quota); preferences must never break the app.
// Kept out of ui.tsx so plain modules stay loadable by the node test runner.
export function tryStorage<T>(action: () => T) {
  try {
    return action();
  } catch {
    return undefined;
  }
}
