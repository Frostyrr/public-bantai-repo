export type PasswordHistoryStatus = {
  protocol:2; backendVersion:"password-history-v2";
  mode:"legacy"|"managed"|"frozen"; enabled:boolean; frozen:boolean; acceptingChanges:boolean;
};
export function parsePasswordHistoryStatus(value:unknown):PasswordHistoryStatus {
  const state=value as Partial<PasswordHistoryStatus>|null;
  if(!state||state.protocol!==2||state.backendVersion!=="password-history-v2"||
    !["legacy","managed","frozen"].includes(state.mode??"")||
    typeof state.enabled!=="boolean"||typeof state.acceptingChanges!=="boolean"||
    state.frozen!==(state.mode==="frozen")||
    (state.mode!=="legacy"&&!state.enabled)|| (state.frozen&&state.acceptingChanges))
    throw new Error("Password management is temporarily unavailable. Please try again later.");
  return state as PasswordHistoryStatus;
}
