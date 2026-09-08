import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/modules/settings", () => ({ getNextSequence: vi.fn() }));
vi.mock("@carbon/glossary", () => ({ terms: {}, glossaryEntries: () => [] }));
vi.mock("@carbon/auth", () => ({
  assertIsPost: () => undefined,
  getMESUrl: () => "http://localhost",
  getAppUrl: () => "http://localhost",
  CARBON_API_URL: "http://localhost",
  error: (cause: unknown, message: string) => ({ cause, message }),
  success: (message: string) => ({ message })
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));
vi.mock("@carbon/react", () => ({
  ScrollArea: () => null,
  VStack: () => null
}));
vi.mock("@carbon/form", () => ({
  validator: (schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      data?: unknown;
      error?: unknown;
    };
  }) => ({
    validate: async (form: FormData) => {
      const parsed = schema.safeParse(Object.fromEntries(form));
      return parsed.success ? { data: parsed.data } : { error: parsed.error };
    }
  }),
  validationError: (error: unknown) => ({ error })
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("~/hooks", () => ({ useRouteData: vi.fn() }));
vi.mock("~/modules/accounting/ui/AccountDefaults", () => ({
  AccountDefaultsForm: () => null
}));
vi.mock("~/modules/accounting", async () => ({
  ...(await import("./accounting.ee.service")),
  ...(await import("./accounting.models"))
}));

import {
  getDefaultAccounts,
  updateDefaultIncomeAccounts
} from "./accounting.ee.service";
import {
  defaultAccountValidator,
  defaultIncomeAcountValidator
} from "./accounting.models";

const income = Object.fromEntries(
  Object.keys(defaultIncomeAcountValidator.shape).map((key) => [
    key,
    `${key}-id`
  ])
);
const defaults = {
  ...income,
  companyId: "company",
  salesAccount: "sales",
  salesShippingRevenueAccount: "shipping"
};
const shipping = {
  id: "shipping",
  companyGroupId: "group",
  active: true,
  isGroup: false,
  class: "Revenue",
  incomeBalance: "Income Statement"
};

function database(account = shipping) {
  const rows: Record<string, Record<string, unknown>[]> = {
    company: [{ id: "company", companyGroupId: "group" }],
    accountDefault: [{ ...defaults }],
    account: [account]
  };
  const writes = vi.fn();
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let values: Record<string, unknown> | undefined;
      const result = () => {
        const matched = rows[table].filter((row) =>
          filters.every(([key, value]) => row[key] === value)
        );
        if (values) {
          writes(table, values);
          for (const row of matched) Object.assign(row, values);
        }
        return { data: values ? null : (matched[0] ?? null), error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        update: (input: Record<string, unknown>) => {
          values = input;
          return query;
        },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve)
      };
      return query;
    }
  } as unknown as SupabaseClient<Database>;
  return { client, writes };
}

function payload(overrides: Record<string, string> = {}) {
  return {
    ...defaultIncomeAcountValidator.parse({
      ...income,
      salesAccount: "sales",
      ...overrides
    }),
    companyId: "company",
    updatedBy: "user"
  };
}

describe("shipping revenue defaults", () => {
  it("the real defaults action rejects an invalid shipping mapping before either section writes", async () => {
    const { client, writes } = database({ ...shipping, active: false });
    vi.mocked(requirePermissions).mockResolvedValue({
      client,
      companyId: "company",
      userId: "user"
    } as never);
    const body = new FormData();
    for (const field of Object.keys(defaultAccountValidator.shape))
      body.set(field, `${field}-id`);
    body.set("salesAccount", "sales");
    body.set("salesShippingRevenueAccount", "shipping");
    body.set("intent", "all");
    const { action } = await import("~/routes/x+/accounting+/defaults");
    await action({
      request: new Request("http://localhost/x/accounting/defaults", {
        method: "POST",
        body
      }),
      params: {},
      context: {}
    } as never);
    expect(writes).not.toHaveBeenCalled();
  });
  it("preserves the incoming shipping field and rejects present empty values", () => {
    expect(
      defaultIncomeAcountValidator.parse({
        ...income,
        salesShippingRevenueAccount: "shipping"
      }).salesShippingRevenueAccount
    ).toBe("shipping");
    expect(
      defaultIncomeAcountValidator.safeParse({
        ...income,
        salesShippingRevenueAccount: ""
      }).success
    ).toBe(false);
  });

  it("accepts an older payload without shipping and preserves the stored mapping", async () => {
    const { salesShippingRevenueAccount: _, ...older } = income;
    const parsed = defaultIncomeAcountValidator.parse({
      ...older,
      salesAccount: "sales"
    });
    const { client, writes } = database();
    const result = await updateDefaultIncomeAccounts(client, {
      ...parsed,
      companyId: "company",
      updatedBy: "user"
    });
    expect(result.error).toBeNull();
    expect(writes).toHaveBeenCalledOnce();
    expect(
      (await getDefaultAccounts(client, "company")).data
        ?.salesShippingRevenueAccount
    ).toBe("shipping");
  });

  it("saves and reloads a valid account selected from the company group", async () => {
    const { client } = database({ ...shipping, id: "custom-shipping" });
    const result = await updateDefaultIncomeAccounts(
      client,
      payload({ salesShippingRevenueAccount: "custom-shipping" })
    );
    expect(result.error).toBeNull();
    expect(
      (await getDefaultAccounts(client, "company")).data
        ?.salesShippingRevenueAccount
    ).toBe("custom-shipping");
  });

  it.each([
    ["missing", { id: "other" }],
    ["foreign group", { companyGroupId: "other" }],
    ["inactive", { active: false }],
    ["group account", { isGroup: true }],
    ["expense", { class: "Expense" }],
    ["balance sheet", { incomeBalance: "Balance Sheet" }]
  ])("rejects %s before any write", async (_, invalid) => {
    const { client, writes } = database({
      ...shipping,
      ...(invalid as object)
    });
    const result = await updateDefaultIncomeAccounts(
      client,
      payload({ salesShippingRevenueAccount: "shipping" })
    );
    expect(result.error).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
  });

  it("rejects the effective Sales account even when shipping was omitted", async () => {
    const { client, writes } = database();
    const { salesShippingRevenueAccount: _, ...older } = income;
    const result = await updateDefaultIncomeAccounts(client, {
      ...defaultIncomeAcountValidator.parse({
        ...older,
        salesAccount: "shipping"
      }),
      companyId: "company",
      updatedBy: "user"
    });
    expect(result.error).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
  });

  it("refuses an unknown company without writing another company's defaults", async () => {
    const { client, writes } = database();
    const result = await updateDefaultIncomeAccounts(client, {
      ...payload({ salesShippingRevenueAccount: "shipping" }),
      companyId: "other"
    });
    expect(result.error).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
  });
});
