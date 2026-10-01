// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const sanitize = (input: Record<string, any>) => {
  const output = { ...input };
  Object.keys(output).forEach((key) => {
    if (output[key] === undefined && key !== "id") output[key] = null;
  });
  return output;
};
