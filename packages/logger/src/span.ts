// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

type Attributes = Record<string, string | number | boolean | undefined>;

/**
 * Runs `run` in a child span of whatever is active. Only the OpenTelemetry API
 * is imported, which does nothing until a tracer is registered, so this is safe
 * in code that is also reachable from the browser bundle (`tracing.server` is
 * not). A throw is recorded on the span and rethrown; `run` gets the span to
 * mark a failure it returns instead of throwing.
 */
export function inSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>
): Promise<T> {
  return trace
    .getTracer("carbon")
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await run(span);
      } catch (error) {
        failSpan(span, error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        span.end();
      }
    });
}

export function failSpan(span: Span, message: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}
