// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stripeAccount,
  consoleSetting,
  requireMfaSetting,
  batchTrigger,
  trigger,
  unmappedRequiredAccounts
} = vi.hoisted(() => ({
  stripeAccount: vi.fn(),
  consoleSetting: vi.fn(),
  requireMfaSetting: vi.fn(),
  // Inngest: the two-factor announcement is sent through it.
  batchTrigger: vi.fn(),
  // Inngest: scheduler notices are sent through it.
  trigger: vi.fn(),
  unmappedRequiredAccounts: vi.fn()
}));
vi.mock("@carbon/ee/accounting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/ee/accounting")>()),
  getUnmappedRequiredAccounts: unmappedRequiredAccounts
}));
vi.mock("@carbon/kv", () => ({
  redis: { del: vi.fn(), keys: vi.fn(async () => []), pipeline: vi.fn() }
}));
vi.mock("@carbon/stripe/send-sales-invoice.server", () => ({
  getStripeConnectAccountId: stripeAccount
}));
vi.mock("@carbon/ee/console.server", () => ({
  updateConsoleSetting: consoleSetting
}));
vi.mock("@carbon/ee/two-factor.server", () => ({
  updateRequireMfaSetting: requireMfaSetting
}));
vi.mock("@carbon/printing/printing.server", () => ({
  invalidatePrinterCache: vi.fn()
}));
vi.mock("@carbon/jobs", () => ({ batchTrigger, trigger }));

import { EntitlementError } from "@carbon/ee/entitlements.server";
import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";

import {
  removePrinterRoute,
  savePrinterRoute,
  setIntegrationSyncEnabled,
  setRecordCustomFields,
  transitionSyncOperations,
  updateInventorySettings,
  updateInvoicingSettings,
  updatePeopleSettings,
  updatePlanningSettings,
  updatePostingSync,
  updateProductionSettings,
  updateSecuritySettings,
  updateSubsidiaryDetails
} from "../app/modules/settings/settings.server";

const settings = {
  settings: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
};

type Write = { table: string; method: string; values: unknown };

/**
 * A Supabase client whose every query answers with the rows the test names
 * for its table. Every write is recorded with what it wrote. It ignores
 * filters, so a company or id scope is tested against the database instead
 * (`test/database/settings-scoping.test.ts`).
 */
