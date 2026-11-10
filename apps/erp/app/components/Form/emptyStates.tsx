// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  anyOf,
  type Gate,
  type GateLevel,
  ITEM_PAGES,
  type ModuleId,
  moduleOf,
  pageOfUrl
} from "@carbon/database/access";
import { FieldEmptyState, fieldEmptyStateLinkClassName } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import { useModuleNames } from "~/hooks/useModules";
import { path } from "~/utils/path";

type EntityCopy = {
  /** Who may create the entity, when it is not `level` on the page of `route`. */
  gate?: Gate;
  /** Defaults to Create. */
  level?: GateLevel;
  route: string;
  noun: string;
  pluralNoun: string;
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
        route: path.to.newSupplier,
        noun: t`supplier`,
        pluralNoun: t`suppliers`
      };
    case "customer":
      return {
        route: path.to.newCustomer,
        noun: t`customer`,
        pluralNoun: t`customers`
      };
    case "location":
      return {
        route: path.to.newLocation,
        noun: t`location`,
        pluralNoun: t`locations`
      };
    case "costCenter":
      return {
        route: path.to.newCostCenter,
        noun: t`cost center`,
        pluralNoun: t`cost centers`
      };
    case "department":
      return {
        route: path.to.newDepartment,
        noun: t`department`,
        pluralNoun: t`departments`
      };
    case "shift":
      return {
        route: path.to.newShift,
        noun: t`shift`,
        pluralNoun: t`shifts`
      };
    case "process":
      return {
        route: path.to.newProcess,
        noun: t`process`,
        pluralNoun: t`processes`
      };
    case "workCenter":
      return {
        level: "Edit",
        route: path.to.newWorkCenter,
        noun: t`work center`,
        pluralNoun: t`work centers`
      };
    case "employee":
      return {
        route: path.to.newEmployee,
        noun: t`employee`,
        pluralNoun: t`employees`
      };
    case "paymentTerm":
      return {
        route: path.to.newPaymentTerm,
        noun: t`payment term`,
        pluralNoun: t`payment terms`
      };
    case "shippingMethod":
      return {
        route: path.to.newShippingMethod,
        noun: t`shipping method`,
        pluralNoun: t`shipping methods`
      };
    case "ability":
      return {
        route: path.to.newAbility,
        noun: t`ability`,
        pluralNoun: t`abilities`
      };
    case "assetClass":
      return {
        route: path.to.newAssetClass,
        noun: t`asset class`,
        pluralNoun: t`asset classes`
      };
    case "customerType":
      return {
        route: path.to.newCustomerType,
        noun: t`customer type`,
        pluralNoun: t`customer types`
      };
    case "customerStatus":
      return {
        route: path.to.newCustomerStatus,
        noun: t`customer status`,
        pluralNoun: t`customer statuses`
      };
    case "supplierType":
      return {
        route: path.to.newSupplierType,
        noun: t`supplier type`,
        pluralNoun: t`supplier types`
      };
    case "itemPostingGroup":
      return {
        route: path.to.newItemPostingGroup,
        noun: t`item group`,
        pluralNoun: t`item groups`
      };
    case "materialType":
      return {
        route: path.to.newMaterialType,
        noun: t`material type`,
        pluralNoun: t`material types`
      };
    case "procedure":
      return {
        route: path.to.newProcedure,
        noun: t`procedure`,
        pluralNoun: t`procedures`
      };
    case "scrapReason":
      return {
        route: path.to.newScrapReason,
        noun: t`scrap reason`,
        pluralNoun: t`scrap reasons`
      };
    case "storageType":
      return {
        route: path.to.newStorageType,
        noun: t`storage type`,
        pluralNoun: t`storage types`
      };
    case "part":
      return {
        route: path.to.newPart,
        noun: t`part`,
        pluralNoun: t`parts`
      };
    case "material":
      return {
        route: path.to.newMaterial,
        noun: t`material`,
        pluralNoun: t`materials`
      };
    case "tool":
      return {
        route: path.to.newTool,
        noun: t`tool`,
        pluralNoun: t`tools`
      };
    case "service":
      return {
        route: path.to.newService,
        noun: t`service`,
        pluralNoun: t`services`
      };
    case "consumable":
      return {
        route: path.to.newConsumable,
        noun: t`consumable`,
        pluralNoun: t`consumables`
      };
    case "customerContact":
      return {
        route: path.to.customers,
        noun: t`contact`,
        pluralNoun: t`contacts`
      };
    case "customerLocation":
      return {
        route: path.to.customers,
        noun: t`location`,
        pluralNoun: t`locations`
      };
    case "supplierContact":
      return {
        route: path.to.suppliers,
        noun: t`contact`,
        pluralNoun: t`contacts`
      };
    case "supplierLocation":
      return {
        route: path.to.suppliers,
        noun: t`location`,
        pluralNoun: t`locations`
      };
    case "supplierProcess":
      return {
        // Adding a process to a supplier edits the supplier (RLS asks Edit).
        level: "Edit",
        route: path.to.suppliers,
        noun: t`supplier process`,
        pluralNoun: t`supplier processes`
      };
    case "item":
      return {
        gate: anyOf(ITEM_PAGES, "Create"),
        route: path.to.parts,
        noun: t`item`,
        pluralNoun: t`items`
      };
    case "gauge":
      return {
        route: path.to.gauges,
        noun: t`gauge`,
        pluralNoun: t`gauges`
      };
    case "storageUnit":
      return {
        route: path.to.storageUnits,
        noun: t`storage unit`,
        pluralNoun: t`storage units`
      };
    case "unitOfMeasure":
      return {
        route: path.to.uoms,
        noun: t`unit of measure`,
        pluralNoun: t`units of measure`
      };
    case "materialDimension":
      return {
        route: path.to.materialDimensions,
        noun: t`dimension`,
        pluralNoun: t`dimensions`
      };
    case "materialFinish":
      return {
        route: path.to.materialFinishes,
        noun: t`finish`,
        pluralNoun: t`finishes`
      };
    case "materialGrade":
      return {
        route: path.to.materialGrades,
        noun: t`grade`,
        pluralNoun: t`grades`
      };
    case "materialSubstance":
      return {
        route: path.to.materialSubstances,
        noun: t`substance`,
        pluralNoun: t`substances`
      };
    case "materialShape":
      return {
        route: path.to.materialForms,
        noun: t`shape`,
        pluralNoun: t`shapes`
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
  const moduleNames = useModuleNames();
  const page = pageOfUrl(copy.route);
  const module = moduleOf(page ?? "") as ModuleId;
  const gate =
    copy.gate ?? (page ? { [page]: copy.level ?? "Create" } : undefined);

  if (!gate || !permissions.has(gate)) {
    return (
      <FieldEmptyState
        title={t`No ${copy.pluralNoun} yet`}
        description={t`Ask an admin with ${moduleNames[module]} permission to add the first ${copy.noun}.`}
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
