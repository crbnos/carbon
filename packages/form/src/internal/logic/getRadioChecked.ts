export const getRadioChecked = (
  radioValue: string | undefined = "on",
  newValue: unknown
) => {
  if (typeof newValue === "string") return newValue === radioValue;
  return undefined;
};
