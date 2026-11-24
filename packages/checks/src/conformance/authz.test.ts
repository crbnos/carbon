// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import { describe, expect, it } from "vitest";
import { migrationsDir, repoRoot } from "../sources/migrations";
import {
  edgeFunctionAuthorizesCaller,
  findMovedTableGaps,
  findRoutePageGaps,
  findStaleRegistryHelpers,
  GENERATED_AUTHZ_MIGRATION,
  gateConstants,
  LAST_MODULE_KEY_MIGRATION,
  listGates,
  livePolicies,
  MODULE_KEY_MIGRATIONS,
  type MovedTablesRegistry,
  noAuthzDdlInMigrations,
  noLegacyRls,
  noModulePermissionKey,
  REGISTRY_HELPERS_FIX,
  type RouteRegistry,
  routeGateNamesPage
} from "./authz";

const DIR = "packages/database/supabase/functions";

describe("edgeFunctionAuthorizesCaller", () => {
  it("flags a function with no in-function auth", () => {
    const ts =
      'serve(async (req) => jsonResponse(await db.selectFrom("job")));';
    const v = edgeFunctionAuthorizesCaller.scan(`${DIR}/post-picking`, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("post-picking");
  });

  it.each(["await requireCaller(req);", "requireServiceRole(req);"])(
    "accepts %s",
    (ts) => {
      expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
    }
  );

  it("does not accept a gate that is only declared", () => {
    const ts =
      "async function requireCaller(req: Request): Promise<void> {}\nDeno.serve(() => ok());";
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });

  it("accepts a declared gate that is also called", () => {
    const ts =
      "async function requireServiceRole(req: Request) {}\nawait requireServiceRole(req);";
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
  });
});

const rendered = [
  { name: "util.module_pages.sql", sql: "-- pages v2\n" },
  { name: "util.page_max_level.sql", sql: "-- levels\n" }
];
const at = (name: string) => `${REGISTRY_HELPERS_DIR}/${name}`;

describe("findStaleRegistryHelpers", () => {
  it("passes files that hold what the registry renders", () => {
    expect(
      findStaleRegistryHelpers(rendered, [
        { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
        { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
      ])
    ).toEqual([]);
  });

  it("fails a stale file and names the sync command", () => {
    const violations = findStaleRegistryHelpers(rendered, [
      { file: at("util.module_pages.sql"), contents: "-- pages v1\n" },
      { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(at("util.module_pages.sql"));
    expect(violations[0]?.message).toContain("stale");
    expect(violations[0]?.message).toContain(REGISTRY_HELPERS_FIX);
  });

  it("fails a missing file", () => {
    const violations = findStaleRegistryHelpers(rendered, [
      { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
      { file: at("util.page_max_level.sql"), contents: undefined }
    ]);
    expect(violations.map((v) => v.file)).toEqual([
      at("util.page_max_level.sql")
    ]);
    expect(violations[0]?.message).toContain("missing");
  });
});

const ddlCheck = noAuthzDdlInMigrations([
  {
    schema: "public",
    name: "get_companies_with_employee_role",
    file: "packages/database/src/authz/helpers/get_companies_with_employee_role.sql",
    since: "20260927000000"
  },
  {
    schema: "public",
    name: "dispatch_event_batch",
    file: "packages/database/src/event-system/functions/dispatch_event_batch.sql",
    since: "20261002114954"
  },
  {
    schema: "util",
    name: "wake_event_queue",
    file: "packages/database/src/event-system/functions/util.wake_event_queue.sql",
    since: "20261002114954"
  }
]);
const NEW = "20260928120000_widget.sql";
const AFTER_EVENT_TAKEOVER = "20261003120000_widget.sql";

describe("noAuthzDdlInMigrations", () => {
  it("flags CREATE POLICY and ALTER POLICY in a new migration", () => {
    const sql = `CREATE POLICY "SELECT" ON "public"."widget" FOR SELECT USING (true);
ALTER POLICY "SELECT" ON "public"."widget" USING (false);`;
    expect(ddlCheck.scan(NEW, sql).map((v) => v.line)).toEqual([1, 2]);
  });

  it("flags a policy whose target is on the next line, at the CREATE line", () => {
    const sql = `SELECT 1;\nCREATE POLICY "SELECT"\n  ON widget FOR SELECT USING (true);`;
    expect(ddlCheck.scan(NEW, sql).map((v) => v.line)).toEqual([2]);
  });

  it("allows policies outside public (storage buckets are not in the manifest)", () => {
    const sql = `CREATE POLICY "Bucket read" ON storage.objects FOR SELECT USING (true);
CREATE POLICY "x" ON "storage"."objects" FOR INSERT WITH CHECK (true);`;
    expect(ddlCheck.scan(NEW, sql)).toEqual([]);
  });

  it("flags a policy on realtime.messages (broadcast authorization is in the manifest)", () => {
    const sql = `CREATE POLICY "company topic" ON realtime.messages FOR SELECT USING (true);`;
    expect(ddlCheck.scan(NEW, sql)).toHaveLength(1);
  });

  it("flags a call that attaches event triggers (they are declared in attachments.ts)", () => {
    const sql = `SELECT attach_event_trigger('widget', ARRAY['sync_widget']::TEXT[]);
SELECT attach_statement_handler('widget', ARRAY['broadcast_table_changes']);
SELECT set_event_triggers('widget');`;
    expect(ddlCheck.scan("20261101120000_widget.sql", sql)).toHaveLength(3);
    expect(ddlCheck.scan("20261004194526_before.sql", sql)).toEqual([]);
  });

  it("allows DROP POLICY (needed before dropping a column a policy uses)", () => {
    expect(
      ddlCheck.scan(NEW, `DROP POLICY "SELECT" ON "public"."widget";`)
    ).toEqual([]);
  });

  it("flags defining, altering or dropping a managed helper, however it is spelled", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.get_companies_with_employee_role() RETURNS text[] AS $$ $$;
ALTER FUNCTION "public"."get_companies_with_employee_role"() VOLATILE;
DROP FUNCTION IF EXISTS get_companies_with_employee_role();`;
    expect(ddlCheck.scan(NEW, sql)).toHaveLength(3);
  });

  it("flags an event-system function, in public or util, after its takeover", () => {
    const sql = `CREATE OR REPLACE FUNCTION public.dispatch_event_batch() RETURNS trigger AS $$ $$;
CREATE OR REPLACE FUNCTION util.wake_event_queue() RETURNS void AS $$ $$;`;
    const found = ddlCheck.scan(AFTER_EVENT_TAKEOVER, sql);
    expect(found.map((v) => v.line)).toEqual([1, 2]);
    expect(found[1]?.message).toContain("util.wake_event_queue.sql");
  });

  it("leaves event-system migrations from before the takeover as history", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION public.dispatch_event_batch() RETURNS trigger AS $$ $$;";
    expect(
      ddlCheck.scan(
        "20261001195204_event-dispatch-skip-unchanged-updates.sql",
        sql
      )
    ).toEqual([]);
  });

  it("tells a managed function from its namesake in another schema", () => {
    expect(
      ddlCheck.scan(
        AFTER_EVENT_TAKEOVER,
        "CREATE OR REPLACE FUNCTION public.wake_event_queue() RETURNS void AS $$ $$;"
      )
    ).toEqual([]);
  });

  it("allows any other function", () => {
    expect(
      ddlCheck.scan(
        NEW,
        "CREATE OR REPLACE FUNCTION public.get_part_details() RETURNS void AS $$ $$;"
      )
    ).toEqual([]);
  });

  it("exempts only the exact header `authz migration` writes", () => {
    const source = readFileSync(
      join(repoRoot(), "packages/database/src/authz/migration.ts"),
      "utf8"
    );
    expect(source).toContain(JSON.stringify(GENERATED_AUTHZ_MIGRATION));
    const edited = GENERATED_AUTHZ_MIGRATION.replace("Do not edit.", "Edited.");
    expect(
      ddlCheck.scan(
        NEW,
        `${edited}\nCREATE POLICY "SELECT" ON public.widget FOR SELECT USING (true);`
      )
    ).toHaveLength(1);
  });

  it("allows a migration rendered by `authz migration`", () => {
    const sql = `-- Generated by \`pnpm --filter @carbon/database authz migration\` from packages/database/src/authz. Do not edit.
CREATE POLICY "SELECT" ON public.widget FOR SELECT USING (true);`;
    expect(ddlCheck.scan(NEW, sql)).toEqual([]);
  });

  it("ignores migrations from before the manifest took over, and comments", () => {
    const sql = `CREATE POLICY "SELECT" ON t FOR SELECT USING (true);`;
    expect(ddlCheck.scan("20260926141957_employee-pin.sql", sql)).toEqual([]);
    expect(ddlCheck.scan(NEW, `-- CREATE POLICY "x" ON t`)).toEqual([]);
  });
});

describe("noLegacyRls", () => {
  it("flags has_company_permission(...)", () => {
    const sql =
      'CREATE POLICY "p" ON "t" USING (has_company_permission(\'view\', "companyId"));';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("allows the current get_companies_with_employee_permission helper", () => {
    const sql =
      'CREATE POLICY "p" ON "t" USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(\'view\'))::text[]));';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(0);
  });

  it("leaves the helper's own definition and a comment alone", () => {
    const sql = [
      "-- has_company_permission('view', \"companyId\")",
      "CREATE FUNCTION has_company_permission(claim text, company text) RETURNS bool LANGUAGE sql AS $$ SELECT true $$;"
    ].join("\n");
    expect(noLegacyRls.scan("p.sql", sql)).toHaveLength(0);
  });

  it("flags a call inside a function body", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS bool LANGUAGE plpgsql AS $$",
      "BEGIN",
      "  RETURN has_company_permission('view', 'c');",
      "END $$;"
    ].join("\n");
    expect(noLegacyRls.scan("p.sql", sql).map((v) => v.line)).toEqual([3]);
  });
  it("leaves a generated authz migration alone: it holds the helper's own policies", () => {
    const sql = `${GENERATED_AUTHZ_MIGRATION}\nCREATE POLICY "p" ON "t" USING (has_company_permission('view', "companyId"));`;
    expect(noLegacyRls.scan("p.sql", sql)).toHaveLength(0);
  });
});

const ROUTE = "apps/erp/app/routes/x+/inventory+/receipts.tsx";

const scanKeys = (contents: string, file = ROUTE) =>
  noModulePermissionKey.scan(file, contents).map((v) => v.snippet);

describe("no-module-permission-key — TypeScript", () => {
  it("flags a module key string", () => {
    expect(scanKeys(`holds(claims, "inventory_view", companyId);`)).toEqual([
      '"inventory_view"'
    ]);
  });

  it("flags a gate keyed by a module, in each gate shape", () => {
    expect(
      scanKeys(`await authorize(request, { inventory: "Edit" });`)
    ).toEqual(["inventory:"]);
    expect(
      scanKeys(`await authorize(request, { view: "inventory" });`)
    ).toEqual(['"inventory"']);
    expect(scanKeys(`permissions.has({ "sales": "View" })`)).toEqual([
      '"sales":'
    ]);
    expect(
      scanKeys(
        `hasPermission(claims.permissions, "sales", "update", companyId)`
      )
    ).toEqual(['"sales"']);
    expect(
      scanKeys(
        `export const x = defineServiceFn({\n  permission: { parts: "Edit" },\n  run() {}\n});`
      )
    ).toEqual(["parts:"]);
  });

  it("flags a workflow catalog permission naming a module", () => {
    const file = "packages/ee/src/workflows/catalog/actions.ts";
    expect(
      scanKeys(`permission: { module: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
    expect(
      scanKeys(`permission: { page: "production", action: "create" },`, file)
    ).toEqual(['"production"']);
  });

  it("passes page keys, page gates and the rules that are not gates", () => {
    expect(
      scanKeys(
        [
          `await authorize(request, { "inventory.receipts": "Edit" });`,
          `permissions.has({ "sales.quotes": "Edit" });`,
          `await authorize(request, anyOf(pagesOf("sales"), "View"));`,
          `holds(claims, "inventory.receipts_update", companyId);`,
          `permission: { page: "production.jobs", action: "create" },`,
          `permission: "employee",`,
          `permission: anyOfRule("item", "Edit"),`,
          `permissions.has({ documents: "View" });`,
          `const key = "documents_view";`,
          `columnCaps={{ accounting: "Edit" }}`
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("ignores comments", () => {
    expect(
      scanKeys(
        `// the old gate was { view: "sales" } and "sales_view"\nconst a = 1;`
      )
    ).toEqual([]);
  });

  it("skips a portal rule's own key, and scans the rest of the manifest", () => {
    expect(
      scanKeys(
        `widget: company({ read: or(portal.customer("customerId", "sales_view"), "inventory_view") }),`,
        "packages/database/src/authz/manifest.ts"
      )
    ).toEqual(['"inventory_view"']);
  });
});

describe("no-module-permission-key — SQL", () => {
  const after = `${String(Number(LAST_MODULE_KEY_MIGRATION) + 1)}_x.sql`;

  it("leaves the migrations that existed at the cutoff alone", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        `${LAST_MODULE_KEY_MIGRATION}_module-keys-to-pages.sql`
      )
    ).toEqual([]);
  });

  // An open branch can land a migration dated before the cutoff after it.
  it("flags a migration dated before the cutoff that was not there at the cutoff", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        "packages/database/supabase/migrations/20261001120000_late-branch.sql"
      )
    ).toEqual(["settings_update"]);
  });

  // A migration listed after the cutoff was merged from main. It must be a
  // generated authz migration: @carbon/database's migration.test.ts (`unshipped`)
  // then fails unless a later generated migration re-ships its tables.
  it("lists, after the cutoff, only generated authz migrations", () => {
    const dir = migrationsDir(repoRoot());
    const late = [...MODULE_KEY_MIGRATIONS].filter(
      (name) => name.slice(0, 14) > LAST_MODULE_KEY_MIGRATION
    );
    for (const name of late) {
      const firstLine = readFileSync(join(dir, name), "utf8").split("\n")[0];
      expect(firstLine, name).toBe(GENERATED_AUTHZ_MIGRATION);
    }
  });

  it("flags a managed function file whatever its age", () => {
    expect(
      scanKeys(
        [
          "CREATE FUNCTION get_audit_log(p_company_id TEXT) RETURNS void LANGUAGE plpgsql AS $$",
          "BEGIN",
          "  PERFORM assert_audit_log_access(p_company_id, 'settings_view');",
          "  PERFORM 1 FROM pg_policies p WHERE p.qual LIKE '%settings_view%';",
          "END $$;"
        ].join("\n"),
        "packages/database/src/event-system/functions/get_audit_log.sql"
      )
    ).toEqual(["settings_view", "settings_view"]);
  });

  it("passes page keys, portal keys and comments", () => {
    expect(
      scanKeys(
        [
          `-- the old key was settings_view`,
          `SELECT get_companies_with_employee_permission('settings.auditLogs_view');`,
          `SELECT get_customer_ids_with_customer_permission('parts_view');`,
          `SELECT get_supplier_ids_with_supplier_permission('parts_update');`,
          `SELECT format('SELECT get_companies_with_employee_permission(''documents_view'')');`
        ].join("\n"),
        after
      )
    ).toEqual([]);
  });
  it("skips SQL that is neither a migration nor a managed function file", () => {
    expect(
      scanKeys(
        `SELECT get_companies_with_employee_permission('settings_update');`,
        "apps/erp/app/modules/settings/report.sql"
      )
    ).toEqual([]);
  });
});

