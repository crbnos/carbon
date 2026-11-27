// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findNestedOutlets,
  indexRedirectBeforeLoaders,
  loaderReadsThroughApi,
  scanBareOutlets,
  noStateCopyOfLoaderData,
  wrappedBuildingBlocks
} from "./routes";

const INDEX = "apps/erp/app/routes/x+/issue+/$id._index.tsx";
const scanIndexRedirect = (contents: string, file = INDEX) =>
  indexRedirectBeforeLoaders.scan(file, contents);

const REDIRECT_ONLY = `import { redirect } from "react-router";

export async function loader({ params }: LoaderFunctionArgs) {
  throw redirect(path.to.issueDetails(params.id));
}
`;

describe("indexRedirectBeforeLoaders", () => {
  it("flags the shape that ran the issue layout for every hovered link", () => {
    const violations = scanIndexRedirect(REDIRECT_ONLY);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
  });

  it("accepts the route once the redirect is exported as middleware", () => {
    expect(
      scanIndexRedirect(
        `${REDIRECT_ONLY}\nexport const middleware = [redirectBeforeLoaders(loader)];\n`
      )
    ).toEqual([]);
  });

  it("covers a module root and a const loader that returns its redirect", () => {
    expect(
      scanIndexRedirect(
        `export const loader: LoaderFunction = async () => {\n  return redirect(path.to.operations);\n};\n`,
        "apps/mes/app/routes/x+/_index.tsx"
      )
    ).toHaveLength(1);
  });

  it("ignores an index route that renders a page", () => {
    expect(
      scanIndexRedirect(
        `${REDIRECT_ONLY}\nexport default function Page() {\n  return null;\n}\n`
      )
    ).toEqual([]);
  });

  it("ignores a resource route, and any file that is not an index route", () => {
    expect(
      scanIndexRedirect(
        `export async function loader() {\n  return { ok: true };\n}\n`
      )
    ).toEqual([]);
    expect(
      scanIndexRedirect(REDIRECT_ONLY, "apps/erp/app/routes/x+/issue+/$id.tsx")
    ).toEqual([]);
  });

  it("is not satisfied by a middleware export that does something else", () => {
    expect(
      scanIndexRedirect(
        `${REDIRECT_ONLY}\nexport const middleware = [authMiddleware];\n`
      )
    ).toHaveLength(1);
  });
});

const scanStateCopy = (contents: string) =>
  noStateCopyOfLoaderData.scan("apps/erp/app/routes/x+/thing.tsx", contents);

