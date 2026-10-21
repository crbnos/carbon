// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const {
  stripeAccount,
  consoleSetting,
  requireMfaSetting,
  mfaEmails,
  unmappedRequiredAccounts
} = vi.hoisted(() => ({
  stripeAccount: vi.fn(),
  consoleSetting: vi.fn(),
  requireMfaSetting: vi.fn(),
  mfaEmails: vi.fn(),
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
vi.mock("../app/services/mfa-email.server", () => ({
  sendMfaRequiredEmails: mfaEmails
}));

import { EntitlementError } from "@carbon/ee/entitlements.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

const {
  removePrinterRoute,
  setIntegrationSyncEnabled,
  updatePostingSync,
  updateInventorySettings,
  updateInvoicingSettings,
  updatePeopleSettings,
  updatePlanningSettings,
  transitionSyncOperations,
  updateSecuritySettings,
  updateSubsidiaryDetails
} = await import("../app/modules/settings/settings.server");

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
function client(rows: Record<string, unknown>) {
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
  return { from, writes };
}

function contextWith(rows: Record<string, unknown> = {}) {
  const db = client(rows);
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

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Connect Stripe in Integrations first"
    });
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

    expect(result.error).toMatchObject({
      category: "entitlement",
      message: "Console mode requires the Business plan"
    });
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

  it("emails the company when two-factor goes from optional to required", async () => {
    const { ctx } = contextWith({ companySettings: { requireMfa: false } });

    await updateSecuritySettings(ctx, { requireMfa: true });

    expect(mfaEmails).toHaveBeenCalledWith(expect.anything(), "company-1");
  });

  it("does not announce a requirement that was already on", async () => {
    const { ctx } = contextWith({ companySettings: { requireMfa: true } });

    await updateSecuritySettings(ctx, { requireMfa: true });

    expect(mfaEmails).not.toHaveBeenCalled();
  });
});

describe("deleting a printer route", () => {
  it("clears every assignment that named it and keeps the others", async () => {
    const { ctx, writes } = contextWith({
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
      companySettings: {
        printing: { assignments: { "loc-1": { defaultPrinterRouteId: "x" } } }
      }
    });

    await removePrinterRoute(ctx, { id: "route-1" });

    expect(writes.map((write) => `${write.method}:${write.table}`)).toEqual([
      "delete:printerRoute"
    ]);
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

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Map the remaining 2 required accounts before turning on sync"
    });
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

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Updated 1 of 3 sync operations"
    });
    expect(result.error?.cause).toEqual([
      { id: "op-2", reason: "invalid transition In Flight → Pending" },
      { id: "op-3", reason: "Sync operation op-3 not found" }
    ]);
    expect(sent.map((request) => request.method)).toEqual(["PATCH", "GET"]);
    expect(sent[1]?.url.searchParams.get("id")).toBe("in.(op-2,op-3)");
  });
});
