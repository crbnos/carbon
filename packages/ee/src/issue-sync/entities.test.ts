// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  isSyncedEntityType,
  syncedEntities,
  syncedEntityParentId
} from "./entities";

describe("syncedEntities", () => {
  it("knows the two action task tables", () => {
    expect(isSyncedEntityType("nonConformanceActionTask")).toBe(true);
    expect(isSyncedEntityType("changeOrderActionTask")).toBe(true);
    expect(isSyncedEntityType("projectElement")).toBe(true);
    expect(isSyncedEntityType("job")).toBe(false);
    expect(isSyncedEntityType(null)).toBe(false);
  });

  it("links back to the parent's details page", () => {
    expect(
      syncedEntities.nonConformanceActionTask.detailPath("ncr1", "t1")
    ).toBe("/x/issue/ncr1/details");
    expect(syncedEntities.changeOrderActionTask.detailPath("co1", "t1")).toBe(
      "/x/items/change-notice/co1/details"
    );
  });

  it("links an element to its own page", () => {
    expect(syncedEntities.projectElement.detailPath("p1", "e1")).toBe(
      "/x/project/p1/element/e1"
    );
  });

  it("reads the parent id from a selected row", () => {
    expect(
      syncedEntityParentId([{ changeOrderId: "co1" }], "changeOrderActionTask")
    ).toBe("co1");
    expect(syncedEntityParentId(null, "changeOrderActionTask")).toBeNull();
  });
});
