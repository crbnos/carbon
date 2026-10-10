// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// responsibleEmployee ownership ladder (spec §P1.3): resolve who owns an
// item+location's planning actions, most-specific first. Drawn as a tree it is
// company default → location → location-specific item group → item; resolution
// walks the rungs leaf-first and returns the first non-null. An action in a
// project segment tries the project's manager (`project.ownerId`) before all
// of them.
//
// This is a hierarchical inheritance tree, NOT a classification matrix: each
// rung stores at most one employee, and the item-group rung is looked up by
// (locationId, itemPostingGroupId) from the sparse itemPostingGroupResponsibility
// table — the same group can have a different owner at each location.

import type { DB } from "@carbon/database/client";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import type { Kysely } from "kysely";

export type ResponsibleEmployeeRungs = {
  /** project.ownerId of the action's segment project — segmented rows only */
  projectManager?: string | null;
  /** itemPlanning.responsibleEmployee for (itemId, locationId) — leaf override */
  item: string | null;
  /** itemPostingGroupResponsibility for (locationId, group) — location-specific */
  itemGroup: string | null;
  /** location.responsibleEmployee */
  location: string | null;
  /** companySettings.defaultResponsibleEmployee */
  company: string | null;
};

export function resolveResponsibleEmployee(
  rungs: ResponsibleEmployeeRungs
): string | null {
  return (
    rungs.projectManager ??
    rungs.item ??
    rungs.itemGroup ??
    rungs.location ??
    rungs.company ??
    null
  );
}

export type ResponsibleEmployeeResolver = (
  itemId: string,
  locationId: string,
  /** the action's netting segment; '' (common) has no project rung */
  segmentId?: string
) => string | null;

/**
 * Bulk-load every rung for a company in a handful of set queries (never
 * per-item), returning a resolver closure the action generator calls per
 * (itemId, locationId).
 */
export async function loadResponsibleEmployeeResolver(
  db: Kysely<DB>,
  companyId: string
): Promise<ResponsibleEmployeeResolver> {
  const [
    itemPlanningRows,
    itemGroups,
    groupResponsibilities,
    locations,
    settings,
    segmentProjects
  ] = await Promise.all([
    db
      .selectFrom("itemPlanning")
      .select(["itemId", "locationId", "responsibleEmployee"])
      .where("companyId", "=", companyId)
      .where("responsibleEmployee", "is not", null)
      .execute(),
    db
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId"])
      .where("companyId", "=", companyId)
      .where("itemPostingGroupId", "is not", null)
      .execute(),
    db
      .selectFrom("itemPostingGroupResponsibility")
      .select(["locationId", "itemPostingGroupId", "responsibleEmployee"])
      .where("companyId", "=", companyId)
      .where("responsibleEmployee", "is not", null)
      .execute(),
    db
      .selectFrom("location")
      .select(["id", "responsibleEmployee"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("companySettings")
      .select(["defaultResponsibleEmployee"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    // The managers of the projects that are netting segments: a project with
    // project stock is its own segment (project_planning_segment).
    db
      .selectFrom("project")
      .select(["id", "ownerId"])
      .where("companyId", "=", companyId)
      .where("projectStock", "=", true)
      .where("ownerId", "is not", null)
      .execute()
  ]);

  const itemRung = new Map<string, string>();
  for (const row of itemPlanningRows) {
    if (row.responsibleEmployee) {
      itemRung.set(
        `${row.itemId}${KEY_SEP}${row.locationId}`,
        row.responsibleEmployee
      );
    }
  }

  const groupByItem = new Map<string, string>();
  for (const row of itemGroups) {
    if (row.itemPostingGroupId) {
      groupByItem.set(row.itemId, row.itemPostingGroupId);
    }
  }

  const groupRung = new Map<string, string>();
  for (const row of groupResponsibilities) {
    if (row.responsibleEmployee) {
      groupRung.set(
        `${row.locationId}${KEY_SEP}${row.itemPostingGroupId}`,
        row.responsibleEmployee
      );
    }
  }

  const locationRung = new Map<string, string | null>();
  for (const row of locations) {
    locationRung.set(row.id, row.responsibleEmployee ?? null);
  }

  const companyDefault = settings?.defaultResponsibleEmployee ?? null;

  const managerBySegment = new Map<string, string>();
  for (const row of segmentProjects) {
    if (row.ownerId) managerBySegment.set(row.id, row.ownerId);
  }

  return (
    itemId: string,
    locationId: string,
    segmentId: string = COMMON_SEGMENT
  ) => {
    const group = groupByItem.get(itemId);
    return resolveResponsibleEmployee({
      projectManager:
        segmentId === COMMON_SEGMENT
          ? null
          : (managerBySegment.get(segmentId) ?? null),
      item: itemRung.get(`${itemId}${KEY_SEP}${locationId}`) ?? null,
      itemGroup: group
        ? (groupRung.get(`${locationId}${KEY_SEP}${group}`) ?? null)
        : null,
      location: locationRung.get(locationId) ?? null,
      company: companyDefault
    });
  };
}
