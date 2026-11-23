// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { expect } from "vitest";
import { approveTimesheetEntries } from "../../../app/modules/projects/projects.server";
import { databaseTest } from "../fixtures/local-database";
import { localServiceRoleClient } from "../fixtures/local-supabase";
import {
  PROJECT_TEST_USER as USER,
  projectPostingFixture
} from "../fixtures/project-posting";

databaseTest(
  "time whose post fails goes back to wait for approval",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const client = localServiceRoleClient();
      if (!client) throw new Error("This test needs the local stack");
      const entry = await f.db
        .insertInto("timesheetEntry")
        .values({
          employeeId: USER,
          entryDate: "2026-10-05",
          projectId: f.projectId,
          projectElementId: f.elementId,
          laborCategoryId: f.laborCategoryId,
          hours: 6,
          status: "Submitted",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      // A project on hold takes no new time, so the post refuses.
      await f.db
        .updateTable("project")
        .set({ status: "On Hold" })
        .where("id", "=", f.projectId)
        .execute();

      const result = await approveTimesheetEntries(
        createServiceContext({
          actor: { type: "system", onBehalfOf: USER },
          company: { id: f.companyId, groupId: f.groupId },
          caller: client as never,
          system: () => client as never,
          pg: () => f.db,
          kv: () => {
            throw new Error("The operation takes no kv");
          }
        }),
        { ids: [entry.id] }
      );

      expect(result.error).toBeNull();
      expect(result.data?.postingError).toBeTruthy();
      const row = await f.db
        .selectFrom("timesheetEntry")
        .select(["status", "approvedBy", "approvedAt"])
        .where("id", "=", entry.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        status: "Submitted",
        approvedBy: null,
        approvedAt: null
      });
    } finally {
      await f.cleanup();
    }
  }
);
