export function authCacheAction(previous: string | null | undefined, next: string | null, event: string) {
  if (event === 'SIGNED_OUT' || (previous !== undefined && previous !== next)) return 'clear';
  if (event === 'USER_UPDATED' || (previous === undefined && event === 'SIGNED_IN')) return 'refresh-auth';
  return 'keep';
}
