// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

interface UseKeyboardWedgeOptions {
  test: (input: string) => boolean;
  callback?: (input: string) => void;
  active?: boolean;
}

export function useKeyboardWedge(options?: UseKeyboardWedgeOptions) {
  const [inputBuffer, setInputBuffer] = useState("");
  const navigate = useNavigate();

  // Default test and callback for backward compatibility
  const defaultTest = (input: string) => input.startsWith("http");
  const defaultCallback = (input: string) => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      navigate(input);
      return;
    }
    // A link into the other app (an ERP kanban scanned in the MES) has a
    // different origin, and its path does not exist here: load it there.
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }
    navigate(url.pathname + url.search);
  };

  const test = options?.test ?? defaultTest;
  const callback = options?.callback ?? defaultCallback;
  const active = options?.active ?? true;

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if the active element is an input or textarea
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA")
      ) {
        return;
      }

      if (/^[a-zA-Z0-9\-./:?=&_]$/.test(event.key)) {
        setInputBuffer((prev) => prev + event.key);
      } else if (event.key === "Enter") {
        if (test(inputBuffer)) {
          event.preventDefault();
        }

        if (test(inputBuffer)) {
          callback(inputBuffer);
        }
        setInputBuffer("");
      } else if (event.key === "Escape") {
        setInputBuffer("");
      }
    };

    const timeoutId = setTimeout(() => {
      setInputBuffer("");
    }, 3000);

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeoutId);
    };
  }, [inputBuffer, test, callback, active]);

  return inputBuffer;
}
