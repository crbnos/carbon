// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function prettifyKeyboardShortcut(input: string, isMac: boolean = true) {
  if (isMac) {
    return input
      .split("+")
      .join("")
      .replace("ArrowRight", "→")
      .replace("ArrowLeft", "←")
      .replace("Command", "⌘")
      .replace("Shift", "⇧")
      .replace("Control", "⌃")
      .replace("Enter", "↩")
      .toUpperCase();
  }
  return input
    .replace("ArrowRight", "→")
    .replace("ArrowLeft", "←")
    .replace("Command", "Ctrl")
    .replace("Enter", "Enter");
}