/** demandForecast moved from Inventory (write and read) to production.forecasts. */
const BASE = {
  demandForecast: { read: ["inventory"], write: ["inventory"] },
  salesOrder: { read: [], write: ["sales"] },
  printerRoute: { read: [], write: ["printing"] },
  dropped: { read: [], write: ["inventory"] }
};

const OWNERS: Record<string, string[]> = {
  demandForecast: ["production.forecasts"],
  salesOrder: ["sales.orders"],
  printerRoute: ["settings.printing"]
};

const movedRegistry: MovedTablesRegistry = {
  ownersOf: (table) => OWNERS[table] ?? [],
  moduleOf: (page) => page.slice(0, page.indexOf(".")),
  hasPages: (module) => module !== "printing"
};

const policy = (command: string, keys: string) =>
  `CREATE POLICY "${command}" ON "public"."demandForecast" FOR ${command} USING (${keys});`;

const movedGaps = (sql: string) =>
  findMovedTableGaps(
    livePolicies([{ file: "1_ship.sql", contents: sql }]),
    movedRegistry,
    BASE
  ).map((v) => v.message);

const COVERED = [
  policy(
    "SELECT",
    "get_companies_with_module_view(ARRAY['production']::text[], ARRAY['inventory.quantities_view']::text[])"
  ),
  policy(
    "INSERT",
    "get_companies_with_any_employee_permission(ARRAY['production.forecasts_create', 'inventory.quantities_create'])"
  )
].join("\n");

