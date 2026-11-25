import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

type DraftValue = string | number | boolean | null | undefined | DraftValue[] | { [field: string]: DraftValue };
type DraftValues = Record<string, DraftValue>;
type Entry = { values: DraftValues; version: string; owner: symbol; change: number };
type DraftIdentity = { key: string; owner: symbol };
export type DraftSubmission = DraftIdentity & { change: number };

export function createFormDraftStore(userId: string) {
  const storageKey = `bantai:drafts:${userId}`;
  const entries = new Map<string, Entry>();
  let available = true;

  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, { values: DraftValues; version: string; change: number }>;
        if (parsed && typeof parsed === "object") {
          for (const [k, item] of Object.entries(parsed)) {
            if (item && typeof item.values === "object") {
              entries.set(k, {
                values: item.values,
                version: item.version ?? "",
                owner: Symbol(),
                change: typeof item.change === "number" ? item.change : 0,
              });
            }
          }
        }
      }
    }
  } catch {
    // Ignore storage parse/access errors; in-memory store remains active
  }

  const persist = () => {
    try {
      if (typeof localStorage === "undefined") return;
      if (entries.size === 0) {
        localStorage.removeItem(storageKey);
        return;
      }
      const serializable: Record<string, { values: DraftValues; version: string; change: number }> = {};
      for (const [k, item] of entries) {
        serializable[k] = { values: item.values, version: item.version, change: item.change };
      }
      localStorage.setItem(storageKey, JSON.stringify(serializable));
    } catch {
      // Ignore storage quota/access errors
    }
  };

  return {
    userId,
    read: (key: string) => (available ? entries.get(key) : undefined),
    write(key: string, entry: Entry) {
      if (!available) return;
      entries.set(key, entry);
      persist();
    },
    remove(key: string, owner: symbol) {
      if (entries.get(key)?.owner === owner) {
        entries.delete(key);
        persist();
      }
    },
    endSession() {
      available = false;
      entries.clear();
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage errors
      }
    },
  };
}

export const FormDraftContext = createContext<{
  store: ReturnType<typeof createFormDraftStore>;
} | null>(null);

type Status = "idle" | "saving" | "saved" | "restored" | "stale" | "checking" | "unavailable";
type Session = DraftIdentity & {
  baseline: DraftValues;
  version: string;
  pending?: DraftValues;
  serialized: string;
  change: number;
  timer?: ReturnType<typeof setTimeout>;
  finished?: boolean;
  stale?: Entry;
  checking?: boolean;
};

