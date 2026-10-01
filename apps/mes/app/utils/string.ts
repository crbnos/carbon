// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const capitalize = (words: string) => {
  const [first, ...otherLetters] = words;
  return [first.toLocaleUpperCase(), ...otherLetters].join("");
};
