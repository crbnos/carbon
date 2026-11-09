// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toast } from "../Toast";
import useLocalStorage from "./useLocalStorage";

it("keeps both display changes made before React renders again", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  let setDisplay: ReturnType<
    typeof useLocalStorage<{ empty: boolean; thumbnail: boolean }>
  >[1] = () => undefined;

  function Display() {
    const [settings, setSettings] = useLocalStorage("schedule-display-test", {
      empty: true,
      thumbnail: true
    });
    setDisplay = setSettings;
    return <span>{JSON.stringify(settings)}</span>;
  }

  act(() => root.render(<Display />));
  act(() => {
    setDisplay((previous) => ({ ...previous, empty: false }));
    setDisplay((previous) => ({ ...previous, thumbnail: false }));
  });

  expect(element.textContent).toBe('{"empty":false,"thumbnail":false}');
  expect(
    JSON.parse(localStorage.getItem("schedule-display-test") ?? "null")
  ).toEqual({
    empty: false,
    thumbnail: false
  });

  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("uses defaults for invalid storage and keeps a stable setter when writes fail", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => "{invalid",
    setItem: () => {
      throw new Error("Storage is full");
    }
  });
  const errorToast = vi.spyOn(toast, "error").mockReturnValue("storage-error");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  const setters: Array<(value: boolean) => void> = [];

  function Display() {
    const [showCustomer, setShowCustomer] = useLocalStorage(
      "schedule-display-invalid",
      true
    );
    setters.push(setShowCustomer);
    return <span>{String(showCustomer)}</span>;
  }

  act(() => root.render(<Display />));
  expect(element.textContent).toBe("true");
  const setDisplay = setters[0];
  if (!setDisplay) throw new Error("The storage hook did not render");
  act(() => setDisplay(false));
  expect(element.textContent).toBe("false");
  expect(setters.at(-1)).toBe(setDisplay);
  expect(errorToast).toHaveBeenCalledWith(
    "Could not save this preference in your browser.",
    { id: "local-storage-preference-error" }
  );

  act(() => root.unmount());
  errorToast.mockRestore();
  vi.unstubAllGlobals();
});

it("migrates a legacy preference only when the scoped key is empty", () => {
  const values = new Map<string, string>([["legacy", '{"empty":false}']]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  const defaults = { empty: true, thumbnail: true };

  function Display({ storageKey }: { storageKey: string }) {
    const [settings] = useLocalStorage(storageKey, defaults, {
      key: "legacy",
      parse: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? { ...defaults, ...(value as Partial<typeof defaults>) }
          : null
    });
    return <span>{JSON.stringify(settings)}</span>;
  }

  act(() => root.render(<Display storageKey="scoped-a" />));
  expect(element.textContent).toBe('{"empty":false,"thumbnail":true}');
  expect(values.get("scoped-a")).toBe(element.textContent);

  values.set("scoped-b", '{"empty":true,"thumbnail":false}');
  act(() => root.render(<Display storageKey="scoped-b" />));
  expect(element.textContent).toBe('{"empty":true,"thumbnail":false}');
  expect(values.get("scoped-b")).toBe('{"empty":true,"thumbnail":false}');

  act(() => root.unmount());
  vi.unstubAllGlobals();
});
