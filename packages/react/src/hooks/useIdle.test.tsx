// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { useIdle } from "./useIdle";

const HOUR = 60 * 60 * 1000;
let root: Root;
let container: HTMLDivElement;
let idle = false;

function Harness() {
  idle = useIdle({
    enabled: true,
    idleMs: HOUR,
    heartbeatMs: 60 * 1000,
    heartbeatUrl: "/api/session/heartbeat"
  }).isIdle;
  return null;
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true })))
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("stays pinned through hours of activity on one screen, then locks after one idle hour", () => {
  for (let hour = 0; hour < 3; hour++) {
    act(() => vi.advanceTimersByTime(HOUR - 60 * 1000));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
    expect(idle).toBe(false);
  }
  expect(fetch).toHaveBeenCalledTimes(3);

  act(() => vi.advanceTimersByTime(HOUR + 1000));
  expect(idle).toBe(true);
});

it("does not revive an expired pin-in when input precedes the interval check", () => {
  vi.setSystemTime(Date.now() + HOUR + 1000);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  expect(idle).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("locks when the server says the operator pin-in has expired", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false })))
  );
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown"));
  });
  expect(idle).toBe(true);
});
