// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it } from "vitest";
import {
  loadResponsibleEmployeeResolver,
  resolveResponsibleEmployee
} from "./responsible-employee";

describe("resolveResponsibleEmployee", () => {
  it("item overrides group, location, and company", () => {
    expect(
      resolveResponsibleEmployee({
        item: "item-owner",
        itemGroup: "group-owner",
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("item-owner");
  });

  it("location-specific item group beats location and company", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: "group-owner",
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("group-owner");
  });

  it("location beats company", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("location-owner");
  });

  it("falls back to the company default", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: null,
        company: "company-owner"
      })
    ).toBe("company-owner");
  });

  it("returns null (Unassigned) when every rung is empty", () => {
    expect(
      resolveResponsibleEmployee({
        item: null,
        itemGroup: null,
        location: null,
        company: null
      })
    ).toBeNull();
  });

  // An action in a project segment belongs to the project's manager first.
  it("assigns a project segment's action to the project's manager", () => {
    expect(
      resolveResponsibleEmployee({
        projectManager: "project-manager",
        item: "item-owner",
        itemGroup: "group-owner",
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("project-manager");
  });

  it("continues down the ladder when the project has no manager", () => {
    expect(
      resolveResponsibleEmployee({
        projectManager: null,
        item: null,
        itemGroup: null,
        location: "location-owner",
        company: "company-owner"
      })
    ).toBe("location-owner");
  });
});

describe("loadResponsibleEmployeeResolver", () => {
  // The database answers each rung's read by its table.
  const TABLES: Record<string, Record<string, unknown>[]> = {
    location: [{ id: "l1", responsibleEmployee: "location-owner" }],
    project: [{ id: "prj_1", ownerId: "project-manager" }]
  };

  class TableDriver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <R>(
          query: CompiledQuery
        ): Promise<QueryResult<R>> => {
          const table = query.sql.match(/from "(\w+)"/)?.[1] ?? "";
          return { rows: (TABLES[table] ?? []) as R[] };
        },
        // biome-ignore lint/correctness/useYield: never streamed
        streamQuery: async function* () {
          throw new Error("not streamed");
        }
      };
    }
  }

  it("gives a project segment's action to the project's manager", async () => {
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new TableDriver(),
        createIntrospector: (k) => new PostgresIntrospector(k),
        createQueryCompiler: () => new PostgresQueryCompiler()
      }
    });
    const resolve = await loadResponsibleEmployeeResolver(db, "c1");

    expect(resolve("i1", "l1", "prj_1")).toBe("project-manager");
    // common stock, and a project with no manager, keep the ladder
    expect(resolve("i1", "l1")).toBe("location-owner");
    expect(resolve("i1", "l1", "prj_2")).toBe("location-owner");
  });
});
