// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-node";
import { beforeEach, expect, it, vi } from "vitest";

// Tracing is decided when the module loads, and the global provider registers once.
vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)]
});
provider.register();

beforeEach(() => exporter.reset());

it("names each middleware span after its function", async () => {
  const { namedMiddleware, routerInstrumentation } = await import(
    "./tracing.server"
  );

  type Handler = () => Promise<{ error?: Error }>;
  let wrap: (call: Handler, info: never) => Promise<void> = async () =>
    undefined;
  routerInstrumentation(provider.getTracer("test")).route?.({
    id: "root",
    instrument: (handlers: { middleware?: typeof wrap }) => {
      if (handlers.middleware) wrap = handlers.middleware;
    }
  } as never);

  const requestIdMiddleware = async () => undefined;
  const flashMiddleware = async () => undefined;
  for (const run of namedMiddleware([requestIdMiddleware, flashMiddleware])) {
    await wrap(
      async () => {
        await run();
        return {};
      },
      { request: { method: "GET" }, pattern: "x" } as never
    );
  }

  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
    "middleware requestIdMiddleware",
    "middleware flashMiddleware"
  ]);
});

it("wraps a call in a span and marks it failed when the call throws", async () => {
  const { withSpan } = await import("./tracing.server");

  const attributes = { "carbon.operation": "sales_getCustomers" };
  await expect(
    withSpan("operation sales_getCustomers", attributes, async () => 1)
  ).resolves.toBe(1);
  await expect(
    withSpan("operation sales_getCustomers", attributes, async () => {
      throw new Error("denied");
    })
  ).rejects.toThrow("denied");

  const [ok, failed] = exporter.getFinishedSpans();
  expect(ok?.name).toBe("operation sales_getCustomers");
  expect(ok?.attributes).toEqual(attributes);
  expect(failed?.status).toEqual({ code: 2, message: "denied" });
});

it("names the request span after what a shared route served", async () => {
  const { nameRequestSpan, routerInstrumentation } = await import(
    "./tracing.server"
  );

  type Handle = () => Promise<{ error?: Error }>;
  let wrap: (handle: Handle, info: never) => Promise<void> = async () =>
    undefined;
  routerInstrumentation(provider.getTracer("test")).handler?.({
    instrument: (handlers: { request?: typeof wrap }) => {
      if (handlers.request) wrap = handlers.request;
    }
  } as never);

  await wrap(
    async () => {
      nameRequestSpan("POST /api/inngest carbon-event-queue");
      return {};
    },
    {
      request: new Request("http://localhost/api/inngest", { method: "POST" })
    } as never
  );

  expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
    "POST /api/inngest carbon-event-queue"
  ]);
});
