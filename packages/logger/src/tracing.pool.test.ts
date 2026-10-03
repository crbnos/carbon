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
new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)]
}).register();

beforeEach(() => exporter.reset());

// The counts a node-postgres pool reports, settable per test.
const fakePool = (state: {
  idleCount: number;
  totalCount: number;
  waitingCount: number;
}) => ({
  ...state,
  options: { max: 2 },
  connect: vi.fn(async (..._args: unknown[]) => "client")
});

it("records a wait only when connect() cannot hand out an idle connection", async () => {
  const { traceConnectionWaits } = await import("./tracing.server");
  const names = () => exporter.getFinishedSpans().map((span) => span.name);

  const idle = traceConnectionWaits(
    fakePool({ idleCount: 1, totalCount: 2, waitingCount: 0 })
  );
  expect(await idle.connect()).toBe("client");
  expect(names()).toEqual([]);

  const opening = traceConnectionWaits(
    fakePool({ idleCount: 0, totalCount: 1, waitingCount: 0 })
  );
  await opening.connect();
  expect(names()).toEqual(["db connect"]);

  // One idle connection, but an earlier caller is already queued for it.
  const full = traceConnectionWaits(
    fakePool({ idleCount: 1, totalCount: 2, waitingCount: 3 })
  );
  await full.connect();
  expect(names()).toEqual(["db connect", "db pool wait"]);
  expect(
    exporter.getFinishedSpans()[1]?.attributes[
      "db.client.connection.pool.waiting"
    ]
  ).toBe(3);

  // pg's own pool.query uses the callback form; it passes straight through.
  const callback = () => undefined;
  await full.connect(callback as never);
  expect(names()).toHaveLength(2);

  // Wrapping twice does not wrap twice.
  expect(traceConnectionWaits(full)).toBe(full);
});
