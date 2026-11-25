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
  redis: {
    del: vi.fn(),
    keys: vi.fn(async () => []),
    pipeline: vi.fn(() => ({ del: vi.fn(), exec: vi.fn(async () => []) }))
  }
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
// The plan check behind the API-key lock: the real answer unless a test says.
vi.mock("@carbon/ee/plan.server", async (importOriginal) => {
  const plan = await importOriginal<typeof import("@carbon/ee/plan.server")>();
  return { ...plan, companyHasFeature: vi.fn(plan.companyHasFeature) };
});

import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { redis } from "@carbon/kv";
import { pageClaims } from "./page-claims";

import {
  createItemSerialSequence,
  deleteCustomField,
  removePrinterRoute,
  revokeApiKey,
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
  updateCustomField,
  updateItemSerialSequence,
  updatePurchasingSettings,
  updateResourcesSettings,
  updateSecuritySettings,
  updateSubsidiaryDetails
} from "../app/modules/settings/settings.server";
import {
  type CustomFieldType,
  consolePinUserId
} from "../app/modules/settings/settings.service";
import { DataType } from "../app/modules/shared/types";

const settings = pageClaims({
  settings: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
});

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
    actor: { type: "user", role: "employee", userId: "user-1", permissions: settings },
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
      actor: { type: "user", role: "employee", userId: "user-1", permissions: {} },
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

