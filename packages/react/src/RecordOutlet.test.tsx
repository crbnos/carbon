// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToStaticMarkup } from "react-dom/server";
import type { RouteObject } from "react-router";
import {
  createStaticHandler,
  createStaticRouter,
  Outlet,
  StaticRouterProvider
} from "react-router";
import { describe, expect, it } from "vitest";
import { routeParamNames, useRecordOutletKey } from "./RecordOutlet";

describe("routeParamNames", () => {
  it("names the record and the page's own params", () => {
    expect(
      routeParamNames("routes/x+/purchase-order+/$orderId.$lineId.details")
    ).toEqual(["orderId", "lineId"]);
  });

  it("leaves out a drawer's param: the page behind it has none of its own", () => {
    expect(routeParamNames("routes/x+/part+/$itemId.purchasing")).toEqual([
      "itemId"
    ]);
  });

  it("is empty for a route with no params, so its outlet never remounts", () => {
    expect(routeParamNames("routes/x+/part+/_layout")).toEqual([]);
  });
});

// Each layout prints the key its outlet would get, then renders the outlet.
function Layout({ name }: { name: string }) {
  const key = useRecordOutletKey();
  return (
    <>
      <i data-layout={name} data-key={key ?? "none"} />
      <Outlet />
    </>
  );
}

// The app's own shape, with the ids flat routes give: a module layout, a
// record layout, a page, a page that is itself a list with a drawer below it,
// and an order whose lines are pages.
const routes: RouteObject[] = [
  {
    id: "routes/x+/part+/_layout",
    path: "/x/part",
    element: <Layout name="module" />,
    children: [
      {
        id: "routes/x+/part+/$itemId",
        path: ":itemId",
        element: <Layout name="record" />,
        children: [
          {
            id: "routes/x+/part+/$itemId.details",
            path: "details",
            element: <b />
          },
          {
            id: "routes/x+/part+/$itemId.purchasing",
            path: "purchasing",
            element: <Layout name="page" />,
            children: [
              {
                id: "routes/x+/part+/$itemId.purchasing.$supplierPartId",
                path: ":supplierPartId",
                element: <b />
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "routes/x+/purchase-order+/$orderId",
    path: "/x/purchase-order/:orderId",
    element: <Layout name="order" />,
    children: [
      {
        id: "routes/x+/purchase-order+/$orderId.$lineId.details",
        path: ":lineId/details",
        element: <b />
      }
    ]
  }
];

async function keysAt(path: string): Promise<Record<string, string>> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error("unexpected redirect");
  const html = renderToStaticMarkup(
    <StaticRouterProvider
      router={createStaticRouter(handler.dataRoutes, context)}
      context={context}
      hydrate={false}
    />
  );
  return Object.fromEntries(
    [...html.matchAll(/data-layout="(\w+)" data-key="([^"]*)"/g)].map(
      (match) => [match[1]!, match[2]!]
    )
  );
}

describe("useRecordOutletKey", () => {
  it("changes with the record, so the record's page remounts", async () => {
    const a = await keysAt("/x/part/A/details");
    const b = await keysAt("/x/part/B/details");
    expect(a.module).toBe("A");
    expect(b.module).toBe("B");
    expect(a.record).toBe("A");
    expect(b.record).toBe("B");
  });

  it("stays the same from one page of a record to another", async () => {
    const details = await keysAt("/x/part/A/details");
    const purchasing = await keysAt("/x/part/A/purchasing");
    // The record layout itself stays mounted; only its outlet's route differs,
    // and React remounts a different element type on its own.
    expect(details.module).toBe(purchasing.module);
    expect(details.record).toBe(purchasing.record);
  });

  it("does not change when a drawer opens over the page", async () => {
    const page = await keysAt("/x/part/A/purchasing");
    const drawer = await keysAt("/x/part/A/purchasing/SP1");
    expect(drawer.module).toBe(page.module);
    expect(drawer.record).toBe(page.record);
  });

  it("changes for the drawer itself when it shows another row", async () => {
    const one = await keysAt("/x/part/A/purchasing/SP1");
    const two = await keysAt("/x/part/A/purchasing/SP2");
    expect(one.page).toBe("A/SP1");
    expect(two.page).toBe("A/SP2");
  });

  it("changes from one line of an order to the next", async () => {
    const one = await keysAt("/x/purchase-order/PO1/L1/details");
    const two = await keysAt("/x/purchase-order/PO1/L2/details");
    expect(one.order).toBe("PO1/L1");
    expect(two.order).toBe("PO1/L2");
  });
});
