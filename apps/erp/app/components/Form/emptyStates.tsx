import { FieldEmptyState, fieldEmptyStateLinkClassName } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type Action = "view" | "create" | "update" | "delete";

type EntityCopy = {
  module: string;
  action: Action;
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
        module: "purchasing",
        action: "create",
        route: path.to.newSupplier,
        noun: t`supplier`,
        pluralNoun: t`suppliers`,
        moduleLabel: t`purchasing`
      };
    case "customer":
      return {
        module: "sales",
        action: "create",
        route: path.to.newCustomer,
        noun: t`customer`,
        pluralNoun: t`customers`,
        moduleLabel: t`sales`
      };
    case "location":
      return {
        module: "resources",
        action: "create",
        route: path.to.newLocation,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`resources`
      };
    case "costCenter":
      return {
        module: "accounting",
        action: "create",
        route: path.to.newCostCenter,
        noun: t`cost center`,
        pluralNoun: t`cost centers`,
        moduleLabel: t`accounting`
      };
    case "department":
      return {
        module: "people",
        action: "create",
        route: path.to.newDepartment,
        noun: t`department`,
        pluralNoun: t`departments`,
        moduleLabel: t`people`
      };
    case "shift":
      return {
        module: "people",
        action: "create",
        route: path.to.newShift,
        noun: t`shift`,
        pluralNoun: t`shifts`,
        moduleLabel: t`people`
      };
    case "process":
      return {
        module: "resources",
        action: "create",
        route: path.to.newProcess,
        noun: t`process`,
        pluralNoun: t`processes`,
        moduleLabel: t`resources`
      };
    case "workCenter":
      return {
        module: "resources",
        action: "update",
        route: path.to.newWorkCenter,
        noun: t`work center`,
        pluralNoun: t`work centers`,
        moduleLabel: t`resources`
      };
    case "employee":
      return {
        module: "users",
        action: "create",
        route: path.to.newEmployee,
        noun: t`employee`,
        pluralNoun: t`employees`,
        moduleLabel: t`users`
      };
    case "paymentTerm":
      return {
        module: "accounting",
        action: "create",
        route: path.to.newPaymentTerm,
        noun: t`payment term`,
        pluralNoun: t`payment terms`,
        moduleLabel: t`accounting`
      };
    case "shippingMethod":
      return {
        module: "inventory",
        action: "create",
        route: path.to.newShippingMethod,
        noun: t`shipping method`,
        pluralNoun: t`shipping methods`,
        moduleLabel: t`inventory`
      };
    case "ability":
      return {
        module: "resources",
        action: "create",
        route: path.to.newAbility,
        noun: t`ability`,
        pluralNoun: t`abilities`,
        moduleLabel: t`resources`
      };
    case "assetClass":
      return {
        module: "accounting",
        action: "create",
        route: path.to.newAssetClass,
        noun: t`asset class`,
        pluralNoun: t`asset classes`,
        moduleLabel: t`accounting`
      };
    case "customerType":
      return {
        module: "sales",
        action: "create",
        route: path.to.newCustomerType,
        noun: t`customer type`,
        pluralNoun: t`customer types`,
        moduleLabel: t`sales`
      };
    case "customerStatus":
      return {
        module: "sales",
        action: "create",
        route: path.to.newCustomerStatus,
        noun: t`customer status`,
        pluralNoun: t`customer statuses`,
        moduleLabel: t`sales`
      };
    case "supplierType":
      return {
        module: "purchasing",
        action: "create",
        route: path.to.newSupplierType,
        noun: t`supplier type`,
        pluralNoun: t`supplier types`,
        moduleLabel: t`purchasing`
      };
    case "itemPostingGroup":
      return {
        module: "parts",
        action: "create",
        route: path.to.newItemPostingGroup,
        noun: t`item group`,
        pluralNoun: t`item groups`,
        moduleLabel: t`parts`
      };
    case "materialType":
      return {
        module: "parts",
        action: "create",
        route: path.to.newMaterialType,
        noun: t`material type`,
        pluralNoun: t`material types`,
        moduleLabel: t`parts`
      };
    case "procedure":
      return {
        module: "production",
        action: "create",
        route: path.to.newProcedure,
        noun: t`procedure`,
        pluralNoun: t`procedures`,
        moduleLabel: t`production`
      };
    case "scrapReason":
      return {
        module: "production",
        action: "create",
        route: path.to.newScrapReason,
        noun: t`scrap reason`,
        pluralNoun: t`scrap reasons`,
        moduleLabel: t`production`
      };
    case "storageType":
      return {
        module: "parts",
        action: "create",
        route: path.to.newStorageType,
        noun: t`storage type`,
        pluralNoun: t`storage types`,
        moduleLabel: t`parts`
      };
    case "part":
      return {
        module: "parts",
        action: "create",
        route: path.to.newPart,
        noun: t`part`,
        pluralNoun: t`parts`,
        moduleLabel: t`parts`
      };
    case "material":
      return {
        module: "parts",
        action: "create",
        route: path.to.newMaterial,
        noun: t`material`,
        pluralNoun: t`materials`,
        moduleLabel: t`parts`
      };
    case "tool":
      return {
        module: "parts",
        action: "create",
        route: path.to.newTool,
        noun: t`tool`,
        pluralNoun: t`tools`,
        moduleLabel: t`parts`
      };
    case "service":
      return {
        module: "parts",
        action: "create",
        route: path.to.newService,
        noun: t`service`,
        pluralNoun: t`services`,
        moduleLabel: t`parts`
      };
    case "consumable":
      return {
        module: "parts",
        action: "create",
        route: path.to.newConsumable,
        noun: t`consumable`,
        pluralNoun: t`consumables`,
        moduleLabel: t`parts`
      };
    case "customerContact":
      return {
        module: "sales",
        action: "create",
        route: path.to.customers,
        noun: t`contact`,
        pluralNoun: t`contacts`,
        moduleLabel: t`sales`
      };
    case "customerLocation":
      return {
        module: "sales",
        action: "create",
        route: path.to.customers,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`sales`
      };
    case "supplierContact":
      return {
        module: "purchasing",
        action: "create",
        route: path.to.suppliers,
        noun: t`contact`,
        pluralNoun: t`contacts`,
        moduleLabel: t`purchasing`
      };
    case "supplierLocation":
      return {
        module: "purchasing",
        action: "create",
        route: path.to.suppliers,
        noun: t`location`,
        pluralNoun: t`locations`,
        moduleLabel: t`purchasing`
      };
    case "supplierProcess":
      return {
        module: "purchasing",
        action: "create",
        route: path.to.suppliers,
        noun: t`supplier process`,
        pluralNoun: t`supplier processes`,
        moduleLabel: t`purchasing`
      };
    case "item":
      return {
        module: "parts",
        action: "create",
        route: path.to.parts,
        noun: t`item`,
        pluralNoun: t`items`,
        moduleLabel: t`parts`
      };
    case "gauge":
      return {
        module: "quality",
        action: "create",
        route: path.to.gauges,
        noun: t`gauge`,
        pluralNoun: t`gauges`,
        moduleLabel: t`quality`
      };
    case "storageUnit":
      return {
        module: "inventory",
        action: "create",
        route: path.to.storageUnits,
        noun: t`storage unit`,
        pluralNoun: t`storage units`,
        moduleLabel: t`inventory`
      };
    case "unitOfMeasure":
      return {
        module: "parts",
        action: "create",
        route: path.to.uoms,
        noun: t`unit of measure`,
        pluralNoun: t`units of measure`,
        moduleLabel: t`parts`
      };
    case "materialDimension":
      return {
        module: "parts",
        action: "create",
        route: path.to.materialDimensions,
        noun: t`dimension`,
        pluralNoun: t`dimensions`,
        moduleLabel: t`parts`
      };
    case "materialFinish":
      return {
        module: "parts",
        action: "create",
        route: path.to.materialFinishes,
        noun: t`finish`,
        pluralNoun: t`finishes`,
        moduleLabel: t`parts`
      };
    case "materialGrade":
      return {
        module: "parts",
        action: "create",
        route: path.to.materialGrades,
        noun: t`grade`,
        pluralNoun: t`grades`,
        moduleLabel: t`parts`
      };
    case "materialSubstance":
      return {
        module: "parts",
        action: "create",
        route: path.to.materialSubstances,
        noun: t`substance`,
        pluralNoun: t`substances`,
        moduleLabel: t`parts`
      };
    case "materialShape":
      return {
        module: "parts",
        action: "create",
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

  if (!permissions.can(copy.action, copy.module)) {
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
