export const getCheckboxChecked = (
  checkboxValue: string | undefined = "on",
  newValue: unknown
): boolean | undefined => {
  if (Array.isArray(newValue))
    return newValue.some((val) => val === true || val === checkboxValue);
  if (typeof newValue === "boolean") return newValue;
  if (typeof newValue === "string") return newValue === checkboxValue;
  return undefined;
};
