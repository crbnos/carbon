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
  it("drops errors logged for a read whose client has gone", () => {
    const write = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    ensureLoggingConfigured({ level: "debug", pretty: false });
    const controller = new AbortController();
    const request = new Request("http://erp.test/x", {
      signal: controller.signal
    });
    const fail = () => getLogger("erp").error("Failed to load part");

    runInRequestContext(new RouterContextProvider(), fail, { request });
    expect(write).toHaveBeenCalledTimes(1);

    controller.abort();
    runInRequestContext(new RouterContextProvider(), fail, { request });
    expect(write).toHaveBeenCalledTimes(1);

    fail();
    expect(write).toHaveBeenCalledTimes(2);
    write.mockRestore();
  });
});