function client(
  rows: Record<string, unknown>,
  { rpcError = null }: { rpcError?: { message: string } | null } = {}
) {
  const writes: Write[] = [];
  const from = (table: string) => {
    const result = { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      chain[method] = () => chain;
    }
    for (const method of ["insert", "update", "upsert", "delete"]) {
      chain[method] = (values: unknown) => {
        writes.push({ table, method, values });
        return chain;
      };
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return chain;
  };
  const rpc = (fn: string, args: unknown) => {
    writes.push({ table: fn, method: "rpc", values: args });
    return Promise.resolve({ data: null, error: rpcError });
  };
  return { from, rpc, writes };
}

function contextWith(
  rows: Record<string, unknown> = {},
  options: Parameters<typeof client>[1] = {}
) {
  const db = client(rows, options);
  const ctx = createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: settings },
    company: { id: "company-1", groupId: "group-1" },
    caller: db as never,
    system: () => db as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: db.writes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a settings page update", () => {
  it("writes only the fields sent, so a neighbouring setting keeps its value", async () => {
    const { ctx, writes } = contextWith();

    const result = await updateInventorySettings(ctx, {
      kanbanOutput: "label"
    });

    expect(result.error).toBeNull();
    expect(writes).toEqual([
      {
        table: "companySettings",
        method: "update",
        values: { kanbanOutput: "label" }
      }
    ]);
  });

  it("refuses a call that sends nothing to change", async () => {
    const { ctx, writes } = contextWith();

    const result = await updateInventorySettings(ctx, {});

    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("is refused without the settings permission", async () => {
    const db = client({});
    const ctx = createServiceContext({
      actor: { type: "user", userId: "user-1", permissions: {} },
      company: { id: "company-1", groupId: "group-1" },
      caller: db as never,
      system: () => db as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });

    const result = await updateInventorySettings(ctx, {
      kanbanOutput: "label"
    });

    expect(result.error?.category).toBe("forbidden");
    expect(db.writes).toEqual([]);
  });
});

describe("invoicing settings", () => {
  it("refuses sending recurring invoices via Stripe before Stripe is connected", async () => {
    stripeAccount.mockResolvedValue(null);
    const { ctx, writes } = contextWith();

    const result = await updateInvoicingSettings(ctx, {
      invoiceAutomation: "Post and Send via Stripe"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("saves the receivables billing address with its cleared fields", async () => {
    const { ctx, writes } = contextWith();

    await updateInvoicingSettings(ctx, {
      accountsReceivableBillingAddress: { name: "Acme", city: null }
    });

    expect(writes).toEqual([
      {
        table: "companyAccountsReceivableBillingAddress",
        method: "upsert",
        values: {
          id: "company-1",
          name: "Acme",
          city: null,
          updatedBy: "user-1"
        }
      }
    ]);
  });
});

describe("planning settings", () => {
  it("stores the daily MRP time with its seconds, and clears it for the 3-hourly default", async () => {
    const { ctx, writes } = contextWith();

    await updatePlanningSettings(ctx, { mrpRunTime: "14:30" });
    await updatePlanningSettings(ctx, { mrpRunTime: null });

    expect(writes.map((write) => write.values)).toEqual([
      { mrpRunTime: "14:30:00" },
      { mrpRunTime: null }
    ]);
  });
});

describe("people settings", () => {
  it("answers a company without the plan with an entitlement error", async () => {
    consoleSetting.mockRejectedValue(new EntitlementError("PERMISSIONS"));
    const { ctx } = contextWith();

    const result = await updatePeopleSettings(ctx, { consoleEnabled: true });

    expect(result.error?.category).toBe("entitlement");
  });

  it("generates no console PIN for a key caller: the key holder may not be its creator", async () => {
    consoleSetting.mockResolvedValue({ error: null, pin: null, pinError: null });
    const db = client({});
    const ctx = createServiceContext({
      actor: { type: "apiKey", createdBy: "user-1", scopes: settings },
      company: { id: "company-1", groupId: "group-1" },
      caller: db as never,
      system: () => db as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });

    const result = await updatePeopleSettings(ctx, { consoleEnabled: true });

    expect(result.data).toMatchObject({ pin: null });
    expect(consoleSetting.mock.calls[0]![4]).toBeUndefined();
  });
});

describe("security settings", () => {
  beforeEach(() => {
    requireMfaSetting.mockResolvedValue({ error: null });
  });

  const company = (requireMfa: boolean) =>
    contextWith({
      companySettings: { requireMfa },
      company: { name: "Acme" },
      employees: [{ id: "user-2", email: "ada@acme.com", name: "Ada" }]
    });

  it("emails the company when two-factor goes from optional to required", async () => {
    await updateSecuritySettings(company(false).ctx, { requireMfa: true });
    expect(batchTrigger).toHaveBeenCalledOnce();
  });

  it("does not announce a requirement that was already on", async () => {
    await updateSecuritySettings(company(true).ctx, { requireMfa: true });
    expect(batchTrigger).not.toHaveBeenCalled();
  });
});

const sent = (writes: Write[]) =>
  writes.map((write) => `${write.method}:${write.table}`);

describe("saving a printer route", () => {
  const route = {
    name: "Zebra 2x1",
    format: "zpl" as const,
    mediaSizeId: "label2x1",
    printerUrl: "https://pbx.example/print"
  };

  it("keeps the saved API key when the field is blank", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    const result = await savePrinterRoute(ctx, { ...route, id: "route-1" });

    expect(result.error).toBeNull();
    expect(sent(writes)).toEqual(["update:printerRoute"]);
  });

  it("treats a key of only whitespace as a blank field", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    await savePrinterRoute(ctx, { ...route, id: "route-1", apiKey: "   " });

    expect(sent(writes)).toEqual(["update:printerRoute"]);
  });

  it("stores a new key in the vault, never on the route row", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    const result = await savePrinterRoute(ctx, {
      ...route,
      id: "route-1",
      apiKey: "secret"
    });

    expect(result.error).toBeNull();
    expect(JSON.stringify(writes[0]?.values)).not.toContain("secret");
    expect(writes[1]).toEqual({
      table: "set_printer_api_key",
      method: "rpc",
      values: {
        p_company_id: "company-1",
        p_printer_route_id: "route-1",
        p_api_key: "secret"
      }
    });
  });

  it("removes the key when asked, whatever the field holds", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    await savePrinterRoute(ctx, {
      ...route,
      id: "route-1",
      apiKey: "typed by mistake",
      removeApiKey: "on"
    });

    expect(writes[1]?.values).toMatchObject({ p_api_key: "" });
  });

  it("saves a document printer with no media size", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    const result = await savePrinterRoute(ctx, {
      ...route,
      id: "route-1",
      format: "pdf",
      mediaSizeId: ""
    });

    expect(result.error).toBeNull();
    expect(writes[0]?.values).toMatchObject({ mediaSizeId: null });
  });

  it("refuses a label printer with no media size", async () => {
    const { ctx, writes } = contextWith({ printerRoute: { id: "route-1" } });

    const result = await savePrinterRoute(ctx, {
      ...route,
      id: "route-1",
      mediaSizeId: ""
    });

    expect(result.error).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it("deletes a route it created when the key cannot be stored", async () => {
    const { ctx, writes } = contextWith(
      { printerRoute: { id: "route-new" } },
      { rpcError: { message: "vault unavailable" } }
    );

    const result = await savePrinterRoute(ctx, { ...route, apiKey: "secret" });

    expect(result.error).not.toBeNull();
    expect(sent(writes)).toEqual([
      "insert:printerRoute",
      "rpc:set_printer_api_key",
      "delete:printerRoute"
    ]);
  });
});

describe("deleting a printer route", () => {
  it("clears every assignment that named it and keeps the others", async () => {
    const { ctx, writes } = contextWith({
      printerRoute: [{ id: "route-1" }],
      companySettings: {
        printing: {
          assignments: {
            "loc-1": {
              defaultPrinterRouteId: "route-1",
              shipping: { printerRouteId: "route-2", autoPrint: true },
              receiving: { printerRouteId: "route-1", autoPrint: false },
              workCenters: {
                "wc-1": { printerRouteId: "route-1", autoPrint: true },
                "wc-2": { printerRouteId: "route-2", autoPrint: true }
              }
            }
          }
        }
      }
    });

    const result = await removePrinterRoute(ctx, { id: "route-1" });

    expect(result.error).toBeNull();
    // Its API key leaves Supabase Vault with it.
    expect(writes).toContainEqual({
      table: "set_printer_api_key",
      method: "rpc",
      values: {
        p_company_id: "company-1",
        p_printer_route_id: "route-1",
        p_api_key: ""
      }
    });
    const saved = writes.find(
      (write) => write.table === "companySettings" && write.method === "update"
    );
    expect(saved?.values).toEqual({
      printing: {
        assignments: {
          "loc-1": {
            defaultPrinterRouteId: null,
            shipping: { printerRouteId: "route-2", autoPrint: true },
            receiving: { printerRouteId: null, autoPrint: false },
            workCenters: {
              "wc-1": { printerRouteId: null, autoPrint: true },
              "wc-2": { printerRouteId: "route-2", autoPrint: true }
            }
          }
        }
      }
    });
  });

  it("leaves the settings alone when no assignment named it", async () => {
    const { ctx, writes } = contextWith({
      printerRoute: [{ id: "route-1" }],
      companySettings: {
        printing: { assignments: { "loc-1": { defaultPrinterRouteId: "x" } } }
      }
    });

    await removePrinterRoute(ctx, { id: "route-1" });

    expect(sent(writes)).toEqual([
      "delete:printerRoute",
      "rpc:set_printer_api_key"
    ]);
  });

  it("keeps the API key when no route row was deleted", async () => {
    // RLS can refuse the delete without an error; the route and its key stay.
    const { ctx, writes } = contextWith({ printerRoute: [] });

    await removePrinterRoute(ctx, { id: "route-1" });

    expect(sent(writes)).toEqual(["delete:printerRoute"]);
  });
});

describe("managing the companies of a group", () => {
  const subsidiary = {
    id: "company-2",
    name: "Acme East",
    addressLine1: "1 Main St",
    city: "Springfield",
    postalCode: "12345",
    countryCode: "US",
    baseCurrencyCode: "USD",
    timezone: "America/New_York"
  };

  it("is refused to a user outside Carbon", async () => {
    const { ctx, writes } = contextWith({
      user: { email: "someone@acme.com" }
    });

    const result = await updateSubsidiaryDetails(ctx, subsidiary);

    expect(result.error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });
});

describe("an accounting integration's settings", () => {
  const integration = (settings: Record<string, unknown>) => ({
    companyIntegration: {
      id: "xero",
      active: true,
      secretRef: null,
      metadata: { tenantId: "t-1", settings }
    }
  });

  it("refuses to turn sync on while a required account is unmapped", async () => {
    unmappedRequiredAccounts.mockResolvedValue({
      data: [{ id: "acc-1" }, { id: "acc-2" }],
      error: null
    });
    const { ctx, writes } = contextWith(integration({ syncEnabled: false }));

    const result = await setIntegrationSyncEnabled(ctx, {
      integrationId: "xero",
      syncEnabled: true
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("saves posting sync in the v3 shape, keeping the keys the form does not own", async () => {
    const { ctx, writes } = contextWith(
      integration({
        syncEnabled: true,
        postingSync: {
          enabled: false,
          includeManual: true,
          consolidation: "daily",
          sourceTypes: ["Sales Invoice"],
          lastReconciliation: { at: "2026-10-01" }
        }
      })
    );

    const result = await updatePostingSync(ctx, {
      integrationId: "xero",
      sourceTypeConfigs: [],
      familyAr: "documents",
      familyAp: "none",
      familyCreditMemo: "none",
      familySupplierCredit: "none",
      periodLockPolicy: "park"
    });

    expect(result.error).toBeNull();
    const saved = writes.find((write) => write.method === "upsert")
      ?.values as { metadata: Record<string, any> }[];
    const { settings } = saved[0]!.metadata;
    expect(settings.syncEnabled).toBe(true);
    expect(saved[0]!.metadata.tenantId).toBe("t-1");
    expect(settings.postingSync).toMatchObject({
      lastReconciliation: { at: "2026-10-01" },
      families: { ar: "documents", ap: "none" },
      periodLockPolicy: "park"
    });
    for (const legacy of ["enabled", "includeManual", "consolidation"]) {
      expect(settings.postingSync).not.toHaveProperty(legacy);
    }
    expect(Array.isArray(settings.postingSync.sourceTypes)).toBe(false);
  });
});

describe("retrying or skipping sync operations", () => {
  // The boundary is PostgREST: a real supabase-js client whose fetch answers
  // the UPDATE with the rows it moved and the follow-up read with the rest.
  function syncOperations(moved: string[], others: object[]) {
    const sent: { method: string; url: URL }[] = [];
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({ method, url: new URL(String(input)) });
      const rows = method === "PATCH" ? moved.map((id) => ({ id })) : others;
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const caller = createClient("http://localhost:54321", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub as typeof fetch }
    });
    const ctx = createServiceContext({
      actor: { type: "user", userId: "user-1", permissions: settings },
      company: { id: "company-1", groupId: "group-1" },
      caller: caller as never,
      system: () => caller as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });
    return { ctx, sent };
  }

  it("moves every operation in one UPDATE that only matches a status allowed to move", async () => {
    const { ctx, sent } = syncOperations(["op-1", "op-2"], []);

    const result = await transitionSyncOperations(ctx, {
      ids: ["op-1", "op-2"],
      to: "Pending"
    });

    expect(result).toEqual({ data: { count: 2, to: "Pending" }, error: null });
    expect(sent).toHaveLength(1);
    const [update] = sent;
    expect(update?.method).toBe("PATCH");
    expect(update?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(update?.url.searchParams.get("id")).toBe("in.(op-1,op-2)");
    // In Flight and Pending itself can never move to Pending.
    expect(update?.url.searchParams.get("status")).toBe(
      'in.(Completed,Failed,Warning,Skipped,Excluded)'
    );
  });

  it("reports each operation it could not move, with why", async () => {
    const { ctx, sent } = syncOperations(
      ["op-1"],
      [{ id: "op-2", status: "In Flight" }]
    );

    const result = await transitionSyncOperations(ctx, {
      ids: ["op-1", "op-2", "op-3"],
      to: "Pending"
    });

    expect(result.error?.category).toBe("rule");
    expect(result.error?.cause).toEqual([
      { id: "op-2", reason: "invalid transition In Flight → Pending" },
      { id: "op-3", reason: "Sync operation op-3 not found" }
    ]);
    expect(sent.map((request) => request.method)).toEqual(["PATCH", "GET"]);
    expect(sent[1]?.url.searchParams.get("id")).toBe("in.(op-2,op-3)");
  });
});

describe("a location's staffing requirement", () => {
  const scheduleNotices = () =>
    trigger.mock.calls.filter(([event]) => event === "schedule-inputs-changed");

  // While it is on, the scheduler places work only where someone is manned.
  it("re-plans the location when the requirement changes", async () => {
    const { ctx, writes } = contextWith({
      location: { requiresStaffing: false }
    });

    const result = await updateProductionSettings(ctx, {
      locationStaffing: { locationId: "loc-1", requiresStaffing: true }
    });

    expect(result.error).toBeNull();
    expect(writes).toContainEqual({
      table: "location",
      method: "update",
      values: { requiresStaffing: true }
    });
    expect(scheduleNotices()).toEqual([
      [
        "schedule-inputs-changed",
        expect.objectContaining({ kind: "location", entityId: "loc-1" })
      ]
    ]);
  });

  it("writes nothing and tells no scheduler when the requirement is unchanged", async () => {
    const { ctx, writes } = contextWith({
      location: { requiresStaffing: true }
    });

    await updateProductionSettings(ctx, {
      locationStaffing: { locationId: "loc-1", requiresStaffing: true }
    });

    expect(writes.filter((w) => w.table === "location")).toEqual([]);
    expect(scheduleNotices()).toEqual([]);
  });
});

describe("setting a record's custom field values", () => {
  // The boundary is PostgREST: a real supabase-js client whose fetch answers
  // the custom field table's module and the UPDATE with the rows it changed.
  function recordCustomFields({
    actor = { type: "user", userId: "user-1", permissions: settings },
    module = "Items",
    changed = ["P-1"],
    fields = ["color"],
    stored = []
  }: {
    actor?: Actor;
    module?: string | null;
    changed?: string[];
    fields?: string[];
    stored?: { id: string; customFields: Record<string, unknown> }[];
  } = {}) {
    const sent: { method: string; url: URL; body: unknown }[] = [];
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const url = new URL(String(input));
      sent.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      const rows = url.pathname.endsWith("/customFieldTable")
        ? module
          ? [{ module }]
          : []
        : url.pathname.endsWith("/customField")
          ? fields.map((id) => ({ id }))
          : method === "GET"
            ? stored
            : changed.map((id) => ({ id }));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const caller = createClient("http://localhost:54321", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub as typeof fetch }
    });
    const ctx = createServiceContext({
      actor,
      company: { id: "company-1", groupId: "group-1" },
      caller: caller as never,
      system: () => caller as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });
    const updates = () => sent.filter((request) => request.method === "PATCH");
    return { ctx, updates };
  }

  const key = (scopes: Record<string, { view?: string[]; update?: string[] }>) =>
    ({
      type: "apiKey",
      createdBy: "user-1",
      scopes: Object.fromEntries(
        Object.entries(scopes).map(([module, actions]) => [
          module,
          { view: [], create: [], update: [], delete: [], ...actions }
        ])
      )
    }) as Actor;

  const partValues = {
    table: "part",
    ids: ["P-1", "P-2"],
    customFields: { color: "Red" }
  };

  // A part number repeats across companies, so an unscoped write would change
  // another company's part of the same number.
  it("changes only this company's records and answers the ids it changed", async () => {
    const { ctx, updates } = recordCustomFields({ changed: ["P-1"] });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result).toEqual({ data: { ids: ["P-1"] }, error: null });
    const [update] = updates();
    expect(update?.url.pathname).toBe("/rest/v1/part");
    expect(update?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(update?.url.searchParams.get("id")).toBe("in.(P-1,P-2)");
    expect(update?.body).toMatchObject({ customFields: { color: "Red" } });
  });

  it("scopes a table shared by the company group by the group", async () => {
    const { ctx, updates } = recordCustomFields({
      module: "Accounting",
      changed: ["acc-1"]
    });

    await setRecordCustomFields(ctx, {
      table: "account",
      ids: ["acc-1"],
      customFields: {}
    });

    const [update] = updates();
    expect(update?.url.searchParams.get("companyGroupId")).toBe("eq.group-1");
    expect(update?.url.searchParams.has("companyId")).toBe(false);
  });

  it.each([
    ["only view on parts", { parts: { view: ["company-1"] } }],
    ["update on items, the table's module name", { items: { update: ["company-1"] } }],
    ["update on another module", { sales: { update: ["company-1"] } }]
  ])("refuses an API key with %s and writes nothing", async (_name, scopes) => {
    const { ctx, updates } = recordCustomFields({ actor: key(scopes) });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result.error?.category).toBe("forbidden");
    expect(updates()).toEqual([]);
  });

  it("lets an API key with update on parts change an item table's records", async () => {
    const { ctx, updates } = recordCustomFields({
      actor: key({ parts: { update: ["company-1"] } })
    });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result.error).toBeNull();
    expect(updates()).toHaveLength(1);
  });

  it("refuses a table that has no custom fields", async () => {
    const { ctx, updates } = recordCustomFields({ module: null });

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      table: "apiKey"
    });

    expect(result.error?.category).toBe("validation");
    expect(updates()).toEqual([]);
  });

  it("refuses a key that is not one of the table's custom fields", async () => {
    const { ctx, updates } = recordCustomFields({
      stored: [{ id: "P-1", customFields: { color: "Blue" } }]
    });

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      customFields: { color: "Red", notAField: "junk" }
    });

    expect(result.error?.category).toBe("validation");
    expect(updates()).toEqual([]);
  });

  it("sends back a deleted field's stored value unchanged, as the panel does", async () => {
    const { ctx, updates } = recordCustomFields({
      stored: [{ id: "P-1", customFields: { color: "Blue", retired: "x" } }]
    });

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      ids: ["P-1"],
      customFields: { color: "Red", retired: "x" }
    });

    expect(result.error).toBeNull();
    expect(updates()).toHaveLength(1);
  });

  it("refuses a write that changed no record", async () => {
    const { ctx } = recordCustomFields({ changed: [] });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result.error?.category).toBe("notFound");
  });
});
