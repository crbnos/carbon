// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { isTextEntryTarget } from "../utils/keyboard";

interface UseKeyboardWedgeOptions {
  test: (input: string) => boolean;
  /**
   * Runs for an accepted scan. Return a promise (a navigation, a fetcher) and
   * the scan stays pending until it settles: `useScanPending` reports it, and
   * every other scan is ignored meanwhile, so a second scan of the same label
   * does nothing.
   */
  callback?: (input: string) => unknown;
  active?: boolean;
  /**
   * Also take scans made while a text field has focus. A matched scan is
   * removed from the field; an unmatched one stays in it.
   */
  inTextFields?: boolean;
  /** A scan no wedge on the page accepted, made outside a text field. */
  onUnrecognized?: (input: string) => void;
}

/** A scanner types faster than this per key on average; a person never does. */
const SCANNER_KEY_GAP_MS = 50;
/** A gap longer than this between two keys starts a new burst. */
const NEW_BURST_GAP_MS = 80;
/**
 * A scan with no Enter or Tab suffix ends once no key arrives for this long.
 * The wait also joins a scan a Bluetooth scanner paused part-way through: the
 * first half of a URL is often a valid URL itself, so ending sooner would act
 * on half a scan.
 */
const QUIET_END_MS = 700;
/** Scanner-speed keys before they are kept from the page; below this, two keys pressed together would count. */
const MIN_SCAN_LENGTH = 4;
/** A pending scan whose callback never settles (a navigation that failed to load) stops blocking after this. */
const PENDING_TIMEOUT_MS = 20_000;

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

type Burst = { text: string; firstAt: number; lastAt: number };

/**
 * Splits the keystream into bursts at every gap longer than
 * `NEW_BURST_GAP_MS`. A burst at scanner speed is (part of) a scan; anything
 * else is a person, and is dropped when the next burst starts — so a stray
 * key can never sit in front of the next scan. Scanner bursts separated by a
 * pause are kept (`held`) and joined.
 */
export class ScanReader {
  private burst: Burst | null = null;
  private held = "";

  /**
   * One printable key at `at` ms. `startsScan` is true for the first key of
   * what may become a scan; `hold` is true once the key is part of a scan and
   * should be kept from the page.
   */
  key(char: string, at: number): { startsScan: boolean; hold: boolean } {
    let startsScan = false;
    if (this.burst && at - this.burst.lastAt > NEW_BURST_GAP_MS) {
      if (this.isScannerBurst(this.burst)) this.held += this.burst.text;
      this.burst = null;
    }
    if (!this.burst) {
      this.burst = { text: "", firstAt: at, lastAt: at };
      startsScan = this.held === "";
    }
    this.burst.text += char;
    this.burst.lastAt = at;
    return { startsScan, hold: this.isScan() };
  }

  /** What the scan so far could be, most likely first. */
  candidates(): string[] {
    if (!this.burst) return this.held ? [this.held] : [];
    const joinable =
      this.held &&
      (this.isScannerBurst(this.burst) || this.burst.text.length <= 2);
    return joinable
      ? [this.held + this.burst.text, this.burst.text]
      : [this.burst.text];
  }

  /** Long enough, and fast enough, to be a scan rather than a person. */
  isScan(): boolean {
    const length = this.held.length + (this.burst?.text.length ?? 0);
    return (
      length >= MIN_SCAN_LENGTH &&
      (this.held !== "" || this.isScannerBurst(this.burst))
    );
  }

  /** Typed by a scanner at all, however short (a scan with no Enter suffix ends on this). */
  typedByScanner(): boolean {
    return this.held !== "" || this.isScannerBurst(this.burst);
  }

  reset() {
    this.burst = null;
    this.held = "";
  }

  private isScannerBurst(burst: Burst | null): boolean {
    return (
      !!burst && typedByScanner(burst.firstAt, burst.lastAt, burst.text.length)
    );
  }
}

type Handler = Required<
  Pick<UseKeyboardWedgeOptions, "test" | "inTextFields">
> & {
  callback: (input: string) => unknown;
  onUnrecognized?: (input: string) => void;
};

// One reader for the page, however many wedges are mounted: the layout's and a
// screen's own see the same scan, and only one of them acts on it.
const handlers = new Set<{ current: Handler }>();
const reader = new ScanReader();
let origin: {
  inField: boolean;
  field: TextField | null;
  value: string;
} | null = null;
let quietTimer: ReturnType<typeof setTimeout> | undefined;

