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

const pauseEvents = { start: "pin-change-start", end: "pin-change-end" };

function Harness({ startedAt }: { startedAt?: number }) {
  idle = useIdle({
    enabled: true,
    idleMs: HOUR,
    startedAt,
    heartbeatMs: 60 * 1000,
    heartbeatUrl: "/api/session/heartbeat",
    pauseEvents
  }).isIdle;
  return null;
}

function mount(startedAt?: number) {
  act(() => root.render(<Harness startedAt={startedAt} />));
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("stays pinned through hours of activity on one screen, then locks after one idle hour", () => {
  mount();
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
  mount();
  vi.setSystemTime(Date.now() + HOUR + 1000);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  expect(idle).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("locks when the server says the operator pin-in has expired", async () => {
  mount();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false })))
  );
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown"));
  });
  expect(idle).toBe(true);
});

it("starts the screen deadline from the server's pin timestamp", () => {
  mount(Date.now() - HOUR + 60 * 1000);
  act(() => vi.advanceTimersByTime(60 * 1000 + 1000));
  expect(idle).toBe(true);
});

it("aborts and ignores a heartbeat from before a pin change", async () => {
  mount();
  let finishResponse!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          finishResponse = resolve;
          expect(options.signal?.aborted).toBe(false);
        })
    )
  );

  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  act(() => window.dispatchEvent(new Event(pauseEvents.start)));
  expect(signal?.aborted).toBe(true);
  act(() => window.dispatchEvent(new Event(pauseEvents.end)));
  await act(async () => {
    finishResponse(new Response(JSON.stringify({ ok: false })));
  });
  expect(idle).toBe(false);
});

it("ignores a failed heartbeat from an earlier watcher lifetime", async () => {
  mount();
  let finishResponse!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishResponse = resolve;
        })
    )
  );
  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  act(() => root.render(null));
  mount();
  await act(async () => {
    finishResponse(new Response(JSON.stringify({ ok: false })));
  });
  expect(idle).toBe(false);
});
