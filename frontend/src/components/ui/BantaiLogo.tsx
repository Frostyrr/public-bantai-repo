import React from "react";
import logoTransparentWhite from "../../assets/Bantai logo transparent bg.png";
import logoTransparentBlack from "../../assets/Bantai logo transparent black.png";
import { useTheme } from "../../context/ThemeContext";

export interface BantaiLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Theme-aware Bantai wordmark/emblem.
 * Renders the dedicated black transparent asset in light mode and the original
 * white transparent asset in dark mode.
 */
export const BantaiLogo: React.FC<BantaiLogoProps> = ({
  className = "w-7 h-7 object-contain",
  alt = "Bantai logo",
}) => {
  const { resolvedTheme } = useTheme();
  const src = resolvedTheme === "dark" ? logoTransparentWhite : logoTransparentBlack;

  return <img src={src} alt={alt} className={className} />;
};

export default BantaiLogo;
