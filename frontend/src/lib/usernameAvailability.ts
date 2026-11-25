export function validUsernameCandidate(value: string) {
  return /^[A-Za-z][A-Za-z0-9]{5,19}$/.test(value);
}
export function normalizeUsername(value: string) { return value.trim().toLowerCase(); }

/** Cancels pending debounce/network work and suppresses stale results even if transport ignores abort. */
export function scheduleUsernameCheck(
  value: string,
  check: (username: string, signal: AbortSignal) => Promise<boolean>,
  completed: (result: {available: boolean} | {error: unknown}) => void,
  delay = 450,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    void check(normalizeUsername(value), controller.signal).then(
      available => { if (!controller.signal.aborted) completed({available}); },
      error => { if (!controller.signal.aborted) completed({error}); },
    );
  }, delay);
  return () => { clearTimeout(timer); controller.abort(); };
}
