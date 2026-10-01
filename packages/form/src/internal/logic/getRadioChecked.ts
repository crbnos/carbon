// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const getRadioChecked = (
  radioValue: string | undefined = "on",
  newValue: unknown
) => {
  if (typeof newValue === "string") return newValue === radioValue;
  return undefined;
};
