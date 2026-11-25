import type { ElementType, ReactNode, CSSProperties } from "react";
import { useScrollReveal } from "../../hooks/useScrollReveal";

export interface ScrollRevealProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  delay?: number;
  duration?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
  threshold?: number;
}

export default function ScrollReveal({
  children,
  as: Component = "div",
  className = "",
  delay = 0,
  duration = 520,
  direction = "up",
  distance = 14,
  threshold = 0.12,
}: ScrollRevealProps) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>({ threshold, rootMargin: "0px 0px -60px 0px" });

  const getTransform = () => {
    if (isVisible) return "translate3d(0, 0, 0)";
    switch (direction) {
      case "up":
        return `translate3d(0, ${distance}px, 0)`;
      case "down":
        return `translate3d(0, -${distance}px, 0)`;
      case "left":
        return `translate3d(${distance}px, 0, 0)`;
      case "right":
        return `translate3d(-${distance}px, 0, 0)`;
      case "none":
      default:
        return "translate3d(0, 0, 0)";
    }
  };

  const style: CSSProperties = {
    opacity: isVisible ? 1 : 0,
    transform: getTransform(),
    transitionProperty: "opacity, transform",
    transitionDuration: `${duration}ms`,
    transitionDelay: `${delay}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    willChange: isVisible ? "auto" : "opacity, transform",
  };

  return (
    <Component ref={ref} style={style} className={`hardware-sharp focus-within:opacity-100! motion-reduce:opacity-100! motion-reduce:transform-none! motion-reduce:transition-none! ${className}`}>
      {children}
    </Component>
  );
}
