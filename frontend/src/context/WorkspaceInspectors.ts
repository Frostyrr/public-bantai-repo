import { createContext, useCallback, useContext, useId, useLayoutEffect, useState } from "react";

export const WorkspaceInspectorsContext = createContext<{
  activeId?: string;
  register: (id: string) => () => void;
} | null>(null);

export function useWorkspaceInspectors() {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const register = useCallback((id: string) => {
    setOpenIds(ids => [...ids, id]);
    return () => setOpenIds(ids => ids.filter(openId => openId !== id));
  }, []);
  return { activeId: openIds.at(-1), register };
}

export function useInspectorVisibility(requestedOpen: boolean) {
  const coordinator = useContext(WorkspaceInspectorsContext);
  const id = useId();
  const register = coordinator?.register;
  useLayoutEffect(() => {
    if (requestedOpen) return register?.(id);
  }, [id, requestedOpen, register]);
  return { isOpen: requestedOpen && (!coordinator || coordinator.activeId === id), managed: !!coordinator };
}
