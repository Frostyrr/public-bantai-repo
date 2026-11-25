import { useId } from "react";
import { Check } from "lucide-react";
import type { ThemePreference } from "../../context/ThemeContext";

const choices = [
  { id: "light", label: "Light", description: "Bright workspace", tones: ["light"] },
  { id: "dark", label: "Dark", description: "Dim workspace", tones: ["dark"] },
  { id: "system", label: "System", description: "Match your device", tones: ["light", "dark"] },
] as const;

export default function ThemeChoices({ value, onChange, disabled }: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
  disabled?: boolean;
}) {
  const groupName = useId();
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="sr-only">Theme mode</legend>
    <div className="grid gap-2.5 sm:grid-cols-3">
      {choices.map(choice => <label key={choice.id} className="relative block min-w-0 cursor-pointer">
        <input type="radio" className="peer sr-only" name={groupName} value={choice.id}
          checked={value === choice.id} onChange={() => onChange(choice.id)} />
        <span className="flex h-full items-center gap-3 rounded-xl border border-subtle bg-surface p-2.5 transition-colors hover:border-strong peer-checked:border-strong peer-checked:bg-selected-surface peer-focus-visible:ring-2 peer-focus-visible:ring-strong peer-disabled:opacity-60 sm:flex-col sm:items-stretch">
          <span aria-hidden="true" className="flex h-11 w-16 shrink-0 overflow-hidden rounded-md border border-subtle sm:w-full">
            {choice.tones.map(tone => <span key={tone} className={`flex min-w-0 flex-1 flex-col justify-between gap-1.5 p-1.5 ${tone === "light" ? "bg-zinc-100" : "bg-zinc-950"}`}>
              <span className={`h-1.5 w-4 rounded-full ${tone === "light" ? "bg-zinc-400" : "bg-zinc-600"}`} />
              <span className={`min-h-0 flex-1 rounded-sm border ${tone === "light" ? "border-zinc-300 bg-white" : "border-zinc-700 bg-zinc-800"}`} />
            </span>)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-1.5 text-sm font-medium text-primary">
              {choice.label}
              {value === choice.id && <Check aria-hidden="true" className="size-4 shrink-0" />}
            </span>
            <span className="block text-xs text-secondary">{choice.description}</span>
          </span>
        </span>
      </label>)}
    </div>
  </fieldset>;
}