describe("noStateCopyOfLoaderData", () => {
  it("flags state seeded from loader data, directly or in an initialiser", () => {
    expect(
      scanStateCopy(
        `const { rows, total: count } = useLoaderData<typeof loader>();\nconst [list, setList] = useState(rows);\nconst [n] = useState<number>(() => count + 1);\n`
      ).map((v) => v.line)
    ).toEqual([2, 3]);
  });

  it("flags state seeded from route data", () => {
    const violations = scanStateCopy(
      `const routeData = useRouteData<{ lines: Line[] }>(path.to.quote(id));\nconst [selected, setSelected] = useState(() =>\n  routeData?.lines.reduce(toSelection, {})\n);\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("routeData");
  });

  it("accepts state that does not read the loaded data", () => {
    expect(
      scanStateCopy(
        `const { rows } = useLoaderData<typeof loader>();\nconst [open, setOpen] = useState(false);\nconst [picks, setPicks] = useState<Record<string, number>>({});\nconst [draft, setDraft] = useState({ rows: [] });\nconst total = useMemo(() => sum(rows), [rows]);\n`
      )
    ).toEqual([]);
  });

  it("does not take a property of the same name for the data", () => {
    expect(
      scanStateCopy(
        `const { rows } = useLoaderData<typeof loader>();\nconst [view, setView] = useState(settings.rows);\n`
      )
    ).toEqual([]);
  });

  it("ignores a file that loads nothing", () => {
    expect(
      scanStateCopy(`const [list, setList] = useState(props.rows);\n`)
    ).toEqual([]);
  });

  it("reads only .tsx files", () => {
    expect(
      noStateCopyOfLoaderData.scan(
        "apps/erp/app/hooks/useThing.ts",
        `const { rows } = useLoaderData<typeof loader>();\nconst [list, setList] = useState(rows);\n`
      )
    ).toEqual([]);
  });
});

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
const scanLoader = (contents: string, file = ROUTE) =>
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
    expect(
      loaderReadsThroughApi(wrapped)
        .scan(ROUTE, contents)
        .map((v) => [v.line, v.snippet])
    ).toEqual([[3, "sales.getCustomer"]]);
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

const scanOutlet = (
  contents: string,
  file = "apps/erp/app/routes/x+/part+/$itemId.tsx"
) => scanBareOutlets(file, contents);

describe("noBareOutlet", () => {
  it("flags a plain outlet in a route under /x, in either app", () => {
    expect(scanOutlet("  return <Outlet />;\n")).toHaveLength(1);
    expect(
      scanOutlet(
        "<div>\n  <Outlet context={ctx} />\n</div>\n",
        "apps/mes/app/routes/x+/picking.tsx"
      )[0]!.line
    ).toBe(2);
  });

  it("accepts the record outlet, a keyed outlet and a mention in a comment", () => {
    expect(scanOutlet("  return <RecordOutlet />;\n")).toEqual([]);
    expect(scanOutlet("  <Outlet key={companyId} />\n")).toEqual([]);
    expect(
      scanOutlet("  // No <Outlet /> here: the detail is a full page\n")
    ).toEqual([]);
  });

  it("leaves routes outside /x and components alone", () => {
    expect(
      scanOutlet("<Outlet />", "apps/erp/app/routes/_public+/_layout.tsx")
    ).toEqual([]);
    expect(
      scanOutlet(
        "<Outlet />",
        "apps/erp/app/modules/items/ui/Item/SupplierParts.tsx"
      )
    ).toEqual([]);
  });
});

describe("findNestedOutlets", () => {
  const TABLE = "apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysTable.tsx";
  const ROUTE = "apps/erp/app/routes/x+/settings+/api-keys.tsx";
  const file = (path: string, ...lines: string[]) => ({
    file: path,
    contents: `${lines.join("\n")}\n`
  });
  const table = file(TABLE, "<>", "  <Table />", "  <Outlet />", "</>");
  const where = (files: ReturnType<typeof file>[]) =>
    findNestedOutlets(files).map(({ file, line, snippet }) => ({
      file,
      line,
      snippet
    }));

  it("flags a route that renders its own outlet and a table that renders another", () => {
    const route = file(
      ROUTE,
      'import { ApiKeysTable } from "~/modules/settings/ui";',
      "<>",
      "  <ApiKeysTable data={data} />",
      "  <RecordOutlet />",
      "</>"
    );
    expect(where([table, route])).toEqual([
      { file: ROUTE, line: 3, snippet: "<ApiKeysTable data={data} />" }
    ]);
  });

  it("follows a component that renders the table", () => {
    const overlay = file(
      "apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysUpgradeOverlay.tsx",
      'import ApiKeysTable from "./ApiKeysTable";',
      "<ApiKeysTable data={mock} />"
    );
    const route = file(
      ROUTE,
      'import ApiKeysUpgradeOverlay from "~/modules/settings/ui/ApiKeys/ApiKeysUpgradeOverlay";',
      "if (gated) return <ApiKeysUpgradeOverlay />;",
      "<RecordOutlet />"
    );
    expect(where([table, overlay, route])).toEqual([
      {
        file: ROUTE,
        line: 2,
        snippet: "if (gated) return <ApiKeysUpgradeOverlay />;"
      }
    ]);
  });

  it("accepts a single outlet, in the route or in the table", () => {
    const imports =
      'import ApiKeysTable from "~/modules/settings/ui/ApiKeys/ApiKeysTable";';
    expect(
      where([
        file(TABLE, "<Table />"),
        file(ROUTE, imports, "<ApiKeysTable />", "<RecordOutlet />")
      ])
    ).toEqual([]);
    expect(where([table, file(ROUTE, imports, "<ApiKeysTable />")])).toEqual(
      []
    );
  });

  it("does not take another file's component of the same name for the table", () => {
    const itemSupplierParts = file(
      "apps/erp/app/modules/items/ui/Item/SupplierParts/SupplierParts.tsx",
      "<Grid />",
      "<Outlet />"
    );
    const route = file(
      "apps/erp/app/routes/x+/supplier+/$supplierId.parts.tsx",
      'import SupplierParts from "~/modules/purchasing/ui/Supplier/SupplierParts";',
      "<SupplierParts />",
      "<RecordOutlet />"
    );
    expect(where([itemSupplierParts, route])).toEqual([]);
  });

  it("does not take another export of the component's file for the component", () => {
    const panel = file(
      "apps/erp/app/components/Panel/Panel.tsx",
      "export const PanelHeader = () => <h2 />;",
      "export default function Panel() { return <Outlet />; }"
    );
    const route = file(
      ROUTE,
      'import { PanelHeader } from "~/components/Panel/Panel";',
      "<PanelHeader />",
      "<RecordOutlet />"
    );
    expect(where([panel, route])).toEqual([]);
  });

  it("follows a default import through a folder's index", () => {
    const panel = file(
      "apps/erp/app/components/Panel/Panel.tsx",
      "<Card />",
      "<Outlet />"
    );
    const route = file(
      ROUTE,
      'import Panel from "~/components/Panel";',
      "<Panel />",
      "<RecordOutlet />"
    );
    expect(where([panel, route])).toEqual([
      { file: ROUTE, line: 2, snippet: "<Panel />" }
    ]);
  });

  it("does not take a type argument for a render when following components", () => {
    const columns = file(
      "apps/erp/app/modules/settings/ui/ApiKeys/ApiKeysColumns.tsx",
      'import ApiKeysTable from "./ApiKeysTable";',
      "const columns = useColumns<ApiKeysTable>();"
    );
    const route = file(
      ROUTE,
      'import ApiKeysColumns from "~/modules/settings/ui/ApiKeys/ApiKeysColumns";',
      "<ApiKeysColumns />",
      "<RecordOutlet />"
    );
    expect(where([table, columns, route])).toEqual([]);
  });

  it("leaves an app other than erp and mes alone", () => {
    const layout = file(
      "apps/academy/app/components/Layout.tsx",
      "<Header />",
      "<Outlet />"
    );
    const lesson = file(
      "apps/academy/app/routes/lesson.tsx",
      'import Layout from "../components/Layout";',
      "<Layout />",
      "<Outlet />"
    );
    expect(where([layout, lesson])).toEqual([]);
  });

  it("ignores type arguments and comments", () => {
    const route = file(
      ROUTE,
      'import { ApiKeysTable } from "~/modules/settings/ui";',
      "useColumns<ApiKeysTable>();",
      "// <ApiKeysTable /> renders the list",
      "<RecordOutlet />"
    );
    expect(where([table, route])).toEqual([]);
  });
});
