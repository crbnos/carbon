// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  createWorkflowCatalog,
  entityValue,
  type RuntimeContext,
  resolveRef
} from "@carbon/ee/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runSearch } from "./actions/search";
import { createEntityLoader } from "./engine/loader";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The column of a membership table that points at its parent's id. */
const EMBED_KEYS: Record<string, string> = { userToCompany: "userId" };

/**
 * An in-memory PostgREST: keeps rows, applies filters, answers an `!inner`
 * embed with only the parents that have a matching child, and fails a filter
 * on a column the table does not have, as PostgREST does.
 */
function createDatabase(tables: Tables) {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const columns = new Set(rows.flatMap((row) => Object.keys(row)));
    const filters: ((row: Row) => boolean)[] = [];
    const embedFilters: Record<string, unknown> = {};
    let embed: string | undefined;
    let missingColumn: string | undefined;
    let limit = Number.POSITIVE_INFINITY;

    const read = () => {
      if (missingColumn !== undefined) {
        return {
          data: null,
          error: { message: `column ${table}.${missingColumn} does not exist` }
        };
      }
      const data: Row[] = [];
      for (const row of rows) {
        if (!filters.every((test) => test(row))) continue;
        if (embed === undefined) {
          data.push(row);
          continue;
        }
        const key = EMBED_KEYS[embed] as string;
        const children = (tables[embed] ?? []).filter(
          (child) =>
            child[key] === row.id &&
            Object.entries(embedFilters).every(
              ([column, value]) => child[column] === value
            )
        );
        if (children.length > 0) data.push({ ...row, [embed]: children });
      }
      return { data: data.slice(0, limit), error: null };
    };

    const chain = {
      select: (selected: string) => {
        embed = /(\w+)!inner\(/.exec(selected)?.[1];
        return chain;
      },
      eq: (column: string, value: unknown) => {
        const [first, second] = column.split(".");
        if (second !== undefined && first === embed) {
          embedFilters[second] = value;
        } else if (!columns.has(column)) {
          missingColumn = column;
        } else {
          filters.push((row) => row[column] === value);
        }
        return chain;
      },
      ilike: (column: string, pattern: string) => {
        const needle = pattern.replaceAll("%", "").toLowerCase();
        filters.push((row) =>
          String(row[column] ?? "")
            .toLowerCase()
            .includes(needle)
        );
        return chain;
      },
      order: () => chain,
      limit: (count: number) => {
        limit = count;
        return Promise.resolve(read());
      },
      maybeSingle: async () => {
        const { data, error } = read();
        return { data: data?.[0] ?? null, error };
      }
    };
    return chain;
  };

  return { from } as unknown as SupabaseClient<Database>;
}

const COMPANY = "co1";

const here = {
  id: "usr_here",
  email: "here@example.com",
  fullName: "Ada Here",
  createdAt: "2026-01-01T00:00:00Z"
};
const elsewhere = {
  id: "usr_elsewhere",
  email: "elsewhere@example.com",
  fullName: "Bo Elsewhere",
  createdAt: "2026-01-02T00:00:00Z"
};

const client = createDatabase({
  user: [here, elsewhere],
  userToCompany: [
    { userId: "usr_here", companyId: COMPANY },
    { userId: "usr_here", companyId: "co2" },
    { userId: "usr_elsewhere", companyId: "co2" }
  ],
  salesOrder: [
    { id: "so_1", companyId: COMPANY, salesOrderId: "SO000001" },
    { id: "so_2", companyId: "co2", salesOrderId: "SO000002" }
  ]
});

const loader = () =>
  createEntityLoader({ client, companyId: COMPANY, cache: new Map() });

describe("createEntityLoader", () => {
  it("reads a user of the company, though the user table has no companyId", async () => {
    expect(await loader().load("user", "usr_here")).toEqual(here);
  });

  it("does not read a user who belongs only to another company", async () => {
    expect(await loader().load("user", "usr_elsewhere")).toBeNull();
  });

  it("still scopes a company-owned record by its companyId", async () => {
    expect(await loader().load("salesOrder", "so_1")).toEqual({
      id: "so_1",
      companyId: COMPANY,
      salesOrderId: "SO000001"
    });
    expect(await loader().load("salesOrder", "so_2")).toBeNull();
  });

  it("resolves a moment's user output to the user's name", async () => {
    const ctx = {
      catalog: createWorkflowCatalog(),
      loader: loader(),
      outputs: { trigger: { overriddenBy: entityValue("user", "usr_here") } }
    } as unknown as RuntimeContext;

    const resolved = await resolveRef(
      {
        kind: "ref",
        nodeId: "trigger",
        output: "overriddenBy",
        path: ["fullName"]
      },
      ctx
    );

    expect(resolved).toEqual({
      ok: true,
      value: { kind: "primitive", of: "string", value: "Ada Here" }
    });
  });
});

describe("runSearch on users", () => {
  it("finds only the users of the company, without their memberships", async () => {
    const outcome = await runSearch({
      client,
      companyId: COMPANY,
      entity: "user",
      returns: "list",
      criteria: [
        {
          field: "email",
          operator: "contains",
          value: { kind: "primitive", of: "string", value: "example.com" }
        }
      ]
    });

    expect(outcome).toEqual({
      ok: true,
      value: {
        kind: "list",
        of: { kind: "entity", of: "user" },
        items: [entityValue("user", "usr_here", here)]
      },
      matched: 1,
      dropped: 0
    });
  });
});
