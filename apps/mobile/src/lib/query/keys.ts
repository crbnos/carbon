// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * EVERY query key in the app comes from here, and every one starts with the
 * instance and company.
 *
 * `.ai/lessons.md`: "Client-side entity caches must be company-keyed in a
 * multi-tenant app" — a multi-company user passes RLS for both companies, so
 * nothing server-side notices a cache from the wrong one. The instance id is in
 * front of the company id because a company id is NOT unique across instances:
 * a staging Carbon restored from a production backup has the same ids.
 */
export type Scope = { instanceId: string; companyId: string };

export const keys = {
  me: (s: Scope) => ["me", s.instanceId, s.companyId] as const,
  operations: (s: Scope, locationId: string, workCenterIds: string[]) =>
    [
      "operations",
      s.instanceId,
      s.companyId,
      locationId,
      [...workCenterIds].sort().join(",")
    ] as const,
  operation: (s: Scope, operationId: string) =>
    ["operation", s.instanceId, s.companyId, operationId] as const,
  reworkTargets: (s: Scope, operationId: string) =>
    ["rework-targets", s.instanceId, s.companyId, operationId] as const,
  picking: (s: Scope) => ["picking", s.instanceId, s.companyId] as const,
  pickingList: (s: Scope, listId: string) =>
    ["picking-list", s.instanceId, s.companyId, listId] as const,
  pickingTrackedOptions: (s: Scope, listId: string, lineId: string) =>
    [
      "picking-tracked-options",
      s.instanceId,
      s.companyId,
      listId,
      lineId
    ] as const,
  /**
   * `itemTrackingType` for the items on one picking list. Keyed by the list AND
   * by a fingerprint of the item ids, so a list whose lines change does not
   * read a tracking map built for the old set of items.
   */
  pickingItemTracking: (s: Scope, listId: string, itemFingerprint: string) =>
    [
      "picking-item-tracking",
      s.instanceId,
      s.companyId,
      listId,
      itemFingerprint
    ] as const,
  timecard: (s: Scope, weekOffset: number) =>
    ["timecard", s.instanceId, s.companyId, weekOffset] as const,
  operators: (s: Scope) => ["operators", s.instanceId, s.companyId] as const,
  scrapReasons: (s: Scope) =>
    ["scrap-reasons", s.instanceId, s.companyId] as const
} as const;

/** Everything cached for one instance, for a switch or a sign-out. */
export const instancePrefix = (instanceId: string) => [instanceId] as const;