// Settings → Company owns the settings row, its billing addresses and the
// company row; a module's settings page writes its own fields there as the
// system, after its own permission.
// The writes these pages make as the system, past RLS, are pinned against the
// database in `test/database/settings-scoping.test.ts`.
describe("a caller with one settings page only", () => {
  function pageOnly(page: string, rows: Record<string, unknown> = {}) {
    const db = client(rows);
    const ctx = createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions: {
          [page]: {
            view: ["company-1"],
            create: ["company-1"],
            update: ["company-1"],
            delete: []
          }
        }
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: db as never,
      system: () => db as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });
    return { ctx, writes: db.writes };
  }

  it("refuses a location that is not the company's", async () => {
    const { ctx } = pageOnly("settings.planning", { location: [] });

    const result = await updatePlanningSettings(ctx, {
      locationResponsibleEmployee: {
        locationId: "loc-9",
        responsibleEmployee: null
      }
    });

    expect(result.error?.category).toBe("notFound");
  });

  it("is refused on another settings page's operation", async () => {
    const { ctx, writes } = pageOnly("settings.inventory");

    const result = await updatePurchasingSettings(ctx, {
      requireSupplierContactEmail: true
    });

    expect(result.error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
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
    consoleSetting.mockResolvedValue({
      error: { code: "entitlement", message: "Requires the Business plan" },
      pin: null,
      pinError: null
    });
    const { ctx } = contextWith();

    const result = await updatePeopleSettings(ctx, { consoleEnabled: true });

    expect(result.error?.category).toBe("entitlement");
  });

  it("generates a console PIN for a person only, never for an API key", () => {
    const permissions = settings;
    expect(
      consolePinUserId({
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions
      })
    ).toBe("user-1");
    // Whoever holds the key may not be its creator.
    expect(
      consolePinUserId({ type: "apiKey", createdBy: "user-1", permissions })
    ).toBeUndefined();
    expect(
      consolePinUserId({ type: "system", onBehalfOf: "user-1" })
    ).toBeUndefined();
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
      actor: { type: "user", role: "employee", userId: "user-1", permissions: settings },
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
  // the custom field table's module and the save (`set_record_custom_fields`)
  // with the rows it changed.
  function recordCustomFields({
    actor = {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: settings
    },
    module = "Items",
    changed = ["P-1"],
    fields = [{ id: "color", dataTypeId: DataType.Text, listOptions: null }],
    stored = []
  }: {
    actor?: Actor;
    module?: string | null;
    changed?: string[];
    fields?: CustomFieldType[];
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
          ? fields
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
    const updates = () =>
      sent.filter((request) =>
        request.url.pathname.endsWith("/rpc/set_record_custom_fields")
      );
    return { ctx, updates };
  }

  const key = (grants: Record<string, { view?: string[]; update?: string[] }>) =>
    ({
      type: "apiKey",
      createdBy: "user-1",
      permissions: pageClaims(
        Object.fromEntries(
          Object.entries(grants).map(([subject, actions]) => [
            subject,
            { view: [], create: [], update: [], delete: [], ...actions }
          ])
        )
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
    expect(updates().map((update) => update.body)).toEqual([
      {
        p_table: "part",
        p_ids: ["P-1", "P-2"],
        p_scope_column: "companyId",
        p_scope_id: "company-1",
        p_set: { color: "Red" },
        p_clear: [],
        p_updated_by: "user-1"
      }
    ]);
  });

  // The panel sends the one field it changed; writing that as the whole map
  // dropped every field another person saved since the panel loaded.
  it("writes only the fields sent, and clears a field sent as null", async () => {
    const { ctx, updates } = recordCustomFields({
      fields: [
        { id: "color", dataTypeId: DataType.Text, listOptions: null },
        { id: "due", dataTypeId: DataType.Date, listOptions: null }
      ]
    });

    const result = await setRecordCustomFields(ctx, {
      table: "part",
      ids: ["P-1"],
      customFields: { color: "Red", due: null }
    });

    expect(result.error).toBeNull();
    expect(updates().map((update) => update.body)).toEqual([
      expect.objectContaining({ p_set: { color: "Red" }, p_clear: ["due"] })
    ]);
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

    expect(updates().map((update) => update.body)).toEqual([
      expect.objectContaining({
        p_scope_column: "companyGroupId",
        p_scope_id: "group-1"
      })
    ]);
  });

  it.each([
    ["only view on parts", { parts: { view: ["company-1"] } }],
    ["update on items, the table's module name", { items: { update: ["company-1"] } }],
    [
      "Edit on another item page",
      { "parts.materials": { update: ["company-1"] } }
    ],
    ["update on another module", { sales: { update: ["company-1"] } }]
  ])("refuses an API key with %s and writes nothing", async (_name, scopes) => {
    const { ctx, updates } = recordCustomFields({ actor: key(scopes) });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result.error?.category).toBe("forbidden");
    expect(updates()).toEqual([]);
  });

  it("lets an API key with Edit on the table's page change its records", async () => {
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

  it("takes a deleted field's stored value sent back unchanged", async () => {
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

  // Taken only because the records hold it: written back, it would undo a
  // save another person made to that field since this call read the records.
  it.each([
    ["a List value its options no longer hold", { shade: "Blue" }],
    ["a deleted field's stored null", { retired: null }]
  ])("leaves %s out of the write, and still clears a Date sent as null", async (_name, held) => {
    const { ctx, updates } = recordCustomFields({
      fields: [
        { id: "color", dataTypeId: DataType.Text, listOptions: null },
        { id: "shade", dataTypeId: DataType.List, listOptions: ["Red"] },
        { id: "due", dataTypeId: DataType.Date, listOptions: null }
      ],
      stored: [{ id: "P-1", customFields: held }]
    });

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      ids: ["P-1"],
      customFields: { color: "Red", due: null, ...held }
    });

    expect(result.error).toBeNull();
    expect(updates().map((update) => update.body)).toEqual([
      expect.objectContaining({ p_set: { color: "Red" }, p_clear: ["due"] })
    ]);
  });

  it("refuses a write that changed no record", async () => {
    const { ctx } = recordCustomFields({ changed: [] });

    const result = await setRecordCustomFields(ctx, partValues);

    expect(result.error?.category).toBe("notFound");
  });

  it("refuses a value its field's panel input never sends, and writes nothing", async () => {
    const { ctx, updates } = recordCustomFields({
      fields: [{ id: "weight", dataTypeId: DataType.Numeric, listOptions: null }],
      stored: [{ id: "P-1", customFields: { weight: 3 } }]
    });

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      ids: ["P-1"],
      customFields: { weight: { kg: 3 } }
    });

    expect(result.error?.category).toBe("validation");
    expect(updates()).toEqual([]);
  });

  it("refuses more than 100 records in one call", async () => {
    const { ctx, updates } = recordCustomFields();

    const result = await setRecordCustomFields(ctx, {
      ...partValues,
      ids: Array.from({ length: 101 }, (_, i) => `P-${i}`)
    });

    expect(result.error?.category).toBe("validation");
    expect(updates()).toEqual([]);
  });
});

describe("custom field definitions and serial sequences", () => {
  // The boundary is PostgREST: a real supabase-js client whose fetch answers
  // every request with the rows `respond` gives, and records what was sent.
  function postgrest(
    respond: (method: string, url: URL) => { status?: number; body: unknown },
    actor: Actor = {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: settings
    }
  ) {
    const sent: { method: string; url: URL; body: unknown }[] = [];
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const url = new URL(String(input));
      sent.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      const { status = 200, body } = respond(method, url);
      return new Response(JSON.stringify(body), {
        status,
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
    const writes = () => sent.filter((request) => request.method !== "GET");
    const reads = () => sent.filter((request) => request.method === "GET");
    return { ctx, reads, writes };
  }

  // PostgREST's answer to `.single()` when the write matched no row.
  const noRow = {
    status: 406,
    body: {
      code: "PGRST116",
      details: "The result contains 0 rows",
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned"
    }
  };

  const sequence = {
    itemId: "item-1",
    prefix: "SN",
    next: 0,
    step: 1,
    size: 5
  };

  it("creates a serial sequence without an id it was sent", async () => {
    const { ctx, writes } = postgrest(() => ({ body: { id: "seq-new" } }));

    const result = await createItemSerialSequence(ctx, {
      ...sequence,
      id: "seq-chosen"
    } as never);

    expect(result.error).toBeNull();
    const [insert] = writes();
    expect(insert?.body).toEqual([
      { ...sequence, companyId: "company-1", createdBy: "user-1" }
    ]);
  });

  // The sequence's item reference is not company-scoped in the database.
  it("refuses a serial sequence for an item that is not the company's", async () => {
    const { ctx, reads, writes } = postgrest(() => ({ body: [] }));

    const result = await createItemSerialSequence(ctx, {
      ...sequence,
      itemId: "item-other"
    });

    expect(result.error?.category).toBe("notFound");
    expect(writes()).toEqual([]);
    const [owned] = reads();
    expect(owned?.url.pathname).toBe("/rest/v1/item");
    expect(owned?.url.searchParams.get("id")).toBe("eq.item-other");
    expect(owned?.url.searchParams.get("companyId")).toBe("eq.company-1");
  });

  it("updates a serial sequence only on its own item", async () => {
    const { ctx, writes } = postgrest(() => noRow);

    const result = await updateItemSerialSequence(ctx, {
      ...sequence,
      id: "seq-1",
      itemId: "item-2"
    });

    expect(result.error?.category).toBe("notFound");
    const [update] = writes();
    expect(update?.url.searchParams.get("id")).toBe("eq.seq-1");
    expect(update?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(update?.url.searchParams.get("itemId")).toBe("eq.item-2");
  });

  it("deletes a custom field only in this company, and refuses one it did not delete", async () => {
    const { ctx, writes } = postgrest(() => ({ body: [] }));

    const result = await deleteCustomField(ctx, { id: "field-1" });

    expect(result.error?.category).toBe("notFound");
    const [deleted] = writes();
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.url.searchParams.get("id")).toBe("eq.field-1");
    expect(deleted?.url.searchParams.get("companyId")).toBe("eq.company-1");
  });

  it("updates a custom field only in this company", async () => {
    const { ctx, writes } = postgrest((method) =>
      method === "GET"
        ? {
            body: {
              name: "Color",
              table: "part",
              dataTypeId: DataType.Text,
              listOptions: null,
              tags: null,
              required: false
            }
          }
        : { body: [{ id: "field-1" }] }
    );

    const result = await updateCustomField(ctx, { id: "field-1", name: "Hue" });

    expect(result).toEqual({ data: { id: "field-1" }, error: null });
    const [update] = writes();
    expect(update?.url.searchParams.get("id")).toBe("eq.field-1");
    expect(update?.url.searchParams.get("companyId")).toBe("eq.company-1");
    expect(update?.body).toMatchObject({ name: "Hue" });
  });

  // The merged definition is validated, but a field left out is not written:
  // a change saved since the read keeps its value.
  it("writes only the custom field definition fields sent", async () => {
    const { ctx, writes } = postgrest((method) =>
      method === "GET"
        ? {
            body: {
              name: "Color",
              table: "part",
              dataTypeId: DataType.List,
              listOptions: ["Red"],
              tags: ["paint"],
              required: true
            }
          }
        : { body: [{ id: "field-1" }] }
    );

    const renamed = await updateCustomField(ctx, { id: "field-1", name: "Hue" });
    const listed = await updateCustomField(ctx, {
      id: "field-1",
      listOptions: ["Red", "Blue"]
    });

    expect(renamed.error).toBeNull();
    expect(listed.error).toBeNull();
    expect(writes().map((write) => write.body)).toEqual([
      { name: "Hue", updatedBy: "user-1" },
      { listOptions: ["Red", "Blue"], updatedBy: "user-1" }
    ]);
  });

  // Row-level security updates a custom field only with Edit on Custom Fields.
  it("refuses a custom field change to a user with Create on Custom Fields alone", async () => {
    const { ctx, writes } = postgrest(() => ({ body: [] }), {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: pageClaims({
        settings: {
          view: ["company-1"],
          create: ["company-1"],
          update: [],
          delete: []
        }
      })
    });

    const result = await updateCustomField(ctx, { id: "field-1", name: "Hue" });

    expect(result.error?.category).toBe("forbidden");
    expect(writes()).toEqual([]);
  });
});

describe("revoking an API key", () => {
  // API Keys at Edit: RLS lets this role update a key but not delete it.
  const editor = {
    "settings.apiKeys": {
      view: ["company-1"],
      create: ["company-1"],
      update: ["company-1"],
      delete: []
    }
  };

  function revoke(deleted: { keyHash: string } | undefined) {
    const caller = client({});
    const where: [string, string, string][] = [];
    const query = {
      where: (...args: [string, string, string]) => {
        where.push(args);
        return query;
      },
      returning: () => query,
      executeTakeFirst: async () => deleted
    };
    const pg = { deleteFrom: vi.fn(() => query) };
    vi.mocked(companyHasFeature).mockResolvedValueOnce(true);
    const ctx = createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions: editor
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: caller as never,
      system: () => caller as never,
      pg: () => pg as never,
      kv: () => ({}) as never
    });
    return { result: revokeApiKey(ctx, { id: "key-1" }), caller, pg, where };
  }

  it("deletes the company's key as the system, then drops its cached authentication", async () => {
    const { result, caller, pg, where } = revoke({ keyHash: "hash-1" });

    expect(await result).toEqual({ data: { id: "key-1" }, error: null });
    expect(pg.deleteFrom).toHaveBeenCalledWith("apiKey");
    expect(where).toEqual([
      ["id", "=", "key-1"],
      ["companyId", "=", "company-1"]
    ]);
    // Never through the caller's client, whose RLS would delete nothing.
    expect(caller.writes).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining("hash-1"));
  });

  it("refuses a key no row was deleted for, and reports no success", async () => {
    const { result } = revoke(undefined);

    expect((await result).error?.category).toBe("notFound");
    expect(redis.del).not.toHaveBeenCalled();
  });
});
