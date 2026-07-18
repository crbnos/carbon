import type { JSONContent } from "@carbon/react";
import type { MethodItemType, MethodType } from "../../../shared";
import type { ChangeOrderItemDiff } from "../../items.models";
import type { getRevisionLock } from "../../items.server";
import type {
  ChangeOrderAffectedItemWithLabel,
  getConfigurationParameters,
  getConfigurationRules,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId
} from "../../items.service";
import type { MakeMethod } from "../../types";
import type { PartPropertiesData } from "../Parts/PartProperties";

// Shared type for a change-order affected item + its CO-owned Draft make method.
// Lives in this dedicated file (not in a component) so the sidebar, the detail
// pane, the workspace, and the $id route/loader can all import it without a
// component-to-component dependency.

type RevisionLock = Awaited<ReturnType<typeof getRevisionLock>>;

type DraftMaterial = NonNullable<
  Awaited<ReturnType<typeof getMethodMaterialsByMakeMethod>>["data"]
>[number];
type DraftOperation = NonNullable<
  Awaited<ReturnType<typeof getMethodOperationsByMakeMethodId>>["data"]
>[number];
type DraftConfigParameters = Awaited<
  ReturnType<typeof getConfigurationParameters>
>["parameters"];
type DraftConfigRules = Awaited<ReturnType<typeof getConfigurationRules>>;

// The $id loader normalizes the raw rows (adds description, coerces nullable
// ids to undefined) exactly as the part make-method route does — these mapped
// shapes are what the embedded editors consume.
export type DraftMaterialMapped = Omit<
  DraftMaterial,
  "description" | "methodOperationId" | "methodType" | "itemType"
> & {
  description: string;
  methodOperationId: string | undefined;
  methodType: MethodType;
  itemType: MethodItemType;
};
export type DraftOperationMapped = Omit<
  DraftOperation,
  | "description"
  | "procedureId"
  | "operationSupplierProcessId"
  | "operationMinimumCost"
  | "operationLeadTime"
  | "operationUnitCost"
  | "tags"
  | "workCenterId"
  | "workInstruction"
> & {
  description: string;
  procedureId: string | undefined;
  operationSupplierProcessId: string | undefined;
  operationMinimumCost: number;
  operationLeadTime: number;
  operationUnitCost: number;
  tags: string[];
  workCenterId: string | undefined;
  workInstruction: JSONContent | null;
};

// v2: one affected item plus its CO-owned Draft make method (real rows shaped
// for the embedded BillOfMaterial / BillOfProcess editors), the change type, and
// the read-only authoring diff. The $id loader assembles this per affected item.
export type AffectedItemDraft = {
  affectedItem: ChangeOrderAffectedItemWithLabel;
  // The item the draft edits — the same item for a Version, the new item for
  // Revision / New Part.
  draftItemId: string;
  makeMethod: MakeMethod | null;
  methodMaterials: DraftMaterialMapped[];
  methodOperations: DraftOperationMapped[];
  tags: { name: string }[];
  configurable: boolean;
  configurationRules: DraftConfigRules;
  parameters: DraftConfigParameters;
  revisionStatus: RevisionLock["revisionStatus"];
  releaseControl: RevisionLock["releaseControl"] | null;
  // Attribute/file bundle for the embedded PartProperties editor — set for
  // Part-type Revision / New Part affected items, null otherwise.
  partData: PartPropertiesData | null;
  diff?: ChangeOrderItemDiff;
};