describe("findMovedTableGaps", () => {
  it("passes a moved table whose policies still admit its old module", () => {
    expect(movedGaps(COVERED)).toEqual([]);
  });

  it("fails a moved table no write policy lets its old module write", () => {
    expect(
      movedGaps(COVERED.replace("'inventory.quantities_create'", "'x'"))
    ).toEqual([
      "demandForecast moved from Inventory to production.forecasts, and no write policy checks a page of Inventory: list it in its page's alsoWrittenBy with a page of Inventory, then run authz migration"
    ]);
  });

  it("fails a moved table whose SELECT no longer admits its old module", () => {
    expect(
      movedGaps(COVERED.replace("'inventory.quantities_view'", "'x'"))
    ).toEqual([
      "demandForecast moved from Inventory to production.forecasts, and its SELECT admits no page of Inventory: list it in the readers of a page of Inventory, then run authz migration"
    ]);
  });

  it("reads a table's policies from the last migration that sets them", () => {
    const later = [
      policy(
        "SELECT",
        "get_companies_with_module_view(ARRAY['production']::text[], '{}'::text[])"
      ),
      policy("INSERT", "'production.forecasts_create'")
    ].join("\n");
    const live = livePolicies([
      { file: "1_ship.sql", contents: COVERED },
      { file: "2_ship.sql", contents: later }
    ]);
    expect(findMovedTableGaps(live, movedRegistry, BASE)).toHaveLength(2);
  });

  it("skips a table still in its module, one from a module with no pages, and one no page owns", () => {
    expect(movedGaps("").map((m) => m.slice(0, m.indexOf(" ")))).toEqual([
      "demandForecast",
      "demandForecast"
    ]);
  });
  it("reads only public tables, and a policy with no FOR clause as ALL", () => {
    const live = livePolicies([
      {
        file: "1_ship.sql",
        contents: [
          'CREATE POLICY "Bucket read" ON storage.objects FOR SELECT USING (true);',
          'CREATE POLICY "Everything" ON "demandForecast" USING (true);'
        ].join("\n")
      }
    ]);
    expect([...live.keys()]).toEqual(["demandForecast"]);
    expect(live.get("demandForecast")?.map((p) => p.command)).toEqual(["ALL"]);
  });
});

