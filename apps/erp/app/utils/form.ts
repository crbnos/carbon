import type { Json } from "@carbon/database";

const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i;

export const isValidEmail = (email: string) => {
  return emailRegex.test(email);
};

export const getCustomFields = (
  fields?: Json
): Record<string, string | number | boolean> => {
  if (!fields || typeof fields !== "object" || fields === null) return {};
  return Object.entries(fields).reduce<
    Record<string, string | number | boolean>
  >((acc, [key, value]) => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      acc[`custom-${key}`] = value;
    }
    return acc;
  }, {});
};

// Read a repeated/array form field straight off raw FormData, tolerating both the plain
// repeated name ("field") and the bracket-indexed names our MultiSelect emits ("field[0]",
// "field[1]", ...). Used where the value is read outside the zod validator (e.g. the
// tier-agnostic operationToolValidator) — the validator itself decodes brackets via
// objectFromPathEntries, but formData.getAll does not.
export const getFormDataArray = (
  formData: FormData,
  name: string
): string[] => {
  const out: string[] = [];
  const prefix = `${name}[`;
  for (const [key, value] of formData.entries()) {
    if (
      (key === name || key.startsWith(prefix)) &&
      typeof value === "string" &&
      value.length > 0
    ) {
      out.push(value);
    }
  }
  return out;
};

export const setCustomFields = (
  formData: FormData
): Record<string, string | number | boolean> => {
  let result: Record<string, string | number | boolean> = {};
  for (let [key, value] of formData.entries()) {
    if (
      (key.startsWith("custom-") && typeof value === "string") ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key.replace("custom-", "")] = value;
    }
  }
  return result;
};
