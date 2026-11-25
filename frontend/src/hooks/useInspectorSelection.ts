import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * URL-driven selection hook for DetailInspector.
 * Persists the active record ID in query parameters (?selectedId=...) so
 * browser Back/Forward, deep-linking, and ArrowUp/ArrowDown navigation work uniformly.
 */
export function useInspectorSelection<T>(
  items: T[],
  getId: (item: T) => string,
  paramName = "selectedId"
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(paramName);

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return items.findIndex((item) => getId(item) === selectedId);
  }, [items, getId, selectedId]);

  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;

  const setSelectedId = useCallback(
    (nextId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextId) {
            next.set(paramName, nextId);
          } else {
            next.delete(paramName);
          }
          return next;
        },
        { replace: false }
      );
    },
    [paramName, setSearchParams]
  );

  const selectItem = useCallback(
    (item: T | null) => {
      setSelectedId(item ? getId(item) : null);
    },
    [getId, setSelectedId]
  );

  const close = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      if (items.length === 0) return;
      if (selectedIndex < 0) {
        setSelectedId(getId(items[0]));
        return;
      }
      const nextIndex =
        direction === "prev"
          ? Math.max(0, selectedIndex - 1)
          : Math.min(items.length - 1, selectedIndex + 1);
      if (nextIndex !== selectedIndex) {
        setSelectedId(getId(items[nextIndex]));
      }
    },
    [getId, items, selectedIndex, setSelectedId]
  );

  return {
    selectedId,
    selectedItem,
    selectedIndex,
    setSelectedId,
    selectItem,
    close,
    navigate,
  };
}
