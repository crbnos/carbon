import type { MiddlewareFunction } from "react-router";

/**
 * Sets the headers required for cross-origin isolation on every MES response.
 *
 * `crossOriginIsolated` only becomes `true` when BOTH of these are present, and
 * `SharedArrayBuffer` (used by the occt-import-js WASM worker that parses STEP
 * files in the model viewer) is gated behind cross-origin isolation. Without it
 * the STEP import worker cannot allocate its shared memory and the import hangs
 * at 90%.
 */
export const crossOriginIsolationMiddleware: MiddlewareFunction<
  Response
> = async (_, next) => {
  const response = await next();
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return response;
};
