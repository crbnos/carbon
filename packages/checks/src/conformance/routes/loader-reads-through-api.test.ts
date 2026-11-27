// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loaderReadsThroughApi } from "./loader-reads-through-api";

const sales = {
  server: {
    file: "apps/erp/app/modules/sales/sales.server.ts",
    contents: `export const getCustomer = defineServiceFn({
  async run(ctx, input) {
    return unwrap(ctx, await service.getCustomer(ctx.asCaller.supabase, input.customerId));
  }
});`
  },
  service: { file: "apps/erp/app/modules/sales/sales.service.ts", contents: "" }
};
const ROUTE = "apps/erp/app/routes/x+/customer+/$customerId.tsx";
const findLoader = (contents: string, file = ROUTE) =>
  loaderReadsThroughApi.find({
    routes: [{ file, contents }],
    modules: [sales]
  });
const scanLoader = (contents: string, file = ROUTE) =>
  findLoader(contents, file).map((v) => v.snippet);

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
  it("flags a loader calling a wrapped building block", () => {
    expect(
      scanLoader(route("  const c = await getCustomer(client, id);"))
    ).toEqual(["sales.getCustomer"]);
  });

  it("passes a helper no service function wraps, and the action", () => {
    expect(
      scanLoader(route("  const tz = await getCustomerTimeZone(client);"))
    ).toEqual([]);
  });

  it("passes a loader that reads through the API", () => {
    expect(
      scanLoader(
        route("  const c = await api.sales.getCustomer({ customerId: id });")
      )
    ).toEqual([]);
  });

  it.each([
    ["a side-effect import", 'import "~/styles/print.css";'],
    [
      "a namespace import of a service file",
      'import * as items from "~/modules/items/items.service";'
    ]
  ])("still flags the wrapped call in a route that also has %s", (_, extra) => {
    expect(
      scanLoader(extra + route("  const c = await getCustomer(client, id);"))
    ).toEqual(["sales.getCustomer"]);
  });

  it("flags a wrapped building block called through a namespace import, at the line of the call", () => {
    const contents = `import * as sales from "~/modules/sales/sales.service";
export async function loader({ request }) {
  const c = await sales.getCustomer(client, id);
}`;
    expect(findLoader(contents).map((v) => [v.line, v.snippet])).toEqual([
      [3, "sales.getCustomer"]
    ]);
  });

  it.each([
    [
      "a helper no service function wraps",
      'import * as sales from "~/modules/sales/sales.service";',
      "sales.getCustomerTimeZone(client)"
    ],
    [
      "a type-only namespace import",
      'import type * as sales from "~/modules/sales/sales.service";',
      "sales.getCustomer(client, id)"
    ],
    [
      "a namespace import of a file that is not a service file",
      'import * as sales from "~/modules/sales/sales.models";',
      "sales.getCustomer(client, id)"
    ]
  ])("passes a call through %s", (_, namespaceImport, call) => {
    expect(scanLoader(namespaceImport + route(`  await ${call};`))).toEqual([]);
  });

  it("passes a route that has no loader", () => {
    expect(
      scanLoader(`import { getCustomer } from "~/modules/sales/sales.service";
export async function action() {
  await getCustomer(client, id);
}`)
    ).toEqual([]);
  });

  it("only scans ERP routes", () => {
    expect(
      scanLoader(
        route("  await getCustomer(client, id);"),
        "apps/mes/app/routes/x.tsx"
      )
    ).toEqual([]);
  });
});
