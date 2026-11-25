import React, { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";

export interface InfoTooltipProps {
  content: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  iconClassName?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  side = "top",
  className = "",
  iconClassName = "",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(true);
  };

  const hide = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <div
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        type="button"
        className="text-muted hover:text-primary transition-colors cursor-help p-0.5 rounded-full hover:bg-elevated focus:outline-none focus:ring-1 focus:ring-border-strong inline-flex items-center justify-center"
        aria-label="Information"
        tabIndex={0}
      >
        <HelpCircle className={`w-3.5 h-3.5 ${iconClassName}`} />
      </button>

      {isVisible && (
        <div
          role="tooltip"
          className={`absolute ${positionClasses} w-64 p-2.5 rounded-xl bg-surface border border-subtle text-[11px] leading-relaxed text-secondary shadow-xl z-[99999] pointer-events-none backdrop-blur-md animate-tooltip-enter font-normal normal-case tracking-normal`}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default InfoTooltip;
