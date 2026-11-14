// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const CONSOLE_PIN_PAUSE_EVENTS = {
  start: "carbon:console-pin-change-start",
  end: "carbon:console-pin-change-end"
};
export const CONSOLE_PIN_CHANNEL = "carbon-console-pin-change";
export const CONSOLE_PIN_SOURCE_ID =
  typeof window === "undefined" ? "" : crypto.randomUUID();

let pendingChanges = 0;
let channel: BroadcastChannel | null = null;

function announce(type: "start" | "end") {
  window.dispatchEvent(new Event(CONSOLE_PIN_PAUSE_EVENTS[type]));
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(CONSOLE_PIN_CHANNEL);
    channel.postMessage({ type, sourceId: CONSOLE_PIN_SOURCE_ID });
  }
}

/** Stop operator heartbeats before a PIN action can change the cookie. */
export function beginConsolePinChange() {
  if (pendingChanges++ === 0) {
    announce("start");
  }
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (--pendingChanges === 0) {
      announce("end");
    }
  };
}
