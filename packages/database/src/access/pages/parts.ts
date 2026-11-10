// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Child, Hop, Page } from "../registry";

/** The module's name in the sidebar. Its id stays `parts`, the permission name. */
export const LABEL = "Items";

const ITEM: Hop = ["itemId", "item"];
const MAKE_METHOD: Hop = ["makeMethodId", "makeMethod"];
const OPERATION: Hop = ["operationId", "methodOperation"];

/**
 * The Items tables that hang off one item: each checks the item's type through
 * `itemId`, or through the hops of its `path` (a method's lines reach the item
 * through `makeMethod`).
 */
const ITEM_CHILDREN: readonly Child[] = [
  ...[
    "batchProperty",
    "configurationParameter",
    "configurationParameterGroup",
    "configurationRule",
    "customerPartToItem",
    "itemCost",
    "itemPlanning",
    "itemReplenishment",
    "itemShelfLife",
    "itemSupersession",
    "itemUnitSalePrice",
    "makeMethod",
    "pickMethod",
    "supplierPart"
  ].map((table) => ({ table, via: "itemId" })),
  {
    table: "supplierPartPrice",
    path: [["supplierPartId", "supplierPart"], ITEM]
  },
  { table: "methodMaterial", path: [MAKE_METHOD, ITEM] },
  { table: "methodOperation", path: [MAKE_METHOD, ITEM] },
  {
    table: "methodMaterialStep",
    path: [["methodMaterialId", "methodMaterial"], MAKE_METHOD, ITEM]
  },
  { table: "methodOperationParameter", path: [OPERATION, MAKE_METHOD, ITEM] },
  { table: "methodOperationStep", path: [OPERATION, MAKE_METHOD, ITEM] },
  { table: "methodOperationTool", path: [OPERATION, MAKE_METHOD, ITEM] },
  {
    table: "methodOperationStepSlide",
    path: [["stepId", "methodOperationStep"], OPERATION, MAKE_METHOD, ITEM]
  },
  {
    table: "methodOperationToolStep",
    path: [
      ["methodOperationToolId", "methodOperationTool"],
      OPERATION,
      MAKE_METHOD,
      ITEM
    ]
  }
];

/** The item pages, one per item type: they share `item` by `type`. */
export const ITEM_PAGE_IDS = [
  "parts.parts",
  "parts.materials",
  "parts.tools",
  "parts.consumables",
  "parts.services"
] as const;

/** Item tables that moved here and keep the page that wrote them before (Page.alsoWrittenBy). */
const ITEM_ALSO_WRITTEN_BY = {
  batchProperty: ["inventory.trackedEntities"],
  methodOperationStep: ["production.jobs"],
  methodOperationStepSlide: ["production.jobs"]
};

/** Restricted tables of other pages that an item's costing and planning tabs read. */
const ITEM_READERS = ["costLedger", "demandActual", "supplyActual"];

export const PAGES = [
  {
    id: "parts.parts",
    label: "Parts",
    maxLevel: "Full",
    // An item points at its model (`item.modelUploadId`), and quotes, orders
    // and jobs point at models too: no one row names the page, so the
    // models table sits on Parts and every item page writes it.
    tables: ["item", "part", "modelUpload"],
    where: { table: "item", column: "type", value: "Part" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
    alsoWrittenBy: {
      ...ITEM_ALSO_WRITTEN_BY,
      modelUpload: ITEM_PAGE_IDS.filter((id) => id !== "parts.parts")
    },
    paths: ["/x/items/parts", "/x/part/"]
  },
  {
    id: "parts.materials",
    label: "Materials",
    maxLevel: "Full",
    tables: ["item", "material"],
    where: { table: "item", column: "type", value: "Material" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
    alsoWrittenBy: ITEM_ALSO_WRITTEN_BY,
    paths: ["/x/items/materials", "/x/material/"]
  },
  {
    id: "parts.tools",
    label: "Tools",
    maxLevel: "Full",
    tables: ["item", "tool"],
    where: { table: "item", column: "type", value: "Tool" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
    alsoWrittenBy: ITEM_ALSO_WRITTEN_BY,
    paths: ["/x/items/tools", "/x/tool/"]
  },
  {
    id: "parts.consumables",
    label: "Consumables",
    maxLevel: "Full",
    tables: ["item", "consumable"],
    where: { table: "item", column: "type", value: "Consumable" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
    alsoWrittenBy: ITEM_ALSO_WRITTEN_BY,
    paths: ["/x/items/consumables", "/x/consumable/"]
  },
  {
    id: "parts.services",
    label: "Services",
    maxLevel: "Full",
    tables: ["item", "service"],
    where: { table: "item", column: "type", value: "Service" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
    alsoWrittenBy: ITEM_ALSO_WRITTEN_BY,
    paths: ["/x/items/services", "/x/service/"]
  },
  {
    id: "parts.changeNotices",
    label: "Change Notices",
    maxLevel: "Full",
    tables: [
      "changeOrder",
      "changeOrderActionTask",
      "changeOrderAffectedItem",
      "changeOrderSupersession"
    ],
    paths: [
      "/x/items/change-notices",
      "/x/items/change-notice/",
      "/x/change-notice/"
    ]
  },
  {
    id: "parts.changeNoticeTypes",
    label: "Change Notice Types",
    maxLevel: "Full",
    tables: ["changeOrderType"],
    paths: ["/x/items/change-notice-types"]
  },
  {
    id: "parts.changeNoticeActions",
    label: "Change Notice Actions",
    maxLevel: "Full",
    tables: ["changeOrderRequiredAction"],
    paths: ["/x/items/change-notice-actions"]
  },
  {
    id: "parts.dimensions",
    label: "Dimensions",
    maxLevel: "Full",
    tables: ["materialDimension"],
    paths: ["/x/items/dimensions"]
  },
  {
    id: "parts.finishes",
    label: "Finishes",
    maxLevel: "Full",
    tables: ["materialFinish"],
    paths: ["/x/items/finishes"]
  },
  {
    id: "parts.grades",
    label: "Grades",
    maxLevel: "Full",
    tables: ["materialGrade"],
    paths: ["/x/items/grades"]
  },
  {
    id: "parts.shapes",
    label: "Shapes",
    maxLevel: "Full",
    tables: ["materialForm"],
    paths: ["/x/items/forms"]
  },
  {
    id: "parts.substances",
    label: "Substances",
    maxLevel: "Full",
    tables: ["materialSubstance"],
    paths: ["/x/items/substances"]
  },
  {
    id: "parts.types",
    label: "Types",
    maxLevel: "Full",
    tables: ["materialType"],
    paths: ["/x/items/types"]
  },
  {
    id: "parts.itemGroups",
    label: "Item Groups",
    maxLevel: "Full",
    tables: ["itemPostingGroup"],
    paths: ["/x/items/groups"]
  },
  {
    id: "parts.units",
    label: "Units",
    maxLevel: "Full",
    tables: ["unitOfMeasure"],
    paths: ["/x/items/uom"]
  }
] as const satisfies readonly Page[];
