// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-node";
import { afterAll, expect, it } from "vitest";
import { ensureLoggingConfigured } from "./config.server";
import { getLogger } from "./logger";

const exporter = new InMemorySpanExporter();
new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)]
}).register();
afterAll(() => trace.disable());

it("records an error log as a span, by template, without its values", () => {
  ensureLoggingConfigured({ level: "info", pretty: false });
  const logger = getLogger("erp", "receipts");
  logger.info("Posting {receiptId}", { receiptId: "rec_1" });
  logger.error("Failed to post {receiptId} for {email}", {
    receiptId: "rec_1",
    email: "someone@example.com"
  });

  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.name).toBe("log error");
  expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
  expect(spans[0]?.attributes["log.message"]).toBe(
    "Failed to post {receiptId} for {email}"
  );
  expect(String(spans[0]?.attributes["log.category"])).toContain("receipts");
  expect(JSON.stringify(spans[0]?.attributes)).not.toContain("someone@");
});
