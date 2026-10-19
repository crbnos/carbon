// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { anyOf, type Gate, ITEM_PAGES } from "@carbon/database/access";
import { FieldEmptyState, fieldEmptyStateLinkClassName } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type EntityCopy = {
  /** The page and level that may create the entity. */
  gate: Gate;
  route: string;
  noun: string;
  pluralNoun: string;
  moduleLabel: string;
};

export type EntityKey =
  | "supplier"
  | "customer"
  | "location"
  | "costCenter"
  | "department"
  | "shift"
  | "process"
  | "workCenter"
  | "employee"
  | "paymentTerm"
  | "shippingMethod"
  | "ability"
  | "assetClass"
  | "customerType"
  | "customerStatus"
  | "supplierType"
  | "itemPostingGroup"
  | "materialType"
  | "procedure"
  | "scrapReason"
  | "storageType"
  | "part"
  | "material"
  | "tool"
  | "service"
  | "consumable"
  | "customerContact"
  | "customerLocation"
  | "supplierContact"
  | "supplierLocation"
  | "supplierProcess"
  | "item"
  | "gauge"
  | "storageUnit"
  | "unitOfMeasure"
  | "materialDimension"
  | "materialFinish"
  | "materialGrade"
  | "materialSubstance"
  | "materialShape";

