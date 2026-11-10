// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { anyOf, ITEM_PAGES } from "@carbon/database/access";
import {
  CHANGE_NOTICE_REQUIRED_ACTIONS_PAGING,
  CHANGE_NOTICE_TYPES_PAGING,
  CHANGE_NOTICES_PAGING,
  CONSUMABLES_PAGING,
  getChangeNoticeRequiredActions,
  getChangeNotices,
  getChangeNoticeTypes,
  getConsumables,
  getItemPostingGroups,
  getMaterialDimensions,
  getMaterialFinishes,
  getMaterialForms,
  getMaterialGrades,
  getMaterialSubstances,
  getMaterials,
  getMaterialTypes,
  getMethodMaterials,
  getMethodOperations,
  getParts,
  getServices,
  getTools,
  getUnitOfMeasures,
  ITEM_POSTING_GROUPS_PAGING,
  MATERIAL_DIMENSIONS_PAGING,
  MATERIAL_FINISHES_PAGING,
  MATERIAL_FORMS_PAGING,
  MATERIAL_GRADES_PAGING,
  MATERIAL_SUBSTANCES_PAGING,
  MATERIAL_TYPES_PAGING,
  MATERIALS_PAGING,
  METHOD_MATERIALS_PAGING,
  METHOD_OPERATIONS_PAGING,
  PARTS_PAGING,
  SERVICES_PAGING,
  TOOLS_PAGING,
  UNIT_OF_MEASURES_PAGING
} from "~/modules/items/items.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

export const partsList = searchList({
  key: "parts",
  permission: { gate: { "parts.parts": "View" } },
  paging: PARTS_PAGING,
  service: getParts,
  params: { supplierId: "supplierId" }
});

export const materialsList = searchList({
  key: "materials",
  permission: { gate: { "parts.materials": "View" } },
  paging: MATERIALS_PAGING,
  service: getMaterials,
  params: { supplierId: "supplierId" }
});

export const toolsList = searchList({
  key: "tools",
  permission: { gate: { "parts.tools": "View" } },
  paging: TOOLS_PAGING,
  service: getTools,
  params: { supplierId: "supplierId" }
});

export const consumablesList = searchList({
  key: "consumables",
  permission: { gate: { "parts.consumables": "View" } },
  paging: CONSUMABLES_PAGING,
  service: getConsumables,
  params: { supplierId: "supplierId" }
});

export const servicesList = searchList({
  key: "services",
  permission: { gate: { "parts.services": "View" } },
  paging: SERVICES_PAGING,
  service: getServices,
  params: { supplierId: "supplierId", group: "group" }
});

export const changeNoticesList = searchList({
  key: "change-notices",
  permission: { gate: { "parts.changeNotices": "View" } },
  paging: CHANGE_NOTICES_PAGING,
  service: getChangeNotices
});

export const changeNoticeRequiredActionsList = searchList({
  key: "change-notice-actions",
  permission: {
    gate: { "parts.changeNoticeActions": "View" }
  },
  paging: CHANGE_NOTICE_REQUIRED_ACTIONS_PAGING,
  service: getChangeNoticeRequiredActions
});

export const changeNoticeTypesList = searchList({
  key: "change-notice-types",
  permission: { gate: { "parts.changeNoticeTypes": "View" } },
  paging: CHANGE_NOTICE_TYPES_PAGING,
  service: getChangeNoticeTypes
});

export const materialDimensionsList = {
  key: "material-dimensions",
  permission: { gate: { "parts.dimensions": "View" } },
  ...MATERIAL_DIMENSIONS_PAGING,
  // The list shows the dimensions of the company's unit system only.
  query: async (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const settings = await getCompanySettings(client, companyId);
    return getMaterialDimensions(client, companyId, {
      search: params.get("search"),
      isMetric: settings?.data?.useMetric ?? false,
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  }
} satisfies ListDefinition;

export const materialFinishesList = searchList({
  key: "material-finishes",
  permission: { gate: { "parts.finishes": "View" } },
  paging: MATERIAL_FINISHES_PAGING,
  service: getMaterialFinishes
});

export const materialFormsList = searchList({
  key: "material-forms",
  permission: { gate: { "parts.shapes": "View" } },
  paging: MATERIAL_FORMS_PAGING,
  service: getMaterialForms
});

export const materialGradesList = searchList({
  key: "material-grades",
  permission: { gate: { "parts.grades": "View" } },
  paging: MATERIAL_GRADES_PAGING,
  service: getMaterialGrades
});

export const itemPostingGroupsList = searchList({
  key: "item-posting-groups",
  permission: { gate: { "parts.itemGroups": "View" } },
  paging: ITEM_POSTING_GROUPS_PAGING,
  service: getItemPostingGroups
});

export const materialSubstancesList = searchList({
  key: "material-substances",
  permission: { gate: { "parts.substances": "View" } },
  paging: MATERIAL_SUBSTANCES_PAGING,
  service: getMaterialSubstances
});

export const materialTypesList = searchList({
  key: "material-types",
  permission: { gate: { "parts.types": "View" } },
  paging: MATERIAL_TYPES_PAGING,
  service: getMaterialTypes
});

export const unitOfMeasuresList = searchList({
  key: "units-of-measure",
  permission: { gate: { "parts.units": "View" } },
  paging: UNIT_OF_MEASURES_PAGING,
  service: getUnitOfMeasures
});

export const methodMaterialsList = searchList({
  key: "method-materials",
  permission: { gate: anyOf(ITEM_PAGES, "View") },
  paging: METHOD_MATERIALS_PAGING,
  service: getMethodMaterials
});

export const methodOperationsList = searchList({
  key: "method-operations",
  permission: { gate: anyOf(ITEM_PAGES, "View") },
  paging: METHOD_OPERATIONS_PAGING,
  service: getMethodOperations
});

export const itemsLists: Record<string, ListDefinition> = {
  [partsList.key]: partsList,
  [materialsList.key]: materialsList,
  [toolsList.key]: toolsList,
  [consumablesList.key]: consumablesList,
  [servicesList.key]: servicesList,
  [changeNoticesList.key]: changeNoticesList,
  [changeNoticeRequiredActionsList.key]: changeNoticeRequiredActionsList,
  [changeNoticeTypesList.key]: changeNoticeTypesList,
  [materialDimensionsList.key]: materialDimensionsList,
  [materialFinishesList.key]: materialFinishesList,
  [materialFormsList.key]: materialFormsList,
  [materialGradesList.key]: materialGradesList,
  [itemPostingGroupsList.key]: itemPostingGroupsList,
  [materialSubstancesList.key]: materialSubstancesList,
  [materialTypesList.key]: materialTypesList,
  [unitOfMeasuresList.key]: unitOfMeasuresList,
  [methodMaterialsList.key]: methodMaterialsList,
  [methodOperationsList.key]: methodOperationsList
};
