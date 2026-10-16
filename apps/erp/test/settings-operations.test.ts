// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const { stripeAccount, consoleSetting, requireMfaSetting, mfaEmails } =
  vi.hoisted(() => ({
    stripeAccount: vi.fn(),
    consoleSetting: vi.fn(),
    requireMfaSetting: vi.fn(),
    mfaEmails: vi.fn()
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
vi.mock("../app/services/mfa-email.server", () => ({
  sendMfaRequiredEmails: mfaEmails
}));

import { EntitlementError } from "@carbon/ee/entitlements.server";
import { createServiceContext } from "../app/modules/service-fn.server";

const {
  updateInventorySettings,
  updateInvoicingSettings,
  updatePeopleSettings,
  updatePlanningSettings,
  updateProductionSettings,
  updateSecuritySettings
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
 * for its table. Every write is recorded with what it wrote.
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

describe("production settings", () => {
  it("refuses a location that is not the company's", async () => {
    const { ctx } = contextWith({ location: [] });

    const result = await updateProductionSettings(ctx, {
      locationStaffing: { locationId: "loc-x", requiresStaffing: true }
    });

    expect(result.error?.category).toBe("notFound");
  });
});

describe("planning settings", () => {
  it("refuses an employee who is not an active employee of the company", async () => {
    const { ctx, writes } = contextWith({ employee: null });

    const result = await updatePlanningSettings(ctx, {
      defaultResponsibleEmployee: "someone-else"
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Choose an employee of this company"
    });
    expect(writes).toEqual([]);
  });

  it("refuses a location row-level security hides from the caller", async () => {
    const { ctx } = contextWith({ employee: { id: "user-2" }, location: [] });

    const result = await updatePlanningSettings(ctx, {
      locationResponsibleEmployee: {
        locationId: "loc-1",
        responsibleEmployee: "user-2"
      }
    });

    expect(result.error).toMatchObject({
      category: "forbidden",
      message: "You do not have permission to change this location"
    });
  });

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
