// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirectBeforeLoaders } from "@carbon/utils";
import {
  createStaticHandler,
  type LoaderFunctionArgs,
  RouterContextProvider,
  redirect
} from "react-router";
import { describe, expect, it, vi } from "vitest";

// The shape of every entity page: a layout with a loader and an action, and an
// index route that only redirects to the details child.
function entityRoutes() {
  const layoutLoader = vi.fn(async () => ({ entity: true }));
  const layoutAction = vi.fn(async () => ({ saved: true }));
  const indexLoader = ({ params }: LoaderFunctionArgs) => {
    throw redirect(`/x/issue/${params.id}/details`);
  };
  const handler = createStaticHandler([
    {
      id: "layout",
      path: "/x/issue/:id",
      loader: layoutLoader,
      action: layoutAction,
      children: [
        {
          id: "index",
          index: true,
          loader: indexLoader,
          middleware: [redirectBeforeLoaders(indexLoader)]
        },
        { id: "details", path: "details", loader: async () => ({}) }
      ]
    }
  ]);
  const run = async (request: Request) => {
    const result = await handler.query(request, {
      requestContext: new RouterContextProvider(),
      generateMiddlewareResponse: async (query) => {
        const inner = await query(request);
        return inner instanceof Response ? inner : new Response("rendered");
      }
    });
    return result as Response;
  };
  return { layoutAction, layoutLoader, run };
}

describe("redirectBeforeLoaders", () => {
  it("redirects a GET of the bare URL without running the layout loader", async () => {
    const { layoutLoader, run } = entityRoutes();
    const response = await run(new Request("http://erp/x/issue/nc_1"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/x/issue/nc_1/details");
    expect(layoutLoader).not.toHaveBeenCalled();
  });

  it("lets a POST to the bare URL reach the layout's action", async () => {
    const { layoutAction, run } = entityRoutes();
    await run(
      new Request("http://erp/x/issue/nc_1", { body: "a=1", method: "POST" })
    );
    expect(layoutAction).toHaveBeenCalledTimes(1);
  });

  it("honours a loader that returns its redirect instead of throwing it", async () => {
    const parentLoader = vi.fn(async () => ({}));
    const indexLoader = () => redirect("/x/operations");
    const handler = createStaticHandler([
      {
        id: "shell",
        path: "/x",
        loader: parentLoader,
        children: [
          {
            id: "index",
            index: true,
            loader: indexLoader,
            middleware: [redirectBeforeLoaders(indexLoader)]
          }
        ]
      }
    ]);
    const request = new Request("http://mes/x");
    const response = (await handler.query(request, {
      requestContext: new RouterContextProvider(),
      generateMiddlewareResponse: async (query) => {
        const inner = await query(request);
        return inner instanceof Response ? inner : new Response("rendered");
      }
    })) as Response;
    expect(response.headers.get("Location")).toBe("/x/operations");
    expect(parentLoader).not.toHaveBeenCalled();
  });

  it("leaves the details URL alone", async () => {
    const { layoutLoader, run } = entityRoutes();
    const response = await run(new Request("http://erp/x/issue/nc_1/details"));
    expect(response.status).toBe(200);
    expect(layoutLoader).toHaveBeenCalledTimes(1);
  });
});
