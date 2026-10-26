// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

interface UseKeyboardWedgeOptions {
  test: (input: string) => boolean;
  callback?: (input: string) => void;
  active?: boolean;
}

/** A scanner types faster than this per key on average; a person never does. */
const SCANNER_KEY_GAP_MS = 50;
/** A scan with no Enter suffix is over once no key arrives for this long. */
const SCAN_END_MS = 200;
/** A buffer nobody submitted is dropped after this long without a key. */
const BUFFER_RESET_MS = 3000;

/**
 * Whether `length` keys typed between `firstKeyAt` and `lastKeyAt` came from
 * a barcode scanner rather than a person. Scanners configured without an
 * Enter suffix end a scan by going quiet, so this is how the wedge tells a
 * finished scan from someone typing.
 */
export function typedByScanner(
  firstKeyAt: number,
  lastKeyAt: number,
  length: number
): boolean {
  if (length < 2) return false;
  return (lastKeyAt - firstKeyAt) / (length - 1) < SCANNER_KEY_GAP_MS;
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

  // Callers pass inline functions; the listener reads the latest ones so it
  // never re-subscribes (and loses the buffer) mid-scan.
  const handlers = useRef({ test, callback });
  handlers.current = { test, callback };

  useEffect(() => {
    if (!active) return;

    // The buffer lives here, not in state: the Enter that ends a scan must
    // see every key before it, whether or not React has re-rendered since.
    let buffer = "";
    let firstKeyAt = 0;
    let lastKeyAt = 0;
    let scanEndTimer: ReturnType<typeof setTimeout> | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
      buffer = "";
      clearTimeout(scanEndTimer);
      clearTimeout(resetTimer);
      setInputBuffer("");
    };

    // A scanner with no Enter suffix: submit once the burst goes quiet.
    const endScan = () => {
      if (
        typedByScanner(firstKeyAt, lastKeyAt, buffer.length) &&
        handlers.current.test(buffer)
      ) {
        const input = buffer;
        clear();
        handlers.current.callback(input);
      }
    };

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
        const now = Date.now();
        if (buffer === "") firstKeyAt = now;
        lastKeyAt = now;
        buffer += event.key;
        setInputBuffer(buffer);
        clearTimeout(scanEndTimer);
        clearTimeout(resetTimer);
        scanEndTimer = setTimeout(endScan, SCAN_END_MS);
        resetTimer = setTimeout(clear, BUFFER_RESET_MS);
      } else if (event.key === "Enter") {
        const input = buffer;
        clear();
        if (handlers.current.test(input)) {
          event.preventDefault();
          handlers.current.callback(input);
        }
      } else if (event.key === "Escape") {
        clear();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clear();
    };
  }, [active]);

  return inputBuffer;
}
