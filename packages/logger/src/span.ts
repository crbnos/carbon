// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Attributes,
  context,
  createContextKey,
  type Span,
  SpanStatusCode,
  trace
} from "@opentelemetry/api";

/**
 * Spans through the OpenTelemetry API only. The API does nothing until
 * `tracing.server` registers a provider, so all of this is safe in code the
 * browser bundle reaches too, and costs nothing while tracing is off.
 */

/** Where `tracing.server` keeps the request's server span. */
export const REQUEST_SPAN = createContextKey("carbon.request-span");

export const tracer = () => trace.getTracer("carbon");

function requestSpan(): Span | undefined {
  return context.active().getValue(REQUEST_SPAN) as Span | undefined;
}

export function failSpan(span: Span, error: unknown): void {
  const cause = error instanceof Error ? error : new Error(String(error));
  span.recordException(cause);
  span.setStatus({ code: SpanStatusCode.ERROR, message: cause.message });
}

/**
 * Runs `run` in a child span of whatever is active. A throw is recorded on the
 * span and rethrown; `run` gets the span to mark a failure it returns instead.
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      failSpan(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Starts a span and returns what ends it, for a wait someone else's call finishes. */
export function startSpan(name: string, attributes: Attributes): () => void {
  const span = tracer().startSpan(name, { attributes });
  return () => span.end();
}

/** Adds attributes to the request's span. No-op outside a traced request. */
export function annotateRequestSpan(attributes: Attributes): void {
  requestSpan()?.setAttributes(attributes);
}

/** Renames the request's span. Keep it to a bounded set of names. */
export function nameRequestSpan(name: string): void {
  requestSpan()?.updateName(name);
}
