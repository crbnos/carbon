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
