import { useState } from "react";
import Select from "../../ui/Select";
import Button from "../../ui/Button";
import Modal from "../../ui/Modal";

export type CollectionAmountFilters = {
  assessedMin?: number; assessedMax?: number; noAssessment?: true;
  paidMin?: number; paidMax?: number;
  balanceMin?: number; balanceMax?: number;
};

type Amount = "assessed" | "paid" | "balance";
type Bounds = { min?: number; max?: number; missing?: true };
type Preset = { label: string; value: string; bounds: Bounds };
const settings: Record<Amount, { label: string; presets: Preset[] }> = {
  assessed: { label: "Assessed dues", presets: [
    { label: "No assessment", value: "missing", bounds: { missing: true } },
  ] },
  paid: { label: "Paid", presets: [
    { label: "Nothing paid", value: "zero", bounds: { max: 0 } },
    { label: "Some amount paid", value: "positive", bounds: { min: 1 } },
  ] },
  balance: { label: "Balance", presets: [
    { label: "Outstanding balance", value: "positive", bounds: { min: 1 } },
    { label: "Zero balance", value: "zero", bounds: { max: 0 } },
  ] },
};

function parseAmount(input: string): number | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(BigInt(whole + fraction.padEnd(2, "0")));
  return Number.isSafeInteger(cents) ? cents : NaN;
}

export default function CollectionAmountFilter({ field, currency, bounds, onChange }: {
  field: Amount; currency: string; bounds: Bounds; onChange: (value: Bounds) => void;
}) {
  const { label, presets } = settings[field];
  const [open, setOpen] = useState(false);
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [error, setError] = useState("");
  const any = !bounds.missing && bounds.min === undefined && bounds.max === undefined;
  const current = presets.find(option => option.bounds.min === bounds.min && option.bounds.max === bounds.max &&
    option.bounds.missing === bounds.missing);
  const format = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value / 100);
  const appliedRange = bounds.min === undefined ? (bounds.max === undefined ? "" : `up to ${format(bounds.max)}`)
    : bounds.max === undefined ? `from ${format(bounds.min)}` : `${format(bounds.min)}–${format(bounds.max)}`;
  return <div>
    <Select ariaLabel={label} variant="pill" selectSize="sm" menuWidth="auto"
      value={any ? "all" : current?.value ?? "range"}
      options={[
        { value: "all", label },
        ...presets.map(option => ({ ...option, label: `${label} · ${option.label}` })),
        { value: "range", label: !any && !current ? `${label} · ${appliedRange}` : "Custom amount range" },
      ]}
      onValueChange={value => {
        if (value === "range") {
          setMinimum(bounds.min === undefined ? "" : (bounds.min / 100).toFixed(2));
          setMaximum(bounds.max === undefined ? "" : (bounds.max / 100).toFixed(2));
          setError("");
          setOpen(true);
        } else {
          setOpen(false);
          onChange(presets.find(option => option.value === value)?.bounds ?? {});
        }
      }} />
    {open && <Modal isOpen maxWidth="sm" labelledBy={`${field}-range-heading`} onClose={() => setOpen(false)}>
      <form className="space-y-3"
      onSubmit={event => {
        event.preventDefault();
        const min = parseAmount(minimum), max = parseAmount(maximum);
        if (Number.isNaN(min) || Number.isNaN(max) || (min !== undefined && max !== undefined && min > max)) {
          setError("Enter valid amounts with the minimum at or below the maximum.");
          return;
        }
        onChange({ min, max });
        setOpen(false);
      }}>
      <h2 id={`${field}-range-heading`} className="text-sm font-semibold">{label} range ({currency})</h2>
      <label className="block text-sm">Minimum
        <input inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)}
          className="block w-full rounded-lg border border-subtle bg-elevated px-2 py-1" />
      </label>
      <label className="block text-sm">Maximum
        <input inputMode="decimal" value={maximum} onChange={event => setMaximum(event.target.value)}
          className="block w-full rounded-lg border border-subtle bg-elevated px-2 py-1" />
      </label>
      {error && <p role="alert" className="text-xs text-sem-error-fg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" size="sm">Apply</Button>
      </div>
      </form>
    </Modal>}
  </div>;
}
