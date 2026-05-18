// Step 2 foundation check (technical issue #3): the entire "auth context is
// established in root middleware, including for the MCP route" design depends
// on React Router root `middleware` running for RESOURCE routes (loader/
// action only, no Component — e.g. `api+/mcp+/_index.ts`).
//
// CRITICAL FINDING (encoded by this test): in RR 7.12, `staticHandler
// .queryRoute()` only runs the middleware chain when called WITH a
// `generateMiddlewareResponse` callback (the callback runs middleware, then
// invokes the inner queryRoute). This mirrors RR's own server handler. The
// real server passes it because `v8_middleware` is on; any custom invocation
// of queryRoute for resource routes MUST do the same or middleware silently
// does not run. This is the implementation contract Step 2 must honour.

import {
  createContext,
  createStaticHandler,
  type MiddlewareFunction
} from "react-router";
import { describe, expect, it } from "vitest";

const marker = createContext<string | null>(null);

const rootMiddleware: MiddlewareFunction<Response> = async (
  { context },
  next
) => {
  context.set(marker, "set-by-root-middleware");
  return next();
};

function makeHandler(kind: "loader" | "action") {
  return createStaticHandler(
    [
      {
        id: "root",
        path: "/",
        middleware: [rootMiddleware],
        children: [
          {
            id: "mcp",
            // Resource route: handler only, NO Component — mirrors
            // apps/erp/app/routes/api+/mcp+/_index.ts
            path: "api/mcp",
            [kind]({ context }: { context: { get: typeof marker } }) {
              return Response.json({
                // @ts-expect-error context.get is the RR runtime API
                sawMiddleware: context.get(marker)
              });
            }
          }
        ]
      }
    ],
    { future: { v8_middleware: true } }
  );
}

describe("RR 7.12 root middleware runs for resource routes (Step 2 #3)", () => {
  it("runs root middleware before a resource-route LOADER (GET)", async () => {
    const handler = makeHandler("loader");
    // Mirror the real RR server: pass generateMiddlewareResponse so the
    // middleware chain executes, then the inner queryRoute runs.
    const response: Response = await handler.queryRoute(
      new Request("http://localhost/api/mcp"),
      {
        generateMiddlewareResponse: async (queryRoute) =>
          queryRoute(new Request("http://localhost/api/mcp"))
      }
    );
    expect(response).toBeInstanceOf(Response);
    const body = await response.json();
    // The assertion that validates the entire Step 2 design:
    expect(body.sawMiddleware).toBe("set-by-root-middleware");
  });

  it("runs root middleware before a resource-route ACTION (POST, like MCP)", async () => {
    const handler = makeHandler("action");
    const response: Response = await handler.queryRoute(
      new Request("http://localhost/api/mcp", { method: "POST" }),
      {
        generateMiddlewareResponse: async (queryRoute) =>
          queryRoute(
            new Request("http://localhost/api/mcp", { method: "POST" })
          )
      }
    );
    const body = await response.json();
    expect(body.sawMiddleware).toBe("set-by-root-middleware");
  });

  it("WITHOUT generateMiddlewareResponse, middleware does NOT run (documents the contract)", async () => {
    const handler = makeHandler("loader");
    const response: Response = await handler.queryRoute(
      new Request("http://localhost/api/mcp")
    );
    const body = await response.json();
    // Proves Step 2 must wire generateMiddlewareResponse for resource routes;
    // the real server already does (v8_middleware on), but any custom path
    // must too.
    expect(body.sawMiddleware).toBeNull();
  });
});
