import { CircleAlert } from "lucide-react";

export function RequiredMark() {
  return <span aria-hidden="true" className="ml-1 text-sem-error-fg">*</span>;
}

export function FieldError({ id, children }: { id: string; children: string }) {
  return <p id={id} role="alert" className="flex items-start gap-1.5 text-xs text-sem-error-fg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
    <CircleAlert aria-hidden="true" size={14} className="shrink-0" />{children}
  </p>;
}
