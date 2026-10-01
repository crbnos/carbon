// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
