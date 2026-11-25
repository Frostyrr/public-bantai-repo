import { startTransition, useRef, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

/** Keep the current form visible until its exit finishes, then enter the next view. */
export default function AuthSwitchLink({ to, className, children }: {
  to: "/login" | "/register";
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const switching = useRef(false);
  const preload = () => to === "/login" ? import("../../pages/auth/Login") : import("../../pages/auth/Register");

  const switchView = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const form = event.currentTarget.closest(".auth-form-content");
    if (!form || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    event.preventDefault();
    if (switching.current) return;
    switching.current = true;
    try {
      await preload();
      if (!form.isConnected) return;
      await form.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 140, easing: "ease-out", fill: "forwards" },
      ).finished;
      if (form.isConnected) startTransition(() => navigate(to));
    } catch {
      // Navigation retains the router's normal loading/error recovery if preloading fails.
      if (form.isConnected) navigate(to);
    } finally {
      switching.current = false;
    }
  };

  return <Link to={to} onClick={switchView} onFocus={() => void preload().catch(() => undefined)} onMouseEnter={() => void preload().catch(() => undefined)} className={className}>{children}</Link>;
}
