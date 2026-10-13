// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useState } from "react";

const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [storedValue, setStoredValue] = useState(initialValue);
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;

  useEffect(() => {
    // Retrieve from localStorage. A key with nothing stored falls back to the
    // initial value, so switching keys never carries the previous key's value.
    const item = window.localStorage.getItem(key);
    setStoredValue(item ? JSON.parse(item) : initialValueRef.current);
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    // Save state
    const newValue = value instanceof Function ? value(storedValue) : value;
    setStoredValue(newValue);
    // Save to localStorage
    window.localStorage.setItem(key, JSON.stringify(newValue));
  };
  return [storedValue, setValue];
};

export default useLocalStorage;
