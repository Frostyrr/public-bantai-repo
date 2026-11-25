import React, { useState } from "react";
import { Cpu, User } from "lucide-react";

export type ActorKind = "user" | "system" | "unavailable";

export interface ActorAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  actorType?: ActorKind;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<ActorAvatarProps["size"]>, { box: string; text: string; icon: string }> = {
  xs: { box: "w-6 h-6", text: "text-[10px]", icon: "w-3 h-3" },
  sm: { box: "w-8 h-8", text: "text-[11px]", icon: "w-3.5 h-3.5" },
  md: { box: "w-9 h-9", text: "text-xs", icon: "w-4 h-4" },
  lg: { box: "w-11 h-11", text: "text-sm", icon: "w-5 h-5" },
};

function getInitials(name?: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const ActorAvatar: React.FC<ActorAvatarProps> = ({
  name,
  avatarUrl,
  actorType = "user",
  size = "md",
  className = "",
}) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const dims = SIZE_CLASSES[size];
  const initials = actorType === "user" ? getInitials(name) : null;
  const imgError = Boolean(avatarUrl) && failedUrl === avatarUrl;
  const showImage = Boolean(avatarUrl) && !imgError && actorType !== "system";

  return (
    <div
      className={`${dims.box} rounded-full shrink-0 overflow-hidden border border-subtle bg-elevated flex items-center justify-center select-none ${className}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={avatarUrl!}
          alt={name ? `${name} avatar` : "Actor avatar"}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailedUrl(avatarUrl ?? null)}
        />
      ) : actorType === "system" ? (
        <Cpu className={`${dims.icon} text-secondary`} />
      ) : initials ? (
        <span className={`${dims.text} font-semibold tracking-tight text-primary`}>
          {initials}
        </span>
      ) : (
        <User className={`${dims.icon} text-muted`} />
      )}
    </div>
  );
};

export default ActorAvatar;
