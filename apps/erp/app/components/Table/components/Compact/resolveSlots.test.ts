// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Column } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSlots } from "./resolveSlots";

type Row = Record<string, unknown>;

const col = (id: string, meta: Record<string, unknown> = {}) =>
  ({ id, columnDef: { meta } }) as unknown as Column<Row, unknown>;

const status = (id: string, mobile?: string) =>
  col(id, { mobile, filter: { type: "static", options: [] } });

afterEach(() => vi.restoreAllMocks());

describe("resolveSlots", () => {
  it("fills slots from explicit priorities", () => {
    const number = col("number", { mobile: "P1" });
    const supplier = col("supplier", { mobile: "P3" });
    const state = status("status", "P2");
    const total = col("total", { mobile: "P2" });
    const slots = resolveSlots([
      col("Select"),
      number,
      supplier,
      state,
      total,
      col("createdAt")
    ]);
    expect(slots?.p1).toBe(number);
    expect(slots?.p2).toBe(total);
    expect(slots?.p3).toBe(supplier);
    expect(slots?.pills).toEqual([state]);
  });

  it("puts an action column in the action slot only", () => {
    const id = col("id", { mobile: "P1" });
    const order = col("order", { mobile: "action" });
    const slots = resolveSlots([id, order]);
    expect(slots?.action).toBe(order);
    expect(slots?.p2).toBeUndefined();
    expect(slots?.p3).toBeUndefined();
    expect(slots?.pills).toEqual([]);
  });

  it("falls back to the first data column and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const name = col("name");
    const slots = resolveSlots([col("Select"), name, col("other")], "Parts");
    expect(slots?.p1).toBe(name);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Parts"));
  });

  it("never uses the select, actions or expand columns", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      resolveSlots([col("Select"), col("Expand"), col("Actions")])
    ).toBeNull();
    const id = col("id");
    expect(resolveSlots([col("Expand"), col("Actions"), id])?.p1).toBe(id);
  });

  it("caps status pills at two", () => {
    const pills = [status("a", "P2"), status("b", "P2"), status("c", "P2")];
    const slots = resolveSlots([col("id", { mobile: "P1" }), ...pills]);
    expect(slots?.pills).toEqual(pills.slice(0, 2));
    expect(slots?.p2).toBeUndefined();
  });
});
