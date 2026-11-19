// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef } from "react";

/**
 * Fills an empty field that has exactly one option, once per option, and tells
 * `onChange` as a pick would. A user who clears it afterwards keeps it empty.
 */
export function useAutoSelectSingleOption<O extends { value: string }>({
  enabled,
  options,
  value,
  setValue,
  onChange
}: {
  enabled: boolean;
  options: O[];
  value: string | undefined;
  setValue: (value: string) => void;
  onChange?: (option: O) => void;
}) {
  const sole = enabled && options.length === 1 ? options[0] : undefined;
  const filledWith = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sole && value === sole.value) filledWith.current = sole.value;
    if (!sole || value || filledWith.current === sole.value) return;
    filledWith.current = sole.value;
    setValue(sole.value);
    onChange?.(sole);
  }, [sole, value, setValue, onChange]);
}
