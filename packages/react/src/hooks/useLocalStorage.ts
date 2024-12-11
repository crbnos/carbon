import { useEffect, useState } from "react";

const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [storedValue, setStoredValue] = useState(initialValue);

  useEffect(() => {
    // Retrieve from localStorage
    const item = window.localStorage.getItem(key);
    if (item) {
      setStoredValue(JSON.parse(item));
    }
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
