// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { useKeyboardWedge, useScanPending } from "../hooks/useKeyboardWedge";

const LABEL = "https://erp.carbon.ms/api/kanban/complete/kbn_8f3k2m1q";

type Options = Parameters<typeof useKeyboardWedge>[0];

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let pending = false;

function Harness({ options }: { options: Options }) {
  useKeyboardWedge(options);
  pending = useScanPending();
  return <input aria-label="search" />;
}

function mount(options: Options) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const router = createMemoryRouter([
    { path: "/", element: <Harness options={options} /> }
  ]);
  root = createRoot(container);
  act(() => root!.render(<RouterProvider router={router} />));
  return container.querySelector("input")!;
}

/** Dispatches one keydown and does what the browser would when nobody prevented it. */
function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  });
  const notPrevented = target.dispatchEvent(event);
  if (notPrevented && key.length === 1 && target instanceof HTMLInputElement) {
    target.value += key;
  }
  return event;
}

/** Types `text` at scanner speed, then `suffix`; returns the suffix's event. */
function scan(
  text: string,
  target: EventTarget = document.body,
  suffix = "Enter"
) {
  for (const char of text) {
    press(char, target);
    vi.advanceTimersByTime(8);
  }
  return suffix ? press(suffix, target) : null;
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // jsdom stamps every event with Date.now(): faking it sets the key timing.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

describe("useKeyboardWedge", () => {
  it("acts on a scan, and keeps its keys and Enter from the page", () => {
    const callback = vi.fn();
    mount({ test: (input) => input === LABEL, callback });
    const reachedPage = vi.fn();
    document.addEventListener("keydown", reachedPage);

    const enter = scan(LABEL);

    document.removeEventListener("keydown", reachedPage);
    expect(callback).toHaveBeenCalledWith(LABEL);
    expect(enter?.defaultPrevented).toBe(true);
    // The first three keys can't be told from a person yet; the rest are held.
    expect(reachedPage).toHaveBeenCalledTimes(3);
  });

  it("ignores a stray key pressed a second before the scan", () => {
    const callback = vi.fn();
    mount({ test: (input) => input === LABEL, callback });
    press("a");
    vi.advanceTimersByTime(1000);
    scan(LABEL);
    expect(callback).toHaveBeenCalledWith(LABEL);
  });

  it("still sees the Enter when a component stops it", () => {
    const callback = vi.fn();
    mount({ test: (input) => input === LABEL, callback });
    const combobox = document.createElement("div");
    combobox.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.appendChild(combobox);

    scan(LABEL, combobox);

    combobox.remove();
    expect(callback).toHaveBeenCalledWith(LABEL);
  });

  it("takes a scan out of a text field when it opted in", () => {
    const callback = vi.fn();
    const field = mount({
      test: (input) => input === LABEL,
      callback,
      inTextFields: true
    });
    field.value = "bolt";
    field.focus();

    scan(LABEL, field);

    expect(callback).toHaveBeenCalledWith(LABEL);
    expect(field.value).toBe("bolt");
  });

  it("leaves a scan in a text field to the field when it did not opt in", () => {
    const callback = vi.fn();
    const field = mount({ test: (input) => input === LABEL, callback });
    field.focus();

    const enter = scan(LABEL, field);

    expect(callback).not.toHaveBeenCalled();
    expect(field.value).toBe(LABEL);
    expect(enter?.defaultPrevented).toBe(false);
  });

  it("reports a scan nothing accepted, and keeps its Enter from the page", () => {
    const onUnrecognized = vi.fn();
    mount({ test: () => false, callback: vi.fn(), onUnrecognized });

    const enter = scan("LOT-2026-0042");

    expect(onUnrecognized).toHaveBeenCalledWith("LOT-2026-0042");
    expect(enter?.defaultPrevented).toBe(true);
  });

  it("leaves an unrecognized scan in a text field alone", () => {
    const onUnrecognized = vi.fn();
    const field = mount({
      test: () => false,
      callback: vi.fn(),
      inTextFields: true,
      onUnrecognized
    });
    field.focus();

    const enter = scan("LOT-2026-0042", field);

    expect(onUnrecognized).not.toHaveBeenCalled();
    expect(enter?.defaultPrevented).toBe(false);
    expect(field.value).toBe("LOT-2026-0042");
  });

  it("waits out a pause before acting on a scan with no Enter", () => {
    const callback = vi.fn();
    // The first half of the label is a valid link on its own.
    mount({ test: (input) => input.startsWith("https://"), callback });

    scan(LABEL.slice(0, 30), document.body, "");
    vi.advanceTimersByTime(400);
    scan(LABEL.slice(30), document.body, "");
    // `scan` already waited 8 ms after the last key: 699 ms of quiet so far.
    vi.advanceTimersByTime(691);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledWith(LABEL);
  });

  it("stays pending until the action settles, and ignores a second scan meanwhile", async () => {
    let settle: () => void = () => undefined;
    const callback = vi.fn(
      () => new Promise<void>((resolve) => (settle = resolve))
    );
    mount({ test: (input) => input === LABEL, callback });

    act(() => void scan(LABEL));
    expect(pending).toBe(true);

    vi.advanceTimersByTime(1000);
    const second = scan(LABEL);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(second?.defaultPrevented).toBe(true);

    await act(async () => settle());
    expect(pending).toBe(false);
  });
});
