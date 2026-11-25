import { authCacheAction } from '../../utils/authCache';
import { useEffect } from "react";
import { supabase } from "../../config/supabase";
import queryClient from "../../config/queryClient";

export default function AuthListener() {
  useEffect(() => {
    let active = true;
    let identity: string | null | undefined;
    let revision = 0;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextIdentity = session?.user.id ?? null;
      const action = authCacheAction(identity, nextIdentity, event);
      identity = nextIdentity;
      if (action === 'keep') return;
      const currentRevision = ++revision;
      window.setTimeout(() => {
        if (!active || currentRevision !== revision) return;
        void (async () => {
          if (action === 'clear') {
            // Never retain another account's data or in-flight responses.
            await queryClient.cancelQueries();
            if (!active || currentRevision !== revision) return;
            queryClient.getMutationCache().clear();
            if (!nextIdentity) {
              try {
                for (const key of Object.keys(localStorage)) {
                  if (/^bantai_(role|name|logo|cover)_/.test(key)) localStorage.removeItem(key);
                }
              } catch {
                // Storage may be unavailable. Continue clearing in-memory data.
              }
            }
            queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' });
          }
          if (!nextIdentity) queryClient.setQueryData(['auth'], null);
          else {
            await queryClient.invalidateQueries({ queryKey: ['auth'] });
          }
        })();
      }, 0);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return null;
}
