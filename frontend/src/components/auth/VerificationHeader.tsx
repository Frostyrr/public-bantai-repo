import { Mail, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

export default function VerificationHeader({ email = false, title = "Verify your identity", children }: {
  email?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const Icon = email ? Mail : Smartphone;
  return <div className="verification-header">
    <div className="verification-emblem" aria-hidden="true"><Icon size={22} strokeWidth={1.6} /></div>
    <h1 className="text-xl font-medium tracking-tight text-primary">{title}</h1>
    <p className="mx-auto mt-2 max-w-[290px] text-sm leading-relaxed text-secondary">{children}</p>
  </div>;
}
