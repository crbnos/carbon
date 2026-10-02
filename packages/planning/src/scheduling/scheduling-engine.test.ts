// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { describe, expect, it } from "vitest";
import { isDistinctFromAny } from "./scheduling-engine.ts";

const db = new Kysely<any>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
});

describe("isDistinctFromAny", () => {
  it("guards an update on the columns it would change, skipping undefined", () => {
    const query = db
      .updateTable("jobOperation")
      .set({ startDate: "2026-10-05" })
      .where("id", "=", "op_1")
      .where(
        isDistinctFromAny({
          startDate: "2026-10-05",
          priority: undefined,
          dueDate: null
        })
      )
      .compile();

    expect(query.sql).toBe(
      'update "jobOperation" set "startDate" = $1 where "id" = $2 and ("startDate" is distinct from $3 or "dueDate" is distinct from $4)'
    );
    expect(query.parameters).toEqual([
      "2026-10-05",
      "op_1",
      "2026-10-05",
      null
    ]);
  });

  it("lets the write through when there is nothing to compare", () => {
    const query = db
      .updateTable("jobOperation")
      .set({ updatedBy: "u_1" })
      .where(isDistinctFromAny({ priority: undefined }))
      .compile();

    expect(query.sql).toBe(
      'update "jobOperation" set "updatedBy" = $1 where true'
    );
  });
});
