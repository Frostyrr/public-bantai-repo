import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { notifyAppRouteCommit } from "../../utils/navTransition";

export default function PageScroll() {
  const { pathname, hash, key } = useLocation();
  const navigation = useNavigationType();
  useLayoutEffect(notifyAppRouteCommit, [key]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) {
        let id: string;
        try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
        const target = document.getElementById(id);
        if (target) {
          target.focus({ preventScroll: true });
          window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - 112), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        }
      } else if (navigation !== "POP") {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, key, navigation]);
  return null;
}
