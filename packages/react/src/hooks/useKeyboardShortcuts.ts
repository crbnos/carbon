import { useEffect, useState } from "react";

function includes(array: string[], element: string) {
  return array.indexOf(element) >= 0;
}

export default function useKeyboardShortcuts(keyMap: {
  [id: string]: (event: KeyboardEvent) => void;
}) {
  const [lastKeydown, setLastKeydown] = useState<string | null>();

  const handleKeydown = (event: any) => {
    if (
      !keyMap ||
      includes(["INPUT", "TEXTAREA", "SELECT"], event.target.nodeName) ||
      event.target.classList.contains("ProseMirror")
    ) {
      return;
    }

    const keyPressed = getKeyPresses(event);

    if (keyMap[keyPressed]) {
      /**
       * combined keymap will trigger action on KeyDown event
       * while single keymap  will trigger action on KeyUp event
       */
      if (keyPressed.includes("+")) {
        event.preventDefault();
        keyMap[keyPressed](event);
        setLastKeydown(null);
      } else {
        setLastKeydown(event.key);
        event.preventDefault();
      }
    }
  };

  const handleKeyup = (event: any) => {
    if (!keyMap) return;

    if (keyMap[event.key] && lastKeydown === event.key) {
      event.preventDefault();
      keyMap[event.key](event);
      setLastKeydown(null);
    }
  };

  function getKeyPresses(event: KeyboardEvent) {
    return event.metaKey && event.shiftKey
      ? `Command+Shift+${event.key}`
      : event.metaKey
      ? `Command+${event.key}`
      : event.shiftKey && event.key === "Enter"
      ? `Shift+${event.key}`
      : event.ctrlKey && event.key
      ? `Control+${event.key}`
      : event.key;
  }

  useEffect(() => {
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("keyup", handleKeyup);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
    };
  });
}