export function useFormDraft<T extends DraftValues>(options: {
  orgId: string;
  form: string;
  open: boolean;
  recordId?: string;
  contextId?: string;
  version?: string;
  values: T;
  restore: (values: T) => void;
  verifyEdit?: (id: string, signal: AbortSignal) => Promise<{ values: T; version: string; adopt: () => void }>;
}) {
  const store = useContext(FormDraftContext)?.store;
  const enabled = Boolean(store);
  const key = options.open && store && options.orgId
    ? JSON.stringify([store.userId, options.orgId, options.form, options.recordId ? "edit" : "create", options.recordId, options.contextId])
    : null;
  const sessionRef = useRef<Session | null>(null);
  const latest = useRef(options);
  const openedValues = useRef<DraftValues | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [comparison, setComparison] = useState<{ current: DraftValues; draft: DraftValues }>();

  useLayoutEffect(() => { latest.current = options; });

  useLayoutEffect(() => {
    openedValues.current = key ? latest.current.values : null;
  }, [key]);

  useLayoutEffect(() => {
    if (!store || !key || !enabled) return;
    const { values, version = "", recordId, verifyEdit } = latest.current;
    const baseline = openedValues.current ?? values;
    const draft = store.read(key);
    const controller = new AbortController();
    const session: Session = {
      key, owner: Symbol(), baseline, version, serialized: JSON.stringify(baseline), change: draft?.change ?? 0,
    };
    sessionRef.current = session;
    if (draft) {
      store.write(key, { ...draft, owner: session.owner });
      function offerDraft(current: DraftValues, currentVersion: string) {
        if (!draft) return;
        session.checking = false;
        session.baseline = current;
        session.version = currentVersion;
        const changedWhileOpening = JSON.stringify(latest.current.values) !== JSON.stringify(baseline);
        if (draft.version !== currentVersion || changedWhileOpening) {
          session.stale = draft;
          if (!changedWhileOpening) latest.current.restore(current as T);
          setComparison({ current: changedWhileOpening ? latest.current.values : current, draft: draft.values });
          setStatus("stale");
        } else {
          session.serialized = JSON.stringify(draft.values);
          latest.current.restore(draft.values as T);
          setStatus("restored");
        }
      }
      if (recordId && verifyEdit) {
        session.checking = true;
        setStatus("checking");
        void verifyEdit(recordId, controller.signal).then(current => {
          if (controller.signal.aborted) return;
          current.adopt();
          offerDraft(current.values, current.version);
        }).catch(() => {
          if (controller.signal.aborted) return;
          session.checking = false;
          session.stale = draft;
          setStatus("unavailable");
        });
      } else {
        offerDraft(values, version);
      }
    }
    return () => {
      controller.abort();
      clearTimeout(session.timer);
      if (!session.finished && !session.stale && session.pending) {
        store.write(key, { values: session.pending, version: session.version, owner: session.owner, change: session.change });
      }
      sessionRef.current = null;
      setStatus("idle");
      setComparison(undefined);
    };
  }, [store, key, enabled]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!store || !session || session.finished || session.stale || session.checking) return;
    const values = latest.current.values;
    const serialized = JSON.stringify(values);
    if (serialized === session.serialized) return;
    // Restoration can schedule a synchronous second render after this effect.
    if (values === session.baseline && !session.pending) return;
    session.serialized = serialized;
    session.change++;
    session.pending = values;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      if (session.finished || !session.pending) return;
      store.write(session.key, { values: session.pending, version: session.version, owner: session.owner, change: session.change });
      session.pending = undefined;
      setStatus("saved");
    }, 750);
    setStatus("saving");
  }, [store, key, enabled, options.values]);

  function discard() {
    const session = sessionRef.current;
    if (!session || !store) return;
    clearTimeout(session.timer);
    store.remove(session.key, session.owner);
    session.pending = undefined;
    session.stale = undefined;
    session.serialized = JSON.stringify(session.baseline);
    session.change++;
    latest.current.restore(session.baseline as T);
    setStatus("idle");
    setComparison(undefined);
  }

  function applyReviewedDraft() {
    const session = sessionRef.current;
    if (!session?.stale || !store) return;
    const { values } = session.stale;
    session.stale = undefined;
    session.serialized = JSON.stringify(values);
    session.change++;
    store.write(session.key, { values, version: session.version, owner: session.owner, change: session.change });
    latest.current.restore(values as T);
    setStatus("restored");
    setComparison(undefined);
  }

  function submission(): DraftSubmission | undefined {
    const session = sessionRef.current;
    if (session) return { key: session.key, owner: session.owner, change: session.change };
    const existing = key && store?.read(key);
    if (key && existing) return { key, owner: existing.owner, change: existing.change };
  }

  function complete(ticket: DraftSubmission | undefined) {
    if (!ticket) return;
    const session = sessionRef.current;
    if (session?.owner === ticket.owner) {
      if (session.change !== ticket.change) return;
      session.finished = true;
      clearTimeout(session.timer);
      session.pending = undefined;
    } else {
      const saved = store?.read(ticket.key);
      if (!saved || saved.change !== ticket.change) return;
    }
    store?.remove(ticket.key, ticket.owner);
  }

  const blocked = enabled && (status === "checking" || status === "stale" || status === "unavailable");
  return { enabled, status, blocked, comparison, discard, applyReviewedDraft, submission, complete };
}

export function unavailableDraftSelection(value: string, options: readonly { id: string }[] | undefined) {
  return !!value && !options?.some(option => option.id === value);
}
