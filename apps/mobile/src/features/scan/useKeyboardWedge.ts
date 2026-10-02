// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import type {
  NativeSyntheticEvent,
  TextInput,
  TextInputProps,
  TextInputSubmitEditingEventData
} from "react-native";

/**
 * A Bluetooth or USB barcode scanner in keyboard mode.
 *
 * Most scanners on a shop floor are not cameras — they are keyboards. They
 * type the code as a burst of keystrokes and finish with Enter. There is no
 * key-event stream to listen to on React Native the way web MES does
 * (`packages/react/src/hooks/useKeyboardWedge.ts` listens on `document`), so
 * the app gives the scanner somewhere to type: a focused 1x1 invisible
 * `TextInput` that submits on Enter.
 *
 * That also settles the one subtlety the web hook has to handle by hand —
 * yielding Enter to the wedge while a scan burst is in flight. Here the wedge
 * IS the focused input, so Enter goes to it by construction and no other
 * control has to stand aside.
 *
 * `showSoftInputOnFocus: false` keeps the on-screen keyboard down: the wedge
 * is focused for most of the screen's life, and a keyboard covering the work
 * would be worse than no wedge at all. The consequence is that the wedge is
 * for hardware scanners only — an operator cannot type into it.
 */

/**
 * Invisible but focusable. Not `display: none`, not zero width, and not
 * `opacity` alone: a view with no size, or one that is laid out away, is
 * unreliable to focus on both platforms, and a 1x1 transparent input is the
 * shape that works.
 */
const WEDGE_STYLE = {
  position: "absolute" as const,
  width: 1,
  height: 1,
  opacity: 0
};

export type KeyboardWedge = {
  /** Attach to the hidden `TextInput`. */
  ref: React.RefObject<TextInput | null>;
  /** Spread onto the hidden `TextInput`. Includes its style. */
  props: TextInputProps;
  /** Put the scanner's keystrokes back into the wedge after a detour. */
  focus: () => void;
};

export function useKeyboardWedge({
  onScan,
  enabled = true
}: {
  onScan: (text: string) => void;
  /**
   * False while something else owns the keyboard — a focused text field, a
   * sheet, a screen that is not the operator's current one.
   */
  enabled?: boolean;
}): KeyboardWedge {
  const input = useRef<TextInput | null>(null);

  // The callback lives in a ref so the returned props stay referentially
  // stable: this input is focused while a camera preview renders beside it,
  // and remounting it mid-burst would lose half a code.
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  const focus = useCallback(() => {
    if (enabled) input.current?.focus();
  }, [enabled]);

  // A scanner must work the moment the operator comes back to the screen —
  // after an operation, after the app was backgrounded, after a sheet closed.
  useFocusEffect(
    useCallback(() => {
      focus();
      return () => input.current?.blur();
    }, [focus])
  );

  const submit = useCallback(
    (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      const text = event.nativeEvent.text;
      // Cleared rather than held in state: a 20-character burst through a
      // controlled input is 20 renders of a screen with a live camera on it.
      input.current?.clear();
      if (!enabled) return;
      if (text.trim()) handler.current(text);
    },
    [enabled]
  );

  return {
    ref: input,
    focus,
    props: {
      style: WEDGE_STYLE,
      autoFocus: enabled,
      // The scanner sends Enter after the code; keeping focus is what lets it
      // send a second one without anybody touching the tablet.
      blurOnSubmit: false,
      showSoftInputOnFocus: false,
      onSubmitEditing: submit,
      // A code is a code: autocorrect, capitalisation and smart punctuation
      // would all rewrite it.
      autoCapitalize: "none",
      autoCorrect: false,
      spellCheck: false,
      caretHidden: true,
      // Keeps the wedge out of the accessibility tree — there is nothing here
      // for a screen reader to read or to land on.
      accessible: false,
      importantForAccessibility: "no-hide-descendants"
    }
  };
}
