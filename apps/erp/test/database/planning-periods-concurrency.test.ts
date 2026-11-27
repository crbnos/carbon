// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { expect } from "vitest";
import { getOrCreatePeriods } from "../../app/modules/shared/shared.service";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

const CALLERS = 4;
const WEEKS = 3;
// A Friday in a year no other test or seed plans: the table is global.
const TODAY = "2417-03-10";

const clearWeeks = (db: Awaited<ReturnType<typeof connectLocalTestDatabase>>) =>
  db
    .deleteFrom("period")
    .where("periodType", "=", "Week")
    .where("startDate", ">=", "2417-01-01")
    .where("startDate", "<=", "2417-12-31")
    .execute();

// `period` is shared by every company and has no unique key on a week, so
// only the writers' lock keeps two first opens of a planning screen from
// both inserting the same week.
databaseTest(
  "concurrent first reads of the planning weeks insert each week once",
  async () => {
    const connections = await Promise.all(
      Array.from({ length: CALLERS }, () => connectLocalTestDatabase())
    );
    const [db] = connections;
    try {
      await clearWeeks(db!);
      const results = await Promise.all(
        connections.map((connection) =>
          getOrCreatePeriods(connection, parseDate(TODAY), WEEKS)
        )
      );

      const stored = await db!
        .selectFrom("period")
        .select(["id", "startDate"])
        .where("periodType", "=", "Week")
        .where("startDate", ">=", "2417-01-01")
        .where("startDate", "<=", "2417-12-31")
        .orderBy("startDate")
        .execute();
      // The week of a Friday starts on the Sunday before it.
      expect(stored.map((row) => row.startDate)).toEqual([
        "2417-03-05",
        "2417-03-12",
        "2417-03-19"
      ]);
      const ids = stored.map((row) => row.id);
      for (const periods of results) {
        expect(periods.map((period) => period.id)).toEqual(ids);
      }
    } finally {
      await clearWeeks(db!);
      await Promise.all(connections.map((connection) => connection.destroy()));
    }
  }
);
