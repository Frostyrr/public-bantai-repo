export function showFormErrors(form: HTMLFormElement): boolean {
  const invalid = [...form.querySelectorAll<HTMLInputElement>("input[data-validation-message]")]
    .filter(field => !field.matches(":disabled") && !field.closest("[hidden]"));
  const first = invalid[0];
  if (!first) return false;

  for (const field of invalid) field.dispatchEvent(new Event("invalid"));
  for (let parent = first.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  first.focus();
  first.scrollIntoView({ block: "nearest" });
  return true;
}

// The visible text input can keep incomplete decimals in a draft. Validate
// submitted values with the same number, minimum and step rules as before.
export function isValidAmountInput(value: string, minimum: number, required = true) {
  if (value === "") return !required;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(minimum);
  input.step = "0.01";
  input.value = value;
  return input.value !== "" && input.validity.valid;
}