const routeRegistry = (
  overrides: Partial<RouteRegistry> = {}
): RouteRegistry => ({
  pages: [
    { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
    { id: "inventory.shipments", paths: ["/x/inventory/shipments"] }
  ],
  ...overrides
});

const UNPAGED = {
  "/x": "The app shell.",
  "/x/account/": "The signed-in person's own account."
};

const ROUTES = [
  "_index.tsx",
  "inventory+/receipts.tsx",
  "inventory+/receipts.$id.tsx",
  "inventory+/shipments.tsx",
  "account+/profile.tsx"
];

const routeGaps = (
  routes: readonly string[],
  overrides: Partial<RouteRegistry> = {},
  unpaged: Record<string, string> = UNPAGED
) =>
  findRoutePageGaps(routes, routeRegistry(overrides), unpaged).map(
    ({ file, snippet }) => [file, snippet]
  );

describe("findRoutePageGaps", () => {
  it("passes routes each on one page, and routes UNPAGED_ROUTES lists", () => {
    expect(routeGaps(ROUTES)).toEqual([]);
  });

  it("flags a route on no page that UNPAGED_ROUTES does not list", () => {
    expect(routeGaps([...ROUTES, "inventory+/kanbans.tsx"])).toEqual([
      ["apps/erp/app/routes/x+/inventory+/kanbans.tsx", "/x/inventory/kanbans"]
    ]);
  });

  it("flags a route two pages cover equally", () => {
    expect(
      routeGaps(ROUTES, {
        pages: [
          { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
          { id: "inventory.shipments", paths: ["/x/inventory/shipments"] },
          { id: "purchasing.receipts", paths: ["/x/inventory/receipts/"] }
        ]
      })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/receipts.tsx",
        "/x/inventory/receipts"
      ],
      [
        "apps/erp/app/routes/x+/inventory+/receipts.$id.tsx",
        "/x/inventory/receipts/$id"
      ]
    ]);
  });

  it("flags a route that is on a page and in UNPAGED_ROUTES", () => {
    expect(
      routeGaps(ROUTES, {}, { ...UNPAGED, "/x/inventory/shipments": "Listed." })
    ).toEqual([
      [
        "apps/erp/app/routes/x+/inventory+/shipments.tsx",
        "/x/inventory/shipments"
      ]
    ]);
  });

  it("matches a page path's $param to any one segment, as pageOfUrl does", () => {
    const customers = {
      pages: [
        { id: "inventory.receipts", paths: ["/x/inventory/receipts"] },
        { id: "inventory.shipments", paths: ["/x/inventory/shipments"] },
        { id: "sales.customers", paths: ["/x/customer/$customerId"] }
      ]
    };
    expect(
      routeGaps([...ROUTES, "customer+/$id.details.tsx"], customers)
    ).toEqual([]);
  });

  it("flags an UNPAGED_ROUTES entry that matches no route", () => {
    expect(routeGaps(ROUTES, {}, { ...UNPAGED, "/x/print": "Gone." })).toEqual([
      ["packages/checks/src/conformance/authz.ts", "/x/print"]
    ]);
  });

  it("flags a page path no route has", () => {
    expect(
      routeGaps(ROUTES.filter((route) => !route.startsWith("inventory+/ship")))
    ).toEqual([
      [
        "packages/database/src/access/pages/inventory.ts",
        "/x/inventory/shipments"
      ]
    ]);
  });
});