let pending = false;
const pendingListeners = new Set<() => void>();
function setPending(next: boolean) {
  if (pending === next) return;
  pending = next;
  for (const listener of pendingListeners) listener();
}

type TextField = HTMLInputElement | HTMLTextAreaElement;
function textField(target: EventTarget | null): TextField | null {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
    ? target
    : null;
}

// Through the native setter, so a controlled input's onChange sees it.
function restoreField(field: TextField, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function swallow(event: KeyboardEvent | null) {
  event?.preventDefault();
  event?.stopImmediatePropagation();
}

function run(handler: Handler, input: string) {
  const result = handler.callback(input);
  if (!(result instanceof Promise)) return;
  setPending(true);
  const timeout = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
  const settle = () => {
    clearTimeout(timeout);
    setPending(false);
  };
  result.then(settle, settle);
}

/** Ends the scan in progress: on Enter or Tab (`event`), or when it went quiet (`null`). */
function finish(event: KeyboardEvent | null) {
  clearTimeout(quietTimer);
  const candidates = reader.candidates();
  const isScan = reader.isScan();
  const byScanner = reader.typedByScanner();
  const from = origin;
  reader.reset();
  origin = null;
  if (!candidates.length || (!event && !byScanner)) return;

  if (pending) {
    // A scan is already being handled: this is the second scan of the label.
    if (isScan && !from?.inField) swallow(event);
    return;
  }

  const eligible = [...handlers]
    .map((handler) => handler.current)
    .filter((handler) => !from?.inField || handler.inTextFields);
  for (const input of candidates) {
    const handler = eligible.find((h) => h.test(input));
    if (!handler) continue;
    swallow(event);
    if (from?.field) restoreField(from.field, from.value);
    run(handler, input);
    return;
  }

  // An unrecognized scan never clicks the focused button. In a text field it
  // is the field's: someone scanned a lot number into it.
  if (!isScan || from?.inField) return;
  swallow(event);
  const [input] = candidates;
  if (input) eligible.find((h) => h.onUnrecognized)?.onUnrecognized?.(input);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key.length === 1) {
    const { startsScan, hold } = reader.key(event.key, event.timeStamp);
    if (startsScan) {
      const field = textField(event.target);
      origin = {
        inField: isTextEntryTarget(event.target),
        field,
        value: field?.value ?? ""
      };
    }
    // Held keys never reach the page's shortcuts (Space is Start/Pause). In a
    // text field they type as usual until the scan is matched.
    if (hold && !origin?.inField) swallow(event);
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => finish(null), QUIET_END_MS);
  } else if (
    event.key === "Enter" ||
    (event.key === "Tab" && reader.isScan())
  ) {
    finish(event);
  } else if (event.key === "Escape") {
    clearTimeout(quietTimer);
    reader.reset();
    origin = null;
  }
}

function register(handler: { current: Handler }) {
  handlers.add(handler);
  // Capture on window: runs before any component can stop the key.
  if (handlers.size === 1) {
    window.addEventListener("keydown", handleKeyDown, true);
  }
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      window.removeEventListener("keydown", handleKeyDown, true);
      clearTimeout(quietTimer);
      reader.reset();
      origin = null;
    }
  };
}

/** True while an accepted scan's action is still running. */
export function useScanPending() {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    () => pending,
    () => false
  );
}

export function useKeyboardWedge(options?: UseKeyboardWedgeOptions) {
  const navigate = useNavigate();

  // Default test and callback for backward compatibility
  const defaultTest = (input: string) => input.startsWith("http");
  const defaultCallback = (input: string) => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return navigate(input);
    }
    // A link into the other app (an ERP kanban scanned in the MES) has a
    // different origin, and its path does not exist here: load it there. The
    // page unloads when it arrives, so the scan stays pending until then.
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return new Promise<void>((resolve) => {
        // Back from the bfcache: the page never unloaded.
        window.addEventListener("pageshow", () => resolve(), { once: true });
      });
    }
    return navigate(url.pathname + url.search);
  };

  const active = options?.active ?? true;

  // Callers pass inline functions; the reader calls the latest ones, so the
  // wedge never re-registers mid-scan.
  const handler = useRef<Handler>(null!);
  handler.current = {
    test: options?.test ?? defaultTest,
    callback: options?.callback ?? defaultCallback,
    inTextFields: options?.inTextFields ?? false,
    onUnrecognized: options?.onUnrecognized
  };

  useEffect(() => {
    if (!active) return;
    return register(handler);
  }, [active]);
}