const useEntityCopy = (entity: EntityKey): EntityCopy => {
  const { t } = useLingui();
  switch (entity) {
    case "supplier":
      return {
        gate: { "purchasing.suppliers": "Create" },
        route: path.to.newSupplier,
        noun: t`supplier`,
        pluralNoun: t`suppliers`,
        moduleLabel: t`purchasing`
      };
    case "customer":
      return {
        gate: { "sales.customers": "Create" },
        route: path.to.newCustomer,
        noun: t`customer`,
        pluralNoun: t`customers`,
        moduleLabel: t`sales`
      };
    case "location":
      return {
        gate: { "resources.locations": "Create" },
        route: path.to.newLocation,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`resources`
      };
    case "costCenter":
      return {
        gate: { "accounting.costCenters": "Create" },
        route: path.to.newCostCenter,
        noun: t`cost center`,
        pluralNoun: t`cost centers`,
        moduleLabel: t`accounting`
      };
    case "department":
      return {
        gate: { "people.departments": "Create" },
        route: path.to.newDepartment,
        noun: t`department`,
        pluralNoun: t`departments`,
        moduleLabel: t`people`
      };
    case "shift":
      return {
        gate: { "people.shifts": "Create" },
        route: path.to.newShift,
        noun: t`shift`,
        pluralNoun: t`shifts`,
        moduleLabel: t`people`
      };
    case "process":
      return {
        gate: { "resources.processes": "Create" },
        route: path.to.newProcess,
        noun: t`process`,
        pluralNoun: t`processes`,
        moduleLabel: t`resources`
      };
    case "workCenter":
      return {
        gate: { "resources.workCenters": "Edit" },
        route: path.to.newWorkCenter,
        noun: t`work center`,
        pluralNoun: t`work centers`,
        moduleLabel: t`resources`
      };
    case "employee":
      return {
        gate: { "users.accounts": "Create" },
        route: path.to.newEmployee,
        noun: t`employee`,
        pluralNoun: t`employees`,
        moduleLabel: t`users`
      };
    case "paymentTerm":
      return {
        gate: { "accounting.paymentTerms": "Create" },
        route: path.to.newPaymentTerm,
        noun: t`payment term`,
        pluralNoun: t`payment terms`,
        moduleLabel: t`accounting`
      };
    case "shippingMethod":
      return {
        gate: { "inventory.shippingMethods": "Create" },
        route: path.to.newShippingMethod,
        noun: t`shipping method`,
        pluralNoun: t`shipping methods`,
        moduleLabel: t`inventory`
      };
    case "ability":
      return {
        gate: { "resources.abilities": "Create" },
        route: path.to.newAbility,
        noun: t`ability`,
        pluralNoun: t`abilities`,
        moduleLabel: t`resources`
      };
    case "assetClass":
      return {
        gate: { "accounting.assetClasses": "Create" },
        route: path.to.newAssetClass,
        noun: t`asset class`,
        pluralNoun: t`asset classes`,
        moduleLabel: t`accounting`
      };
    case "customerType":
      return {
        gate: { "sales.types": "Create" },
        route: path.to.newCustomerType,
        noun: t`customer type`,
        pluralNoun: t`customer types`,
        moduleLabel: t`sales`
      };
    case "customerStatus":
      return {
        gate: { "sales.statuses": "Create" },
        route: path.to.newCustomerStatus,
        noun: t`customer status`,
        pluralNoun: t`customer statuses`,
        moduleLabel: t`sales`
      };
    case "supplierType":
      return {
        gate: { "purchasing.types": "Create" },
        route: path.to.newSupplierType,
        noun: t`supplier type`,
        pluralNoun: t`supplier types`,
        moduleLabel: t`purchasing`
      };
    case "itemPostingGroup":
      return {
        gate: { "parts.itemGroups": "Create" },
        route: path.to.newItemPostingGroup,
        noun: t`item group`,
        pluralNoun: t`item groups`,
        moduleLabel: t`parts`
      };
    case "materialType":
      return {
        gate: { "parts.types": "Create" },
        route: path.to.newMaterialType,
        noun: t`material type`,
        pluralNoun: t`material types`,
        moduleLabel: t`parts`
      };
    case "procedure":
      return {
        gate: { "production.procedures": "Create" },
        route: path.to.newProcedure,
        noun: t`procedure`,
        pluralNoun: t`procedures`,
        moduleLabel: t`production`
      };
    case "scrapReason":
      return {
        gate: { "production.scrapReasons": "Create" },
        route: path.to.newScrapReason,
        noun: t`scrap reason`,
        pluralNoun: t`scrap reasons`,
        moduleLabel: t`production`
      };
    case "storageType":
      return {
        gate: { "inventory.storageTypes": "Create" },
        route: path.to.newStorageType,
        noun: t`storage type`,
        pluralNoun: t`storage types`,
        moduleLabel: t`parts`
      };
    case "part":
      return {
        gate: { "parts.parts": "Create" },
        route: path.to.newPart,
        noun: t`part`,
        pluralNoun: t`parts`,
        moduleLabel: t`parts`
      };
    case "material":
      return {
        gate: { "parts.materials": "Create" },
        route: path.to.newMaterial,
        noun: t`material`,
        pluralNoun: t`materials`,
        moduleLabel: t`parts`
      };
    case "tool":
      return {
        gate: { "parts.tools": "Create" },
        route: path.to.newTool,
        noun: t`tool`,
        pluralNoun: t`tools`,
        moduleLabel: t`parts`
      };
    case "service":
      return {
        gate: { "parts.services": "Create" },
        route: path.to.newService,
        noun: t`service`,
        pluralNoun: t`services`,
        moduleLabel: t`parts`
      };
    case "consumable":
      return {
        gate: { "parts.consumables": "Create" },
        route: path.to.newConsumable,
        noun: t`consumable`,
        pluralNoun: t`consumables`,
        moduleLabel: t`parts`
      };
    case "customerContact":
      return {
        gate: { "sales.customers": "Create" },
        route: path.to.customers,
        noun: t`contact`,
        pluralNoun: t`contacts`,
        moduleLabel: t`sales`
      };
    case "customerLocation":
      return {
        gate: { "sales.customers": "Create" },
        route: path.to.customers,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`sales`
      };
    case "supplierContact":
      return {
        gate: { "purchasing.suppliers": "Create" },
        route: path.to.suppliers,
        noun: t`contact`,
        pluralNoun: t`contacts`,
        moduleLabel: t`purchasing`
      };
    case "supplierLocation":
      return {
        gate: { "purchasing.suppliers": "Create" },
        route: path.to.suppliers,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`purchasing`
      };
    case "supplierProcess":
      return {
        gate: { "resources.processes": "Create" },
        route: path.to.suppliers,
        noun: t`supplier process`,
        pluralNoun: t`supplier processes`,
        moduleLabel: t`purchasing`
      };
    case "item":
      return {
        gate: anyOf(ITEM_PAGES, "Create"),
        route: path.to.parts,
        noun: t`item`,
        pluralNoun: t`items`,
        moduleLabel: t`parts`
      };
    case "gauge":
      return {
        gate: { "quality.gauges": "Create" },
        route: path.to.gauges,
        noun: t`gauge`,
        pluralNoun: t`gauges`,
        moduleLabel: t`quality`
      };
    case "storageUnit":
      return {
        gate: { "inventory.storageUnits": "Create" },
        route: path.to.storageUnits,
        noun: t`storage unit`,
        pluralNoun: t`storage units`,
        moduleLabel: t`inventory`
      };
    case "unitOfMeasure":
      return {
        gate: { "parts.units": "Create" },
        route: path.to.uoms,
        noun: t`unit of measure`,
        pluralNoun: t`units of measure`,
        moduleLabel: t`parts`
      };
    case "materialDimension":
      return {
        gate: { "parts.dimensions": "Create" },
        route: path.to.materialDimensions,
        noun: t`dimension`,
        pluralNoun: t`dimensions`,
        moduleLabel: t`parts`
      };
    case "materialFinish":
      return {
        gate: { "parts.finishes": "Create" },
        route: path.to.materialFinishes,
        noun: t`finish`,
        pluralNoun: t`finishes`,
        moduleLabel: t`parts`
      };
    case "materialGrade":
      return {
        gate: { "parts.grades": "Create" },
        route: path.to.materialGrades,
        noun: t`grade`,
        pluralNoun: t`grades`,
        moduleLabel: t`parts`
      };
    case "materialSubstance":
      return {
        gate: { "parts.substances": "Create" },
        route: path.to.materialSubstances,
        noun: t`substance`,
        pluralNoun: t`substances`,
        moduleLabel: t`parts`
      };
    case "materialShape":
      return {
        gate: { "parts.shapes": "Create" },
        route: path.to.materialForms,
        noun: t`shape`,
        pluralNoun: t`shapes`,
        moduleLabel: t`parts`
      };
  }
};

type UseEmptyStateOptions = {
  onCreate?: () => void;
};

export const useEmptyState = (
  entity: EntityKey,
  opts?: UseEmptyStateOptions
): ReactNode => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const copy = useEntityCopy(entity);

  if (!permissions.has(copy.gate)) {
    return (
      <FieldEmptyState
        title={t`No ${copy.pluralNoun} yet`}
        description={t`Ask an admin with ${copy.moduleLabel} permission to add the first ${copy.noun}.`}
      />
    );
  }

  const ctaLabel = t`Add your first ${copy.noun}`;
  const cta = opts?.onCreate ? (
    <button
      type="button"
      onClick={opts.onCreate}
      className={fieldEmptyStateLinkClassName}
    >
      {ctaLabel}
    </button>
  ) : (
    <Link to={copy.route} className={fieldEmptyStateLinkClassName}>
      {ctaLabel}
    </Link>
  );

  return (
    <FieldEmptyState
      title={t`No ${copy.pluralNoun} yet`}
      description={
        <>
          {cta} {t`so you can assign it here.`}
        </>
      }
    />
  );
};
