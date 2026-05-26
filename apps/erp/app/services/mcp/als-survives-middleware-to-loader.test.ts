// Diagnostic: does an AsyncLocalStorage scope opened in a root middleware
// (wrapping next()) survive into a route LOADER under RR 7.12 +
// v8_middleware + the generateMiddlewareResponse server contract? This
// reproduces the exact AuthClientScope failure pattern seen on
// http://localhost:3000/x:
//   "AuthClientScope.setFactory: no client scope in scope"
//
// middleware-runs-for-resource-routes.test.ts only proves RR's `context`
// channel propagates — NOT AsyncLocalStorage. This isolates ALS, using the
// same queryRoute + generateMiddlewareResponse path the real server uses.

import { AsyncLocalStorage } from "node:async_hooks";
import { createStaticHandler, type MiddlewareFunction } from "react-router";
import { describe, expect, it } from "vitest";

const als = new AsyncLocalStorage<{ marker: string }>();

const alsMiddleware: MiddlewareFunction<unknown> = async (_args, next) => {
  // Mirrors AuthClientScope.run(() => { ... return next() })
  return als.run({ marker: "opened-by-middleware" }, () => next());
};

function makeHandler() {
  return createStaticHandler(
    [
      {
        id: "root",
        path: "/",
        middleware: [alsMiddleware],
        children: [
          {
            id: "child",
            // Resource route so we can use queryRoute (mirrors the real
            // server middleware contract). The ALS question is identical
            // for component routes — same callRouteMiddleware/next() chain.
            path: "x",
            loader() {
              // Mirrors x+/_layout.tsx calling AuthClientScope.setFactory()
              const store = als.getStore();
              return Response.json({ alsVisible: store?.marker ?? null });
            }
          }
        ]
      }
    ],
    { future: { v8_middleware: true } }
  );
}

describe("ALS scope: middleware -> loader (RR 7.12)", () => {
  it("is visible inside the loader via generateMiddlewareResponse", async () => {
    const handler = makeHandler();
    const response: Response = await handler.queryRoute(
      new Request("http://localhost/x"),
      {
        generateMiddlewareResponse: async (queryRoute) =>
          queryRoute(new Request("http://localhost/x"))
      }
    );
    const body = (await response.json()) as { alsVisible: string | null };
    // null => ALS does NOT survive the middleware->loader boundary and the
    // AuthClientScope design is structurally broken for routes.
    expect(body.alsVisible).toBe("opened-by-middleware");
  });
});
