// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { loadDbTableColumnTypes } from "./db-columns";
import { COUNTER_COLUMNS, statusColumns } from "./guarded-columns";
import { repoRoot } from "./migrations";

describe("statusColumns over the generated types", () => {
  const real = statusColumns(loadDbTableColumnTypes(repoRoot()));

  it("finds the lifecycle columns the shipped bugs wrote", () => {
    expect(real.get("accountingPeriod")?.has("closeStatus")).toBe(true);
    expect(real.get("quote")?.has("status")).toBe(true);
    expect(real.get("receipt")?.has("status")).toBe(true);
    expect(real.get("salesInvoice")?.has("status")).toBe(true);
  });

  it("leaves out classifications, results and history logs", () => {
    expect(real.has("employeeJob")).toBe(false);
    expect(real.has("salesOrderStatusHistory")).toBe(false);
    expect(real.get("gauge")).toBeUndefined();
  });
});

describe("COUNTER_COLUMNS over the generated types", () => {
  it("are numeric columns the schema really has", () => {
    const types = loadDbTableColumnTypes(repoRoot());
    const numeric = new Set<string>();
    for (const columns of types.values()) {
      for (const [name, type] of columns) {
        if (/^number\b/.test(type)) numeric.add(name);
      }
    }
    const missing = [...COUNTER_COLUMNS].filter((c) => !numeric.has(c));
    expect(missing).toEqual([]);
  });
});
