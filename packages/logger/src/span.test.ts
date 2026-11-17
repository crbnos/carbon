// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { failSpan, withSpan } from "./span";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)]
});
provider.register();

beforeEach(() => exporter.reset());
afterAll(() => trace.disable());

describe("withSpan", () => {
  it("records a span around the work, nested under the active one", async () => {
    const result = await withSpan(
      "function outer",
      { "carbon.function": "outer" },
      () => withSpan("function inner", {}, async () => 42)
    );
    expect(result).toBe(42);
    const [inner, outer] = exporter.getFinishedSpans();
    expect(outer?.name).toBe("function outer");
    expect(outer?.attributes["carbon.function"]).toBe("outer");
    expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
  });

  it("marks a throw as an error and rethrows it", async () => {
    await expect(
      withSpan("function boom", {}, async () => {
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "nope"
    });
  });

  it("lets the work mark a failure it returns instead of throwing", async () => {
    await withSpan("function refused", {}, async (span) => {
      failSpan(span, "database unavailable");
      return { error: true };
    });
    expect(exporter.getFinishedSpans()[0]?.status.code).toBe(
      SpanStatusCode.ERROR
    );
  });
});