const GATE_ROUTES = "apps/erp/app/routes/x+/";
const gateCheck = routeGateNamesPage(
  new Map([["CONTRACT_READ_GATE", ["sales.serviceContracts"]]]),
  new Map([["receiptsList", ["inventory.receipts"]]])
);
const scanRoute = (route: string, contents: string) =>
  gateCheck.scan(`${GATE_ROUTES}${route}`, contents);
const gated = (gate: string) =>
  `export async function loader({ request }) {\n  await authorize(request, ${gate});\n}\n`;

describe("routeGateNamesPage", () => {
  it("accepts a gate on the page the URL maps to", () => {
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`{ "inventory.receipts": "View" }`)
      )
    ).toEqual([]);
  });

  it("flags a gate on another page", () => {
    const [violation, ...rest] = scanRoute(
      "resources+/work-centers.new.tsx",
      gated(`{ "inventory.storageRules": "Create" }`)
    );
    expect(rest).toEqual([]);
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("resources.workCenters");
  });

  it("accepts a list that holds the page, by anyOf, pagesOf or ITEM_PAGES", () => {
    expect(
      scanRoute("part+/$itemId.tsx", gated(`anyOf(ITEM_PAGES, "View")`))
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`anyOf(pagesOf("inventory"), "View")`)
      )
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        gated(`anyOf(["parts.parts", "inventory.receipts"], "View")`)
      )
    ).toEqual([]);
  });

  it("reads a gate constant by name", () => {
    expect(scanRoute("contract+/$id.tsx", gated("CONTRACT_READ_GATE"))).toEqual(
      []
    );
    expect(
      scanRoute("part+/$itemId.tsx", gated("CONTRACT_READ_GATE"))
    ).toHaveLength(1);
  });

  it("skips a gate it cannot read, a gate-less authorize and an unmapped URL", () => {
    expect(
      scanRoute("inventory+/receipts.tsx", gated("permissionsFor(type)"))
    ).toEqual([]);
    expect(
      scanRoute(
        "inventory+/receipts.tsx",
        "const { api } = await authorize(request);"
      )
    ).toEqual([]);
    expect(
      scanRoute("account+/profile.tsx", gated(`{ "parts.parts": "View" }`))
    ).toEqual([]);
  });

  it.each([
    `{ anyOf: morePages, "inventory.storageRules": "Create" }`,
    `{ ...sharedGate, "inventory.storageRules": "Create" }`,
    `anyOf(["inventory.storageRules", morePage], "Create")`
  ])("skips a gate that is only partly readable: %s", (gate) => {
    expect(scanRoute("resources+/work-centers.new.tsx", gated(gate))).toEqual(
      []
    );
  });

  it("reads the pages a gate spreads from a constant", () => {
    const violations = scanRoute(
      "part+/$itemId.tsx",
      gated(`{ ...CONTRACT_READ_GATE }`)
    );
    expect(violations.map((v) => v.line)).toEqual([2]);
  });

  it("reads the gate of the list a route loads with loadListPage", () => {
    const loads = (list: string) =>
      `export async function loader({ request }) {\n  return loadListPage(request, ${list}, { dataKey: "rows" });\n}\n`;
    expect(scanRoute("inventory+/receipts.tsx", loads("receiptsList"))).toEqual(
      []
    );
    const [violation] = scanRoute(
      "inventory+/shipments.tsx",
      loads("receiptsList")
    );
    expect(violation?.line).toBe(2);
    expect(violation?.message).toContain("inventory.shipments");
    expect(scanRoute("inventory+/shipments.tsx", loads("unknownList"))).toEqual(
      []
    );
  });

  it("accepts the pages an exception lists for its route", () => {
    expect(
      scanRoute(
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "projects.approvals": "View" }`)
      )
    ).toEqual([]);
    expect(
      scanRoute(
        "projects+/timesheets.$employeeId.tsx",
        gated(`{ "sales.quotes": "View" }`)
      )
    ).toHaveLength(1);
  });
});

describe("gateConstants", () => {
  it("collects exported upper-case constants that name pages, outside routes", () => {
    const constants = gateConstants([
      {
        file: "apps/erp/app/modules/sales/sales.models.ts",
        contents: `export const CONTRACT_READ_GATE = anyOf(["sales.serviceContracts", "sales.projectContracts"], "View");\nexport const LIMIT = 10;\nconst HIDDEN = { "parts.parts": "View" };`
      },
      {
        file: `${GATE_ROUTES}contract+/$id.tsx`,
        contents: `export const ROUTE_GATE = { "parts.parts": "View" };`
      }
    ]);
    expect([...constants]).toEqual([
      [
        "CONTRACT_READ_GATE",
        ["sales.serviceContracts", "sales.projectContracts"]
      ]
    ]);
  });
});

describe("listGates", () => {
  it("collects the gate of each list, from searchList or an object", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" }, paging });
export const paymentsList = { key: "payments", gate: { "invoicing.payments": "View" }, query } satisfies ListDefinition;
export const itemsList = searchList({ key: "items", gate: anyOf(ITEM_PAGES, "View") });
export const lists = { receipts: receiptsList };`
      }
    ]);
    expect(lists.get("receiptsList")).toEqual(["inventory.receipts"]);
    expect(lists.get("paymentsList")).toEqual(["invoicing.payments"]);
    expect(lists.get("itemsList")).toContain("parts.parts");
    expect(lists.has("lists")).toBe(false);
  });

  it("reads a list beside imports and functions", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `import { searchList } from "./search-list";
export function describeGate() {
  return "gate: none";
}
export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" } });`
      }
    ]);
    expect([...lists]).toEqual([["receiptsList", ["inventory.receipts"]]]);
  });

  it("reads a list beside constants that are not list definitions", () => {
    const lists = listGates([
      {
        file: "apps/erp/app/utils/list-registry/inventory.server.ts",
        contents: `const PAGE_SIZE = 50;
const paging = defaultPaging();
export const receiptsList = searchList({ key: "receipts", gate: { "inventory.receipts": "View" } });`
      }
    ]);
    expect([...lists]).toEqual([["receiptsList", ["inventory.receipts"]]]);
  });
});
