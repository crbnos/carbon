// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  defaultAccountValidator,
  defaultIncomeAcountValidator
} from "./accounting.models";
import {
  getDefaultAccounts,
  updateDefaultAccounts
} from "./accounting.service";

const income = Object.fromEntries(
  Object.keys(defaultIncomeAcountValidator.shape).map((key) => [
    key,
    `${key}-id`
  ])
);
const allAccounts = Object.fromEntries(
  Object.keys(defaultAccountValidator.shape).map((key) => [key, `${key}-id`])
);
const defaults = {
  ...allAccounts,
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
  return { client, writes, rows };
}

function payload(overrides: Record<string, string> = {}) {
  return {
    ...defaultAccountValidator.parse({
      ...allAccounts,
      salesAccount: "sales",
      ...overrides
    }),
    companyId: "company",
    updatedBy: "user"
  };
}

describe("shipping revenue defaults", () => {
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
    const { salesShippingRevenueAccount: _, ...older } = allAccounts;
    const parsed = defaultAccountValidator.parse({
      ...older,
      salesAccount: "sales"
    });
    const { client, writes } = database();
    const result = await updateDefaultAccounts(client, {
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
    const result = await updateDefaultAccounts(
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
    const result = await updateDefaultAccounts(
      client,
      payload({ salesShippingRevenueAccount: "shipping" })
    );
    expect(result.error).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
  });

  it("rejects the effective Sales account even when shipping was omitted", async () => {
    const { client, writes } = database();
    const { salesShippingRevenueAccount: _, ...older } = allAccounts;
    const result = await updateDefaultAccounts(client, {
      ...defaultAccountValidator.parse({
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
    const result = await updateDefaultAccounts(client, {
      ...payload({ salesShippingRevenueAccount: "shipping" }),
      companyId: "other"
    });
    expect(result.error).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
  });
});
