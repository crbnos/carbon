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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("records each middleware's own time on the request span, not what runs after it", async () => {
  const { routerInstrumentation, timedMiddleware } = await import(
    "./tracing.server"
  );

  type Handle = () => Promise<{ error?: Error }>;
  let request: (handle: Handle, info: never) => Promise<void> = async () =>
    undefined;
  routerInstrumentation(provider.getTracer("test")).handler?.({
    instrument: (handlers: { request?: typeof request }) => {
      if (handlers.request) request = handlers.request;
    }
  } as never);

  const [slow, quick] = timedMiddleware<Response>({
    // 30 ms of its own before the rest of the request, which takes 60 ms.
    slow: async (_args, next) => {
      await sleep(30);
      return next();
    },
    quick: (_args, next) => next()
  });

  await request(
    async () => {
      await slow?.({} as never, () =>
        Promise.resolve(
          quick?.({} as never, async () => {
            await sleep(60);
            return new Response();
          }) as Response
        )
      );
      return {};
    },
    { request: { method: "GET", url: "http://erp.test/x" } } as never
  );

  const spans = exporter.getFinishedSpans();
  expect(spans.map((span) => span.name)).toEqual(["GET"]);
  const attributes = spans[0]?.attributes ?? {};
  const slowMs = attributes["carbon.middleware.slow.ms"] as number;
  const quickMs = attributes["carbon.middleware.quick.ms"] as number;
  expect(slowMs).toBeGreaterThanOrEqual(25);
  expect(slowMs).toBeLessThan(55);
  expect(quickMs).toBeLessThan(10);
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
