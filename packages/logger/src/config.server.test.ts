// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureLoggingConfigured } from "./config.server";
import { runInRequestContext } from "./context.server";
import { getLogger } from "./logger";

const CONFIGURED = Symbol.for("carbon.logging.configured");

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[CONFIGURED];
});

describe("ensureLoggingConfigured (server)", () => {
  it("configures once and is idempotent", () => {
    expect(() => ensureLoggingConfigured({ level: "debug" })).not.toThrow();
    expect((globalThis as Record<PropertyKey, unknown>)[CONFIGURED]).toBe(true);
    // Second call is a no-op, must not throw (LogTape throws on double-configure
    // without reset).
    expect(() => ensureLoggingConfigured({ level: "info" })).not.toThrow();
  });

  // A cancelled query comes back to its loader as an error. With the client
  // gone it is not a failure, and logging it would bury the real ones.
  it("drops cancellation errors logged for a read whose client has gone, and nothing else", () => {
    const write = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    ensureLoggingConfigured({ level: "debug", pretty: false });
    const controller = new AbortController();
    const request = new Request("http://erp.test/x", {
      signal: controller.signal
    });
    // What supabase-js returns for a cancelled call, as a loader logs it.
    const cancelled = {
      error: { message: "AbortError: This operation was aborted", code: "" }
    };
    const fail = (properties = {}) =>
      getLogger("erp").error("Failed to load part", properties);
    const inRequest = (properties?: object) =>
      runInRequestContext(new RouterContextProvider(), () => fail(properties), {
        request
      });

    inRequest(cancelled);
    expect(write).toHaveBeenCalledTimes(1);

    controller.abort();
    inRequest(cancelled);
    inRequest({ result: cancelled });
    // A cancelled storage read: the abort sits under `originalError`.
    inRequest({
      error: {
        name: "StorageUnknownError",
        originalError: new DOMException("aborted", "AbortError")
      }
    });
    expect(write).toHaveBeenCalledTimes(1);

    // A real failure after the client left, e.g. a write, is still logged.
    inRequest({ error: new Error("duplicate key") });
    expect(write).toHaveBeenCalledTimes(2);

    // Outside the request, the same AbortError is a timeout, not a departure.
    fail(cancelled);
    expect(write).toHaveBeenCalledTimes(3);
    write.mockRestore();
  });
});
