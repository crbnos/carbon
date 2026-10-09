// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import type { z } from "zod";
import type { projectValidator } from "./projects.models";
import { defaultProjectStates } from "./projects.models";

/**
 * Creates a project with its six default states, in one transaction. A new
 * project starts in Draft, so nothing can charge it before it is released.
 * When `identifier` is empty, the SQL function `derive_project_identifier`
 * picks a unique one from the name.
 */
export async function createProject(
  db: Kysely<KyselyDatabase>,
  args: Omit<z.infer<typeof projectValidator>, "id"> & {
    companyId: string;
    userId: string;
  }
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .insertInto("project")
      .values({
        name: args.name,
        identifier: args.identifier
          ? args.identifier
          : sql<string>`derive_project_identifier(${args.name}, ${args.companyId})`,
        description: args.description ?? null,
        status: "Draft",
        costTreatment: args.costTreatment,
        costAccountId: args.costAccountId ?? null,
        customerId: args.customerId ?? null,
        ownerId: args.ownerId ?? null,
        locationId: args.locationId ?? null,
        startDate: args.startDate ?? null,
        endDate: args.endDate ?? null,
        priority: args.priority ?? "None",
        active: true,
        companyId: args.companyId,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("projectState")
      .values(
        defaultProjectStates.map((state) => ({
          projectId: project.id,
          companyId: args.companyId,
          name: state.name,
          group: state.group,
          color: state.color,
          sortOrder: state.sortOrder,
          isDefault: state.isDefault,
          createdBy: args.userId
        }))
      )
      .execute();

    return project.id;
  });
}
