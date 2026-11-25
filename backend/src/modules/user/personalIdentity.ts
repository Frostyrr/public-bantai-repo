import { z } from "zod";

export const personName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine(
    (value) => /\p{L}/u.test(value) && !/[\p{Cc}<>]/u.test(value),
    "Enter a name without control characters or angle brackets.",
  );
export function validRegistrationPassword(password: string) {
  const length = [...password].length;
  if (length < 8 || length > 64 || Buffer.byteLength(password, "utf8") > 72)
    return false;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter(
    (pattern) => pattern.test(password),
  ).length;
  const passphrase = length >= 16 && password.trim().split(/\s+/).length >= 3;
  const predictable =
    /^(.{1,4})\1+$/su.test(password) ||
    /^(?:password|qwerty|letmein|12345678|admin|bantai)[\d!@#$]*$/i.test(
      password,
    );
  return !predictable && (passphrase || classes >= 3);
}
export function validBirthdate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <=
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
  );
}
export const personalIdentitySchema = z.object({
  firstName: personName,
  middleName: z
    .union([personName, z.literal(""), z.null()])
    .optional()
    .transform((value) => value?.trim() || null),
  lastName: personName,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9]{5,19}$/,
      "Use 6 to 20 letters or digits, starting with a letter.",
    ),
  birthdate: z
    .union([
      z
        .string()
        .refine(validBirthdate, "Enter a real date that is not in the future."),
      z.null(),
      z.literal(""),
    ])
    .optional()
    .transform((value) => value || null),
});
