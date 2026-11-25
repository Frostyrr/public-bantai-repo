import { useSearchParams } from "react-router-dom";

export function useSpaceRouteFilter() {
  const [params, setParams] = useSearchParams();
  const space = params.get("space") ?? "";
  const setSpace = (value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value === "all") next.delete("space");
    else next.set("space", value);
    return next;
  }, { replace: true });
  return [space, setSpace] as const;
}
