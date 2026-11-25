import { validUsernameCandidate } from "./usernameAvailability";

export interface PersonalIdentity {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  username: string | null;
  birthdate: string | null;
  complete?: boolean;
}
export const emptyIdentity: PersonalIdentity = {
  firstName: "",
  middleName: "",
  lastName: "",
  username: "",
  birthdate: null,
};
export const composePersonalName = (identity: PersonalIdentity) =>
  [identity.firstName, identity.middleName, identity.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
export const resolveOrganizationDisplayName = (
  username?: string | null,
  displayName?: string | null,
) =>
  displayName?.trim() ||
  (username ? `@${username.replace(/^@/, "")}` : "Member");
export function identityError(identity: PersonalIdentity) {
  const validName = (value: string | null) =>
    Boolean(
      value?.trim() &&
      value.trim().length <= 50 &&
      /\p{L}/u.test(value) &&
      !/[\p{Cc}<>]/u.test(value),
    );
  if (!validName(identity.firstName) || !validName(identity.lastName))
    return "Enter valid first and last names.";
  if (identity.middleName?.trim() && !validName(identity.middleName))
    return "Enter a valid middle name or leave it blank.";
  if (!validUsernameCandidate(identity.username?.trim() ?? ""))
    return "Use 6 to 20 letters or digits, starting with a letter.";
  if (identity.birthdate) {
    const date = new Date(`${identity.birthdate}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(identity.birthdate) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== identity.birthdate ||
      identity.birthdate > today
    )
      return "Enter a real birthdate that is not in the future, or leave it blank.";
  }
  return null;
}
