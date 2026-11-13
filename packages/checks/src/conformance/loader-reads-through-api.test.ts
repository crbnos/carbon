// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  loaderReadsThroughApi,
  wrappedBuildingBlocks
} from "./loader-reads-through-api";

const wrapped = wrappedBuildingBlocks([
  {
    file: "apps/erp/app/modules/sales/sales.server.ts",
    contents: `export const getCustomer = defineServiceFn({
  async run(ctx, input) {
    return unwrap(ctx, await service.getCustomer(ctx.asCaller.supabase, input.customerId));
  }
});`
  }
]);
const ROUTE = "apps/erp/app/routes/x+/customer+/$customerId.tsx";
const scan = (contents: string, file = ROUTE) =>
  loaderReadsThroughApi(wrapped)
    .scan(file, contents)
    .map((v) => v.snippet);

const route = (loader: string) => `
import { getCustomer, getCustomerTimeZone } from "~/modules/sales/sales.service";
import type { getCustomerTypes } from "~/modules/sales/sales.service";
export async function loader({ request }) {
${loader}
}
export async function action() {
  await getCustomer(client, id);
}`;

describe("loader-reads-through-api", () => {
  it("reads the wrapped building blocks off the server files", () => {
    expect([...wrapped]).toEqual(["sales.getCustomer"]);
  });

  it("flags a loader calling a wrapped building block", () => {
    expect(scan(route("  const c = await getCustomer(client, id);"))).toEqual([
      "sales.getCustomer"
    ]);
  });

  it("passes a helper no service function wraps, and the action", () => {
    expect(
      scan(route("  const tz = await getCustomerTimeZone(client);"))
    ).toEqual([]);
  });

  it("passes a loader that reads through the API", () => {
    expect(
      scan(
        route("  const c = await api.sales.getCustomer({ customerId: id });")
      )
    ).toEqual([]);
  });

  it("only scans ERP routes", () => {
    expect(
      scan(
        route("  await getCustomer(client, id);"),
        "apps/mes/app/routes/x.tsx"
      )
    ).toEqual([]);
  });
});
