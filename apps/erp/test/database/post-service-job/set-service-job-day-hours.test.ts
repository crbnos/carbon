// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  SERVICE_DAY_HAS_CLOCK_TIME,
  setServiceJobDayHours
} from "../../../app/modules/service/service.service";
import { databaseTest } from "../fixtures/local-database";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

databaseTest(
  "My Time sets a day's total on a job through its one manual entry",
  async () => {
    const f = await serviceJobFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ serviceLaborItemId: f.laborItemId })
        .where("id", "=", f.companyId)
        .execute();
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId });
      const setDay = (hours: number, mustBeAssigned = false) =>
        setServiceJobDayHours(f.db, {
          companyId: f.companyId,
          userId: PROJECT_TEST_USER,
          employeeId: PROJECT_TEST_USER,
          serviceJobId: job.id,
          entryDate: "2026-10-01",
          hours,
          mustBeAssigned
        });
      const day = () =>
        f.db
          .selectFrom("serviceJobTime")
          .select(["hours", "startTime", "laborItemId", "billable"])
          .where("serviceJobId", "=", job.id)
          .orderBy("createdAt")
          .execute();

      // Not assigned and not the lead: refused.
      await expect(setDay(2, true)).rejects.toThrow(/assigned/);

      // A clock entry of 1.5 h and a new total of 3 h: 1.5 h manual.
      await f.db
        .insertInto("serviceJobTime")
        .values({
          serviceJobId: job.id,
          employeeId: PROJECT_TEST_USER,
          laborItemId: f.laborItemId,
          entryDate: "2026-10-01",
          startTime: "2026-10-01T08:00:00Z",
          endTime: "2026-10-01T09:30:00Z",
          hours: 1.5,
          companyId: f.companyId,
          createdBy: PROJECT_TEST_USER
        })
        .execute();
      expect(await setDay(3)).toEqual({ saved: true, warning: null });
      expect(
        (await day()).map((row) => [Number(row.hours), row.startTime !== null])
      ).toEqual([
        [1.5, true],
        [1.5, false]
      ]);
      const manual = (await day())[1];
      expect(manual?.laborItemId).toBe(f.laborItemId);
      expect(manual?.billable).toBe(true);

      // The same manual entry is saved again, never a second one.
      expect(await setDay(4)).toEqual({ saved: true, warning: null });
      expect((await day()).map((row) => Number(row.hours))).toEqual([1.5, 2.5]);

      // Below the clock time: nothing is written.
      expect(await setDay(1)).toEqual({
        saved: false,
        warning: SERVICE_DAY_HAS_CLOCK_TIME
      });
      expect((await day()).map((row) => Number(row.hours))).toEqual([1.5, 2.5]);

      // Equal to the clock time: the manual entry goes.
      expect(await setDay(1.5)).toEqual({ saved: true, warning: null });
      expect((await day()).map((row) => Number(row.hours))).toEqual([1.5]);

      // A closed job takes no time.
      await f.db
        .updateTable("serviceJob")
        .set({ status: "Completed" })
        .where("id", "=", job.id)
        .execute();
      await expect(setDay(3)).rejects.toThrow(/closed/);
    } finally {
      await f.cleanup();
    }
  }
);
