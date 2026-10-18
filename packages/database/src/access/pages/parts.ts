// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

// The Items module keeps its permission name, `parts`.

/** The Items tables that hang off one item: each checks the item's type through `itemId`. */
const ITEM_CHILDREN = [
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
].map((table) => ({ table, via: "itemId" }));

/** Restricted tables of other pages that an item's costing and planning tabs read. */
const ITEM_READERS = ["costLedger", "demandActual", "supplyActual"];

export const PARTS_PAGES = [
  {
    id: "parts.parts",
    label: "Parts",
    maxLevel: "Full",
    // ponytail: the method tables and supplier prices reach their item through
    // a second table (makeMethod, supplierPart), and an item points at its
    // model. `children` names neither, so they sit on Parts for every item type.
    tables: [
      "item",
      "part",
      "methodMaterial",
      "methodMaterialStep",
      "methodOperation",
      "methodOperationParameter",
      "methodOperationStep",
      "methodOperationStepSlide",
      "methodOperationTool",
      "methodOperationToolStep",
      "supplierPartPrice",
      "modelUpload"
    ],
    where: { table: "item", column: "type", value: "Part" },
    children: ITEM_CHILDREN,
    readers: ITEM_READERS,
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
