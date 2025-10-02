import { useNavigate } from "@remix-run/react";
import { useEffect, useState } from "react";

interface UseKeyboardWedgeOptions {
  test: (input: string) => boolean;
  callback: (input: string) => void;
  active?: boolean;
}

export function useKeyboardWedge(options?: UseKeyboardWedgeOptions) {
  const [inputBuffer, setInputBuffer] = useState("");
  const navigate = useNavigate();

  // Default test and callback for backward compatibility
  const defaultTest = (input: string) => input.startsWith("http");
  const defaultCallback = (input: string) => {
    try {
      const url = new URL(input);
      navigate(url.pathname + url.search);
    } catch {
      navigate(input);
    }
  };

  const test = options?.test ?? defaultTest;
  const callback = options?.callback ?? defaultCallback;
  const active = options?.active ?? true;
  console.log(inputBuffer);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
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
