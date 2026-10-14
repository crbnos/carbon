// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  type MappableChartAccount,
  selectRequiredMappingAccountIds,
  selectUnmappedRequiredAccounts
} from "./account-mapping";
import { isAccountingSyncEnabled, syncEnabledOnConnect } from "./models";

describe("isAccountingSyncEnabled", () => {
  it("is off only when the flag is explicitly false", () => {
    expect(isAccountingSyncEnabled({ settings: { syncEnabled: false } })).toBe(
      false
    );
    expect(isAccountingSyncEnabled({ settings: { syncEnabled: true } })).toBe(
      true
    );
  });

  it("treats a row that predates the switch as on", () => {
    expect(isAccountingSyncEnabled({ settings: { postingSync: {} } })).toBe(
      true
    );
    expect(isAccountingSyncEnabled({ credentials: {} })).toBe(true);
    expect(isAccountingSyncEnabled(null)).toBe(true);
  });
});

describe("syncEnabledOnConnect", () => {
  const live = (organization: Record<string, string>) => ({
    settings: { syncEnabled: true },
    credentials: { type: "oauth2", providerMetadata: organization }
  });

  it("starts a first connection off", () => {
    expect(syncEnabledOnConnect(null, "tenant-1")).toBe(false);
    expect(syncEnabledOnConnect(undefined, "realm-1")).toBe(false);
  });

  it("keeps a live integration on when it reconnects to the same organization", () => {
    expect(
      syncEnabledOnConnect(live({ tenantId: "tenant-1" }), "tenant-1")
    ).toBe(true);
    expect(syncEnabledOnConnect(live({ realmId: "realm-1" }), "realm-1")).toBe(
      true
    );
  });

  it("keeps a legacy row (no flag, id on credentials) on for the same organization", () => {
    expect(
      syncEnabledOnConnect(
        { credentials: { tenantId: "tenant-1" } },
        "tenant-1"
      )
    ).toBe(true);
  });

  it("starts off when the organization changes", () => {
    expect(
      syncEnabledOnConnect(live({ tenantId: "tenant-1" }), "tenant-2")
    ).toBe(false);
  });

  it("keeps a switched-off integration off on reconnect", () => {
    expect(
      syncEnabledOnConnect(
        {
          settings: { syncEnabled: false },
          credentials: { providerMetadata: { tenantId: "tenant-1" } }
        },
        "tenant-1"
      )
    ).toBe(false);
  });
});

describe("required account mapping", () => {
  const chart: MappableChartAccount[] = [
    {
      id: "sales",
      number: "4000",
      name: "Sales",
      class: "Revenue",
      accountType: null
    },
    {
      id: "rent",
      number: "6100",
      name: "Rent",
      class: "Expense",
      accountType: null
    },
    {
      id: "travel",
      number: "6200",
      name: "Travel",
      class: "Expense",
      accountType: null
    },
    {
      id: "cash",
      number: "1000",
      name: "Cash",
      class: "Asset",
      accountType: null
    }
  ];

  it("requires every posting-default account plus every Expense account", () => {
    expect(
      selectRequiredMappingAccountIds(["sales", "rent"], chart).sort()
    ).toEqual(["rent", "sales", "travel"]);
  });

  it("lists required accounts that are not mapped, ignoring optional ones", () => {
    expect(
      selectUnmappedRequiredAccounts({
        accountDefaultIds: ["sales"],
        chart,
        mappedAccountIds: new Set(["rent", "cash"])
      })
    ).toEqual([
      { id: "sales", number: "4000", name: "Sales" },
      { id: "travel", number: "6200", name: "Travel" }
    ]);
  });

  it("is empty once every required account is mapped", () => {
    expect(
      selectUnmappedRequiredAccounts({
        accountDefaultIds: ["sales"],
        chart,
        mappedAccountIds: new Set(["sales", "rent", "travel"])
      })
    ).toEqual([]);
  });

  it("ignores a posting default that is not an active leaf account", () => {
    expect(
      selectUnmappedRequiredAccounts({
        accountDefaultIds: ["inactive-account"],
        chart: [],
        mappedAccountIds: new Set()
      })
    ).toEqual([]);
  });
});
