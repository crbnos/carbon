// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
