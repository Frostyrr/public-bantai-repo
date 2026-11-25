import { assessPassword } from "../../lib/passwordPolicy";

export default function PasswordStrength({
  password,
  variant = "text",
}: {
  password: string;
  variant?: "text" | "bar";
}) {
  if (!password) return null;
  const { strength } = assessPassword(password);

  if (variant === "bar") {
    const level = strength === "Strong" ? 3 : strength === "Medium" ? 2 : 1;
    const activeColor =
      strength === "Strong"
        ? "bg-emerald-400"
        : strength === "Medium"
          ? "bg-amber-400"
          : "bg-rose-400";

    return (
      <div className="mt-1 flex items-center gap-1.5" aria-live="polite">
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((segment) => (
            <span
              key={segment}
              className={`h-1 flex-1 rounded-full transition-colors ${
                segment <= level ? activeColor : "bg-white/[0.08]"
              }`}
            />
          ))}
        </div>
        <span className="sr-only">Password strength: {strength}</span>
      </div>
    );
  }

  return <p className="text-xs text-secondary" aria-live="polite">Password strength: {strength}</p>;
}
