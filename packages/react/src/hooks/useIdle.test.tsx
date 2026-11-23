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

function Harness({
  startedAt,
  serverNow,
  onIdle
}: {
  startedAt?: number;
  serverNow?: number;
  onIdle?: () => void;
}) {
  idle = useIdle({
    enabled: true,
    idleMs: HOUR,
    startedAt,
    serverNow,
    heartbeatMs: 60 * 1000,
    heartbeatUrl: "/api/session/heartbeat",
    pauseEvents,
    onIdle
  }).isIdle;
  return null;
}

function mount(startedAt?: number, onIdle?: () => void, serverNow?: number) {
  act(() =>
    root.render(
      <Harness startedAt={startedAt} serverNow={serverNow} onIdle={onIdle} />
    )
  );
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

it("notifies once when the idle deadline locks the screen", () => {
  const onIdle = vi.fn();
  mount(undefined, onIdle);

  act(() => vi.advanceTimersByTime(HOUR + 2000));
  expect(idle).toBe(true);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

it("notifies on a peer lock without broadcasting the lock again", () => {
  let channel!: Channel;
  class Channel {
    onmessage: ((event: MessageEvent<{ type: "lock" }>) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    constructor() {
      channel = this;
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const onIdle = vi.fn();
  mount(undefined, onIdle);

  act(() => channel.onmessage?.({ data: { type: "lock" } } as MessageEvent));
  expect(idle).toBe(true);
  expect(onIdle).toHaveBeenCalledTimes(1);
  expect(channel.postMessage).not.toHaveBeenCalled();
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

it("keeps the server's remaining window when the kiosk clock is ahead", () => {
  const serverNow = Date.now() - 2 * HOUR;
  mount(serverNow - HOUR + 60 * 1000, undefined, serverNow);
  expect(idle).toBe(false);
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
