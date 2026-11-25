import Input from "../ui/Input";
import DatePicker from "../ui/DatePicker";
import type { PersonalIdentity } from "../../lib/identity";
export default function PersonalIdentityFields({
  value,
  onChange,
  disabled,
  birthdateLocked = false,
  hideUsername = false,
}: {
  value: PersonalIdentity;
  onChange: (value: PersonalIdentity) => void;
  disabled?: boolean;
  birthdateLocked?: boolean;
  hideUsername?: boolean;
}) {
  const set = (field: keyof PersonalIdentity, text: string) =>
    onChange({ ...value, [field]: text });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="First name"
          autoComplete="given-name"
          required
          maxLength={100}
          value={value.firstName ?? ""}
          disabled={disabled}
          onChange={(e) => set("firstName", e.target.value)}
        />
        <Input
          label="Middle name (optional)"
          autoComplete="additional-name"
          maxLength={100}
          value={value.middleName ?? ""}
          disabled={disabled}
          onChange={(e) => set("middleName", e.target.value)}
        />
      </div>
      <Input
        label="Last name"
        autoComplete="family-name"
        required
        maxLength={100}
        value={value.lastName ?? ""}
        disabled={disabled}
        onChange={(e) => set("lastName", e.target.value)}
      />
      {!hideUsername && <><Input
        label="Username"
        autoComplete="username"
        required
        minLength={6}
        maxLength={20}
        pattern="[A-Za-z][A-Za-z0-9]{5,19}"
        value={value.username ?? ""}
        disabled={disabled}
        onChange={(e) => set("username", e.target.value)}
      />
      <p className="text-xs leading-relaxed text-secondary">
        Your public Bantai identity. Use 6–20 letters or digits, starting with a
        letter. Usernames are unique and ignore capitalization.
      </p>
      </>}
      <DatePicker
        label="Birthdate"
        optional
        placeholder="Select your birthdate"
        max={new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
        yearRange={{from:1900,to:new Date().getFullYear()}}
        value={value.birthdate ?? ""}
        disabled={disabled || birthdateLocked}
        onChange={(date) => set("birthdate", date)}
      />
      <p className="text-xs leading-relaxed text-secondary">
        Your personal names and birthdate are private. Birthdate can be left
        blank; once saved, corrections require verification.
      </p>
    </div>
  );
}
