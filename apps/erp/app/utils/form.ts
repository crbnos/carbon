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
