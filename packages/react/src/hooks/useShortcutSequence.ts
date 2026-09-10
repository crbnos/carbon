import { useEffect, useRef } from "react";
import { hasOpenDialog } from "../utils/dialog";
import { isEditableTarget } from "../utils/keyboard";

const SEQUENCE_TIMEOUT_MS = 1500;
/** Two printable keys closer than this are a scanner burst, not a human chord. */
const SCANNER_BURST_MS = 50;

export type SequenceState = {
  /** When the prefix armed the sequence, or null while disarmed. */
  armedAt: number | null;
  /** Timestamp of the last printable keydown — the scanner-burst detector. */
  lastPrintableAt: number | null;
};

type SequenceEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey"
>;

/**
 * Pure state step for a two-key sequence ("g" then a letter) — exported for
 * tests. Rules: any modifier disarms; while armed, a key in `keys` matches and
 * disarms, any other key (Escape included) just disarms; the bare prefix arms
 * unless it arrived inside a scanner burst (see `useKeyboardWedge` — barcode
 * scanners type printable characters faster than any human).
 */
export function sequenceStep(
  state: SequenceState,
  event: SequenceEvent,
  now: number,
  config: { prefix: string; keys: ReadonlySet<string> }
): { state: SequenceState; match?: string } {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return { state: { ...state, armedAt: null } };
  }
  const key = event.key.toLowerCase();
  const lastPrintableAt = key.length === 1 ? now : state.lastPrintableAt;
  const armed =
    state.armedAt !== null && now - state.armedAt <= SEQUENCE_TIMEOUT_MS;
  if (armed) {
    if (config.keys.has(key)) {
      return { state: { armedAt: null, lastPrintableAt }, match: key };
    }
    return { state: { armedAt: null, lastPrintableAt } };
  }
  if (key === config.prefix) {
    const burst =
      state.lastPrintableAt !== null &&
      now - state.lastPrintableAt < SCANNER_BURST_MS;
    return { state: { armedAt: burst ? null : now, lastPrintableAt } };
  }
  return { state: { armedAt: null, lastPrintableAt } };
}

/**
 * Two-key sequence shortcuts (`prefix` then a `map` key — e.g. `g` then `s`
 * for Sales). react-hotkeys-hook has no sequence support, so this is a plain
 * document listener. Inert in editable targets and while a dialog is open;
 * map keys must be lowercase single characters.
 */
export function useShortcutSequence({
  prefix,
  map,
  disabled = false
}: {
  prefix: string;
  map: Record<string, () => void>;
  disabled?: boolean;
}) {
  const stateRef = useRef<SequenceState>({
    armedAt: null,
    lastPrintableAt: null
  });
  const mapRef = useRef(map);
  mapRef.current = map;
  const prefixRef = useRef(prefix);
  prefixRef.current = prefix;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        disabledRef.current ||
        hasOpenDialog() ||
        isEditableTarget(event.target)
      ) {
        stateRef.current = { ...stateRef.current, armedAt: null };
        return;
      }
      const result = sequenceStep(stateRef.current, event, Date.now(), {
        prefix: prefixRef.current,
        keys: new Set(Object.keys(mapRef.current))
      });
      stateRef.current = result.state;
      if (result.match) {
        event.preventDefault();
        mapRef.current[result.match]?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
