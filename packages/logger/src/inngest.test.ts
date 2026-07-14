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
  it("logs under the carbon.jobs category", () => {
    createInngestLogger().info("hello");
    expect(recorder.records[0]?.category.join(".")).toBe("carbon.jobs");
  });

  it("maps warn → warning level", () => {
    createInngestLogger().warn("careful");
    expect(recorder.records[0]?.level).toBe("warning");
    expect(recorder.records.map((r) => r.message.join(""))).toContain(
      "careful"
    );
  });

  it("renders a string first arg as the message, rest as args", () => {
    createInngestLogger().info("did {thing}", { extra: 1 });
    const record = recorder.records[0];
    // The raw `{thing}` is a value, not interpreted as a placeholder.
    expect(record?.message.join("")).toBe("did {thing}");
    expect(record?.properties.args).toEqual([{ extra: 1 }]);
  });

  it("attaches a non-string first arg as structured args", () => {
    createInngestLogger().error({ code: "E_BOOM", detail: "x" });
    const record = recorder.records[0];
    expect(record?.level).toBe("error");
    expect(record?.properties.args).toEqual([{ code: "E_BOOM", detail: "x" }]);
  });
});
