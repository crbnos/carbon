// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../Toast";

const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [storedValue, setStoredValue] = useState(initialValue);
  const storedValueRef = useRef(storedValue);
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;

  useEffect(() => {
    // Retrieve from localStorage. A key with nothing stored falls back to the
    // initial value, so switching keys never carries the previous key's value.
    let nextValue = initialValueRef.current;
    try {
      const item = window.localStorage.getItem(key);
      if (item) nextValue = JSON.parse(item);
    } catch {
      // Invalid JSON or unavailable storage must not break the page.
    }
    storedValueRef.current = nextValue;
    setStoredValue(nextValue);
  }, [key]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      const newValue =
        value instanceof Function ? value(storedValueRef.current) : value;
      storedValueRef.current = newValue;
      setStoredValue(newValue);
      try {
        window.localStorage.setItem(key, JSON.stringify(newValue));
      } catch {
        toast.error("Could not save this preference in your browser.", {
          id: "local-storage-preference-error"
        });
      }
    },
    [key]
  );
  return [storedValue, setValue];
};

export default useLocalStorage;
