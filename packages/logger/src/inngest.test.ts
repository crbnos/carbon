// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { configureSync, reset } from "@logtape/logtape";
import { createLogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInngestLogger } from "./inngest";

const recorder = createLogRecorder();

beforeEach(() => {
  recorder.clear();
  configureSync({
    reset: true,
    sinks: { recorder: recorder.sink },
    loggers: [
      { category: ["carbon"], lowestLevel: "trace", sinks: ["recorder"] }
    ]
  });
});

afterEach(async () => {
  await reset();
});

describe("createInngestLogger", () => {
  it("logs under the carbon.jobs category, warn as warning", () => {
    createInngestLogger().warn("careful");
    const record = recorder.records[0];
    expect(record?.category.join(".")).toBe("carbon.jobs");
    expect(record?.level).toBe("warning");
  });

  it("fills a template from its properties, as getLogger does", () => {
    createInngestLogger().error("Run {runId} failed", { runId: "r1" });
    const record = recorder.records[0];
    expect(record?.rawMessage).toBe("Run {runId} failed");
    expect(record?.message.join("")).toBe("Run r1 failed");
    expect(record?.properties).toEqual({ runId: "r1" });
  });

  it("keeps an Error passed after the message under error", () => {
    const boom = new Error("boom");
    createInngestLogger().error("Send failed", boom);
    expect(recorder.records[0]?.properties).toEqual({ error: boom });
  });

  it("keeps a lone Error under error, under one fixed message", () => {
    const boom = new Error("boom");
    createInngestLogger().error(boom);
    expect(recorder.records[0]?.rawMessage).toBe("Job error");
    expect(recorder.records[0]?.properties).toEqual({ error: boom });
  });

  it("logs a lone string holding a brace as a value", () => {
    createInngestLogger().info("payload {not a template}");
    expect(recorder.records[0]?.message.join("")).toBe(
      "payload {not a template}"
    );
  });

  it("logs any other call as a value with its arguments", () => {
    createInngestLogger().info("step", 1, "two");
    const record = recorder.records[0];
    expect(record?.message.join("")).toBe("step");
    expect(record?.properties.args).toEqual([1, "two"]);
  });
});
