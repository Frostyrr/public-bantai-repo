import { toast as sonner } from "sonner";
import { playNotificationSound } from "./notificationSound";

function withSound(type: "success" | "error" | "warning"): typeof sonner.success {
  return (message, options) => {
    const key = options?.id ?? (typeof message === "string" ? `bantai:${type}:${message}` : undefined);
    const active = key === undefined ? undefined : sonner.getToasts().find(item => item.id === key);
    const id = sonner[type](message, key === undefined ? options : { ...options, id: key });
    if (!active || ("type" in active && active.type === "loading")) playNotificationSound(type);
    return id;
  };
}

export const toast = {
  success: withSound("success"),
  error: withSound("error"),
  warning: withSound("warning"),
  info: sonner.info,
  loading: sonner.loading,
  dismiss: sonner.dismiss,
};
