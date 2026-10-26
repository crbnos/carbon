// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NotFoundError, ServerFnError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  CarbonError,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { error } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllByIds,
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone
} from "@carbon/database";
import {
  type ExpressionBuilder,
  type Kysely,
  type KyselyDatabase,
  type KyselyTx,
  withTransaction
} from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
import { insertRows, many, maybeSingle } from "@carbon/database/rows";
import {
  hasPendingApproval,
  pendingApprovalDocumentIds
} from "@carbon/ee/approvals.server";
import {
  isUnsafeStoragePath,
  storage,
  TEMP_STAGING_BUCKET
} from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { TiptapText } from "@carbon/files/markdown";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { oncePerRead } from "@carbon/logger/middleware.server";
import { NotificationEvent } from "@carbon/notifications";
import {
  datetime,
  getReadableIdWithRevision,
  isUniqueViolation,
  pick,
  pluckUnique,
  searchFilter,
  withPathIds
} from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { data } from "react-router";
import { z } from "zod";
import { createDocumentUploadUrl } from "~/modules/documents/documents.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { GenericQueryFilters } from "~/utils/query";
import {
  LIST_COUNT,
  setGenericQueryFilters,
  setSearchFilter
} from "~/utils/query";
import { ruleError, SERVICE_RULE_ERROR_CODE, sanitize } from "~/utils/supabase";
import { makeToAssetItemError } from "../production/production.models";
import * as productionPostings from "../production/production.service";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  operationParameterValidator,
  operationStepSlideValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared/shared.models";
import { normalizeOperationSourceIds } from "../shared/shared.models";
import * as sharedPostings from "../shared/shared.service";
import { invokePosting } from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import type { MethodType, SourcingType } from "../shared/types";
import type { plmReleaseControl } from "./items.models";
import {
  type ChangeNoticeChangeType,
  type ChangeNoticeError,
  type ChangeNoticeItemDiff,
  canEditChangeNoticeEngineering,
  canEditChangeNoticeWorkflow,
  changeNoticeAwaitingApprovalMessage,
  changeNoticeLockedMessage,
  changeNoticeOpenStatuses,
  type changeNoticeStatus,
  type changeNoticeTaskStatus,
  type changeNoticeType,
  type configurationParameterGroupOrderValidator,
  type configurationParameterGroupValidator,
  type configurationParameterOrderValidator,
  type configurationParameterValidator,
  type configurationRuleValidator,
  type consumableValidator,
  type customerPartValidator,
  EACH_UNIT_OF_MEASURE_CODE,
  type getMethodValidator,
  ItemTrackingType,
  isAllowedChangeNoticeTransition,
  type itemCostValidator,
  type itemManufacturingValidator,
  type itemPlanningValidator,
  type itemPostingGroupValidator,
  type itemPurchasingValidator,
  type itemSupersessionValidator,
  type itemTrackingTypes,
  type itemUnitSalePriceValidator,
  type itemValidator,
  type MethodDiffEntry,
  type MethodDiffStatus,
  type materialDimensionValidator,
  type materialFinishValidator,
  type materialFormValidator,
  type materialGradeValidator,
  type materialSubstanceValidator,
  type materialTypeValidator,
  type materialValidator,
  type methodMaterialValidator,
  type methodOperationValidator,
  type OperationChildrenDiff,
  type OperationDiffEntry,
  type partValidator,
  type pickMethodSortMethods,
  type pickMethodValidator,
  type serviceValidator,
  type shelfLifeModes,
  type shelfLifeTriggerTimings,
  supersessionModes,
  type supplierPartPriceBreaksValidator,
  type supplierPartValidator,
  type toolValidator,
  type unitOfMeasureValidator
} from "./items.models";
import { getNextRevision } from "./items.utils";
import {
  checkMaterialProperties,
  clearsSubstanceOrShape,
  generatedIdsNeedSubstanceAndShape,
  generateMaterialIdentity,
  type MaterialPropertyLookups,
  type MaterialPropertyValues,
  materialItemUpdateFields,
  noMaterialProperties,
  resolveMaterialProperties,
  sentFields,
  sentMaterialProperties
} from "./material-properties";
import type { InventoryItemType } from "./types";

const PARTS_LIST_COLUMNS =
  "active,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,unitOfMeasureCode,revision,readableId,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const MATERIALS_LIST_COLUMNS =
  "active,defaultMethodType,description,itemTrackingType,name,unitOfMeasureCode,revision,readableId,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,unitOfMeasure,revisions,materialForm,materialSubstance,dimensions,finish,grade,materialType,materialSubstanceId,materialFormId,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const TOOLS_LIST_COLUMNS =
  "active,assignee,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,revision,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const CONSUMABLES_LIST_COLUMNS =
  "active,assignee,defaultMethodType,description,itemTrackingType,name,replenishmentSystem,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,supersessionMode,mpn,suppliers" as const;

const SERVICES_LIST_COLUMNS =
  "active,defaultMethodType,description,name,replenishmentSystem,revision,readableIdWithRevision,id,companyId,thumbnailPath,supplierIds,revisions,customFields,tags,itemPostingGroupId,createdBy,createdAt,updatedBy,updatedAt,suppliers" as const;

const logger = getLogger("erp", "items");

export async function activateMethodVersion(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id } = payload;
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "methodVersionToActive",
      id
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
}

/** The copy only; `copyMethod` also checks the target's revision lock. */
export async function copyItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "get-method",
    {
      type: "itemToItem",
      sourceId: args.sourceId,
      targetId: args.targetId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

/** The copy only; `copyMethod` also checks the target's revision lock. */
export async function copyMakeMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "get-method",
    {
      type: "makeMethodToMakeMethod",
      sourceId: args.sourceId,
      targetId: args.targetId,
      parts: {
        billOfMaterial: args.billOfMaterial,
        billOfProcess: args.billOfProcess,
        parameters: args.parameters,
        tools: args.tools,
        steps: args.steps,
        workInstructions: args.workInstructions
      }
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

// Copy a source item's item group (itemPostingGroupId, stored on itemCost) onto a
// freshly-created target item whose itemCost row was just auto-created with
// defaults by the item-insert trigger. No-op when the source has no group set.
export async function copyItemPostingGroup(
  client: SupabaseClient<Database>,
  args: { sourceItemId: string; targetItemId: string; companyId: string | null }
) {
  if (!args.companyId) return;
  const source = await client
    .from("itemCost")
    .select("itemPostingGroupId")
    .eq("itemId", args.sourceItemId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  const groupId = source.data?.itemPostingGroupId ?? null;
  if (!groupId) return;
  await client
    .from("itemCost")
    .update({ itemPostingGroupId: groupId })
    .eq("itemId", args.targetItemId)
    .eq("companyId", args.companyId);
}

// Kysely bypasses RLS, so before a Kysely write the caller's client vouches for
// it: the permission the table's RLS policy would have asked for, in that
// company. A service-role client passes.
async function requireCompanyPermission(
  client: SupabaseClient<Database>,
  companyId: string,
  permission: string
): Promise<{ error: ServiceError | null }> {
  const gate = await client.rpc("assert_company_access", {
    p_company_id: companyId,
    p_permission: permission
  });
  return { error: gate.error };
}

// What a new revision inherits from the revision it was copied from, beyond the
// item row and the method: replenishment (batch size, scrap percent, lead time,
// the preferred supplier and its purchasing unit), each location's reorder
// policy with its parameters, the item group, and the supplier parts with their
// price breaks. Runs in the transaction that inserted the target item: the item
// interceptor has by then created the target's itemReplenishment / itemPlanning
// / itemCost rows with defaults, and it has no supplier parts, so this updates
// those rows in place and inserts the rest. Both sides of every statement are
// scoped to the company.
async function copyItemPlanningAndPurchasing(
  trx: KyselyTx,
  args: {
    sourceItemId: string;
    targetItemId: string;
    companyId: string;
    userId: string;
  }
) {
  const { sourceItemId, targetItemId, companyId, userId } = args;
  const updatedAt = datetime.timestamp();

  await trx
    .updateTable("itemReplenishment as target")
    .from("itemReplenishment as source")
    .set((eb) => ({
      lotSize: eb.ref("source.lotSize"),
      scrapPercentage: eb.ref("source.scrapPercentage"),
      leadTime: eb.ref("source.leadTime"),
      // The purchasing unit and conversion factor are properties of the
      // preferred supplier's supplier part (see upsertItemPurchasing), which
      // is copied below, so the three travel together.
      preferredSupplierId: eb.ref("source.preferredSupplierId"),
      purchasingUnitOfMeasureCode: eb.ref("source.purchasingUnitOfMeasureCode"),
      conversionFactor: eb.ref("source.conversionFactor"),
      updatedBy: userId,
      updatedAt
    }))
    .where("target.itemId", "=", targetItemId)
    .where("target.companyId", "=", companyId)
    .where("source.itemId", "=", sourceItemId)
    .where("source.companyId", "=", companyId)
    .execute();

  // A reorder policy is only meaningful with its parameters (Maximum
  // Quantity needs a reorder point and a maximum, and so on), so the policy
  // and its sizing parameters are copied together, location by location.
  // The planning horizon and the responsible employee are not copied: a new
  // revision inherits the company defaults for both. A location the source
  // has no planning row for keeps the defaults.
  await trx
    .updateTable("itemPlanning as target")
    .from("itemPlanning as source")
    .set((eb) => ({
      reorderingPolicy: eb.ref("source.reorderingPolicy"),
      demandAccumulationPeriod: eb.ref("source.demandAccumulationPeriod"),
      demandAccumulationSafetyStock: eb.ref(
        "source.demandAccumulationSafetyStock"
      ),
      reorderPoint: eb.ref("source.reorderPoint"),
      reorderQuantity: eb.ref("source.reorderQuantity"),
      maximumInventoryQuantity: eb.ref("source.maximumInventoryQuantity"),
      minimumOrderQuantity: eb.ref("source.minimumOrderQuantity"),
      maximumOrderQuantity: eb.ref("source.maximumOrderQuantity"),
      orderMultiple: eb.ref("source.orderMultiple"),
      updatedBy: userId,
      updatedAt
    }))
    .whereRef("target.locationId", "=", "source.locationId")
    .where("target.itemId", "=", targetItemId)
    .where("target.companyId", "=", companyId)
    .where("source.itemId", "=", sourceItemId)
    .where("source.companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("itemCost as target")
    .from("itemCost as source")
    .set((eb) => ({
      itemPostingGroupId: eb.ref("source.itemPostingGroupId"),
      updatedBy: userId,
      updatedAt
    }))
    .where("target.itemId", "=", targetItemId)
    .where("target.companyId", "=", companyId)
    .where("source.itemId", "=", sourceItemId)
    .where("source.companyId", "=", companyId)
    .execute();

  await trx
    .insertInto("supplierPart")
    .columns([
      "itemId",
      "supplierId",
      "supplierPartId",
      "supplierUnitOfMeasureCode",
      "minimumOrderQuantity",
      "orderMultiple",
      "conversionFactor",
      "supplierUnitPrice",
      "currencyCode",
      "active",
      "customFields",
      "tags",
      "companyId",
      "createdBy"
    ])
    .expression((eb) =>
      eb
        .selectFrom("supplierPart")
        .select((eb) => [
          eb.val(targetItemId).as("itemId"),
          "supplierId",
          "supplierPartId",
          "supplierUnitOfMeasureCode",
          "minimumOrderQuantity",
          "orderMultiple",
          "conversionFactor",
          "supplierUnitPrice",
          "currencyCode",
          "active",
          "customFields",
          "tags",
          "companyId",
          eb.val(userId).as("createdBy")
        ])
        .where("itemId", "=", sourceItemId)
        .where("companyId", "=", companyId)
    )
    .execute();

  // Price breaks hang off the supplier part, not the item. A supplier has at
  // most one supplier part per item, so the supplier pairs each source part
  // with the copy just inserted.
  await trx
    .insertInto("supplierPartPrice")
    .columns([
      "supplierPartId",
      "quantity",
      "supplierUnitPrice",
      "leadTime",
      "sourceType",
      "sourceDocumentId",
      "companyId",
      "createdBy"
    ])
    .expression((eb) =>
      eb
        .selectFrom("supplierPartPrice as price")
        .innerJoin("supplierPart as source", (join) =>
          join
            .onRef("source.id", "=", "price.supplierPartId")
            .onRef("source.companyId", "=", "price.companyId")
        )
        .innerJoin("supplierPart as target", (join) =>
          join
            .onRef("target.supplierId", "=", "source.supplierId")
            .onRef("target.companyId", "=", "source.companyId")
        )
        .select((eb) => [
          "target.id as supplierPartId",
          "price.quantity",
          "price.supplierUnitPrice",
          "price.leadTime",
          "price.sourceType",
          "price.sourceDocumentId",
          "price.companyId",
          eb.val(userId).as("createdBy")
        ])
        .where("source.itemId", "=", sourceItemId)
        .where("target.itemId", "=", targetItemId)
        .where("price.companyId", "=", companyId)
    )
    .execute();
}

export async function createRevision(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    // The source item's fields a revision copies, not the whole row.
    item: Pick<
      NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>,
      | "id"
      | "companyId"
      | "readableId"
      | "name"
      | "type"
      | "replenishmentSystem"
      | "defaultMethodType"
      | "itemTrackingType"
      | "unitOfMeasureCode"
      | "description"
      | "sourcingType"
      | "thumbnailPath"
      | "mpn"
      | "modelUploadId"
    >;
    revision: string;
    createdBy: string;
    // Change-order draft revisions are created inactive so they don't surface
    // in item pickers/production until the change notice is released. Manual
    // "New Revision" keeps the default (active).
    active?: boolean;
  }
): Promise<
  { data: { id: string }; error: null } | { data: null; error: ServiceError }
> {
  const { item, revision, createdBy, active = true } = args;
  const companyId = item.companyId;
  if (!companyId) {
    return { data: null, error: { message: "Item has no company" } };
  }

  // The revision is written with Kysely: the item INSERT policy asks for
  // parts_create in the item's company.
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_create"
  );
  if (permitted.error) return { data: null, error: permitted.error };

  // The item and what it inherits land together or not at all: a revision
  // with default planning and no suppliers is never visible, and a failure
  // leaves nothing holding the revision label against a retry.
  let revisionItemId: string;
  try {
    revisionItemId = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("item")
        .values({
          readableId: item.readableId,
          revision,
          name: item.name,
          type: item.type,
          replenishmentSystem: item.replenishmentSystem,
          defaultMethodType: item.defaultMethodType,
          itemTrackingType: item.itemTrackingType,
          unitOfMeasureCode: item.unitOfMeasureCode,
          // A revision starts as a faithful copy of the source's attributes so
          // the only differences the user (and the CO diff) sees are ones they
          // made.
          description: item.description,
          sourcingType: item.sourcingType,
          thumbnailPath: item.thumbnailPath,
          mpn: item.mpn,
          active,
          modelUploadId: item.modelUploadId,
          companyId,
          createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await copyItemPlanningAndPurchasing(trx, {
        sourceItemId: item.id,
        targetItemId: inserted.id,
        companyId,
        userId: createdBy
      });

      return inserted.id;
    });
  } catch (error) {
    logger.error("Failed to create revision", {
      companyId,
      sourceItemId: item.id,
      revision,
      error
    });
    return { data: null, error: writeError(error) };
  }

  if (item.replenishmentSystem !== "Buy") {
    const copy = await invokePosting(
      { client, db, companyId, userId: createdBy },
      "get-method",
      {
        type: "itemToItem",
        sourceId: item.id,
        targetId: revisionItemId
      },
      productionPostings.getMethod,
      { as: productionPostings.getMethodPermission }
    );
    // The revision stands either way; its make method can be copied again.
    if (copy.error) {
      logger.error("Failed to copy the make method onto the new revision", {
        companyId,
        sourceItemId: item.id,
        revisionItemId,
        error: copy.error
      });
    }
  }

  return { data: { id: revisionItemId }, error: null };
}

// getNextRevision — numeric → +1, A → …→ Z → AA, AA → AB, etc.

export async function deleteConfigurationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("configurationParameter").delete().eq("id", id);
}

export async function deleteConfigurationRule(
  client: SupabaseClient<Database>,
  field: string,
  itemId: string
) {
  return client
    .from("configurationRule")
    .delete()
    .eq("field", field)
    .eq("itemId", itemId);
}

export async function deleteItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteSupplierPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  // Get any parameters that belong to this group
  const { data: parameters } = await client
    .from("configurationParameter")
    .select("id")
    .eq("configurationParameterGroupId", id);

  if (parameters && parameters.length > 0) {
    // Get the ungrouped group
    const { data: ungrouped } = await client
      .from("configurationParameterGroup")
      .select("id")
      .eq("isUngrouped", true)
      .single();

    if (ungrouped) {
      // Update all parameters to use the ungrouped group
      await client
        .from("configurationParameter")
        .update({ configurationParameterGroupId: ungrouped.id })
        .eq("configurationParameterGroupId", id);
    }
  }
  return client.from("configurationParameterGroup").delete().eq("id", id);
}

// An item delete cascades to its supplier parts, and a price break restricts
// the delete of its supplier part, so the price breaks go first. Runs in the
// caller's transaction: when the item delete is refused (inventory history,
// tracked entities) the price breaks stay.
async function deleteItemsWithPriceBreaks(
  trx: KyselyTx,
  args: { itemIds: string[]; companyId: string }
) {
  const { itemIds, companyId } = args;
  if (itemIds.length === 0) return;

  await trx
    .deleteFrom("supplierPartPrice")
    .where("companyId", "=", companyId)
    .where("supplierPartId", "in", (eb) =>
      eb
        .selectFrom("supplierPart")
        .select("id")
        .where("itemId", "in", itemIds)
        .where("companyId", "=", companyId)
    )
    .execute();

  await trx
    .deleteFrom("item")
    .where("id", "in", itemIds)
    .where("companyId", "=", companyId)
    .execute();
}

export async function deleteItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  id: string,
  companyId: string
): Promise<{ data: null; error: ServiceError | null }> {
  // The item DELETE policy asks for parts_delete in the item's company.
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_delete"
  );
  if (permitted.error) return { data: null, error: permitted.error };

  try {
    await db
      .transaction()
      .execute((trx) =>
        deleteItemsWithPriceBreaks(trx, { itemIds: [id], companyId })
      );
  } catch (error) {
    logger.error("Failed to delete item", { companyId, itemId: id, error });
    return { data: null, error: writeError(error) };
  }
  return { data: null, error: null };
}

export async function deleteItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").delete().eq("id", id);
}

export async function deleteMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").delete().eq("id", id);
}

export async function deleteMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").delete().eq("id", id);
}

export async function deleteMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").delete().eq("id", id);
}

export async function deleteMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").delete().eq("id", id);
}

export async function deleteMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").delete().eq("id", id);
}

export async function deleteMethodMaterial(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodMaterial").delete().eq("id", id);
}

export async function assertMethodOperationIsDraft(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const result = await client
    .from("methodOperation")
    .select("makeMethodId, makeMethod!inner(status)")
    .eq("id", operationId)
    .single();

  if (result.error || !result.data) {
    throw new Error("Failed to find method operation");
  }

  const status = (result.data.makeMethod as { status: string }).status;
  if (status !== "Draft") {
    throw new Error(
      `Cannot modify steps on a method version with status "${status}". Only Draft versions can be modified.`
    );
  }
}

export async function deleteMethodOperation(
  client: SupabaseClient<Database>,
  methodOperationId: string
) {
  return client.from("methodOperation").delete().eq("id", methodOperationId);
}

export async function deleteMethodOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationStep").delete().eq("id", id);
}

export async function deleteMethodOperationStepSlide(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationStepSlide").delete().eq("id", id);
}

export async function deleteMethodOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationParameter").delete().eq("id", id);
}

export async function deleteMethodOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("methodOperationTool").delete().eq("id", id);
}

export async function deleteUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("unitOfMeasure").delete().eq("id", id);
}

export async function getConfigurationRules(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await client
    .from("configurationRule")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (result.error) {
    logger.error("Failed to get configuration rules", { error: result.error });
    return [];
  }
  return result.data ?? [];
}

export async function getConsumable(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_consumable_details", {
      item_id: itemId
    })
    .single();
}

export async function getConsumables(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("consumables")
    .select(CONSUMABLES_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getItem(client: SupabaseClient<Database>, id: string) {
  return client.from("item").select("*").eq("id", id).single();
}

export async function getItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemCost")
    .select("*, ...item(readableIdWithRevision)")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCostHistory(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const dateOneYearAgo = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .subtract({ years: 1 })
    .toString();

  return client
    .from("costLedger")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .gte("postingDate", dateOneYearAgo)
    .order("postingDate", { ascending: false })
    .limit(500);
}

export async function getItemCustomerPart(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemCustomerParts(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerPartToItem")
    .select("*, customer(id, name)")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getItemDemand(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const [actuals, forecasts, projections] = await Promise.all([
    client
      .from("demandActual")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods),
    client
      .from("demandForecast")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
      .order("periodId"),
    client
      .from("demandProjection")
      .select("*")
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId)
      .in("periodId", periods)
  ]);

  // A failed read is reported, not folded into an empty series: an item with
  // no demand yet has empty series too, and the two must not look alike.
  return {
    actuals: actuals.data ?? [],
    forecasts: forecasts.data ?? [],
    projections: projections.data ?? [],
    error: actuals.error ?? forecasts.error ?? projections.error ?? null
  };
}

export type DemandForecastSourceRow = {
  itemId: string;
  locationId: string | null;
  periodId: string;
  sourceType: "Job Material" | "Sales Order" | "Demand Projection";
  quantity: number;
  jobId: string | null;
  salesOrderLineId: string | null;
  demandProjectionId: string | null;
  parentItemId: string;
  parentItem: { id: string; readableId: string; name: string } | null;
  redirectedFromItemId: string | null;
  redirectedFromItem: {
    id: string;
    readableIdWithRevision: string;
  } | null;
  job: {
    id: string;
    jobId: string;
    dueDate: string | null;
    status: string | null;
  } | null;
  salesOrderLine: {
    id: string;
    salesOrderId: string;
    promisedDate: string | null;
    salesOrder: { id: string; salesOrderId: string } | null;
  } | null;
  demandProjection: {
    id: string;
    forecastQuantity: number;
    forecastMethod: string | null;
    confidence: number | null;
    notes: string | null;
    createdBy: string;
    createdAt: string;
    period: { startDate: string } | null;
  } | null;
};

export async function getDemandForecastSources(
  client: SupabaseClient<Database>,
  {
    itemId,
    locationId,
    periods,
    companyId
  }: {
    itemId: string;
    locationId: string;
    periods: string[];
    companyId: string;
  }
) {
  const result = await client
    .from("demandForecastSource")
    .select(
      `
        itemId,
        locationId,
        periodId,
        sourceType,
        quantity,
        jobId,
        salesOrderLineId,
        demandProjectionId,
        parentItemId,
        parentItem:item!demandForecastSource_parentItemId_fkey(id, readableId, name),
        redirectedFromItemId,
        redirectedFromItem:item!demandForecastSource_redirectedFromItemId_fkey(id, readableIdWithRevision),
        job:job!demandForecastSource_jobId_fkey(id, jobId, dueDate, status),
        salesOrderLine:salesOrderLine!demandForecastSource_salesOrderLineId_fkey(
          id,
          salesOrderId,
          promisedDate,
          salesOrder:salesOrder(id, salesOrderId)
        ),
        demandProjection:demandProjection!demandForecastSource_demandProjectionId_fkey(
          id,
          forecastQuantity,
          forecastMethod,
          confidence,
          notes,
          period(startDate),
          createdBy,
          createdAt
        )
      `
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", periods);

  return {
    data: result.data ?? [],
    error: result.error
  };
}

export async function getItemFiles(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/parts/${itemId}`);
  return result.data ?? [];
}

export async function getItemPostingGroup(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("itemPostingGroup").select("*").eq("id", id).single();
}

export async function getItemPostingGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("itemPostingGroup")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getItemPostingGroupsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("itemPostingGroup")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId)
    .order("name");
}

export async function getItemManufacturing(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

export async function getItemPlanning(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("itemPlanning")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getItemQuantities(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  // item_id restricts the RPC to one item so it doesn't aggregate the whole
  // location's ledger/PO/SO/job history for a single detail page (added in
  // migration 20260713231142; the committed DB types regenerate from the
  // cloud DB after deploy, hence the cast).
  return client
    .rpc("get_inventory_quantities", {
      location_id: locationId,
      company_id: companyId,
      item_id: itemId
    } as { location_id: string; company_id: string })
    .eq("id", itemId)
    .maybeSingle();
}

/**
 * On-hand quantity per item for the Item picker's badge, as a plain map.
 *
 * `locationId` of "all" totals every location (including the '' bucket for
 * ledger rows with no location), matching what the picker shows when no
 * location is in play. Zero rows are dropped — the picker renders no badge for
 * an item it has no row for, so they carry no information and are the bulk of
 * the table on a tenant with history.
 */
export async function getItemStockQuantitiesByLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  const { data, error } = await fetchAllFromTable<{
    itemId: string;
    quantityOnHand: number;
  }>(client, "itemStockQuantities", "itemId, quantityOnHand", (query) => {
    const scoped = query
      .eq("companyId", companyId)
      .neq("quantityOnHand", 0)
      // Total order across the whole key: fetchAllFromTable pages, and without
      // one a concurrent write can shift a row across a page boundary.
      .order("itemId")
      .order("locationId");

    return locationId === "all" ? scoped : scoped.eq("locationId", locationId);
  });

  if (error) return { data: null, error };

  const quantities: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.itemId) continue;
    quantities[row.itemId] =
      (quantities[row.itemId] ?? 0) + (Number(row.quantityOnHand) || 0);
  }

  return { data: quantities, error: null };
}

export async function getItemReplenishment(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemReplenishment")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .single();
}

export async function getItemSupersession(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // itemSupersession has two FKs to item, so embeds must hint the FK.
  return client
    .from("itemSupersession")
    .select(
      "*, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getItemSupersessionsForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
) {
  if (itemIds.length === 0) return { data: [], error: null };
  return client
    .from("itemSupersession")
    .select(
      "itemId, supersessionMode, successorItemId, successorEffectivityDate, conversionFactor, successor:item!itemSupersession_successorItemId_fkey(readableIdWithRevision)"
    )
    .in("itemId", itemIds)
    .eq("companyId", companyId);
}

// Parts that point to this item as their successor (the "Supersedes" back-ref).
export async function getItemSupersededBy(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSupersession")
    .select(
      "itemId, supersessionMode, successorEffectivityDate, predecessor:item!itemSupersession_itemId_fkey(id, readableIdWithRevision, name)"
    )
    .eq("successorItemId", itemId)
    .eq("companyId", companyId);
}

export async function getSupersessionChain(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // Forward chain (this item -> successor -> ...), cycle-safe, capped depth.
  type ChainLink = {
    itemId: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
    successorEffectivityDate: string | null;
    successor: {
      id: string;
      readableIdWithRevision: string | null;
      name: string;
    } | null;
  };
  const chain: ChainLink[] = [];
  const visited = new Set<string>();
  let currentId: string | null = itemId;
  while (currentId && !visited.has(currentId) && chain.length < 5) {
    visited.add(currentId);
    const link = await client
      .from("itemSupersession")
      .select(
        "itemId, supersessionMode, successorItemId, successorEffectivityDate, successor:item!itemSupersession_successorItemId_fkey(id, readableIdWithRevision, name)"
      )
      .eq("itemId", currentId)
      .eq("companyId", companyId)
      .maybeSingle();
    const data = link.data as ChainLink | null;
    if (!data) break;
    chain.push(data);
    currentId = data.successorItemId;
  }

  const supersededBy = await getItemSupersededBy(client, itemId, companyId);

  return { chain, supersededBy: supersededBy.data ?? [] };
}

export async function getItemUnitSalePrice(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("itemUnitSalePrice")
    .select("*")
    .eq("itemId", id)
    .eq("companyId", companyId)
    .single();
}

/**
 * Where a material or consumable is used.
 */
export async function getMaterialUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const usedIn = await readUsedIn(client, itemId, companyId);
  return {
    issues: usedIn.issues,
    jobMaterials: usedIn.jobMaterials,
    maintenanceDispatchItems: usedIn.maintenanceDispatchItems,
    methodMaterials: usedIn.methodMaterials,
    purchaseOrderLines: usedIn.purchaseOrderLines,
    receiptLines: usedIn.receiptLines,
    quoteMaterials: usedIn.quoteMaterials,
    salesOrderLines: usedIn.salesOrderLines,
    shipmentLines: usedIn.shipmentLines,
    supplierQuotes: usedIn.supplierQuotes,
    inspections: usedIn.inspections,
    jobMaterialUsage: usedIn.jobMaterialUsage
  };
}

export async function getMakeMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getMakeMethodById(
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) {
  return client
    .from("makeMethod")
    .select("*")
    .eq("id", makeMethodId)
    .eq("companyId", companyId)
    .single();
}

export async function getMaterial(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_material_details", {
      item_id: itemId
    })
    .single();
}

export async function getMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("materials")
    .select(MATERIALS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

function buildSearchFilter(search: string, columns: string[]) {
  const value = `"%${search.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
  return columns.map((column) => `${column}.ilike.${value}`).join(",");
}

export async function getMaterialDimension(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialDimension").select("*").eq("id", id).single();
}

export async function getMaterialDimensions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; isMetric: boolean }
) {
  let query = client
    .from("materialDimensions")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("isMetric", args?.isMetric ?? false)
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "formName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "formName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialDimensionList(
  client: SupabaseClient<Database>,
  materialFormId: string,
  isMetric: boolean,
  companyId: string
) {
  return client
    .from("materialDimension")
    .select("*")
    .eq("materialFormId", materialFormId)
    .eq("isMetric", isMetric)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialFinish(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialFinish").select("*").eq("id", id).single();
}

export async function getMaterialFinishes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialFinishes")
    .select("*", {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "substanceName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialFinishList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialFinish")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialForm(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialForm").select("*").eq("id", id).single();
}

export async function getMaterialForms(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialForm")
    .select("*", {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialFormsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialForm")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMaterialGrades(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialGrades")
    .select("*", {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, ["name", "substanceName", "id"])
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "substanceName", ascending: true },
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialGrade(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialGrade").select("*").eq("id", id).single();
}

export async function getMaterialGradeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  companyId: string
) {
  return client
    .from("materialGrade")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

export async function getMaterialSubstance(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialSubstance").select("*").eq("id", id).single();
}

export async function getMaterialSubstances(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialSubstance")
    .select("*", {
      count: LIST_COUNT
    })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaterialSubstancesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("materialSubstance")
    .select("id, name, code, companyId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .order("name");
}

export async function getMethodMaterials(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodMaterial")
    .select(
      "*, item(name, readableIdWithRevision), makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: LIST_COUNT
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("item.readableIdWithRevision", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, []);
  }

  return query;
}

// The step-link `quantity` column ships with this branch's migration, which only
// runs on main — previews (and the prod window between app deploy and migration)
// run this code against the pre-migration schema. PostgREST fails the WHOLE
// select on an unknown embedded column, so fall back to the quantity-less query
// instead of rendering an empty BOM. 42703 = Postgres undefined_column; PGRST204
// = PostgREST's schema-cache miss for a written column.
function isMissingQuantityColumn(
  error: { code?: string; message?: string } | null
) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function getMethodMaterialsByMakeMethod(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  const result = await client
    .from("methodMaterial")
    .select(
      "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType), methodMaterialStep(methodOperationStepId, quantity)"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
  if (isMissingQuantityColumn(result.error)) {
    return (await client
      .from("methodMaterial")
      .select(
        "*, item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType), methodMaterialStep(methodOperationStepId)"
      )
      .eq("makeMethodId", makeMethodId)
      .order("order", { ascending: true })) as unknown as typeof result;
  }
  return result;
}

export async function getMethodOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("methodOperation")
    .select(
      "*, makeMethod!makeMethodId(item(id, type, name, readableIdWithRevision))",
      {
        count: LIST_COUNT
      }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("description", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "order", ascending: true }
    ]);
  }

  return query;
}

export async function getMethodOperationsByMakeMethodId(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client
    .from("methodOperation")
    .select(
      "*, methodOperationTool(*, methodOperationToolStep(methodOperationStepId)), methodOperationParameter(*), methodOperationStep(*, methodOperationStepSlide(*))"
    )
    .eq("makeMethodId", makeMethodId)
    .order("order", { ascending: true });
}

type Method = NonNullable<
  Awaited<ReturnType<typeof getMethodTreeArray>>["data"]
>[number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

export async function getMethodTree(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  const items = await getMethodTreeArray(client, makeMethodId);
  if (items.error) return items;

  const tree = getMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getMethodTreeArray(
  client: SupabaseClient<Database>,
  makeMethodId: string
) {
  return client.rpc("get_method_tree", {
    uid: makeMethodId
  });
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-expect-error
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-expect-error
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }

  // A sub-assembly used in two places is one node above: give each place an
  // id of its own, the same on every load (see `withPathIds`).
  return withPathIds(rootItems);
}

export type BomItemAttributes = {
  readableId: string;
  revision: string;
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  itemPostingGroup: string | null;
  lotSize: number | null;
  leadTime: number | null;
};

export async function getBomItemAttributes(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[]
) {
  const [items, costs, replenishments] = await Promise.all([
    client
      .from("item")
      .select("id, readableId, revision, itemTrackingType, replenishmentSystem")
      .in("id", itemIds)
      .eq("companyId", companyId),
    client
      .from("itemCost")
      .select("itemId, ...itemPostingGroup(itemPostingGroup:name)")
      .in("itemId", itemIds)
      .eq("companyId", companyId),
    client
      .from("itemReplenishment")
      .select("itemId, lotSize, leadTime")
      .in("itemId", itemIds)
      .eq("companyId", companyId)
  ]);

  const error = items.error ?? costs.error ?? replenishments.error;
  if (error) return { data: null, error };

  const postingGroupByItemId = new Map(
    (costs.data ?? []).map((c) => [c.itemId, c.itemPostingGroup])
  );
  const replenishmentByItemId = new Map(
    (replenishments.data ?? []).map((r) => [r.itemId, r])
  );

  const data = new Map<string, BomItemAttributes>(
    (items.data ?? []).map((item) => [
      item.id,
      {
        readableId: item.readableId,
        revision: item.revision ?? "",
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroup: postingGroupByItemId.get(item.id) ?? null,
        lotSize: replenishmentByItemId.get(item.id)?.lotSize ?? null,
        leadTime: replenishmentByItemId.get(item.id)?.leadTime ?? null
      }
    ])
  );

  return { data, error: null };
}

export async function getOpenJobMaterials(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openJobMaterialLines")
    .select(
      "id, parentMaterialId, jobMakeMethodId, jobId, quantity:quantityToIssue, quantityPerParent, documentReadableId:jobReadableId, documentId:jobId, dueDate"
    )
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId);
}

export async function getOpenProductionOrders(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return fetchAllFromTable<{
    id: string;
    quantity: number | null;
    documentReadableId: string | null;
    documentId: string;
    dueDate: string | null;
    deadlineType: Database["public"]["Enums"]["deadlineType"] | null;
  }>(
    client,
    "openProductionOrders",
    "id, quantity:quantityToReceive, documentReadableId:jobId, documentId:id, dueDate, deadlineType",
    (query) =>
      query
        .eq("itemId", itemId)
        .eq("locationId", locationId)
        .eq("companyId", companyId)
        .order("id")
  );
}

export async function getOpenPurchaseOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return fetchAllFromTable<{
    id: string;
    quantity: number | null;
    promisedDate: string | null;
    dueDate: string | null;
    orderDate: string | null;
    leadTime: number | null;
    documentReadableId: string | null;
    documentId: string;
  }>(
    client,
    "openPurchaseOrderLines",
    "id, quantity:quantityToReceive, promisedDate, dueDate, orderDate, leadTime, ...purchaseOrder(documentReadableId:purchaseOrderId, documentId:id)",
    (query) =>
      query
        .eq("itemId", itemId)
        .eq("locationId", locationId)
        .eq("companyId", companyId)
        .order("id")
  );
}

export async function getOpenSalesOrderLines(
  client: SupabaseClient<Database>,
  {
    itemId,
    companyId,
    locationId
  }: { itemId: string; companyId: string; locationId: string }
) {
  return client
    .from("openSalesOrderLines")
    .select(
      "id, quantity:quantityToSend, dueDate:promisedDate, ...salesOrder(documentReadableId:salesOrderId, documentId:id)"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId);
}

export async function getPart(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_part_details", {
      item_id: itemId
    })
    .single();
}

export async function getParts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("parts")
    .select(PARTS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

// Distinct manufacturer part numbers for the company, used to populate the MPN
// column filter in the item list tables. Deduping happens in the route loader.
export async function getItemMpnsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{ mpn: string }>(client, "item", "mpn", (query) =>
    query
      .eq("companyId", companyId)
      .not("mpn", "is", null)
      .neq("mpn", "")
      .order("mpn")
  );
}

export async function getPartsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Part")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

// Every line's document exists: the foreign keys are NOT NULL.
type UsedInDocument = {
  id: string;
  documentReadableId: string;
  documentId: string;
};
type UsedInMethod = UsedInDocument & { methodType: string };

export type ItemUsedIn = {
  issues: UsedInDocument[];
  jobMaterials: UsedInMethod[];
  jobs: { id: string; documentReadableId: string }[];
  maintenanceDispatchItems: UsedInDocument[];
  methodMaterials: (UsedInMethod & {
    version: number;
    documentParentId: string;
    itemType: Database["public"]["Enums"]["itemType"];
  })[];
  purchaseOrderLines: UsedInDocument[];
  receiptLines: UsedInDocument[];
  quoteLines: UsedInMethod[];
  quoteMaterials: (UsedInMethod & { documentParentId: string })[];
  salesOrderLines: UsedInMethod[];
  shipmentLines: UsedInDocument[];
  supplierQuotes: UsedInDocument[];
  assemblyInstructions: {
    id: string;
    documentReadableId: string;
    version: number;
  }[];
  inspections: { id: string; documentReadableId: string }[];
  jobMaterialUsage: {
    byMaterialId: Record<string, number>;
    byJobId: Record<string, number>;
  };
};

const NOT_USED: ItemUsedIn = {
  issues: [],
  jobMaterials: [],
  jobs: [],
  maintenanceDispatchItems: [],
  methodMaterials: [],
  purchaseOrderLines: [],
  receiptLines: [],
  quoteLines: [],
  quoteMaterials: [],
  salesOrderLines: [],
  shipmentLines: [],
  supplierQuotes: [],
  assemblyInstructions: [],
  inspections: [],
  jobMaterialUsage: { byMaterialId: {}, byJobId: {} }
};

/**
 * Every place an item is referenced, in one request (`get_item_used_in`). It
 * was fifteen PostgREST requests fired at once: on a page load they took most
 * of the request's eight call slots from the queries the page was waiting on.
 * A failure is logged and reads as "not used", as each of the fifteen did.
 */
async function readUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<ItemUsedIn> {
  const { data, error } = await client.rpc("get_item_used_in", {
    item_id: itemId,
    company_id: companyId
  });
  if (error || !data) {
    logger.error("Failed to read where an item is used", {
      companyId,
      itemId,
      error
    });
    return structuredClone(NOT_USED);
  }
  return data as unknown as ItemUsedIn;
}

/**
 * Where a part, tool or service is used.
 */
export async function getPartUsedIn(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<ItemUsedIn> {
  return readUsedIn(client, itemId, companyId);
}

export async function getPickMethod(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  locationId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .maybeSingle();
}

export async function getPickMethods(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("pickMethod")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function getServices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    group: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("services")
    .select(SERVICES_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds"
  ]);

  if (args.group) {
    query = query.eq("itemPostingGroupId", args.group);
  }

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getService(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  // get_service_details returns the same shape as get_tool_details. The RPC only
  // enters the committed (cloud-sourced) types once the migration is applied to
  // the cloud DB, so until then we borrow the tool-details typing while calling
  // the real RPC. Drop the cast after the next cloud type regeneration.
  return client
    .rpc("get_service_details" as unknown as "get_tool_details", {
      item_id: itemId
    })
    .single();
}

export async function getServicesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    readableIdWithRevision: string;
  }>(client, "item", "id, name, readableIdWithRevision", (query) =>
    query
      .eq("type", "Service")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name")
  );
}

export async function getSupplierParts(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("supplierPart")
    .select("*")
    .eq("active", true)
    .eq("itemId", id)
    .eq("companyId", companyId);
}

export async function getSupplierPartsBySupplier(
  client: SupabaseClient<Database>,
  supplierId: string,
  companyId: string
) {
  // Paged past PostgREST's 1000-row cap: a distributor can supply thousands of parts.
  return fetchAllRecords(() =>
    client
      .from("supplierPart")
      .select(
        "*, item(id, readableIdWithRevision, name, type, thumbnailPath, unitOfMeasureCode)"
      )
      .eq("active", true)
      .eq("supplierId", supplierId)
      .eq("companyId", companyId)
      .order("id")
  );
}

export async function getTool(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .rpc("get_tool_details", {
      item_id: itemId
    })
    .single();
}

export async function getTools(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("tools")
    .select(TOOLS_LIST_COLUMNS, {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  query = setSearchFilter(query, args.search, [
    "readableIdWithRevision",
    "name",
    "description",
    "supplierIds",
    "mpn"
  ]);

  if (args.supplierId) {
    query = query.contains("suppliers", [args.supplierId]);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);
  return query;
}

export async function getUnitOfMeasure(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

/**
 * Which tables still reference a unit of measure, and how many rows each;
 * empty means safe to delete (or id not visible to the caller). RPC-backed so
 * the answer doesn't depend on the caller's module permissions.
 */
export async function getUnitOfMeasureUsage(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.rpc("get_unit_of_measure_usage", { p_id: id });
}

export async function getUnitOfMeasures(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("unitOfMeasure")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(searchFilter(["name", "code"], args.search));
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getUnitOfMeasuresList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("unitOfMeasure")
    .select("name, code")
    .eq("companyId", companyId)
    .order("name");
}

export async function updateConfigurationParameterGroupOrder(
  client: SupabaseClient<Database>,
  data: z.infer<typeof configurationParameterGroupOrderValidator>
) {
  return client
    .from("configurationParameterGroup")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateDefaultRevision(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    updatedBy: string;
  }
) {
  const [item, makeMethod] = await Promise.all([
    client
      .from("item")
      .select("id,readableId, readableIdWithRevision, type, companyId")
      .eq("id", data.id)
      .single(),
    client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", data.id)
      .maybeSingle()
  ]);
  if (item.error) return item;
  const { readableId, type, companyId } = item.data;
  if (!companyId) return item;
  const relatedItems = await client
    .from("item")
    .select("id")
    .eq("readableId", readableId)
    .eq("type", type)
    .eq("companyId", companyId);

  const itemIds = relatedItems.data?.map((item) => item.id) ?? [];

  return client
    .from("methodMaterial")
    .update({
      itemId: item.data.id,
      materialMakeMethodId: makeMethod.data?.id
    })
    .in("itemId", itemIds);
}

export async function updateConfigurationParameterOrder(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof configurationParameterOrderValidator>,
    "configurationParameterGroupId"
  > & {
    configurationParameterGroupId?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("configurationParameter")
    .update(sanitize(data))
    .eq("id", data.id);
}

export async function updateItemCost(
  client: SupabaseClient<Database>,
  itemId: string,
  cost: {
    unitCost: number;
    updatedBy: string;
  }
) {
  return client
    .from("itemCost")
    .update({
      ...cost,
      costIsAdjusted: true,
      updatedAt: datetime.timestamp()
    })
    .eq("itemId", itemId)
    .single();
}

export async function updateRevision(
  client: SupabaseClient<Database>,
  revision: {
    id: string;
    revision: string;
    updatedBy: string;
  }
) {
  return client
    .from("item")
    .update({
      ...revision,
      updatedAt: datetime.timestamp()
    })
    .eq("id", revision.id);
}

export async function upsertConfigurationParameter(
  client: SupabaseClient<Database>,
  configurationParameter: z.infer<typeof configurationParameterValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { userId, ...data } = configurationParameter;
  if (configurationParameter.id) {
    return client
      .from("configurationParameter")
      .update(
        sanitize({
          ...data,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
      )
      .eq("id", configurationParameter.id);
  }

  let ungroupedGroupId: string | null = null;
  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", data.itemId);

  const ungroupedGroup = existingGroups.data?.find(
    (group) => group.isUngrouped
  );

  if (ungroupedGroup) {
    ungroupedGroupId = ungroupedGroup.id;
  } else {
    const maxSortOrder =
      existingGroups.data?.reduce(
        (max, group) => Math.max(max, group.sortOrder ?? 1),
        1
      ) ?? 0;
    const ungroupedGroupInsert = await client
      .from("configurationParameterGroup")
      .insert({
        itemId: data.itemId,
        name: "Ungrouped",
        isUngrouped: true,
        sortOrder: maxSortOrder + 1,
        companyId: data.companyId
      })
      .select("id")
      .single();
    if (ungroupedGroupInsert.error) return ungroupedGroupInsert;
    ungroupedGroupId = ungroupedGroupInsert.data.id;
  }

  return client.from("configurationParameter").insert({
    ...data,
    key: data.key ?? "",
    createdBy: userId,
    configurationParameterGroupId: ungroupedGroupId
  });
}

export async function upsertConfigurationParameterGroup(
  client: SupabaseClient<Database>,
  configurationParameterGroup: z.infer<
    typeof configurationParameterGroupValidator
  > & {
    companyId: string;
    itemId: string;
  }
) {
  const { itemId, ...data } = configurationParameterGroup;
  if (configurationParameterGroup.id) {
    return client
      .from("configurationParameterGroup")
      .update({
        name: data.name
      })
      .eq("id", configurationParameterGroup.id);
  }

  const existingGroups = await client
    .from("configurationParameterGroup")
    .select("id, isUngrouped, sortOrder")
    .eq("itemId", itemId);

  const maxSortOrder =
    existingGroups.data?.reduce(
      (max, group) => Math.max(max, group.sortOrder ?? 1),
      1
    ) ?? 0;

  return client.from("configurationParameterGroup").insert({
    ...data,
    itemId,
    name: data.name,
    sortOrder: maxSortOrder + 1
  });
}

export async function upsertConfigurationRule(
  client: SupabaseClient<Database>,
  configurationRule: z.infer<typeof configurationRuleValidator> & {
    itemId: string;
    companyId: string;
    updatedBy: string;
  }
) {
  return client.from("configurationRule").upsert(configurationRule, {
    onConflict: "itemId,field"
  });
}

/**
 * Persist (or clear) the per-item shelf-life policy. Shelf life lives on the
 * "itemShelfLife" table, keyed by itemId. Absence of a row = not managed.
 *
 * Three-way mode handling so this helper can be called from any upsert path
 * safely, including forms that don't surface the shelf-life fields:
 *   - mode undefined         -> no-op. The caller's form didn't opine on
 *                               shelf life; leave whatever row exists alone.
 *   - mode 'NotManaged'      -> explicit opt-out. DELETE any existing row.
 *   - mode 'Fixed Duration' or
 *     'Calculated'           -> UPSERT, clearing fields that don't apply to
 *                               the selected mode so stale values never leak
 *                               between modes.
 *
 * Callers on an item INSERT path should pass companyId so the helper can
 * seed a fresh row without a round-trip; on an UPDATE path where we know
 * the row already exists, companyId is optional.
 */
/**
 * Persist the user's "default storage unit" pick from the item form as a
 * row in the "pickMethod" table. Items are company-wide in Carbon;
 * per-location stocking facts live on pickMethod keyed by
 * (itemId, locationId). Writing the form pick here (rather than as
 * columns on "item") respects that boundary and lets a single item
 * accumulate multiple location defaults over time.
 *
 * The locationId for the pickMethod row is derived from the chosen
 * storageUnit (every storageUnit belongs to exactly one location), so
 * the caller only needs to pass the storageUnitId. This keeps the item
 * form to a single "Default Storage Unit" field - the location is
 * implicit.
 *
 * Semantics:
 *   - storageUnitId undefined -> no-op. Forms that don't surface this
 *     field (e.g. the manufacturing sub-form) can share an action
 *     without accidentally creating or clobbering a pickMethod row.
 *   - storageUnitId set -> UPSERT on (itemId, storageUnit.locationId).
 *     Existing defaultStorageUnit for that location is overwritten with
 *     the new pick.
 */
export async function upsertItemDefaultPickMethod(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    storageUnitId?: string;
  }
) {
  if (!args.storageUnitId) {
    return { data: null, error: null };
  }

  const storageUnit = await client
    .from("storageUnit")
    .select("locationId, companyId")
    .eq("id", args.storageUnitId)
    .single();
  if (storageUnit.error || !storageUnit.data) return storageUnit;

  return client.from("pickMethod").upsert(
    {
      itemId: args.itemId,
      locationId: storageUnit.data.locationId,
      defaultStorageUnitId: args.storageUnitId,
      companyId: storageUnit.data.companyId,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "itemId,locationId" }
  );
}

/**
 * Return the distinct processIds referenced by methodOperation rows on the
 * item's active makeMethod. Used to scope the shelf-life trigger-process
 * picker to processes the recipe will actually run, so users can't pick a
 * process the trigger never matches against (the set-shelf-life helper short-circuits
 * on processId mismatch). Empty array when the item has no active recipe.
 */
export async function getRecipeProcessIdsForItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();
  if (makeMethod.error || !makeMethod.data?.id) {
    return { data: [] as string[], error: makeMethod.error ?? null };
  }
  const operations = await client
    .from("methodOperation")
    .select("processId")
    .eq("makeMethodId", makeMethod.data.id);
  if (operations.error) {
    return { data: [] as string[], error: operations.error };
  }
  const ids = Array.from(
    new Set(
      (operations.data ?? [])
        .map((o) => o.processId)
        .filter((id): id is string => !!id)
    )
  );
  return { data: ids, error: null };
}

/**
 * Fetch the shelf-life policy for an item. Returns `data: null` (without
 * an error) when the item has no row, since absence = "not managed" and
 * that's a valid state we don't want to treat as an error path.
 */
export async function getItemShelfLife(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("itemShelfLife")
    .select("mode, days, triggerProcessId, triggerTiming, calculateFromBom")
    .eq("itemId", itemId)
    .maybeSingle();
}

/**
 * Returns true when the item's active make-method has at least one BOM
 * input with a managed shelf-life policy. Used to surface a warning when
 * the user picks a BOM-driven shelf-life mode (Calculated, or Fixed
 * Duration with calculateFromBom) but no input would actually contribute
 * an expiry date.
 *
 * Returns false when there is no make-method, no materials, or every
 * material has shelf-life NotManaged. Errors are coerced to false — this
 * is a UI hint, not a correctness gate.
 */
export async function getBomHasShelfLifeManagedInput(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<boolean> {
  const makeMethods = await getMakeMethods(client, itemId, companyId);
  if (makeMethods.error || !makeMethods.data?.length) return false;

  const active =
    makeMethods.data.find((m) => m.status === "Active") ?? makeMethods.data[0];

  const materials = await getMethodMaterialsByMakeMethod(client, active.id);
  const inputItemIds = (materials.data ?? [])
    .map((m) => m.itemId)
    .filter((id): id is string => !!id);
  if (inputItemIds.length === 0) return false;

  // Any row in itemShelfLife is by definition managed - the upsert path
  // deletes the row when mode = 'NotManaged' and the column enum has no
  // such value, so presence is sufficient.
  const managed = await client
    .from("itemShelfLife")
    .select("itemId")
    .in("itemId", inputItemIds)
    .limit(1);

  return !managed.error && (managed.data?.length ?? 0) > 0;
}

export async function upsertItemShelfLife(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    userId: string;
    companyId?: string;
    mode?: (typeof shelfLifeModes)[number];
    days?: number;
    triggerProcessId?: string;
    triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
    calculateFromBom?: boolean;
  }
) {
  if (args.mode === undefined) {
    return { data: null, error: null };
  }

  if (args.mode === "NotManaged") {
    return client.from("itemShelfLife").delete().eq("itemId", args.itemId);
  }

  const days = args.mode === "Fixed Duration" ? (args.days ?? null) : null;
  const triggerProcessId =
    args.mode === "Fixed Duration" ? (args.triggerProcessId ?? null) : null;
  // triggerTiming only matters when there's a trigger process. Reset to the
  // default 'After' otherwise so the column never carries a stale value
  // from a prior config.
  const triggerTiming = triggerProcessId
    ? (args.triggerTiming ?? "After")
    : "After";
  // Calculate-from-BOM is meaningful only on Fixed Duration; the table
  // CHECK enforces the same rule. Coerce any stale flag back to false on
  // mode switches so the row never carries an inconsistent combo.
  const calculateFromBom =
    args.mode === "Fixed Duration" ? (args.calculateFromBom ?? false) : false;

  // Reject trigger processes that aren't on the item's active recipe.
  // The set-shelf-life helper gates on processId equality, so a process
  // outside the recipe would never match and the expiry start date would
  // silently never get set. Mirrors the guard inside
  // upsertPickMethodWithShelfLife.
  if (triggerProcessId) {
    const recipe = await getRecipeProcessIdsForItem(client, args.itemId);
    if (recipe.error) {
      return { data: null, error: recipe.error } as any;
    }
    if (!recipe.data.includes(triggerProcessId)) {
      return {
        data: null,
        error: {
          message:
            "Shelf-life trigger process must be one of the operations on this item's recipe",
          details: "",
          hint: "",
          code: "shelf_life_trigger_process_not_in_recipe"
        }
      } as any;
    }
  }

  const existing = await client
    .from("itemShelfLife")
    .select("itemId")
    .eq("itemId", args.itemId)
    .maybeSingle();

  if (existing.error) return existing;

  if (existing.data) {
    return client
      .from("itemShelfLife")
      .update({
        mode: args.mode,
        days,
        triggerProcessId,
        triggerTiming,
        calculateFromBom,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("itemId", args.itemId);
  }

  let companyId = args.companyId;
  if (!companyId) {
    const itemRow = await client
      .from("item")
      .select("companyId")
      .eq("id", args.itemId)
      .single();
    if (itemRow.error || !itemRow.data) return itemRow;
    companyId = itemRow.data.companyId ?? undefined;
  }

  return client.from("itemShelfLife").insert({
    itemId: args.itemId,
    mode: args.mode!,
    days,
    triggerProcessId,
    triggerTiming,
    calculateFromBom,
    companyId: companyId!,
    createdBy: args.userId
  });
}

/**
 * Atomic counterpart to {@link upsertPickMethod} + {@link upsertItemShelfLife}.
 *
 * The inventory form card submits pickMethod fields and shelf-life fields in
 * the same POST (see pickMethodWithShelfLifeValidator). Writing them through
 * two independent Supabase calls means a failure between the two leaves a
 * partial update committed. This helper runs both writes inside a single
 * Postgres transaction via Kysely.
 */
export async function upsertPickMethodWithShelfLife(
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    locationId: string;
    defaultStorageUnitId?: string | null;
    sortMethod?: (typeof pickMethodSortMethods)[number];
    customFields?: Json;
    companyId: string;
    userId: string;
    shelfLife: {
      mode?: (typeof shelfLifeModes)[number];
      days?: number;
      triggerProcessId?: string;
      triggerTiming?: (typeof shelfLifeTriggerTimings)[number];
      calculateFromBom?: boolean;
    };
  }
) {
  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    // Kysely bypasses RLS and itemId comes from the URL, so prove the item is
    // this company's before any write — every statement below is also scoped.
    const item = await trx
      .selectFrom("item")
      .select("id")
      .where("id", "=", args.itemId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!item) {
      throw new Error(`Item ${args.itemId} not found`);
    }

    await trx
      .updateTable("pickMethod")
      .set({
        defaultStorageUnitId: args.defaultStorageUnitId ?? null,
        // Only overwrite when the caller surfaced the field; the column is
        // NOT NULL DEFAULT 'Default' so we never set it null.
        ...(args.sortMethod ? { sortMethod: args.sortMethod } : {}),
        customFields: args.customFields ?? null,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "=", args.itemId)
      .where("locationId", "=", args.locationId)
      .where("companyId", "=", args.companyId)
      .execute();

    const { mode, days, triggerProcessId, triggerTiming, calculateFromBom } =
      args.shelfLife;

    // mode undefined = caller didn't surface the field; leave any existing
    // row alone (matches upsertItemShelfLife semantics).
    if (mode === undefined) return;

    if (mode === "NotManaged") {
      await trx
        .deleteFrom("itemShelfLife")
        .where("itemId", "=", args.itemId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }

    const normalizedDays = mode === "Fixed Duration" ? (days ?? null) : null;
    const normalizedTriggerProcess =
      mode === "Fixed Duration" ? (triggerProcessId ?? null) : null;
    const normalizedTriggerTiming = normalizedTriggerProcess
      ? (triggerTiming ?? "After")
      : "After";
    const normalizedCalcFromBom =
      mode === "Fixed Duration" ? (calculateFromBom ?? false) : false;

    // Reject trigger processes that aren't on the item's active recipe.
    // The set-shelf-life helper gates on processId equality, so picking a
    // process the recipe never runs would silently never set the expiry.
    if (normalizedTriggerProcess) {
      const recipeProcessIds = await trx
        .selectFrom("methodOperation as mo")
        .innerJoin("activeMakeMethods as amm", "amm.id", "mo.makeMethodId")
        .select("mo.processId")
        .where("amm.itemId", "=", args.itemId)
        .where("amm.companyId", "=", args.companyId)
        .where("mo.processId", "is not", null)
        .execute();
      const allowed = new Set(
        recipeProcessIds
          .map((r) => r.processId)
          .filter((id): id is string => !!id)
      );
      if (!allowed.has(normalizedTriggerProcess)) {
        throw new Error(
          "Shelf-life trigger process must be one of the operations on this item's recipe"
        );
      }
    }

    const existing = await trx
      .selectFrom("itemShelfLife")
      .select("itemId")
      .where("itemId", "=", args.itemId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();

    if (existing) {
      await trx
        .updateTable("itemShelfLife")
        .set({
          mode,
          days: normalizedDays,
          triggerProcessId: normalizedTriggerProcess,
          triggerTiming: normalizedTriggerTiming,
          calculateFromBom: normalizedCalcFromBom,
          updatedBy: args.userId,
          updatedAt
        })
        .where("itemId", "=", args.itemId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }

    await trx
      .insertInto("itemShelfLife")
      .values({
        itemId: args.itemId,
        mode,
        days: normalizedDays,
        triggerProcessId: normalizedTriggerProcess,
        triggerTiming: normalizedTriggerTiming,
        calculateFromBom: normalizedCalcFromBom,
        companyId: args.companyId,
        createdBy: args.userId
      })
      .execute();
  });
}

/**
 * Cascades a change to item.itemTrackingType onto the snapshot columns
 * `requiresSerialTracking` and `requiresBatchTracking` on child rows that
 * belong to OPEN parents (jobs, receipts, shipments, stock transfers).
 *
 * Without this, snapshot flags drift from the live item value and leave the
 * UI reading stale (often sticky-true) tracking flags after an item is
 * flipped back to Inventory / Non-Inventory. The cascade only:
 * `setItemTrackingType` also writes the item.
 */
export async function cascadeItemTrackingType(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    newType: InventoryItemType;
    userId: string;
  }
) {
  if (args.itemIds.length === 0) return;

  const requiresSerialTracking = args.newType === ItemTrackingType.Serial;
  const requiresBatchTracking = args.newType === ItemTrackingType.Batch;
  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("jobMakeMethod")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("jobMaterial")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "jobId",
          "in",
          eb
            .selectFrom("job")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "in", ["Draft", "Planned"])
        )
      )
      .execute();

    await trx
      .updateTable("receiptLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "receiptId",
          "in",
          eb
            .selectFrom("receipt")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("shipmentLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "shipmentId",
          "in",
          eb
            .selectFrom("shipment")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();

    await trx
      .updateTable("stockTransferLine")
      .set({
        requiresSerialTracking,
        requiresBatchTracking,
        updatedBy: args.userId,
        updatedAt
      })
      .where("itemId", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .where((eb) =>
        eb(
          "stockTransferId",
          "in",
          eb
            .selectFrom("stockTransfer")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("status", "=", "Draft")
        )
      )
      .execute();
  });
}

/**
 * Updates item-level method/sourcing columns and mirrors the change down to
 * every methodMaterial that references the item — in a single transaction, so
 * the item and its mirrors can never be left half-applied.
 *
 * sourcingType and defaultMethodType are item-level properties; method
 * materials are read-only mirrors. Only mirrors on Draft make methods are
 * touched — Active and Archived methods are frozen. The write only:
 * `setItemSourcing` derives the interlocked fields first.
 */
export async function updateItemMethodAndSourcing(
  db: Kysely<KyselyDatabase>,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    itemUpdate: {
      replenishmentSystem?: Database["public"]["Enums"]["itemReplenishmentSystem"];
      defaultMethodType?: MethodType;
      sourcingType?: SourcingType;
    };
    cascade: {
      sourcingType?: SourcingType;
      methodType?: MethodType;
    };
  }
) {
  if (args.itemIds.length === 0) return;

  const updatedAt = datetime.timestamp();

  // An explicit allow-list, never a spread: `itemUpdate` reaches this from the
  // API with whatever keys the caller sent, and Kysely bypasses RLS — a spread
  // would let `{ companyId }` (or any other column) through to the UPDATE.
  const { replenishmentSystem, defaultMethodType, sourcingType } =
    args.itemUpdate;

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("item")
      .set({
        ...(replenishmentSystem !== undefined && { replenishmentSystem }),
        ...(defaultMethodType !== undefined && { defaultMethodType }),
        ...(sourcingType !== undefined && { sourcingType }),
        updatedBy: args.userId,
        updatedAt
      })
      .where("id", "in", args.itemIds)
      .where("companyId", "=", args.companyId)
      .execute();

    await cascadeSourcingAndMethodTypeToMethodMaterials(trx, {
      itemIds: args.itemIds,
      companyId: args.companyId,
      userId: args.userId,
      newSourcingType: args.cascade.sourcingType,
      newMethodType: args.cascade.methodType
    });
  });
}

/**
 * Mirrors an item's sourcingType/methodType onto every methodMaterial that
 * references it. Operates on a caller-supplied transaction so it composes with
 * the item update above. Only method materials on Draft make methods are
 * touched.
 */
async function cascadeSourcingAndMethodTypeToMethodMaterials(
  trx: KyselyTx,
  args: {
    itemIds: string[];
    companyId: string;
    userId: string;
    newSourcingType?: SourcingType;
    newMethodType?: MethodType;
  }
) {
  if (args.itemIds.length === 0) return;
  if (!args.newSourcingType && !args.newMethodType) return;

  const updatedAt = datetime.timestamp();

  // Restrict to method materials whose make method is still Draft.
  const onDraftMakeMethod = (
    eb: ExpressionBuilder<KyselyDatabase, "methodMaterial">
  ) =>
    eb(
      "makeMethodId",
      "in",
      eb
        .selectFrom("makeMethod")
        .select("id")
        .where("companyId", "=", args.companyId)
        .where("status", "=", "Draft")
    );

  const baseSet: {
    updatedBy: string;
    updatedAt: string;
    sourcingType?: SourcingType;
  } = {
    updatedBy: args.userId,
    updatedAt
  };
  if (args.newSourcingType) baseSet.sourcingType = args.newSourcingType;

  await trx
    .updateTable("methodMaterial")
    .set((eb) => ({
      ...baseSet,
      ...(args.newMethodType === "Make to Order"
        ? {
            methodType: "Make to Order" as const,
            // materialMakeMethodId points at the component item's active make
            // method (mirrors upsertMethodMaterial). Resolved with a correlated
            // subquery so a single statement covers every item; null when the
            // component has no active make method.
            materialMakeMethodId: eb
              .selectFrom("activeMakeMethods")
              .select("id")
              .whereRef(
                "activeMakeMethods.itemId",
                "=",
                "methodMaterial.itemId"
              )
              .where("activeMakeMethods.companyId", "=", args.companyId)
              .limit(1)
          }
        : args.newMethodType
          ? { methodType: args.newMethodType, materialMakeMethodId: null }
          : {})
    }))
    .where("itemId", "in", args.itemIds)
    .where("companyId", "=", args.companyId)
    .where(onDraftMakeMethod)
    .execute();
}

type ServiceError = PostgrestError | { message: string; code?: string };

/**
 * Resolves the typed item (part, material, tool, consumable, service) an
 * update addresses. `item` is keyed by uuid while the typed tables are keyed
 * by the item's readable id plus companyId, so writing the pair needs both
 * keys. Accepts either one: the uuid every read tool and route hands out, or
 * the readable id a person types. A uuid names one revision; a readable id
 * names every revision that shares it.
 */
async function resolveTypedItem(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    type: Database["public"]["Enums"]["itemType"];
  }
): Promise<
  | { data: { readableId: string; itemIds: string[] }; error: null }
  | { data: null; error: ServiceError }
> {
  const byId = await client
    .from("item")
    .select("id, readableId")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .eq("type", args.type)
    .maybeSingle();
  if (byId.error) return { data: null, error: byId.error };
  if (byId.data) {
    return {
      data: { readableId: byId.data.readableId, itemIds: [byId.data.id] },
      error: null
    };
  }

  const byReadableId = await client
    .from("item")
    .select("id")
    .eq("readableId", args.id)
    .eq("companyId", args.companyId)
    .eq("type", args.type);
  if (byReadableId.error) return { data: null, error: byReadableId.error };
  if (byReadableId.data.length === 0) {
    return {
      data: null,
      error: ruleError(`${args.type} ${args.id} not found`)
    };
  }
  return {
    data: {
      readableId: args.id,
      itemIds: byReadableId.data.map((item) => item.id)
    },
    error: null
  };
}

/** resolveTypedItem for a write to one revision's item row. */
async function resolveTypedItemRevision(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    type: Database["public"]["Enums"]["itemType"];
  }
): Promise<
  | { data: { id: string; readableId: string }; error: null }
  | { data: null; error: ServiceError }
> {
  const item = await resolveTypedItem(client, args);
  if (item.error) return item;
  const { readableId, itemIds } = item.data;
  if (itemIds.length > 1) {
    return {
      data: null,
      error: ruleError(
        `${args.type} ${args.id} has ${itemIds.length} revisions; pass the item id of the revision to update`
      )
    };
  }
  return { data: { id: itemIds[0], readableId }, error: null };
}

/**
 * The update half of upsertPart / upsertTool / upsertConsumable /
 * upsertService: resolves the item, then writes the item row and the typed
 * row. Each write selects its row back so a miss fails instead of reporting
 * success.
 */
async function updateTypedItem(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    updatedBy: string;
    type: "Part" | "Tool" | "Consumable" | "Service";
    item: Database["public"]["Tables"]["item"]["Update"];
    typed: { customFields?: Json };
  }
): Promise<
  | { data: { id: string; readableId: string }; error: null }
  | { data: null; error: ServiceError }
> {
  const resolved = await resolveTypedItemRevision(client, args);
  if (resolved.error) return resolved;
  const { id: itemId, readableId } = resolved.data;

  const table = typedItemTables[args.type];
  const audit = { updatedBy: args.updatedBy, updatedAt: datetime.timestamp() };
  const [itemWrite, typedWrite] = await Promise.all([
    client
      .from("item")
      .update({ ...sanitize(args.item), ...audit })
      .eq("id", itemId)
      .eq("companyId", args.companyId)
      .select("id")
      .single(),
    client
      .from(table)
      .update({ ...sanitize(args.typed), ...audit })
      .eq("id", readableId)
      .eq("companyId", args.companyId)
      .select("id")
      .single()
  ]);
  if (itemWrite.error) return { data: null, error: itemWrite.error };
  if (typedWrite.error) return { data: null, error: typedWrite.error };
  return resolved;
}

const typedItemTables = {
  Part: "part",
  Tool: "tool",
  Consumable: "consumable",
  Service: "service"
} as const;

/**
 * Creates a consumable (item row and consumable row) or updates one; on update
 * `id` is the item id (uuid) or the consumable's readable id and the write is
 * a full replace, so omitted optional fields are cleared.
 */
export async function upsertConsumable(
  client: SupabaseClient<Database>,
  consumable:
    | (z.infer<typeof consumableValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof consumableValidator> & {
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in consumable) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: consumable.id,
        name: consumable.name,
        description: consumable.description,
        type: "Consumable",
        replenishmentSystem: consumable.replenishmentSystem,
        defaultMethodType: consumable.defaultMethodType,
        itemTrackingType: consumable.itemTrackingType,
        unitOfMeasureCode: consumable.unitOfMeasureCode,
        active: true,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [consumableInsert, itemCostUpdate] = await Promise.all([
      client.from("consumable").upsert({
        id: consumable.id,
        companyId: consumable.companyId,
        createdBy: consumable.createdBy,
        customFields: consumable.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: consumable.postingGroupId,
            unitCost: consumable.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (consumableInsert.error) return consumableInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: consumable.createdBy,
        storageUnitId: consumable.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: consumable.createdBy,
        companyId: consumable.companyId,
        mode: consumable.shelfLifeMode,
        days: consumable.shelfLifeDays,
        triggerProcessId: consumable.shelfLifeTriggerProcessId,
        triggerTiming: consumable.shelfLifeTriggerTiming,
        calculateFromBom: consumable.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newConsumable = await client
      .from("consumables")
      .select("id")
      .eq("readableId", consumable.id)
      .eq("companyId", consumable.companyId)
      .single();

    return newConsumable;
  }

  const updated = await updateTypedItem(client, {
    id: consumable.id,
    companyId: consumable.companyId,
    updatedBy: consumable.updatedBy,
    type: "Consumable",
    item: {
      name: consumable.name,
      description: consumable.description,
      replenishmentSystem: consumable.replenishmentSystem,
      defaultMethodType: consumable.defaultMethodType,
      itemTrackingType: consumable.itemTrackingType,
      unitOfMeasureCode: consumable.unitOfMeasureCode,
      active: true
    },
    typed: { customFields: consumable.customFields }
  });
  if (updated.error) return updated;
  const itemId = updated.data.id;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId,
    userId: consumable.updatedBy,
    storageUnitId: consumable.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId,
    userId: consumable.updatedBy,
    companyId: consumable.companyId,
    mode: consumable.shelfLifeMode,
    days: consumable.shelfLifeDays,
    triggerProcessId: consumable.shelfLifeTriggerProcessId,
    triggerTiming: consumable.shelfLifeTriggerTiming,
    calculateFromBom: consumable.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updated;
}

/**
 * Best-effort match of extracted text to an existing item. Tries every
 * candidate string (e.g. an extracted part number AND description — the
 * classification doesn't matter) against the item's `readableId` then `name`,
 * case-insensitively; when nothing matches exactly, retries word-boundary
 * prefixes of each candidate against `readableId`. Returns the first item id
 * found, or null.
 *
 * Callers that also have a customer/supplier part mapping should try that
 * first; this covers the readableId/name half of the match.
 */
export async function matchItemIdByText(
  client: SupabaseClient<Database>,
  companyId: string,
  candidates: Array<string | null | undefined>
): Promise<string | null> {
  const seen = new Set<string>();
  const dedupe = (raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value) return null;
    const key = value.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return value;
  };

  // 1. Exact match against readableId or name.
  for (const raw of candidates) {
    const value = dedupe(raw);
    if (!value) continue;

    const byReadableId = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("readableId", value)
      .limit(1);
    if (byReadableId.data?.[0]) return byReadableId.data[0].id;

    const byName = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("name", value)
      .limit(1);
    if (byName.data?.[0]) return byName.data[0].id;
  }

  // 2. Extracted part numbers often carry suffixes the item id doesn't (file
  // extensions, revision notes) — e.g. "LAT pole cut 1 - take 2.ai" for item
  // "LAT POLE CUT 1". Retry progressively shorter word-boundary prefixes,
  // longest first so the most specific item wins, against readableId only
  // (names are free text and too likely to collide with a description
  // fragment).
  const prefixes: string[] = [];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;

    const withoutExtension = dedupe(value.replace(/\.[a-z]{1,5}$/i, ""));
    if (withoutExtension) prefixes.push(withoutExtension);

    // Only phrase-like text also treats dashes as word boundaries
    // ("cut 2-take 2"); a compact part number ("ABC-100-02") stays whole so
    // we never map it to a shorter dashed sibling.
    const variants = [value];
    if (/\s/.test(value) && value.includes("-")) {
      variants.push(value.replace(/-/g, " - "));
    }

    const candidatePrefixes: string[] = [];
    for (const variant of variants) {
      const words = variant.split(/\s+/);
      for (let end = words.length - 1; end > 0; end--) {
        const prefix = dedupe(
          words
            .slice(0, end)
            .join(" ")
            .replace(/[\s\-–—_:;,.]+$/, "")
        );
        if (prefix && prefix.length >= 4) candidatePrefixes.push(prefix);
      }
    }
    candidatePrefixes.sort((a, b) => b.length - a.length);
    prefixes.push(...candidatePrefixes);
  }

  for (const value of prefixes) {
    const byReadableId = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .ilike("readableId", value)
      .limit(1);
    if (byReadableId.data?.[0]) return byReadableId.data[0].id;
  }

  return null;
}

/**
 * Resolve extracted document line text to an item id: first through the
 * party's part mapping (customerPartToItem / supplierPart), then by exact
 * readableId/name match. Returns null when nothing matches directly.
 */
export async function resolveItemIdFromExtractedText(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { type: "customer"; id: string | null | undefined }
    | { type: "supplier"; id: string | null | undefined },
  candidates: Array<string | null | undefined>
): Promise<string | null> {
  if (party.id) {
    for (const raw of candidates) {
      const candidate = raw?.trim();
      if (!candidate) continue;

      if (party.type === "customer") {
        const { data: mapping } = await client
          .from("customerPartToItem")
          .select("itemId")
          .eq("companyId", companyId)
          .eq("customerId", party.id)
          .eq("customerPartId", candidate)
          .maybeSingle();
        if (mapping) return mapping.itemId;
      } else {
        const { data: supplierPart } = await client
          .from("supplierPart")
          .select("itemId")
          .eq("companyId", companyId)
          .eq("supplierId", party.id)
          .ilike("supplierPartId", candidate)
          .limit(1);
        if (supplierPart?.[0]) return supplierPart[0].itemId;
      }
    }
  }

  return matchItemIdByText(client, companyId, candidates);
}

/**
 * Creates a part (item row and part row) or updates one; on update `id` is the
 * item id (uuid) or the part's readable id and the write is a full replace, so
 * omitted optional fields are cleared. `createPart` / `updatePart` are the
 * operations; create also queues the part's model optimisation.
 */
export async function upsertPart(
  client: SupabaseClient<Database>,
  part:
    | (z.infer<typeof partValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof partValidator> & {
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in part) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: part.id,
        revision: part.revision ?? "0",
        name: part.name,
        description: part.description,
        type: "Part",
        replenishmentSystem: part.replenishmentSystem,
        defaultMethodType: part.defaultMethodType,
        itemTrackingType: part.itemTrackingType,
        unitOfMeasureCode: part.unitOfMeasureCode,
        active: true,
        modelUploadId: part.modelUploadId,
        companyId: part.companyId,
        createdBy: part.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [partInsert, itemCostUpdate] = await Promise.all([
      client.from("part").upsert({
        id: part.id,
        companyId: part.companyId,
        createdBy: part.createdBy,
        customFields: part.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: part.postingGroupId,
            unitCost:
              part.replenishmentSystem !== "Make" ? part.unitCost : undefined
          })
        )
        .eq("itemId", itemId)
    ]);

    if (partInsert.error) return partInsert;
    if (itemCostUpdate.error) {
      logger.error("Failed to update item cost", {
        error: itemCostUpdate.error
      });
    }

    if (part.replenishmentSystem !== "Buy") {
      const itemReplenishmentInsert = await client
        .from("itemReplenishment")
        .update({ lotSize: part.lotSize })
        .eq("itemId", itemId);

      if (itemReplenishmentInsert.error) return itemReplenishmentInsert;
    }

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: part.createdBy,
        storageUnitId: part.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: part.createdBy,
        companyId: part.companyId,
        mode: part.shelfLifeMode,
        days: part.shelfLifeDays,
        triggerProcessId: part.shelfLifeTriggerProcessId,
        triggerTiming: part.shelfLifeTriggerTiming,
        calculateFromBom: part.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newPart = await client
      .from("parts")
      .select("id")
      .eq("readableId", part.id)
      .eq("companyId", part.companyId)
      .single();

    return newPart;
  }

  const updated = await updateTypedItem(client, {
    id: part.id,
    companyId: part.companyId,
    updatedBy: part.updatedBy,
    type: "Part",
    item: {
      name: part.name,
      description: part.description,
      replenishmentSystem: part.replenishmentSystem,
      defaultMethodType: part.defaultMethodType,
      itemTrackingType: part.itemTrackingType,
      unitOfMeasureCode: part.unitOfMeasureCode,
      active: true
    },
    typed: { customFields: part.customFields }
  });
  if (updated.error) return updated;
  const itemId = updated.data.id;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId,
    userId: part.updatedBy,
    storageUnitId: part.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId,
    userId: part.updatedBy,
    companyId: part.companyId,
    mode: part.shelfLifeMode,
    days: part.shelfLifeDays,
    triggerProcessId: part.shelfLifeTriggerProcessId,
    triggerTiming: part.shelfLifeTriggerTiming,
    calculateFromBom: part.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updated;
}

export async function updateItem(
  client: SupabaseClient<Database>,
  item: z.infer<typeof itemValidator> & {
    companyId: string;
    type: Database["public"]["Enums"]["itemType"];
  }
) {
  // These are stored elsewhere (pickMethod, itemCost, itemShelfLife), not on
  // the item row.
  const {
    defaultStorageUnitId: _defaultStorageUnitId,
    postingGroupId: _postingGroupId,
    unitCost: _unitCost,
    shelfLifeMode: _shelfLifeMode,
    shelfLifeDays: _shelfLifeDays,
    shelfLifeTriggerProcessId: _shelfLifeTriggerProcessId,
    shelfLifeTriggerTiming: _shelfLifeTriggerTiming,
    shelfLifeCalculateFromBom: _shelfLifeCalculateFromBom,
    ...row
  } = item;
  return client
    .from("item")
    .update(sanitize(row))
    .eq("id", item.id)
    .eq("companyId", item.companyId);
}

export async function upsertItemCost(
  client: SupabaseClient<Database>,
  itemCost: z.infer<typeof itemCostValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemCost")
    .update(sanitize(itemCost))
    .eq("itemId", itemCost.itemId);
}

export async function upsertPickMethod(
  client: SupabaseClient<Database>,
  pickMethod:
    | (z.infer<typeof pickMethodValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof pickMethodValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in pickMethod) {
    return client.from("pickMethod").upsert(pickMethod, {
      onConflict: "itemId,locationId"
    });
  }

  return client
    .from("pickMethod")
    .update(sanitize(pickMethod))
    .eq("itemId", pickMethod.itemId)
    .eq("locationId", pickMethod.locationId);
}

/** The row write only; `updateItemManufacturing` also re-plans the item. */
export async function upsertItemManufacturing(
  client: SupabaseClient<Database>,
  partManufacturing: z.infer<typeof itemManufacturingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemReplenishment")
    .update(sanitize(partManufacturing))
    .eq("itemId", partManufacturing.itemId);
}

/** The row write only; `updateItemPlanning` also checks the responsible employee and re-plans. */
export async function upsertItemPlanning(
  client: SupabaseClient<Database>,
  partPlanning:
    | {
        companyId: string;
        itemId: string;
        locationId: string;
        createdBy: string;
      }
    | (z.infer<typeof itemPlanningValidator> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in partPlanning) {
    return client.from("itemPlanning").insert(partPlanning);
  }
  return client
    .from("itemPlanning")
    .update(sanitize(partPlanning))
    .eq("itemId", partPlanning.itemId)
    .eq("locationId", partPlanning.locationId);
}

export async function upsertItemPurchasing(
  client: SupabaseClient<Database>,
  itemPurchasing: z.infer<typeof itemPurchasingValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  const { companyId, ...update } = itemPurchasing;

  // `purchasingUnitOfMeasureCode` and `conversionFactor` are a property of the
  // preferred supplier's supplierPart, not free-form input — the form submits
  // them only as (client-derived) hidden fields. Re-derive them server-side so
  // a forged submission can't persist a conversion factor that disagrees with
  // the supplier part (which drives PO quantities and costs). The
  // ("itemId","supplierId","companyId") unique constraint makes the lookup
  // single; `.single()` rejects a preferred supplier with no matching part.
  if (update.preferredSupplierId) {
    const supplierPart = await client
      .from("supplierPart")
      .select("supplierUnitOfMeasureCode, conversionFactor")
      .eq("companyId", companyId)
      .eq("itemId", update.itemId)
      .eq("supplierId", update.preferredSupplierId)
      .single();
    if (supplierPart.error) return supplierPart;
    update.purchasingUnitOfMeasureCode =
      supplierPart.data.supplierUnitOfMeasureCode ?? undefined;
    update.conversionFactor = supplierPart.data.conversionFactor ?? 1;
  } else {
    // No preferred supplier → identity conversion, no purchasing UoM override.
    update.purchasingUnitOfMeasureCode = undefined;
    update.conversionFactor = 1;
  }

  return client
    .from("itemReplenishment")
    .update(sanitize(update))
    .eq("itemId", update.itemId);
}

export const SUPERSESSION_CYCLE_CODE = "SUPERSESSION_CYCLE";

const SUPERSESSION_CHAIN_LIMIT = 10;

async function findSupersessionCycle(
  client: SupabaseClient<Database>,
  itemId: string,
  successorItemId: string,
  companyId: string
): Promise<
  | { kind: "ok" }
  | { kind: "cycle"; path: string[] }
  | { kind: "tooLong" }
  | { kind: "error"; error: PostgrestError }
> {
  const path = [itemId, successorItemId];
  const visited = new Set(path);
  let currentId = successorItemId;
  let closed = false;
  for (let hop = 0; hop < SUPERSESSION_CHAIN_LIMIT; hop++) {
    const link = await client
      .from("itemSupersession")
      .select("successorItemId")
      .eq("itemId", currentId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (link.error) return { kind: "error", error: link.error };
    const next = link.data?.successorItemId;
    if (!next) return { kind: "ok" };
    path.push(next);
    if (visited.has(next)) {
      closed = true;
      break;
    }
    visited.add(next);
    currentId = next;
  }
  if (!closed) return { kind: "tooLong" };

  const items = await client
    .from("item")
    .select("id, readableIdWithRevision")
    .in("id", Array.from(new Set(path)))
    .eq("companyId", companyId);
  if (items.error) return { kind: "error", error: items.error };
  const readable = new Map(
    (items.data ?? []).map((i) => [i.id, i.readableIdWithRevision ?? i.id])
  );
  return { kind: "cycle", path: path.map((id) => readable.get(id) ?? id) };
}

/** The building block of `setItemSupersession` and `addItemPredecessor`. */
export async function upsertItemSupersession(
  client: SupabaseClient<Database>,
  itemSupersession: z.infer<typeof itemSupersessionValidator> & {
    companyId: string;
    createdBy: string;
    updatedBy: string;
  }
) {
  const {
    itemId,
    companyId,
    createdBy,
    updatedBy,
    supersessionMode,
    successorItemId,
    discontinuationDate,
    successorEffectivityDate,
    conversionFactor,
    locationId,
    minimumReserveQuantity
  } = itemSupersession;

  // The minimum service-stock floor is per-location, so it lives on
  // itemPlanning rather than the global supersession record.
  if (locationId && minimumReserveQuantity !== undefined) {
    const reserveUpdate = await client
      .from("itemPlanning")
      .update({ minimumReserveQuantity, updatedBy })
      .eq("itemId", itemId)
      .eq("locationId", locationId)
      .eq("companyId", companyId);
    if (reserveUpdate.error) return reserveUpdate;
  }

  // No mode selected = no supersession; clear any existing config.
  if (!supersessionMode) {
    return client
      .from("itemSupersession")
      .delete()
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  const isNoStock = supersessionMode === "No Stock";

  if (!isNoStock && successorItemId) {
    const check = await findSupersessionCycle(
      client,
      itemId,
      successorItemId,
      companyId
    );
    if (check.kind === "error") return { data: null, error: check.error };
    if (check.kind === "tooLong") {
      return {
        data: null,
        error: {
          code: SUPERSESSION_CYCLE_CODE,
          message: `Supersession chains longer than ${SUPERSESSION_CHAIN_LIMIT} hops are not allowed`
        }
      };
    }
    if (check.kind === "cycle") {
      return {
        data: null,
        error: {
          code: SUPERSESSION_CYCLE_CODE,
          message: `This would create a supersession loop: ${check.path.join(" → ")}`
        }
      };
    }
  }

  const row = {
    supersessionMode,
    // No Stock has no successor (nothing takes over the demand).
    successorItemId: isNoStock ? null : (successorItemId ?? null),
    discontinuationDate: discontinuationDate ?? null,
    successorEffectivityDate: isNoStock
      ? null
      : (successorEffectivityDate ?? null),
    conversionFactor: isNoStock ? 1 : (conversionFactor ?? 1)
  };

  const existing = await client
    .from("itemSupersession")
    .select("itemId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (existing.data) {
    return client
      .from("itemSupersession")
      .update({ ...row, updatedBy, updatedAt: datetime.timestamp() })
      .eq("itemId", itemId)
      .eq("companyId", companyId);
  }

  return client
    .from("itemSupersession")
    .insert({ ...row, itemId, companyId, createdBy });
}

export async function upsertItemPostingGroup(
  client: SupabaseClient<Database>,
  itemPostingGroup:
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof itemPostingGroupValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in itemPostingGroup) {
    return client
      .from("itemPostingGroup")
      .insert([itemPostingGroup])
      .select("*")
      .single();
  }
  return client
    .from("itemPostingGroup")
    .update(sanitize(itemPostingGroup))
    .eq("id", itemPostingGroup.id)
    .select("id")
    .single();
}

/** The row write only; `createSupplierPart` / `updateSupplierPart` also save the price breaks. */
export async function upsertSupplierPart(
  client: SupabaseClient<Database>,
  supplierPart:
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierPartValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierPart) {
    return client
      .from("supplierPart")
      .insert([supplierPart])
      .select("id")
      .single();
  }
  return client
    .from("supplierPart")
    .update(sanitize(supplierPart))
    .eq("id", supplierPart.id)
    .eq("companyId", supplierPart.companyId)
    .select("id")
    .single();
}

export async function upsertItemCustomerPart(
  client: SupabaseClient<Database>,
  customerPart:
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof customerPartValidator>, "id"> & {
        id: string;
      })
) {
  if ("id" in customerPart) {
    return client
      .from("customerPartToItem")
      .update(sanitize(customerPart))
      .eq("id", customerPart.id)
      .select("id")
      .single();
  }
  return client
    .from("customerPartToItem")
    .insert([customerPart])
    .select("id")
    .single();
}

export async function upsertItemUnitSalePrice(
  client: SupabaseClient<Database>,
  itemUnitSalePrice: z.infer<typeof itemUnitSalePriceValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("itemUnitSalePrice")
    .update(sanitize(itemUnitSalePrice))
    .eq("itemId", itemUnitSalePrice.itemId);
}

/**
 * A new Draft version of a make method with `copyFromId`'s header, bill of
 * materials and bill of process. With `activate`, a Draft source is set Active
 * first, so the new Draft never outranks it. The insert, the activation and the
 * copy run in one transaction, or in the one `db` already is: a failed copy
 * leaves no empty version and no source set Active. Kysely bypasses RLS, so the
 * caller's client is checked for what the makeMethod policies ask; the copy then
 * runs as the system, since the method line policies ask for no more than
 * parts_create, while get-method's own gate asks for production update.
 */
export async function createMakeMethodVersion(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    copyFromId: string;
    version: number;
    /** Set a Draft source Active. An Active or Archived source is left alone. */
    activate?: boolean;
    /** The change notice the new Draft belongs to; else the source's. */
    changeOrderId?: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | {
      data: {
        id: string;
        itemId: string;
        type: Database["public"]["Tables"]["item"]["Row"]["type"];
      };
      error: null;
    }
  | { data: null; error: ServiceError | ServerFnError }
> {
  const { copyFromId, version, companyId, createdBy } = args;

  const source = await client
    .from("makeMethod")
    .select("itemId, status, customFields, tags, changeOrderId, ...item(type)")
    .eq("id", copyFromId)
    .eq("companyId", companyId)
    .single();
  if (source.error) return { data: null, error: source.error };

  // The makeMethod policies ask for parts_create to insert and parts_update to
  // set a version Active.
  const activate = args.activate === true && source.data.status === "Draft";
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_create"
  );
  if (permitted.error) return { data: null, error: permitted.error };
  if (activate) {
    const canActivate = await requireCompanyPermission(
      client,
      companyId,
      "parts_update"
    );
    if (canActivate.error) return { data: null, error: canActivate.error };
  }

  try {
    const draftId = await withTransaction(db, async (trx) => {
      const draft = await trx
        .insertInto("makeMethod")
        .values({
          itemId: source.data.itemId,
          customFields: toJson(source.data.customFields),
          tags: source.data.tags,
          changeOrderId: args.changeOrderId ?? source.data.changeOrderId,
          status: "Draft",
          version,
          companyId,
          createdBy
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      if (activate) {
        // A source set Active meanwhile, or archived behind a newer Active, is
        // not outranked by the new Draft either: nothing to refuse.
        await trx
          .updateTable("makeMethod")
          .set({ status: "Active" })
          .where("id", "=", copyFromId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .execute();
      }

      const copy = await copyMakeMethod(getCarbonServiceRole(), trx, {
        sourceId: copyFromId,
        targetId: draft.id,
        billOfMaterial: true,
        billOfProcess: true,
        parameters: true,
        tools: true,
        steps: true,
        workInstructions: true,
        companyId,
        userId: createdBy
      });
      if (copy.error) throw copy.error;

      return draft.id;
    });

    return {
      data: { id: draftId, itemId: source.data.itemId, type: source.data.type },
      error: null
    };
  } catch (error) {
    // The copy's refusal, with the status its category is read from.
    if (error instanceof ServerFnError) return { data: null, error };
    // A taken version number is the caller's to retry.
    if (!isUniqueViolation(error)) {
      logger.error("Failed to create make method version", {
        companyId,
        copyFromId,
        version,
        error
      });
    }
    return { data: null, error: writeError(error) };
  }
}

/**
 * On BoM material add, seed `methodMaterial.storageUnitIds` with every
 * (locationId -> defaultStorageUnitId) pair configured for the child item
 * in "pickMethod". Values set by the caller win so downstream BoMs
 * constructed with explicit picks are untouched.
 *
 * The JSONB is modelled as Record<locationId, storageUnitId>. Reading all
 * pickMethods (rather than a single "default") matches Carbon's model
 * where an item can be stocked across multiple locations, each with its
 * own preferred bin.
 */
/**
 * Coerce whatever a caller supplied for `storageUnitIds` into the
 * location → storageUnitId map the column stores. The web form pre-parses its
 * JSON string through `methodMaterialValidator`, but the MCP/API dispatch path
 * bypasses that validator and hands the service the raw value, so normalize
 * defensively here too: an object map is kept (string values only), a JSON
 * string is parsed, and null/undefined/anything-else collapses to `{}`. A bare
 * string used to be spread character-by-character into the JSONB column
 * (`"false"` → `{"0":"f","1":"a",…}`) — this is where that is stopped.
 */
function normalizeStorageUnitIds(value: unknown): Record<string, string> {
  const fromObject = (obj: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (typeof v === "string") out[key] = v;
    }
    return out;
  };

  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? fromObject(parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return fromObject(value as Record<string, unknown>);
  }
  return {};
}

async function resolveMethodMaterialStorageUnitIds(
  client: SupabaseClient<Database>,
  args: {
    itemId?: string | null;
    current?: Record<string, string>;
  }
): Promise<Record<string, string>> {
  const current = { ...(args.current ?? {}) };
  if (!args.itemId) return current;

  const pickMethods = await client
    .from("pickMethod")
    .select("locationId, defaultStorageUnitId")
    .eq("itemId", args.itemId);

  for (const row of pickMethods.data ?? []) {
    if (
      row.locationId &&
      row.defaultStorageUnitId &&
      !current[row.locationId]
    ) {
      current[row.locationId] = row.defaultStorageUnitId;
    }
  }

  return current;
}

export async function upsertMethodMaterial(
  client: SupabaseClient<Database>,

  methodMaterial:
    | (z.infer<typeof methodMaterialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodMaterialValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // The MCP/API path skips methodMaterialValidator, and the insert spreads the
  // id over the column default — so a blank id was stored as "" and the next
  // blank create collided with it.
  if (!methodMaterial.id?.trim()) {
    return {
      data: null,
      error: { message: "Material ID is required" }
    };
  }

  // sourcingType and methodType are item-level properties (edited in the
  // item's Properties sidebar). A methodMaterial is a read-only mirror of its
  // component item, so derive both from the item rather than trusting the
  // submitted form values.
  if (methodMaterial.itemId) {
    const item = await client
      .from("item")
      .select("defaultMethodType, sourcingType")
      .eq("id", methodMaterial.itemId)
      .single();

    if (item.error) return item;
    methodMaterial.methodType =
      item.data.defaultMethodType ?? methodMaterial.methodType;
    methodMaterial.sourcingType = item.data.sourcingType;
  }

  let materialMakeMethodId: string | null = null;
  if (methodMaterial.methodType === "Make to Order") {
    const makeMethod = await client
      .from("activeMakeMethods")
      .select("id, version")
      .eq("itemId", methodMaterial.itemId!)
      .single();

    if (makeMethod.error) return makeMethod;
    materialMakeMethodId = makeMethod.data?.id;
  }

  if ("createdBy" in methodMaterial) {
    // On create, an omitted / null storageUnitIds normalizes to `{}`, then the
    // child item's default location/storage-unit picks seed any locations the
    // caller didn't specify. Respects supplied values; adds sensible defaults.
    const seededStorageUnitIds = await resolveMethodMaterialStorageUnitIds(
      client,
      {
        itemId: methodMaterial.itemId,
        current: normalizeStorageUnitIds(methodMaterial.storageUnitIds)
      }
    );
    return client
      .from("methodMaterial")
      .insert([
        {
          ...methodMaterial,
          itemId: methodMaterial.itemId!,
          storageUnitIds: seededStorageUnitIds,
          materialMakeMethodId
        }
      ])
      .select("id")
      .single();
  }
  // On update, an OMITTED storageUnitIds preserves the stored value (drop the key
  // so `sanitize` can't null it), while an explicit null / {} / map is written —
  // null and {} both clear it. The web form always submits the field, so its
  // behavior is unchanged; only the MCP/API caller can omit it.
  if (methodMaterial.storageUnitIds === undefined) {
    const { storageUnitIds: _omitted, ...preserved } = methodMaterial;
    return client
      .from("methodMaterial")
      .update(sanitize({ ...preserved, materialMakeMethodId }))
      .eq("id", methodMaterial.id)
      .select("id")
      .single();
  }
  return client
    .from("methodMaterial")
    .update(
      sanitize({
        ...methodMaterial,
        materialMakeMethodId,
        storageUnitIds: normalizeStorageUnitIds(methodMaterial.storageUnitIds)
      })
    )
    .eq("id", methodMaterial.id)
    .select("id")
    .single();
}

export async function upsertMethodOperation(
  client: SupabaseClient<Database>,

  methodOperation:
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof methodOperationValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof methodOperationValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in methodOperation) {
    return client
      .from("methodOperation")
      .insert([normalizeOperationSourceIds(methodOperation)])
      .select("id")
      .single();
  }
  return client
    .from("methodOperation")
    .update(sanitize(normalizeOperationSourceIds(methodOperation)))
    .eq("id", methodOperation.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationStep(
  client: SupabaseClient<Database>,
  methodOperationStep:
    | (Omit<z.infer<typeof operationStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepValidator>,
        "id" | "minValue" | "maxValue"
      > & {
        id: string;
        minValue: number | null;
        maxValue: number | null;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationStep) {
    return client
      .from("methodOperationStep")
      .insert(methodOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationStep")
    .update(sanitize(methodOperationStep))
    .eq("id", methodOperationStep.id)
    .select("id")
    .single();
}

// Clone a step within the same operation: a "(copy)" appended after all siblings,
// carrying its reference slides (image + caption + size + annotations, incl. tool
// hotspots). Sequential supabase writes — a step is created first, then its slides,
// so a slide-copy failure surfaces without a half-written step blocking the editor.
export async function duplicateMethodOperationStep(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; createdBy: string }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const source = await client
    .from("methodOperationStep")
    .select("*")
    .eq("id", args.id)
    .single();
  if (source.error || !source.data) {
    return { data: null, error: source.error };
  }
  const src = source.data;

  // Append after the highest sortOrder in the operation.
  const siblings = await client
    .from("methodOperationStep")
    .select("sortOrder")
    .eq("operationId", src.operationId);
  const nextSortOrder =
    (siblings.data ?? []).reduce(
      (max, s) => Math.max(max, s.sortOrder ?? 0),
      0
    ) + 1;

  const insert = await client
    .from("methodOperationStep")
    .insert({
      operationId: src.operationId,
      name: `${src.name} (copy)`,
      description: src.description,
      type: src.type,
      unitOfMeasureCode: src.unitOfMeasureCode,
      minValue: src.minValue,
      maxValue: src.maxValue,
      listValues: src.listValues,
      sortOrder: nextSortOrder,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    return { data: null, error: insert.error };
  }
  const newStepId = insert.data.id;

  // select("*") (not an explicit column list) so `size`/`annotations` — added by the
  // step-slide migration — resolve once types are regenerated, without a bad column in
  // the select string poisoning the whole row type before then.
  const slides = await client
    .from("methodOperationStepSlide")
    .select("*")
    .eq("stepId", args.id);
  if (slides.error) {
    return { data: null, error: slides.error };
  }
  if (slides.data && slides.data.length > 0) {
    const slideRows = slides.data.map((s) => ({
      stepId: newStepId,
      imagePath: s.imagePath,
      modelUploadId: s.modelUploadId,
      caption: s.caption,
      sortOrder: s.sortOrder,
      size: s.size,
      annotations: s.annotations,
      companyId: args.companyId,
      createdBy: args.createdBy
    }));
    const slideInsert = await client
      .from("methodOperationStepSlide")
      .insert(slideRows);
    if (slideInsert.error) {
      return { data: null, error: slideInsert.error };
    }
  }

  // Copy step-scoped tool links. A tool with NO join rows is operation-level (shown on
  // every step) and needs nothing copied; only tools scoped to this specific step carry
  // a row here, and those must be repointed at the clone or the copy silently loses them.
  const toolLinks = await client
    .from("methodOperationToolStep")
    .select("methodOperationToolId")
    .eq("methodOperationStepId", args.id);
  if (toolLinks.error) {
    return { data: null, error: toolLinks.error };
  }
  if (toolLinks.data && toolLinks.data.length > 0) {
    const toolLinkInsert = await client.from("methodOperationToolStep").insert(
      toolLinks.data.map((l) => ({
        methodOperationToolId: l.methodOperationToolId,
        methodOperationStepId: newStepId
      }))
    );
    if (toolLinkInsert.error) {
      return { data: null, error: toolLinkInsert.error };
    }
  }

  // Copy step-scoped part/material links (same operation-level-vs-scoped semantics as tools).
  // Pre-migration schema: no quantity column — copy the bare links instead.
  let materialLinks = await client
    .from("methodMaterialStep")
    .select("methodMaterialId, quantity")
    .eq("methodOperationStepId", args.id);
  if (isMissingQuantityColumn(materialLinks.error)) {
    materialLinks = (await client
      .from("methodMaterialStep")
      .select("methodMaterialId")
      .eq("methodOperationStepId", args.id)) as unknown as typeof materialLinks;
  }
  if (materialLinks.error) {
    return { data: null, error: materialLinks.error };
  }
  if (materialLinks.data && materialLinks.data.length > 0) {
    const materialLinkInsert = await client.from("methodMaterialStep").insert(
      materialLinks.data.map((l) => ({
        methodMaterialId: l.methodMaterialId,
        methodOperationStepId: newStepId,
        ...(l.quantity != null ? { quantity: l.quantity } : {})
      }))
    );
    if (materialLinkInsert.error) {
      return { data: null, error: materialLinkInsert.error };
    }
  }

  return { data: { id: newStepId }, error: null };
}

export async function upsertMethodOperationStepSlide(
  client: SupabaseClient<Database>,
  slide:
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in slide) {
    return client
      .from("methodOperationStepSlide")
      .insert(slide)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationStepSlide")
    .update(sanitize(slide))
    .eq("id", slide.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationParameter(
  client: SupabaseClient<Database>,
  methodOperationParameter:
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationParameter) {
    return client
      .from("methodOperationParameter")
      .insert(methodOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationParameter")
    .update(sanitize(methodOperationParameter))
    .eq("id", methodOperationParameter.id)
    .select("id")
    .single();
}

export async function upsertMethodOperationTool(
  client: SupabaseClient<Database>,
  methodOperationTool:
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in methodOperationTool) {
    return client
      .from("methodOperationTool")
      .insert(methodOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("methodOperationTool")
    .update(sanitize(methodOperationTool))
    .eq("id", methodOperationTool.id)
    .select("id")
    .single();
}

// Toggle a single part↔step link from the STEP side (the step editor's Parts picker).
// `linked` true = link the material to the step, false = unlink. Idempotent on link.
// `quantity` is the per-step share of the BOM line (NULL = the full line quantity);
// re-linking an existing link updates the quantity, so the same call edits a split.
export async function setMethodMaterialStepLink(
  client: SupabaseClient<Database>,
  args: {
    methodMaterialId: string;
    methodOperationStepId: string;
    linked: boolean;
    quantity?: number | null;
  }
) {
  if (args.linked) {
    return client.from("methodMaterialStep").upsert(
      [
        {
          methodMaterialId: args.methodMaterialId,
          methodOperationStepId: args.methodOperationStepId,
          // Omit the column when unset so the default link path still works
          // against a pre-migration schema (see isMissingQuantityColumn).
          ...(args.quantity != null ? { quantity: args.quantity } : {})
        }
      ],
      {
        onConflict: "methodMaterialId,methodOperationStepId"
      }
    );
  }
  return client
    .from("methodMaterialStep")
    .delete()
    .eq("methodMaterialId", args.methodMaterialId)
    .eq("methodOperationStepId", args.methodOperationStepId);
}

// Toggle a single tool↔step link from the STEP side (the step editor's Tools picker).
// Takes the tool ITEM id: the picker offers the whole tool library, and choosing a
// tool implicitly ensures the operation-level tool row exists (quantity 1 — the same
// row the operation's Tools tab would create) before linking it to the step. Unlink
// removes only the step link; the operation tool row stays (the Tools tab owns it).
// Twin of setMethodMaterialStepLink.
export async function setMethodOperationToolStepLink(
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    toolId: string;
    methodOperationStepId: string;
    linked: boolean;
    companyId: string;
    createdBy: string;
  }
) {
  const existingTool = await client
    .from("methodOperationTool")
    .select("id")
    .eq("operationId", args.operationId)
    .eq("toolId", args.toolId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingTool.error) return existingTool;
  let methodOperationToolId = existingTool.data?.id;

  if (args.linked) {
    if (!methodOperationToolId) {
      const created = await client
        .from("methodOperationTool")
        .insert({
          operationId: args.operationId,
          toolId: args.toolId,
          quantity: 1,
          companyId: args.companyId,
          createdBy: args.createdBy
        })
        .select("id")
        .single();
      if (created.error) return created;
      methodOperationToolId = created.data.id;
    }
    return client.from("methodOperationToolStep").upsert(
      [
        {
          methodOperationToolId,
          methodOperationStepId: args.methodOperationStepId
        }
      ],
      {
        onConflict: "methodOperationToolId,methodOperationStepId",
        ignoreDuplicates: true
      }
    );
  }
  if (!methodOperationToolId) return { data: null, error: null };
  return client
    .from("methodOperationToolStep")
    .delete()
    .eq("methodOperationToolId", methodOperationToolId)
    .eq("methodOperationStepId", args.methodOperationStepId);
}

type MaterialPropertyPlan = {
  next: MaterialPropertyValues;
  changed: Partial<MaterialPropertyValues>;
  generated: { readableId: string; name: string } | null;
};

async function materialIdsAreGenerated(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<
  { data: boolean; error: null } | { data: null; error: ServiceError }
> {
  const settings = await client
    .from("companySettings")
    .select("materialGeneratedIds")
    .eq("id", companyId)
    .single();
  if (settings.error) return { data: null, error: settings.error };
  return { data: settings.data.materialGeneratedIds === true, error: null };
}

async function getMaterialPropertyValues(
  client: SupabaseClient<Database>,
  readableId: string,
  companyId: string
): Promise<
  | { data: MaterialPropertyValues; error: null }
  | { data: null; error: ServiceError }
> {
  const material = await client
    .from("material")
    .select(
      "materialSubstanceId, materialFormId, materialTypeId, finishId, gradeId, dimensionId"
    )
    .eq("id", readableId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (material.error) return { data: null, error: material.error };
  if (!material.data) {
    return { data: null, error: ruleError(`Material ${readableId} not found`) };
  }
  return { data: material.data, error: null };
}

async function getMaterialPropertyLookups(
  client: SupabaseClient<Database>,
  companyId: string,
  values: MaterialPropertyValues
): Promise<
  | { data: MaterialPropertyLookups; error: null }
  | { data: null; error: ServiceError }
> {
  const visible = `companyId.eq.${companyId},companyId.is.null`;
  const none = { data: null, error: null };
  const [substance, form, type, finish, grade, dimension] = await Promise.all([
    values.materialSubstanceId
      ? client
          .from("materialSubstance")
          .select("name, code")
          .eq("id", values.materialSubstanceId)
          .or(visible)
          .maybeSingle()
      : none,
    values.materialFormId
      ? client
          .from("materialForm")
          .select("name, code")
          .eq("id", values.materialFormId)
          .or(visible)
          .maybeSingle()
      : none,
    values.materialTypeId
      ? client
          .from("materialType")
          .select("name, code, materialSubstanceId, materialFormId")
          .eq("id", values.materialTypeId)
          .or(visible)
          .maybeSingle()
      : none,
    values.finishId
      ? client
          .from("materialFinish")
          .select("name, materialSubstanceId")
          .eq("id", values.finishId)
          .or(visible)
          .maybeSingle()
      : none,
    values.gradeId
      ? client
          .from("materialGrade")
          .select("name, materialSubstanceId")
          .eq("id", values.gradeId)
          .or(visible)
          .maybeSingle()
      : none,
    values.dimensionId
      ? client
          .from("materialDimension")
          .select("name, materialFormId")
          .eq("id", values.dimensionId)
          .or(visible)
          .maybeSingle()
      : none
  ]);

  const error = [substance, form, type, finish, grade, dimension].find(
    (result) => result.error
  )?.error;
  if (error) return { data: null, error };

  return {
    data: {
      substance: substance.data,
      form: form.data,
      type: type.data,
      finish: finish.data,
      grade: grade.data,
      dimension: dimension.data
    },
    error: null
  };
}

async function planMaterialPropertyChanges(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    current: MaterialPropertyValues;
    changes: Partial<MaterialPropertyValues>;
    generatedIds: boolean;
  }
): Promise<
  | { data: MaterialPropertyPlan; error: null }
  | { data: null; error: ServiceError }
> {
  const { next, changed } = resolveMaterialProperties(
    args.current,
    args.changes
  );
  if (Object.keys(changed).length === 0) {
    return { data: { next, changed, generated: null }, error: null };
  }
  if (args.generatedIds && clearsSubstanceOrShape(args.current, next)) {
    return { data: null, error: ruleError(generatedIdsNeedSubstanceAndShape) };
  }

  const lookups = await getMaterialPropertyLookups(
    client,
    args.companyId,
    next
  );
  if (lookups.error) return { data: null, error: lookups.error };

  const invalid = checkMaterialProperties(args.current, next, lookups.data);
  if (invalid) return { data: null, error: ruleError(invalid) };

  return {
    data: {
      next,
      changed,
      generated: args.generatedIds
        ? generateMaterialIdentity(next, lookups.data)
        : null
    },
    error: null
  };
}

async function materialIdIsTaken(
  client: SupabaseClient<Database>,
  readableId: string,
  companyId: string
): Promise<
  { data: boolean; error: null } | { data: null; error: ServiceError }
> {
  const taken = await client
    .from("item")
    .select("id")
    .eq("readableId", readableId)
    .eq("companyId", companyId)
    .eq("type", "Material")
    .limit(1);
  if (taken.error) return { data: null, error: taken.error };
  return { data: taken.data.length > 0, error: null };
}

// Kysely bypasses RLS, so the caller's client must be able to update the
// material row first. Its policy (parts_update) also covers item and itemCost.
async function requireMaterialUpdatable(
  client: SupabaseClient<Database>,
  args: { readableId: string; companyId: string; updatedBy: string }
): Promise<{ error: ServiceError | null }> {
  const probe = await client
    .from("material")
    .update({ updatedBy: args.updatedBy, updatedAt: datetime.timestamp() })
    .eq("id", args.readableId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
  return { error: probe.error };
}

class MaterialRuleViolation extends Error {}

// A thrown Kysely/Postgres error in the { message, code } shape services
// return. The code is the SQLSTATE (23505 for a taken revision label).
function writeError(error: unknown): ServiceError {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return code ? { code, message } : { message };
}

function materialWriteError(error: unknown): ServiceError {
  if (error instanceof MaterialRuleViolation) return ruleError(error.message);
  return writeError(error);
}

async function writeMaterialIdentity(
  trx: KyselyTx,
  args: {
    readableId: string;
    newReadableId?: string;
    name?: string;
    companyId: string;
    updatedBy: string;
    changes: Partial<MaterialPropertyValues>;
  }
): Promise<string> {
  const { readableId, companyId, updatedBy, changes } = args;
  const newReadableId = args.newReadableId ?? readableId;
  const renamed = newReadableId !== readableId;
  if (!newReadableId) {
    throw new MaterialRuleViolation("Material ID cannot be empty");
  }
  if (!renamed && args.name === undefined && !Object.keys(changes).length) {
    return readableId;
  }

  const updatedAt = datetime.timestamp();
  if (renamed) {
    const taken = await trx
      .selectFrom("item")
      .select("id")
      .where("readableId", "=", newReadableId)
      .where("companyId", "=", companyId)
      .where("type", "=", "Material")
      .executeTakeFirst();
    if (taken) {
      throw new MaterialRuleViolation(
        `Material ${newReadableId} already exists`
      );
    }
  }

  const material = await trx
    .updateTable("material")
    .set({ ...changes, id: newReadableId, updatedBy, updatedAt })
    .where("id", "=", readableId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (Number(material.numUpdatedRows) !== 1) {
    throw new MaterialRuleViolation(`Material ${readableId} not found`);
  }

  if (renamed || args.name !== undefined) {
    await trx
      .updateTable("item")
      .set({
        readableId: newReadableId,
        ...(args.name !== undefined ? { name: args.name } : {}),
        updatedBy,
        updatedAt
      })
      .where("readableId", "=", readableId)
      .where("companyId", "=", companyId)
      .where("type", "=", "Material")
      .execute();
  }
  return newReadableId;
}

/** Refused while the material is open in a change notice, as New Revision is. */
async function getNewMaterialSizes(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    readableId: string;
    companyId: string;
    sizes: string[];
  }
): Promise<
  { data: string[]; error: null } | { data: null; error: ServiceError }
> {
  const existing = await client
    .from("item")
    .select("revision")
    .eq("readableId", args.readableId)
    .eq("companyId", args.companyId)
    .eq("type", "Material");
  if (existing.error) return { data: null, error: existing.error };

  const revisions = new Set(existing.data.map((item) => item.revision));
  const sizes = [...new Set(args.sizes)].filter(
    (size) => size && !revisions.has(size)
  );
  if (sizes.length === 0) return { data: [], error: null };

  const open = await findChangeNoticesForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeNoticeOpenStatuses
  });
  if (open.error) {
    return {
      data: null,
      error: { message: "Could not check open change notices for this item" }
    };
  }
  if (open.data.length > 0) {
    const ids = open.data.map((co) => co.changeOrderId).join(", ");
    return {
      data: null,
      error: ruleError(
        `This item is open in change notice ${ids}. Release it to create new revisions.`
      )
    };
  }
  return { data: sizes, error: null };
}

/**
 * Creates a material or updates one by item id or readable id; an update keeps
 * any optional field it leaves out, and `sizes` adds a revision per new size.
 * Property changes follow updateMaterialProperties: dependents reset, picks
 * are checked against their substance and shape, and with generated material
 * IDs on the readable id and name are derived from the properties (any `id`
 * or `name` sent for them is ignored). `readableId` renames a material when
 * IDs are typed by hand. An update's material, item and item cost writes land
 * together or not at all; the pick method, shelf life and new sizes are
 * written after them.
 */
export async function upsertMaterial(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  material:
    | (z.infer<typeof materialValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
        sizes?: string[];
      })
    | (z.infer<typeof materialValidator> & {
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const generatedIds = await materialIdsAreGenerated(
    client,
    material.companyId
  );
  if (generatedIds.error) return generatedIds;

  if ("createdBy" in material) {
    const plan = await planMaterialPropertyChanges(client, {
      companyId: material.companyId,
      current: noMaterialProperties,
      changes: sentMaterialProperties(material),
      generatedIds: generatedIds.data
    });
    if (plan.error) return plan;
    if (generatedIds.data && !plan.data.generated) {
      return {
        data: null,
        error: ruleError(generatedIdsNeedSubstanceAndShape)
      };
    }
    const readableId = plan.data.generated?.readableId ?? material.id;
    const name = plan.data.generated?.name ?? material.name;

    // An existing id would take the new item rows as extra revisions and
    // overwrite its material row; sizes on an update add revisions instead.
    const taken = await materialIdIsTaken(
      client,
      readableId,
      material.companyId
    );
    if (taken.error) return taken;
    if (taken.data) {
      return {
        data: null,
        error: ruleError(`Material ${readableId} already exists`)
      };
    }

    // Collect every newly-created item id across the sizes / no-sizes
    // branches so the shelf-life policy can be applied uniformly.
    const newItemIds: string[] = [];

    if (material.sizes) {
      const itemInserts = await Promise.all(
        material.sizes.map((size) =>
          client
            .from("item")
            .insert({
              readableId,
              name,
              description: material.description,
              mpn: material.mpn,
              type: "Material",
              replenishmentSystem: material.replenishmentSystem,
              defaultMethodType: material.defaultMethodType,
              itemTrackingType: material.itemTrackingType,
              unitOfMeasureCode: material.unitOfMeasureCode,
              active: true,
              revision: size,
              companyId: material.companyId,
              createdBy: material.createdBy
            })
            .select("id")
            .single()
        )
      );

      const hasErrors = itemInserts.some((insert) => insert.error);
      if (hasErrors) {
        const firstError = itemInserts.find((insert) => insert.error);
        return firstError!;
      }
      for (const insert of itemInserts) {
        if (insert.data?.id) newItemIds.push(insert.data.id);
      }
      const itemCostUpdate = await Promise.all(
        itemInserts.map((insert) =>
          client
            .from("itemCost")
            .update(
              sanitize({
                itemPostingGroupId: material.postingGroupId,
                unitCost: material.unitCost
              })
            )
            .eq("itemId", insert.data?.id ?? "")
        )
      );
      if (itemCostUpdate.some((update) => update.error)) {
        logger.error("Failed to update item cost", {
          error: itemCostUpdate.find((update) => update.error)?.error
        });
      }
    } else {
      const itemInsert = await client
        .from("item")
        .insert({
          readableId,
          name,
          description: material.description,
          mpn: material.mpn,
          type: "Material",
          replenishmentSystem: material.replenishmentSystem,
          defaultMethodType: material.defaultMethodType,
          itemTrackingType: material.itemTrackingType,
          unitOfMeasureCode: material.unitOfMeasureCode,
          active: true,
          companyId: material.companyId,
          createdBy: material.createdBy
        })
        .select("id")
        .single();
      if (itemInsert.error) return itemInsert;
      const itemId = itemInsert.data?.id;
      if (itemId) newItemIds.push(itemId);
      const itemCostUpdate = await client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: material.postingGroupId,
            unitCost: material.unitCost
          })
        )
        .eq("itemId", itemId);
      if (itemCostUpdate.error) {
        logger.error("Failed to update item cost", {
          error: itemCostUpdate.error
        });
      }
    }

    for (const itemId of newItemIds) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: material.createdBy,
        storageUnitId: material.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: material.createdBy,
        companyId: material.companyId,
        mode: material.shelfLifeMode,
        days: material.shelfLifeDays,
        triggerProcessId: material.shelfLifeTriggerProcessId,
        triggerTiming: material.shelfLifeTriggerTiming,
        calculateFromBom: material.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const materialInsert = await client.from("material").upsert({
      id: readableId,
      ...plan.data.next,
      companyId: material.companyId,
      createdBy: material.createdBy,
      customFields: material.customFields
    });

    if (materialInsert.error) return materialInsert;

    const newMaterial = await client
      .from("materials")
      .select("*")
      .eq("readableId", readableId)
      .eq("companyId", material.companyId);

    return {
      data: newMaterial.data?.[0] ?? null,
      error: newMaterial.error
    };
  }

  const { companyId, updatedBy } = material;
  const item = await resolveTypedItemRevision(client, {
    id: material.id,
    companyId,
    type: "Material"
  });
  if (item.error) return item;
  const itemId = item.data.id;
  let readableId = item.data.readableId;

  // Everything that can be refused is checked before the first write.
  const current = await getMaterialPropertyValues(
    client,
    readableId,
    companyId
  );
  if (current.error) return current;

  const plan = await planMaterialPropertyChanges(client, {
    companyId,
    current: current.data,
    changes: sentMaterialProperties(material),
    generatedIds: generatedIds.data
  });
  if (plan.error) return plan;

  let newSizes: string[] = [];
  if (material.sizes?.length) {
    const sizes = await getNewMaterialSizes(client, {
      itemId,
      readableId,
      companyId,
      sizes: material.sizes
    });
    if (sizes.error) return sizes;
    newSizes = sizes.data;
  }

  const itemUpdate = sentFields(
    material,
    materialItemUpdateFields(generatedIds.data)
  );

  const costUpdate: { itemPostingGroupId?: string | null; unitCost?: number } =
    {};
  if ("postingGroupId" in material) {
    costUpdate.itemPostingGroupId = material.postingGroupId || null;
  }
  if (typeof material.unitCost === "number") {
    costUpdate.unitCost = material.unitCost;
  }

  const permitted = await requireMaterialUpdatable(client, {
    readableId,
    companyId,
    updatedBy
  });
  if (permitted.error) return { data: null, error: permitted.error };

  const updatedAt = datetime.timestamp();
  try {
    readableId = await db.transaction().execute(async (trx) => {
      const saved = await writeMaterialIdentity(trx, {
        readableId,
        newReadableId: generatedIds.data
          ? plan.data.generated?.readableId
          : material.readableId || undefined,
        name: plan.data.generated?.name,
        companyId,
        updatedBy,
        changes: plan.data.changed
      });

      await trx
        .updateTable("item")
        .set({ ...itemUpdate, updatedBy, updatedAt })
        .where("id", "=", itemId)
        .where("companyId", "=", companyId)
        .execute();

      if ("customFields" in material) {
        await trx
          .updateTable("material")
          .set({ customFields: material.customFields ?? null, updatedAt })
          .where("id", "=", saved)
          .where("companyId", "=", companyId)
          .execute();
      }

      // The item insert trigger creates the itemCost row, so this updates it.
      if (Object.keys(costUpdate).length > 0) {
        const cost = await trx
          .updateTable("itemCost")
          .set({ ...costUpdate, updatedBy, updatedAt })
          .where("itemId", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (Number(cost.numUpdatedRows) !== 1) {
          throw new MaterialRuleViolation(`Item cost for ${itemId} not found`);
        }
      }
      return saved;
    });
  } catch (error) {
    return { data: null, error: materialWriteError(error) };
  }

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId,
    userId: updatedBy,
    storageUnitId: material.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId,
    userId: updatedBy,
    companyId,
    mode: material.shelfLifeMode,
    days: material.shelfLifeDays,
    triggerProcessId: material.shelfLifeTriggerProcessId,
    triggerTiming: material.shelfLifeTriggerTiming,
    calculateFromBom: material.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  if (newSizes.length > 0) {
    const source = await getItem(client, itemId);
    if (source.error) return source;
    for (const size of newSizes) {
      const revision = await createRevision(client, db, {
        item: source.data,
        revision: size,
        createdBy: updatedBy
      });
      if (revision.error) return revision;
    }
  }

  return client
    .from("item")
    .select("id, readableId, readableIdWithRevision, revision, name")
    .eq("id", itemId)
    .single();
}

/**
 * Changes a material's substance, shape, type, finish, grade or dimension by
 * item id or readable id, as the item properties panel does. Omitted
 * properties keep their value; null or an empty string clears one. A new
 * substance clears finish, grade and type, and a new shape clears dimension
 * and type, unless the same call sets them. Grade and finish must belong to
 * the substance, dimension to the shape, and type to both. With generated
 * material IDs on, every revision's readable id and name are regenerated once
 * the material has a substance and a shape.
 */
export async function updateMaterialProperties(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  material: {
    id: string;
    companyId: string;
    updatedBy: string;
    materialSubstanceId?: string | null;
    materialFormId?: string | null;
    materialTypeId?: string | null;
    finishId?: string | null;
    gradeId?: string | null;
    dimensionId?: string | null;
  }
) {
  const { companyId, updatedBy } = material;

  const item = await resolveTypedItem(client, {
    id: material.id,
    companyId,
    type: "Material"
  });
  if (item.error) return item;
  let readableId = item.data.readableId;

  const [current, generatedIds] = await Promise.all([
    getMaterialPropertyValues(client, readableId, companyId),
    materialIdsAreGenerated(client, companyId)
  ]);
  if (current.error) return current;
  if (generatedIds.error) return generatedIds;

  const plan = await planMaterialPropertyChanges(client, {
    companyId,
    current: current.data,
    changes: sentMaterialProperties(material),
    generatedIds: generatedIds.data
  });
  if (plan.error) return plan;

  if (Object.keys(plan.data.changed).length > 0) {
    const permitted = await requireMaterialUpdatable(client, {
      readableId,
      companyId,
      updatedBy
    });
    if (permitted.error) return { data: null, error: permitted.error };

    try {
      readableId = await db.transaction().execute((trx) =>
        writeMaterialIdentity(trx, {
          readableId,
          newReadableId: plan.data.generated?.readableId,
          name: plan.data.generated?.name,
          companyId,
          updatedBy,
          changes: plan.data.changed
        })
      );
    } catch (error) {
      return { data: null, error: materialWriteError(error) };
    }
  }

  const row = await client
    .from("materials")
    .select("*")
    .eq("readableId", readableId)
    .eq("companyId", companyId)
    .single();
  if (row.error) return row;
  // The view names finish, grade, dimension and type but has no ids for them.
  return { data: { ...row.data, ...plan.data.next }, error: null };
}

/**
 * Creates a dimension (a named size) for a material shape, or updates the one
 * whose `id` is sent; a new dimension's id is generated.
 */
export async function upsertMaterialDimension(
  client: SupabaseClient<Database>,
  materialDimension:
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        companyId: string;
        isMetric: boolean;
      })
    | (Omit<z.infer<typeof materialDimensionValidator>, "id"> & {
        id: string;
        companyId?: string;
      })
) {
  if ("id" in materialDimension) {
    // companyId narrows the match; it must never move the row.
    const { id, companyId, ...update } = materialDimension;
    let query = client
      .from("materialDimension")
      .update(sanitize(update))
      .eq("id", id);
    if (companyId) query = query.eq("companyId", companyId);
    return query.select("id").single();
  }

  return client
    .from("materialDimension")
    .insert([materialDimension])
    .select("*")
    .single();
}

/**
 * Creates a finish for a material substance, or updates the one whose `id` is
 * sent; a new finish's id is generated.
 */
export async function upsertMaterialFinish(
  client: SupabaseClient<Database>,
  materialFinish:
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialFinishValidator>, "id"> & {
        id: string;
        companyId?: string;
      })
) {
  if ("id" in materialFinish) {
    // companyId narrows the match; it must never move the row.
    const { id, companyId, ...update } = materialFinish;
    let query = client
      .from("materialFinish")
      .update(sanitize(update))
      .eq("id", id);
    if (companyId) query = query.eq("companyId", companyId);
    return query.select("id").single();
  }
  return client
    .from("materialFinish")
    .insert([materialFinish])
    .select("*")
    .single();
}

export async function upsertMaterialForm(
  client: SupabaseClient<Database>,
  materialForm:
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialFormValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialForm) {
    return client
      .from("materialForm")
      .insert([materialForm])
      .select("*")
      .single();
  }
  return client
    .from("materialForm")
    .update(sanitize(materialForm))
    .eq("id", materialForm.id)
    .select("id")
    .single();
}

/**
 * Creates a grade for a material substance, or updates the one whose `id` is
 * sent; a new grade's id is generated.
 */
export async function upsertMaterialGrade(
  client: SupabaseClient<Database>,
  materialGrade:
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialGradeValidator>, "id"> & {
        id: string;
        companyId?: string;
      })
) {
  if ("id" in materialGrade) {
    // companyId narrows the match; it must never move the row.
    const { id, companyId, ...update } = materialGrade;
    let query = client
      .from("materialGrade")
      .update(sanitize(update))
      .eq("id", id);
    if (companyId) query = query.eq("companyId", companyId);
    return query.select("id").single();
  }
  return client
    .from("materialGrade")
    .insert([materialGrade])
    .select("*")
    .single();
}

export async function deleteMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").delete().eq("id", id);
}

export async function getMaterialTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("materialTypes")
    .select("*", { count: LIST_COUNT })
    .or(`companyId.eq.${companyId},companyId.is.null`);

  if (args?.search) {
    query = query.or(
      buildSearchFilter(args.search, [
        "name",
        "substanceName",
        "formName",
        "id"
      ])
    );
  }

  query = setGenericQueryFilters(query, args ?? {});
  return query;
}

export async function getMaterialType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("materialType").select("*").eq("id", id).single();
}

export async function getMaterialTypeList(
  client: SupabaseClient<Database>,
  materialSubstanceId: string,
  materialFormId: string,
  companyId: string
) {
  return client
    .from("materialType")
    .select("*")
    .eq("materialSubstanceId", materialSubstanceId)
    .eq("materialFormId", materialFormId)
    .or(`companyId.eq.${companyId},companyId.is.null`);
}

/**
 * Creates a material type for a substance and shape pair, or updates the one
 * whose `id` is sent; a new type's id is generated.
 */
export async function upsertMaterialType(
  client: SupabaseClient<Database>,
  materialType:
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof materialTypeValidator>, "id"> & {
        id: string;
        companyId?: string;
      })
) {
  if ("id" in materialType) {
    // companyId narrows the match; it must never move the row.
    const { id, companyId, ...update } = materialType;
    let query = client
      .from("materialType")
      .update(sanitize(update))
      .eq("id", id);
    if (companyId) query = query.eq("companyId", companyId);
    return query.select("id").single();
  }
  return client
    .from("materialType")
    .insert([materialType])
    .select("*")
    .single();
}

export async function upsertMaterialSubstance(
  client: SupabaseClient<Database>,
  materialSubstance:
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof materialSubstanceValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in materialSubstance) {
    return client
      .from("materialSubstance")
      .insert([materialSubstance])
      .select("*")
      .single();
  }
  return client
    .from("materialSubstance")
    .update(sanitize(materialSubstance))
    .eq("id", materialSubstance.id)
    .select("id")
    .single();
}

/**
 * Creates a service (item row and service row) or updates one. A service is
 * identified by its name: on create the readable id is `name`, and on update
 * a changed name renames the readable id with it (a name another service uses
 * is refused). On update `id` is the item id (uuid) or the
 * service's readable id and the write is a full replace, so omitted optional
 * fields are cleared.
 */
export async function upsertService(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  service:
    | (z.infer<typeof serviceValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof serviceValidator> & {
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in service) {
    const readableId = service.name;
    const existing = await client
      .from("item")
      .select("id")
      .eq("readableId", readableId)
      .eq("type", "Service")
      .eq("companyId", service.companyId)
      .limit(1);
    if (existing.error) return existing;
    if (existing.data.length > 0) {
      return {
        data: null,
        error: ruleError(`A service named "${readableId}" already exists`)
      };
    }

    const itemInsert = await client
      .from("item")
      .insert({
        readableId,
        revision: service.revision || "0",
        name: service.name,
        description: service.description,
        type: "Service",
        replenishmentSystem: service.replenishmentSystem,
        defaultMethodType: service.defaultMethodType,
        // Services can never be shipped, received, or stocked
        itemTrackingType: "Non-Inventory",
        // A service is always counted in Each, whatever unit a caller sends.
        unitOfMeasureCode: EACH_UNIT_OF_MEASURE_CODE,
        active: true,
        companyId: service.companyId,
        createdBy: service.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [serviceInsert, itemCostUpdate] = await Promise.all([
      client.from("service").upsert({
        id: readableId,
        // Legacy column, no longer surfaced in the UI; the migration adds a
        // DB-level default of "External". Passed explicitly until the committed
        // (cloud-sourced) types pick up that default and make it optional.
        serviceType: "External",
        companyId: service.companyId,
        createdBy: service.createdBy,
        customFields: service.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: service.postingGroupId,
            unitCost: service.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (serviceInsert.error) return serviceInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    const newService = await client
      .from("services")
      .select("*")
      .eq("readableId", readableId)
      .eq("companyId", service.companyId)
      .single();

    return newService;
  }

  if (!service.id) {
    return { data: null, error: ruleError("Service id is required") };
  }

  const updated = await updateTypedItem(client, {
    id: service.id,
    companyId: service.companyId,
    updatedBy: service.updatedBy,
    type: "Service",
    item: {
      description: service.description,
      replenishmentSystem: service.replenishmentSystem,
      defaultMethodType: service.defaultMethodType,
      itemTrackingType: "Non-Inventory",
      // A service is always counted in Each, whatever unit a caller sends.
      unitOfMeasureCode: EACH_UNIT_OF_MEASURE_CODE,
      active: true
    },
    typed: { customFields: service.customFields }
  });
  if (updated.error) return updated;

  // The name is the readable id, so it is written by the rename (after the
  // update above, which resolves `id` against the current readable id).
  const renamed = await updateServiceName(db, {
    itemId: updated.data.id,
    name: service.name,
    companyId: service.companyId,
    userId: service.updatedBy
  });
  if (renamed.error) return renamed;
  return {
    data: { id: updated.data.id, readableId: renamed.data.readableId },
    error: null
  };
}

/**
 * Renames a service. A service is identified by its name, so every revision's
 * readable id and the service row's id follow it; a name another service
 * already uses is refused.
 */
export async function updateServiceName(
  db: Kysely<KyselyDatabase>,
  args: { itemId: string; name: string; companyId: string; userId: string }
): Promise<
  | { data: { readableId: string }; error: null }
  | { data: null; error: { code: string; message: string } }
> {
  const name = args.name.trim();
  if (!name) {
    return { data: null, error: ruleError("Name is required") };
  }

  const updatedAt = datetime.timestamp();

  return db.transaction().execute(async (trx) => {
    const item = await trx
      .selectFrom("item")
      .select("readableId")
      .where("id", "=", args.itemId)
      .where("type", "=", "Service")
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!item) {
      return { data: null, error: ruleError("Service not found") };
    }

    if (item.readableId !== name) {
      const taken = await trx
        .selectFrom("item")
        .select("id")
        .where("readableId", "=", name)
        .where("type", "=", "Service")
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (taken) {
        return {
          data: null,
          error: ruleError(`A service named "${name}" already exists`)
        };
      }

      await trx
        .updateTable("service")
        .set({ id: name, updatedBy: args.userId, updatedAt })
        .where("id", "=", item.readableId)
        .where("companyId", "=", args.companyId)
        .execute();
    }

    await trx
      .updateTable("item")
      .set({ readableId: name, name, updatedBy: args.userId, updatedAt })
      .where("readableId", "=", item.readableId)
      .where("type", "=", "Service")
      .where("companyId", "=", args.companyId)
      .execute();

    return { data: { readableId: name }, error: null };
  });
}

export async function upsertUnitOfMeasure(
  client: SupabaseClient<Database>,
  unitOfMeasure:
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof unitOfMeasureValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in unitOfMeasure) {
    return client
      .from("unitOfMeasure")
      .update(sanitize(unitOfMeasure))
      .eq("id", unitOfMeasure.id)
      .select("id")
      .single();
  }

  return client
    .from("unitOfMeasure")
    .insert([unitOfMeasure])
    .select("id")
    .single();
}

/**
 * Creates a tool (item row and tool row) or updates one; on update `id` is the
 * item id (uuid) or the tool's readable id and the write is a full replace, so
 * omitted optional fields are cleared.
 */
export async function upsertTool(
  client: SupabaseClient<Database>,
  tool:
    | (z.infer<typeof toolValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof toolValidator> & {
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in tool) {
    const itemInsert = await client
      .from("item")
      .insert({
        readableId: tool.id,
        revision: tool.revision ?? "0",
        name: tool.name,
        description: tool.description,
        type: "Tool",
        replenishmentSystem: tool.replenishmentSystem,
        defaultMethodType: tool.defaultMethodType,
        itemTrackingType: tool.itemTrackingType,
        unitOfMeasureCode: tool.unitOfMeasureCode,
        active: true,
        modelUploadId: tool.modelUploadId,
        companyId: tool.companyId,
        createdBy: tool.createdBy
      })
      .select("id")
      .single();
    if (itemInsert.error) return itemInsert;
    const itemId = itemInsert.data?.id;

    const [toolInsert, itemCostUpdate] = await Promise.all([
      client.from("tool").upsert({
        id: tool.id,
        companyId: tool.companyId,
        createdBy: tool.createdBy,
        customFields: tool.customFields
      }),
      client
        .from("itemCost")
        .update(
          sanitize({
            itemPostingGroupId: tool.postingGroupId,
            unitCost: tool.unitCost
          })
        )
        .eq("itemId", itemId)
    ]);

    if (toolInsert.error) return toolInsert;
    if (itemCostUpdate.error) return itemCostUpdate;

    if (itemId) {
      const pickMethod = await upsertItemDefaultPickMethod(client, {
        itemId,
        userId: tool.createdBy,
        storageUnitId: tool.defaultStorageUnitId
      });
      if (pickMethod.error) return pickMethod;

      const shelfLife = await upsertItemShelfLife(client, {
        itemId,
        userId: tool.createdBy,
        companyId: tool.companyId,
        mode: tool.shelfLifeMode,
        days: tool.shelfLifeDays,
        triggerProcessId: tool.shelfLifeTriggerProcessId,
        triggerTiming: tool.shelfLifeTriggerTiming,
        calculateFromBom: tool.shelfLifeCalculateFromBom
      });
      if (shelfLife.error) return shelfLife;
    }

    const newTool = await client
      .from("tools")
      .select("*")
      .eq("readableId", tool.id)
      .eq("companyId", tool.companyId)
      .single();

    return newTool;
  }

  const updated = await updateTypedItem(client, {
    id: tool.id,
    companyId: tool.companyId,
    updatedBy: tool.updatedBy,
    type: "Tool",
    item: {
      name: tool.name,
      description: tool.description,
      replenishmentSystem: tool.replenishmentSystem,
      defaultMethodType: tool.defaultMethodType,
      itemTrackingType: tool.itemTrackingType,
      unitOfMeasureCode: tool.unitOfMeasureCode,
      active: true
    },
    typed: { customFields: tool.customFields }
  });
  if (updated.error) return updated;
  const itemId = updated.data.id;

  const pickMethod = await upsertItemDefaultPickMethod(client, {
    itemId,
    userId: tool.updatedBy,
    storageUnitId: tool.defaultStorageUnitId
  });
  if (pickMethod.error) return pickMethod;

  const shelfLife = await upsertItemShelfLife(client, {
    itemId,
    userId: tool.updatedBy,
    companyId: tool.companyId,
    mode: tool.shelfLifeMode,
    days: tool.shelfLifeDays,
    triggerProcessId: tool.shelfLifeTriggerProcessId,
    triggerTiming: tool.shelfLifeTriggerTiming,
    calculateFromBom: tool.shelfLifeCalculateFromBom
  });
  if (shelfLife.error) return shelfLife;

  return updated;
}

// =============================================================================
// Change Notices — header CRUD, stage transitions, list, and CO Types config.
// =============================================================================

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getChangeNotice(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("*")
    .eq("id", changeNoticeId)
    .eq("companyId", companyId)
    .single();
}

export async function getChangeNotices(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrders")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(searchFilter(["changeOrderId", "name"], args.search));
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "changeOrderId", ascending: false }
    ]);
  }

  return query;
}

// -----------------------------------------------------------------------------
// Header CRUD
// -----------------------------------------------------------------------------
/** The header insert only; `createChangeNotice` also dates it and adds its parts. */
export async function insertChangeNotice(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeNoticeId?: string;
    name: string;
    type?: (typeof changeNoticeType)[number];
    priority?: (typeof nonConformancePriority)[number];
    changeNoticeTypeId?: string;
    nonConformanceId?: string;
    openDate: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeNoticeId: string } | null;
  error: ChangeNoticeError | null;
}> {
  let changeNoticeId: string;
  if (input.changeNoticeId) {
    changeNoticeId = input.changeNoticeId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "changeOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error: seq.error ?? {
          message: "Failed to generate changeOrder sequence"
        }
      };
    }
    changeNoticeId = seq.data;
  }

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId: changeNoticeId,
      name: input.name,
      type: input.type ?? "Engineering",
      priority: input.priority ?? null,
      changeOrderTypeId: input.changeNoticeTypeId ?? null,
      nonConformanceId: input.nonConformanceId ?? null,
      openDate: input.openDate,
      reasonForChange: input.reasonForChange ?? {},
      description: input.description ?? {},
      dueDate: input.dueDate ?? null,
      assignee: input.assignee ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id, changeOrderId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  // No default actions are seeded on create — the CO starts with zero required
  // actions selected; the user picks them afterward from the rail's Required
  // Actions multiselect (reconciled by setChangeNoticeActionTasks).

  return {
    data: { id: result.data.id, changeNoticeId: result.data.changeOrderId },
    error: null
  };
}

const changeNoticeHeaderFields = [
  "changeOrderId",
  "name",
  "type",
  "priority",
  "changeOrderTypeId",
  "nonConformanceId",
  "openDate",
  "reasonForChange",
  "description",
  "dueDate",
  "assignee",
  "customFields"
] as const;

/**
 * Writes only the header fields sent, from `changeNoticeHeaderFields`:
 * `status` moves only through `updateChangeNoticeStatus` and the release.
 */
export async function updateChangeNotice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    companyId: string;
    updatedBy: string;
    changeOrderId?: string;
    name?: string;
    type?: (typeof changeNoticeType)[number];
    priority?: (typeof nonConformancePriority)[number] | null;
    changeOrderTypeId?: string | null;
    nonConformanceId?: string | null;
    openDate?: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string | null;
    assignee?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeNoticeError | null;
}> {
  const result = await client
    .from("changeOrder")
    .update({
      ...sanitize(pick(input, [...changeNoticeHeaderFields])),
      updatedBy: input.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.id)
    .eq("companyId", input.companyId)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

export async function deleteChangeNotice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  changeNoticeId: string,
  companyId: string
) {
  // Discard each affected item's CO-owned Draft first (the Draft make method for
  // a Version, or the revealed inactive item for a Revision/New Part). These are
  // NOT FK children of the change notice, so the cascade below won't remove them —
  // only the changeOrderAffectedItem rows cascade. Without this, deleting a CO
  // orphans its drafts (mirrors removeChangeNoticeAffectedItem's cleanup).
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId);
  if (affected.error) return { data: null, error: affected.error };

  // A draft that cannot be discarded keeps its change notice: deleting the
  // notice anyway would leave the draft with nothing pointing at it.
  const discarded = await discardChangeNoticeDrafts(
    client,
    db,
    affected.data,
    companyId
  );
  if (discarded.error) return { data: null, error: discarded.error };

  // Remaining children (affected items, action tasks) cascade via ON DELETE CASCADE.
  return client
    .from("changeOrder")
    .delete()
    .eq("id", changeNoticeId)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Stage transition — the single guarded writer (G8), a compare-and-swap (G2).
// Forward-only (isAllowedChangeNoticeTransition).
// -----------------------------------------------------------------------------
export const changeNoticeUpdatedElsewhere =
  "The change notice was updated by someone else. Refresh and try again.";

/**
 * The guarded write only; `setChangeNoticeStatus` also gates approval,
 * releases and notifies. Never Done: the release is `applyChangeNotice`.
 */
export async function updateChangeNoticeStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeNoticeStatus)[number];
    toStatus: (typeof changeNoticeStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
): Promise<{
  data: { id: string; status: (typeof changeNoticeStatus)[number] } | null;
  error: { message: string } | null;
}> {
  const { id, companyId, fromStatus, toStatus, ...rest } = update;

  if (toStatus === "Done") {
    return {
      data: null,
      error: ruleError("A change notice is completed only by its release")
    };
  }
  if (!isAllowedChangeNoticeTransition(fromStatus, toStatus)) {
    return {
      data: null,
      error: ruleError(`Cannot change status from ${fromStatus} to ${toStatus}`)
    };
  }

  // Build the update explicitly rather than sanitize({...rest}): sanitize coerces
  // every `undefined` field to null, which would wipe an existing assignee on a
  // transition where the caller passes it as undefined. Only set an optional
  // field when the caller provided a value.
  const payload: {
    status: (typeof changeNoticeStatus)[number];
    updatedBy: string;
    assignee?: string | null;
  } = { status: toStatus, updatedBy: rest.updatedBy };
  if (rest.assignee !== undefined) payload.assignee = rest.assignee;

  const result = await client
    .from("changeOrder")
    .update(payload)
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", fromStatus)
    .select("id, status")
    .maybeSingle();

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return { data: null, error: { message: changeNoticeUpdatedElsewhere } };
  }
  return { data: result.data, error: null };
}

// -----------------------------------------------------------------------------
// Change Notice Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export async function getChangeNoticeTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderType")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeNoticeTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getChangeNoticeType(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function upsertChangeNoticeType(
  client: SupabaseClient<Database>,
  changeNoticeType:
    | {
        name: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  // changeOrderType has no customFields column.
  if ("createdBy" in changeNoticeType) {
    const { customFields: _customFields, ...type } = changeNoticeType;
    return client.from("changeOrderType").insert([type]).select("id").single();
  }
  // companyId scopes the row, it is not part of the payload (it's in the PK).
  const {
    companyId,
    customFields: _customFields,
    ...update
  } = changeNoticeType;
  return client
    .from("changeOrderType")
    .update(sanitize(update))
    .eq("id", changeNoticeType.id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function deleteChangeNoticeType(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// =============================================================================
// Phase 2 — Products Affected
// =============================================================================

// Joins to `item` throughout Phase 2 are done as separate FLAT scalar selects +
// a JS stitch rather than PostgREST embeds: an embedded select instantiates
// PostgREST's deeply-recursive relation parser, and across the module that
// pushed TS's global instantiation budget over the edge (TS2589 in unrelated
// files). Flat selects barely instantiate.

// =============================================================================
// v2 — CO-owned Draft make-method orchestration (affected items).
//
// A CO's edits for one affected item live on a REAL Draft makeMethod owned by
// the CO (makeMethod.changeOrderId set). That draft is shown/edited both in the
// CO workspace and on the affected item's own master page (same rows, in sync);
// changeOrderId is cleared at release. Creating an affected item spins that
// draft per the change type:
//   Version  → new Draft method version on the SAME item (BoM/BoP edits).
//   Revision → new inactive revision item + its Draft method (attrs/docs).
//   New Part → new inactive part number (new readableId) + copied Draft method.
// All three keep the user client (the release path uses the same client for the
// same privileged method helpers — see applyChangeNotice).
// =============================================================================

// Mint the next readableId for a CO-derived New Part, following the SAME numbering
// scheme as the source part — so "GA-0029" yields "GA-0030", not a bare number.
// Server-side mirror of useNextItemId: split the source readableId into its
// non-numeric prefix + trailing number, ask the matching sequence RPC for the
// current MAX with that shape, then increment + zero-pad to the same width.
// Falls back to a plain numeric id when the source has no prefix.
async function getNextItemIdFromSource(
  client: SupabaseClient<Database>,
  companyId: string,
  itemType: Database["public"]["Enums"]["itemType"],
  sourceReadableId: string
): Promise<string> {
  const prefix = sourceReadableId.match(/^(.*?)\d+$/)?.[1] ?? "";

  const rpc = prefix
    ? await client.rpc("get_next_prefixed_sequence", {
        company_id: companyId,
        item_type: itemType,
        prefix
      })
    : await client.rpc("get_next_numeric_sequence", {
        company_id: companyId,
        item_type: itemType
      });

  const current = rpc.data;
  const sequence = current?.slice(prefix.length) ?? "";
  const currentSequence = parseInt(sequence, 10);
  if (!current || Number.isNaN(currentSequence)) {
    return `${prefix}${(1).toString().padStart(9, "0")}`;
  }
  // Preserve the source's digit width (mirrors useNextItemId's pad math).
  const tail = current.split(`${currentSequence}`)?.[1]?.length ?? 0;
  const width = Math.max(sequence.length - tail, 1);
  return `${prefix}${(currentSequence + 1).toString().padStart(width, "0")}`;
}

// Resolve the current Active make method id for an item (the base the draft is
// copied from + the merge base at release). Falls back to the highest version.
// Also returns `maxVersion` = the highest version number across ALL of the
// item's methods (Draft/Active/Archived) — a new draft must be numbered above
// this, not above the Active one, so parallel COs on the same item don't collide
// on the `(itemId, version)` unique constraint (a hidden CO draft already holds
// Active+1).
async function getActiveMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{
  id: string;
  version: number;
  maxVersion: number;
  // `status` of the chosen method. Since `chosen = active ?? rows[0]`, a value of
  // "Draft" means the item has NO Active method — its current method is still an
  // un-activated draft (the common case for a Make item that never spun a v2).
  status: string;
} | null> {
  const methods = await client
    .from("makeMethod")
    .select("id, version, status")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false });
  const rows = methods.data ?? [];
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.status === "Active");
  const chosen = active ?? rows[0];
  // rows are ordered by version DESC, so rows[0] holds the highest version.
  const maxVersion = rows[0].version ?? chosen.version ?? 1;
  return {
    id: chosen.id,
    version: chosen.version ?? 1,
    maxVersion,
    status: chosen.status
  };
}

// Fetch the (single) Draft make method for a freshly-created item — the trigger
// creates one and createRevision/copyItem populate it.
async function getDraftMakeMethodIdForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const draft = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return draft.data?.id ?? null;
}

type DraftMethodResult = {
  data: {
    draftMakeMethodId: string | null;
    baseMakeMethodId: string | null;
    newItemId: string | null;
  } | null;
  error: ChangeNoticeError | null;
};

// Create the CO-owned Draft make method for an affected item per its change type.
export async function createChangeNoticeDraftMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    changeNoticeId: string;
    itemId: string;
    changeType: ChangeNoticeChangeType;
    // Optional revision label for the Revision path — when the caller already
    // knows the target revision (e.g. the value typed in the new-revision
    // modal). Omitted → the next revision is auto-computed.
    revision?: string;
    companyId: string;
    userId: string;
  }
): Promise<DraftMethodResult> {
  const { changeNoticeId, itemId, changeType, revision, companyId, userId } =
    input;

  const base = await getActiveMakeMethodId(client, itemId, companyId);

  if (changeType === "Version") {
    if (!base) {
      return {
        data: null,
        error: { message: "Item has no make method to version" }
      };
    }
    // If the item's current method is still an un-activated Draft (no Active
    // version — the common case for a Make item that never spun a v2), promote it
    // to Active as we create the CO's new draft, mirroring the make-method-tools
    // "New Version" flow. Otherwise the CO draft (numbered above the base) would
    // outrank the base draft in `activeMakeMethods` — which falls back to the
    // highest-version draft when there is no Active — and `get-method` would hand
    // the CO's UNRELEASED edits to jobs/quotes. Freezing the base as Active keeps
    // production on the current method until the CO is released.
    // `createMakeMethodVersion` activates only a Draft base, and writes the new
    // Draft with the CO's id and its BoM/BoP rows in one transaction. Number it
    // above ALL existing versions (maxVersion + 1), not the Active one, so a
    // second CO on the same part doesn't collide on (itemId, version). Retry on
    // a concurrent unique-violation by recomputing the next free version.
    let draftId: string | null = null;
    let nextVersion = base.maxVersion + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await createMakeMethodVersion(client, db, {
        copyFromId: base.id,
        activate: true,
        changeOrderId: changeNoticeId,
        version: nextVersion,
        companyId,
        createdBy: userId
      });
      if (!res.error && res.data) {
        draftId = res.data.id;
        break;
      }
      // 23505 = unique_violation (makeMethod_unique_itemId_version); a parallel
      // CO grabbed this number first — recompute the next free version + retry.
      if (isUniqueViolation(res.error)) {
        const latest = await getActiveMakeMethodId(client, itemId, companyId);
        nextVersion = (latest?.maxVersion ?? nextVersion) + 1;
        continue;
      }
      return {
        data: null,
        error: res.error ?? { message: "Failed to create draft version" }
      };
    }
    if (!draftId) {
      return {
        data: null,
        error: { message: "Failed to create draft version" }
      };
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base.id,
        newItemId: null
      },
      error: null
    };
  }

  if (changeType === "Revision") {
    const source = await getItem(client, itemId);
    if (source.error || !source.data) {
      return { data: null, error: { message: "Item not found" } };
    }
    // Honor a caller-supplied revision label (e.g. the value typed in the
    // new-revision modal); otherwise auto-pick the next revision string across
    // the item's readableId siblings.
    let nextRevision = revision?.trim();
    if (!nextRevision) {
      const siblings = await client
        .from("item")
        .select("revision")
        .eq("readableId", source.data.readableId)
        .eq("companyId", companyId)
        .eq("type", source.data.type)
        .order("revision", { ascending: false });
      const maxRevision = siblings.data?.[0]?.revision ?? "0";
      nextRevision = getNextRevision(maxRevision);
    }

    const created = await createRevision(client, db, {
      item: source.data,
      revision: nextRevision,
      createdBy: userId,
      active: false
    });
    if (created.error || !created.data) {
      return { data: null, error: created.error };
    }
    const newItemId = created.data.id;
    const draftId = await getDraftMakeMethodIdForItem(
      client,
      newItemId,
      companyId
    );
    const stampItem = await client
      .from("item")
      .update({ changeOrderId: changeNoticeId })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (stampItem.error) return { data: null, error: stampItem.error };
    if (draftId) {
      await client
        .from("makeMethod")
        .update({ changeOrderId: changeNoticeId })
        .eq("id", draftId)
        .eq("companyId", companyId);
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base?.id ?? null,
        newItemId
      },
      error: null
    };
  }

  if (changeType === "New Part") {
    // Net-new part — no predecessor, no supersession. addChangeNoticeAffectedItem
    // already minted the item (inactive, CO-stamped); here `itemId` IS that new
    // item. Its insert trigger created a Draft makeMethod (status default 'Draft');
    // stamp it CO-owned so it hides from version lists until release (parity with
    // Revision). No source to copy from → empty draft, no baseMakeMethodId.
    const draftId = await getDraftMakeMethodIdForItem(
      client,
      itemId,
      companyId
    );
    if (draftId) {
      const stamp = await client
        .from("makeMethod")
        .update({ changeOrderId: changeNoticeId })
        .eq("id", draftId)
        .eq("companyId", companyId);
      if (stamp.error) return { data: null, error: stamp.error };
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: null,
        newItemId: itemId
      },
      error: null
    };
  }

  // Replacement Part — a new part number derived from + (at release) superseding
  // the affected part. This is the only remaining change type here: Version /
  // Revision / New Part all returned above, so `changeType` is narrowed to
  // "Replacement Part". ECO scope is Parts + Tools (Materials/Consumables/Services
  // excluded); reject other types rather than mint a malformed row.
  const source = await getItem(client, itemId);
  if (source.error || !source.data) {
    return { data: null, error: { message: "Item not found" } };
  }
  if (source.data.type !== "Part" && source.data.type !== "Tool") {
    return {
      data: null,
      error: {
        message: `New Part is only supported for Parts and Tools (got ${source.data.type})`
      }
    };
  }
  const newReadableId = await getNextItemIdFromSource(
    client,
    companyId,
    source.data.type,
    source.data.readableId
  );
  const newItem = await client
    .from("item")
    .insert({
      readableId: newReadableId,
      revision: "0",
      name: source.data.name,
      type: source.data.type,
      replenishmentSystem: source.data.replenishmentSystem,
      defaultMethodType: source.data.defaultMethodType,
      itemTrackingType: source.data.itemTrackingType,
      unitOfMeasureCode: source.data.unitOfMeasureCode,
      // Faithfully copy the source's attributes so the CO diff shows only the
      // user's edits, not gaps left by an incomplete copy.
      description: source.data.description,
      sourcingType: source.data.sourcingType,
      thumbnailPath: source.data.thumbnailPath,
      mpn: source.data.mpn,
      active: false,
      revisionStatus: "Design",
      changeOrderId: changeNoticeId,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (newItem.error || !newItem.data) {
    return { data: null, error: newItem.error };
  }
  const newItemId = newItem.data.id;
  const typeTable = source.data.type === "Part" ? "part" : "tool";
  const typeRow = await client
    .from(typeTable)
    .insert({ id: newReadableId, companyId, createdBy: userId });
  if (typeRow.error) return { data: null, error: typeRow.error };

  // Carry the source's item group (on itemCost) onto the new part.
  await copyItemPostingGroup(client, {
    sourceItemId: itemId,
    targetItemId: newItemId,
    companyId
  });

  // Copy the affected part's method into the new item's (trigger-created) draft.
  // @ts-expect-error TS2345 - getMethodValidator flags default in get-method
  const copy = await copyItem(client, db, {
    sourceId: itemId,
    targetId: newItemId,
    companyId,
    userId
  });
  if (copy.error) {
    return { data: null, error: { message: "Failed to copy make method" } };
  }
  const draftId = await getDraftMakeMethodIdForItem(
    client,
    newItemId,
    companyId
  );
  if (draftId) {
    await client
      .from("makeMethod")
      .update({ changeOrderId: changeNoticeId })
      .eq("id", draftId)
      .eq("companyId", companyId);
  }
  return {
    data: {
      draftMakeMethodId: draftId,
      baseMakeMethodId: base?.id ?? null,
      newItemId
    },
    error: null
  };
}

// Discard affected items' CO-owned Drafts (on a change-type switch, and when an
// affected item or its change notice is removed): the new item for a
// Revision / Replacement Part / New Part, which cascades its method rows, or
// the Draft method for a Version. One transaction, so a failure leaves every
// draft in place and the caller can stop instead of orphaning one.
async function discardChangeNoticeDrafts(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  drafts: {
    draftMakeMethodId: string | null;
    newItemId: string | null;
  }[],
  companyId: string
): Promise<{ error: ServiceError | null }> {
  const itemIds = drafts.flatMap((draft) =>
    draft.newItemId ? [draft.newItemId] : []
  );
  const makeMethodIds = drafts.flatMap((draft) =>
    !draft.newItemId && draft.draftMakeMethodId ? [draft.draftMakeMethodId] : []
  );
  if (itemIds.length === 0 && makeMethodIds.length === 0) {
    return { error: null };
  }

  // The item and makeMethod DELETE policies both ask for parts_delete.
  const permitted = await requireCompanyPermission(
    client,
    companyId,
    "parts_delete"
  );
  if (permitted.error) return permitted;

  try {
    await db.transaction().execute(async (trx) => {
      // A Revision draft inherits its source's price breaks.
      await deleteItemsWithPriceBreaks(trx, { itemIds, companyId });
      if (makeMethodIds.length > 0) {
        await trx
          .deleteFrom("makeMethod")
          .where("id", "in", makeMethodIds)
          .where("companyId", "=", companyId)
          .execute();
      }
    });
  } catch (error) {
    logger.error("Failed to discard change notice drafts", {
      companyId,
      itemIds,
      makeMethodIds,
      error
    });
    return { error: writeError(error) };
  }
  return { error: null };
}

// Add an affected item to a CO: insert the row, then spin its CO-owned Draft
// make method per the change type and write the draft refs back. Rolls the row
// back if draft creation fails (get-method runs its own transaction — G2).
export async function addChangeNoticeAffectedItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    changeNoticeId: string;
    // The existing affected item (Version / Revision / Replacement Part). Omitted
    // for the net-new New Part path, where `newPart` is supplied and the item is
    // minted here.
    itemId?: string;
    changeType: ChangeNoticeChangeType;
    // Forwarded to the Revision draft path so a Revision affected item can take
    // an explicit revision label (e.g. from the new-revision modal).
    revision?: string;
    // Net-new "New Part": mint a brand-new inactive Part/Tool and add it as a New
    // Part affected item (no existing itemId, no predecessor/supersession).
    newPart?: {
      readableId: string;
      name: string;
      itemType: "Part" | "Tool";
      replenishmentSystem: "Buy" | "Make" | "Buy and Make";
      itemTrackingType?: (typeof itemTrackingTypes)[number];
    };
    companyId: string;
    userId: string;
  }
): Promise<{
  data: { id: string; draftMakeMethodId: string | null } | null;
  error: ChangeNoticeError | null;
}> {
  const { changeNoticeId, changeType, revision, newPart, companyId, userId } =
    input;
  let itemId = input.itemId;
  let effectiveChangeType: ChangeNoticeChangeType = changeType;

  if (newPart) {
    // Net-new part introduced by the CO — mint an inactive Part/Tool + its type
    // row, CO-stamped. The minted id becomes the affected item (no predecessor).
    if (newPart.itemType !== "Part" && newPart.itemType !== "Tool") {
      return {
        data: null,
        error: { message: "New Part is only supported for Parts and Tools" }
      };
    }
    const defaultMethodType =
      newPart.replenishmentSystem === "Make"
        ? "Make to Order"
        : newPart.replenishmentSystem === "Buy"
          ? "Purchase to Order"
          : "Pull from Inventory";
    const minted = await client
      .from("item")
      .insert({
        readableId: newPart.readableId,
        revision: "0",
        name: newPart.name,
        type: newPart.itemType,
        replenishmentSystem: newPart.replenishmentSystem,
        defaultMethodType,
        itemTrackingType: newPart.itemTrackingType ?? "Inventory",
        unitOfMeasureCode: "EA",
        active: false,
        revisionStatus: "Design",
        changeOrderId: changeNoticeId,
        companyId,
        createdBy: userId
      })
      .select("id")
      .single();
    if (minted.error || !minted.data) {
      return { data: null, error: minted.error };
    }
    itemId = minted.data.id;
    const typeTable = newPart.itemType === "Part" ? "part" : "tool";
    const typeRow = await client
      .from(typeTable)
      .insert({ id: newPart.readableId, companyId, createdBy: userId });
    if (typeRow.error) return { data: null, error: typeRow.error };
    effectiveChangeType = "New Part";
  }

  if (!itemId) {
    return { data: null, error: { message: "Item is required" } };
  }

  // A purchased (Buy) item has no BoM/BoP, so a Version change is a no-op —
  // default it to a Revision (part-data/docs), the meaningful change for Buy.
  if (!newPart && changeType === "Version") {
    const item = await client
      .from("item")
      .select("replenishmentSystem")
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (item.data?.replenishmentSystem === "Buy") {
      effectiveChangeType = "Revision";
    }
  }

  const last = await client
    .from("changeOrderAffectedItem")
    .select("sortOrder")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last.data?.sortOrder ?? -1) + 1;

  const inserted = await client
    .from("changeOrderAffectedItem")
    .insert({
      changeOrderId: changeNoticeId,
      itemId,
      changeType: effectiveChangeType,
      sortOrder,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return { data: null, error: inserted.error };
  }
  const affectedItemId = inserted.data.id;

  const draft = await createChangeNoticeDraftMethod(client, db, {
    changeNoticeId,
    itemId,
    changeType: effectiveChangeType,
    revision,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    await client
      .from("changeOrderAffectedItem")
      .delete()
      .eq("id", affectedItemId)
      .eq("companyId", companyId);
    return { data: null, error: draft.error };
  }

  await client
    .from("changeOrderAffectedItem")
    .update({
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", affectedItemId)
    .eq("companyId", companyId);

  return {
    data: {
      id: affectedItemId,
      draftMakeMethodId: draft.data.draftMakeMethodId
    },
    error: null
  };
}

// Switch an affected item's change type: discard its current draft and rebuild
// for the new type (Q2 — the editable surface differs per type, so edits reset).
export async function updateChangeNoticeAffectedItemChangeType(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    id: string;
    changeType: ChangeNoticeChangeType;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: ChangeNoticeError | null }> {
  const { id, changeType, companyId, userId } = input;

  const affected = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, changeOrderId, itemId, changeType, draftMakeMethodId, newItemId"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (affected.error || !affected.data) {
    return { data: null, error: { message: "Affected item not found" } };
  }
  // A New Part is net-new by construction — it cannot be switched to another type,
  // nor can an existing-part change become net-new. Reject both directions.
  if (changeType === "New Part" || affected.data.changeType === "New Part") {
    return {
      data: null,
      error: { message: "New Part change type cannot be switched" }
    };
  }
  if (affected.data.changeType === changeType) {
    return { data: { id }, error: null };
  }

  // The current Draft is deleted at the end, which takes parts_delete. Refuse
  // now rather than after the swap, when the old draft could only be orphaned.
  const canDiscard = await requireCompanyPermission(
    client,
    companyId,
    "parts_delete"
  );
  if (canDiscard.error) return { data: null, error: canDiscard.error };

  // Create the replacement Draft BEFORE destroying the current one, so a failure
  // in creation or the ref swap leaves the affected row still pointing at a valid
  // (undeleted) draft instead of a dangling reference. The old draft is discarded
  // only after the swap succeeds (worst case on a late failure is an orphaned
  // draft, never a dangling ref). Capture the old refs first.
  const previousDraft = {
    draftMakeMethodId: affected.data.draftMakeMethodId,
    newItemId: affected.data.newItemId
  };

  const draft = await createChangeNoticeDraftMethod(client, db, {
    changeNoticeId: affected.data.changeOrderId,
    itemId: affected.data.itemId,
    changeType,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    return { data: null, error: draft.error };
  }

  const updated = await client
    .from("changeOrderAffectedItem")
    .update({
      changeType,
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", id)
    .eq("companyId", companyId);
  if (updated.error) return { data: null, error: updated.error };

  // Swap succeeded — now safe to discard the superseded draft. The type has
  // changed either way; a draft that could not be removed is reported.
  const discarded = await discardChangeNoticeDrafts(
    client,
    db,
    [previousDraft],
    companyId
  );
  if (discarded.error) return { data: null, error: discarded.error };
  return { data: { id }, error: null };
}

// Update the per-item revision cutover config (mode + dates). The existence of
// the oldRev→newRev supersession is automatic at release; this only tunes it.
export async function updateChangeNoticeAffectedItemCutover(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    discontinuationDate?: string;
    successorEffectivityDate?: string;
    userId: string;
  }
) {
  const { id, userId, ...rest } = input;
  return client
    .from("changeOrderAffectedItem")
    .update({
      ...sanitize(rest),
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .select("id")
    .single();
}

// =============================================================================
// Affected-item + supersession reads/writes (label-stitched). Flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget).
// =============================================================================

// The minimal item label rendered next to each affected item / supersession.
export type ChangeNoticeStagingItemLabel = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

type ChangeNoticeAffectedItemRow =
  Database["public"]["Tables"]["changeOrderAffectedItem"]["Row"];

export type ChangeNoticeAffectedItemWithLabel = ChangeNoticeAffectedItemRow & {
  item: ChangeNoticeStagingItemLabel | null;
};

const ITEM_LABEL_COLUMNS =
  "id, readableId, readableIdWithRevision, name, type, active, revisionStatus, replenishmentSystem";

// Fetch minimal item labels for a set of ids, indexed by item id.
async function stitchItemLabels(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  labels: Map<string, ChangeNoticeStagingItemLabel>;
  error: { message: string } | null;
}> {
  const uniqueIds = [...new Set(itemIds)];
  const labels = new Map<string, ChangeNoticeStagingItemLabel>();
  if (uniqueIds.length === 0) return { labels, error: null };

  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", uniqueIds)
    .eq("companyId", companyId);

  if (items.error) return { labels, error: items.error };
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeNoticeStagingItemLabel);

  return { labels, error: null };
}

// The affected items of a CO, each stitched to a minimal item label.
export async function getChangeNoticeAffectedItems(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
): Promise<{
  data: ChangeNoticeAffectedItemWithLabel[];
  error: { message: string } | null;
}> {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("*")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (affected.error) return { data: [], error: affected.error };
  const rows = affected.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const { labels, error } = await stitchItemLabels(
    client,
    rows.map((r) => r.itemId),
    companyId
  );
  if (error) return { data: [], error };

  return {
    data: rows.map((r) => ({ ...r, item: labels.get(r.itemId) ?? null })),
    error: null
  };
}

// Remove an affected item + discard its CO-owned Draft (delete the new item for
// Revision/New Part, or the Draft method for Version) so no orphan draft leaks.
export async function removeChangeNoticeAffectedItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  id: string,
  companyId: string
) {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (affected.error) return { data: null, error: affected.error };
  if (affected.data) {
    // The affected row is the only pointer at its draft, so it stays until the
    // draft is gone.
    const discarded = await discardChangeNoticeDrafts(
      client,
      db,
      [affected.data],
      companyId
    );
    if (discarded.error) return { data: null, error: discarded.error };
  }
  return client
    .from("changeOrderAffectedItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// =============================================================================
// Change Notices — item traceability reads (part/tool ↔ CO) and the linked-NCR
// reverse view. Kept as its own section of items.service.ts to keep each area
// focused and under the module's 1000-line budget (G4).
// =============================================================================

// G6 — the SINGLE canonical "change notices referencing this item" query,
// parameterized by status. The item-detail history (all COs), the open-CO alert
// (open statuses), and the single-open-CO guard all call this — no forked
// implementations. Spans every way a CO references an item in the top-to-bottom
// model: an affected item the user selected to change, a staged BOM component,
// a manual supersession (predecessor or successor), and the reverse link from a
// released revision (`item.changeOrderId`). Scoped by readableId so it matches
// the part across all its revisions. Flat queries + JS union (no embeds —
// TS2589 budget).
export type ChangeNoticeForItem = {
  id: string;
  changeOrderId: string;
  name: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
  changeOrderTypeId: string | null;
  createdAt: string;
};

/**
 * Every change notice that touches an item or any other revision of it: as an
 * affected item, as a component on a notice's draft method, as either side of
 * a supersession, or as the revision a notice created. One request
 * (`get_item_change_notices`); it was eight in five steps, awaited by every
 * item page.
 */
export async function findChangeNoticesForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    statuses?: Database["public"]["Enums"]["changeOrderStatus"][];
  }
): Promise<{ data: ChangeNoticeForItem[]; error: { message: string } | null }> {
  const result = await client.rpc("get_item_change_notices", {
    item_id: args.itemId,
    company_id: args.companyId,
    ...(args.statuses && args.statuses.length > 0
      ? { statuses: args.statuses }
      : {})
  });
  if (result.error) return { data: [], error: result.error };
  return { data: result.data ?? [], error: null };
}

// Reverse of the Linked-NCR cross-link (4a): every change notice that references
// a given non-conformance. Read-only, minimal columns; rendered on the Issue
// detail. Flat select (no embeds — TS2589 budget).
export async function getChangeNoticesForNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("id, changeOrderId, name, status")
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

// =============================================================================
// Change Notices — Actions (freeform tasks; reuse changeOrderActionTask). Any
// user, any stage; non-gating. Kept as its own section of items.service.ts to
// keep each area focused and under the module's 1000-line budget (G4).
// =============================================================================
export async function getChangeNoticeActions(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
) {
  const result = await client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (result.error || !result.data) {
    return result;
  }

  const taskIds = result.data.map((t) => t.id);
  let linearMappings: Map<string, unknown> = new Map();
  let jiraMappings: Map<string, unknown> = new Map();

  if (taskIds.length > 0) {
    const [{ data: linearData }, { data: jiraData }] = await Promise.all([
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "changeOrderActionTask")
        .eq("integration", "linear")
        .eq("companyId", companyId)
        .in("entityId", taskIds),
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "changeOrderActionTask")
        .eq("integration", "jira")
        .eq("companyId", companyId)
        .in("entityId", taskIds)
    ]);

    linearMappings = new Map(
      (linearData ?? []).map((m) => [m.entityId, m.metadata])
    );
    jiraMappings = new Map(
      (jiraData ?? []).map((m) => [m.entityId, m.metadata])
    );
  }

  return {
    ...result,
    data: result.data.map((task) => ({
      ...task,
      linearIssue: linearMappings.get(task.id) ?? null,
      jiraIssue: jiraMappings.get(task.id) ?? null
    }))
  };
}

export async function updateChangeNoticeActionStatus(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    companyId: string;
    status: (typeof changeNoticeTaskStatus)[number];
    userId: string;
  }
) {
  const completedDate =
    input.status === "Completed"
      ? datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString()
      : null;
  return client
    .from("changeOrderActionTask")
    .update({
      status: input.status,
      completedDate,
      updatedBy: input.userId
    })
    .eq("id", input.id)
    .eq("companyId", input.companyId)
    .select("id")
    .single();
}

export async function deleteChangeNoticeAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderActionTask").delete().eq("id", id);
}

export async function updateChangeNoticeActionOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  changeNoticeId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "changeOrderActionTask",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "changeOrderId", id: changeNoticeId },
    updates
  });
}

// =============================================================================
// Change Notice Required Actions (the configurable default-action templates the
// config CRUD page manages, and the source new change notices are seeded from).
// =============================================================================
export async function getChangeNoticeRequiredActions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderRequiredAction")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeNoticeRequiredActionsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function upsertChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    name: string;
    active: boolean;
    companyId: string;
    userId: string;
  }
) {
  if (input.id) {
    return client
      .from("changeOrderRequiredAction")
      .update({
        name: input.name,
        active: input.active,
        updatedBy: input.userId
      })
      .eq("id", input.id)
      .eq("companyId", input.companyId)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderRequiredAction")
    .insert({
      name: input.name,
      active: input.active,
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
}

export async function deleteChangeNoticeRequiredAction(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// Reconcile a change notice's action tasks to a chosen set of required-action
// templates — the sidebar's editable "Required Actions" multiselect (mirrors
// Quality's requiredActionIds field). Templates newly selected are instantiated
// (appended); templates deselected have their task removed. Tasks with no
// template link (actionTypeId IS NULL) are left untouched.
export async function setChangeNoticeActionTasks(
  client: SupabaseClient<Database>,
  input: {
    changeNoticeId: string;
    requiredActionIds: string[];
    companyId: string;
    userId: string;
  }
) {
  const existing = await client
    .from("changeOrderActionTask")
    .select("id, actionTypeId, sortOrder")
    .eq("changeOrderId", input.changeNoticeId)
    .eq("companyId", input.companyId);
  if (existing.error) return existing;

  const rows = existing.data ?? [];
  const desired = new Set(input.requiredActionIds);
  const linked = new Set(
    rows.map((r) => r.actionTypeId).filter((id): id is string => Boolean(id))
  );

  const toRemove = rows
    .filter((r) => r.actionTypeId && !desired.has(r.actionTypeId))
    .map((r) => r.id);
  if (toRemove.length > 0) {
    const del = await client
      .from("changeOrderActionTask")
      .delete()
      .in("id", toRemove);
    if (del.error) return del;
  }

  const toAddIds = input.requiredActionIds.filter((id) => !linked.has(id));
  if (toAddIds.length > 0) {
    const templates = await client
      .from("changeOrderRequiredAction")
      .select("id, name")
      .in("id", toAddIds)
      .eq("companyId", input.companyId);
    if (templates.error) return templates;

    const base = rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);
    const ins = await client.from("changeOrderActionTask").insert(
      (templates.data ?? []).map((template, index) => ({
        changeOrderId: input.changeNoticeId,
        actionTypeId: template.id,
        name: template.name,
        status: "Pending" as const,
        sortOrder: base + index + 1,
        companyId: input.companyId,
        createdBy: input.userId
      }))
    );
    if (ins.error) return ins;
  }

  return { data: null, error: null };
}

// =============================================================================
// Change Notices — the reusable method-diff engine (Q5 git-style end-state).
//
// `diffMethod` is a PURE function (no DB access, unit-testable): it compares two
// method snapshots (a `base` = the current live method, a `target` = the CO's
// staged desired end-state) and classifies every material / operation as
// added / removed / modified / unchanged, plus a column-by-column attribute diff.
// The same shape is reused for the pre-release "tips" (staged-vs-live) and the
// post-release oldRev↔newRev redline (Task 17).
//
// `getChangeNoticeDiff` is the DB-facing wrapper: for each affected item it reads
// the current source method live + the staged rows, runs `diffMethod`, and also
// returns the manual supersession declarations. Reads are flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget; see lessons).
// =============================================================================

// A plain record — DB rows are passed straight through; the engine is generic
// over the shape and only reads the compared field subset + the identity keys.
type Row = Record<string, unknown>;

// Materials are matched by identity: a staged/target row's `sourceMaterialId`
// links it to a base row's `id`. Operations use `sourceOperationId`. Operation
// CHILDREN (steps / parameters / tools) use `sourceId` (the staged child's
// pointer at the live child it was copied from; NULL ⇒ added child line).
const MATERIAL_SOURCE_KEY = "sourceMaterialId";
const OPERATION_SOURCE_KEY = "sourceOperationId";
const CHILD_SOURCE_KEY = "sourceId";

// Never compared — audit / linkage / tenancy columns. The compared set for every
// staged entity is derived as (staged row keys − this set), so adding a mirrored
// business column to a staged table automatically includes it in the diff; only
// genuine noise columns need listing here.
const IGNORED_FIELDS = new Set<string>([
  "id",
  "companyId",
  "changeOrderId",
  "affectedItemId",
  "sourceMaterialId",
  "sourceOperationId",
  "sourceId",
  "stagedOperationId",
  // v2: base and draft rows live on different real methods/operations, so these
  // linkage columns always differ and must never count as a business change.
  "makeMethodId",
  "operationId",
  // The customFields JSON bag differs as a copy artifact (null vs {}), surfacing
  // a meaningless "— → Set" on unrelated edits — never diff it as a whole column.
  "customFields",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

// Loose equality tolerant of the numeric-string ↔ number skew that Supabase
// returns for NUMERIC columns (a live `quantity` may be `"1"` while a staged one
// is `1`). null and undefined are the same "empty" value. JSON/array columns
// (workInstruction, step description, listValues/fileTypes) are separate object
// instances on the live vs staged side, so they're compared structurally — a
// reference check would report every non-null one as changed.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// The business columns to compare for a matched (base, target) pair: every key
// the CO actually STAGED (the target row), minus the audit/linkage/tenancy set.
// Deriving from the staged row — not a hand-maintained per-entity list, and not
// the union with the live row — is what keeps the diff in lockstep with the
// mirrored schema: staging copies exactly the changeable columns, live rows carry
// extra columns (makeMethodId, …) that must NOT be compared against `undefined`.
function comparedFields(target: Row): string[] {
  return Object.keys(target).filter((k) => !IGNORED_FIELDS.has(k));
}

// Build the field-level change map for a matched (base, target) pair. Returns
// undefined when nothing changed.
function diffFields(
  base: Row,
  target: Row
): Record<string, { before: unknown; after: unknown }> | undefined {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of comparedFields(target)) {
    if (!valuesEqual(base[field], target[field])) {
      changed[field] = {
        before: base[field] ?? null,
        after: target[field] ?? null
      };
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

// Match target rows to base rows by the given source-pointer key, then classify.
//   - base row with no target pointing at it            ⇒ removed
//   - target row with a null/absent source pointer      ⇒ added
//   - target whose source pointer references a base row  ⇒ modified | unchanged
function diffRows(
  base: Row[],
  target: Row[],
  sourceKey: string
): MethodDiffEntry<Row>[] {
  const entries: MethodDiffEntry<Row>[] = [];

  // Index base rows by their id for O(1) lookup, and track which get matched.
  const baseById = new Map<string, Row>();
  for (const row of base) {
    const id = row.id;
    if (typeof id === "string") baseById.set(id, row);
  }
  const matchedBaseIds = new Set<string>();

  for (const targetRow of target) {
    const sourceId = targetRow[sourceKey];
    const baseRow =
      typeof sourceId === "string" ? baseById.get(sourceId) : undefined;

    if (!baseRow) {
      // No live counterpart — a newly-added line.
      entries.push({ status: "added", before: null, after: targetRow });
      continue;
    }

    matchedBaseIds.add(baseRow.id as string);
    const changedFields = diffFields(baseRow, targetRow);
    const status: MethodDiffStatus = changedFields ? "modified" : "unchanged";
    entries.push({
      status,
      before: baseRow,
      after: targetRow,
      ...(changedFields ? { changedFields } : {})
    });
  }

  // Any base row nothing pointed at was dropped from the staged end-state.
  for (const baseRow of base) {
    const id = baseRow.id;
    if (typeof id === "string" && !matchedBaseIds.has(id)) {
      entries.push({ status: "removed", before: baseRow, after: null });
    }
  }

  return entries;
}

// -----------------------------------------------------------------------------
// Operation children (steps / parameters / tools)
// -----------------------------------------------------------------------------

// The three staged child buckets for a single operation, keyed by the staged
// operation's id. Both the live (base) children and the staged (target) children
// share this shape.
export type OperationChildren = {
  steps: Row[];
  parameters: Row[];
  tools: Row[];
};

// OperationChildrenDiff and OperationDiffEntry now live in items.models
// (imported + re-exported above) so ChangeNoticeItemDiff can reference them
// without a circular import. Their shape is unchanged (Row = Record<string,
// unknown>, the same as MethodDiffEntry's generic here).

// Base/target children keyed by operation id. For target (staged) operations the
// key is the staged operation's own id; for base (live) operations it's the live
// operation's id. Matching a staged operation to its base children goes through
// the operation's `sourceOperationId`.
export type ChildrenByOperationId = Record<string, OperationChildren>;

function emptyChildren(): OperationChildren {
  return { steps: [], parameters: [], tools: [] };
}

// Diff one operation's children. `base`/`target` are the live/staged child
// buckets; each bucket is matched by `sourceId` over its own compare-field set.
function diffOperationChildren(
  base: OperationChildren,
  target: OperationChildren
): OperationChildrenDiff {
  return {
    steps: diffRows(base.steps, target.steps, CHILD_SOURCE_KEY),
    parameters: diffRows(base.parameters, target.parameters, CHILD_SOURCE_KEY),
    tools: diffRows(base.tools, target.tools, CHILD_SOURCE_KEY)
  };
}

// Diff operations AND, when child buckets are supplied, attach a per-operation
// child diff. Matches operations exactly like diffRows (by `sourceOperationId`);
// for each entry it pairs the base children (via the matched base operation id)
// with the target children (via the staged operation id) and runs
// `diffOperationChildren`. When no child maps are supplied it degrades to the
// plain operation diff (identical to `diffRows`), so existing callers/tests are
// unaffected.
function diffOperations(
  base: Row[],
  target: Row[],
  baseChildren?: ChildrenByOperationId,
  targetChildren?: ChildrenByOperationId
): OperationDiffEntry[] {
  const entries = diffRows(
    base,
    target,
    OPERATION_SOURCE_KEY
  ) as OperationDiffEntry[];

  if (!baseChildren && !targetChildren) return entries;

  for (const entry of entries) {
    const baseId = (entry.before as { id?: string } | null)?.id;
    const targetId = (entry.after as { id?: string } | null)?.id;
    const baseKids = (baseId && baseChildren?.[baseId]) || emptyChildren();
    const targetKids =
      (targetId && targetChildren?.[targetId]) || emptyChildren();
    entry.children = diffOperationChildren(baseKids, targetKids);
  }

  return entries;
}

// Column-by-column diff of two attribute objects. Every key present in either
// object (minus the ignored audit/linkage set) is compared; each changed column
// becomes one MethodDiffEntry whose `changedFields` holds the single field. When
// nothing changed a single "unchanged" entry is returned so callers can render
// "no attribute changes" uniformly.
function diffAttributes(
  base: Row | null,
  target: Row | null
): MethodDiffEntry<Row>[] {
  const b = base ?? {};
  const t = target ?? {};
  // Net-new item (a New Part has no predecessor): surface every attribute as an
  // addition — the whole item is new — mirroring how a BOM/BOP with no base
  // method renders all of its rows as `added`. The viewer draws the full property
  // list in green rather than per-field old→new pairs.
  if (!base && target) {
    return [{ status: "added", before: null, after: target }];
  }
  // Compare only the columns the CO staged (target), minus audit/linkage — the
  // live source select carries extra columns (e.g. modelUploadId) the staged row
  // doesn't mirror, and comparing those against `undefined` would be spurious.
  const keys = target ? comparedFields(target) : [];

  const entries: MethodDiffEntry<Row>[] = [];
  for (const key of keys) {
    if (valuesEqual(b[key], t[key])) continue;
    entries.push({
      status: "modified",
      before: base,
      after: target,
      changedFields: {
        [key]: { before: b[key] ?? null, after: t[key] ?? null }
      }
    });
  }

  if (entries.length === 0) {
    return [{ status: "unchanged", before: base, after: target }];
  }
  return entries;
}

// Supplier parts of a draft item against the item it was drafted from. A
// Revision draft starts with a copy of the source revision's supplier parts
// (createRevision), so only what the user changed on the CO line shows: a
// supplier has at most one supplier part per item, so the supplier pairs the
// two sides. A Replacement Part or New Part draft starts with none — a null
// base — and every supplier part is an addition.
function diffSupplierParts(
  base: Row[] | null,
  target: Row[]
): MethodDiffEntry<Row>[] {
  // The two sides are different items by construction; that is not a change.
  const withoutItem = ({ itemId: _itemId, ...row }: Row): Row => row;
  const baseRows = (base ?? []).map(withoutItem);
  const targetRows = target.map(withoutItem);
  correlate(baseRows, targetRows, "supplierId", CHILD_SOURCE_KEY);
  return diffRows(baseRows, targetRows, CHILD_SOURCE_KEY);
}

// -----------------------------------------------------------------------------
// The pure diff engine
// -----------------------------------------------------------------------------

export type DiffMethodInput = {
  baseMaterials: Row[];
  targetMaterials: Row[];
  baseOperations: Row[];
  targetOperations: Row[];
  baseAttributes?: Row | null;
  targetAttributes?: Row | null;
  // Optional per-operation children (steps/parameters/tools), keyed by operation
  // id (live op id for base, staged op id for target). When omitted, operation
  // entries carry no `children` and the result is identical to the pre-Task-16
  // shape.
  baseOperationChildren?: ChildrenByOperationId;
  targetOperationChildren?: ChildrenByOperationId;
  // Optional supplier parts of the draft item (target) and of the item it was
  // drafted from (base). A null/omitted base means the draft started with none,
  // so every target supplier part is an addition.
  baseSupplierParts?: Row[] | null;
  targetSupplierParts?: Row[];
};

export type DiffMethodResult = {
  materials: MethodDiffEntry<Row>[];
  // Operations may carry an optional child-level diff (see OperationDiffEntry).
  // OperationDiffEntry is a superset of MethodDiffEntry<Row>, so consumers typed
  // against MethodDiffEntry<Row>[] keep working.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Row>[];
  supplierParts: MethodDiffEntry<Row>[];
};

// PURE. Compares two method snapshots. No DB access — the caller supplies plain
// rows (live method rows as `base`, CO-staged rows as `target`), and optionally
// the per-operation child buckets to also diff steps/parameters/tools, and the
// two items' supplier parts.
export function diffMethod(input: DiffMethodInput): DiffMethodResult {
  return {
    materials: diffRows(
      input.baseMaterials,
      input.targetMaterials,
      MATERIAL_SOURCE_KEY
    ),
    operations: diffOperations(
      input.baseOperations,
      input.targetOperations,
      input.baseOperationChildren,
      input.targetOperationChildren
    ),
    attributes: diffAttributes(
      input.baseAttributes ?? null,
      input.targetAttributes ?? null
    ),
    supplierParts: diffSupplierParts(
      input.baseSupplierParts ?? null,
      input.targetSupplierParts ?? []
    )
  };
}

// -----------------------------------------------------------------------------
// DB-facing wrapper
// -----------------------------------------------------------------------------

export type ChangeNoticeDiff = {
  items: ChangeNoticeItemDiff[];
};

// Editable item attribute columns compared for the attribute diff. `mpn` lives on
// item; the item group (itemPostingGroupId) lives on itemCost and is merged in
// separately by readItemAttributes. `active` is intentionally excluded — a CO
// draft is created inactive until release, so it always differs (not a real edit).
const ITEM_ATTRIBUTE_COLUMNS =
  "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, thumbnailPath, mpn";

// Read one make method's materials + operations + per-operation children (real
// method tables — the v2 substrate). Empty for a null makeMethodId (e.g. a Buy
// item with no method, or before a draft exists).
async function readMethodRows(
  client: SupabaseClient<Database>,
  makeMethodId: string | null,
  companyId: string
): Promise<{
  materials: Row[];
  operations: Row[];
  children: ChildrenByOperationId;
  error: { message: string } | null;
}> {
  const empty = { materials: [], operations: [], children: {}, error: null };
  if (!makeMethodId) return empty;

  const [materials, operations] = await Promise.all([
    client
      .from("methodMaterial")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true }),
    client
      .from("methodOperation")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true })
  ]);
  if (materials.error) return { ...empty, error: materials.error };
  if (operations.error) return { ...empty, error: operations.error };

  const ops = (operations.data ?? []) as Row[];
  const children: ChildrenByOperationId = {};
  const opIds = ops
    .map((o) => o.id)
    .filter((id): id is string => typeof id === "string");

  if (opIds.length > 0) {
    const [steps, parameters, tools] = await Promise.all([
      client
        .from("methodOperationStep")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationParameter")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationTool")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId)
    ]);
    if (steps.error) return { ...empty, error: steps.error };
    if (parameters.error) return { ...empty, error: parameters.error };
    if (tools.error) return { ...empty, error: tools.error };

    for (const id of opIds)
      children[id] = { steps: [], parameters: [], tools: [] };
    for (const r of (steps.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.steps.push(r);
    }
    for (const r of (parameters.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.parameters.push(r);
    }
    for (const r of (tools.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.tools.push(r);
    }
  }

  return {
    materials: (materials.data ?? []) as Row[],
    operations: ops,
    children,
    error: null
  };
}

// The v2 draft method is created by copying the base method, so it initially
// mirrors the base 1:1 with NO back-pointer ids. We reconstruct the source
// pointers the pure engine expects by matching each target row to a base row on
// a natural key (materials → component itemId, operations → order, children →
// name/key/toolId), first-unmatched-wins. An unmatched target row is an add; an
// unmatched base row is a remove.
function correlate(
  base: Row[],
  target: Row[],
  keyField: string,
  sourceKey: string
): void {
  const usedBaseIds = new Set<string>();
  for (const t of target) {
    const key = t[keyField];
    const match = base.find(
      (b) =>
        b[keyField] === key &&
        typeof b.id === "string" &&
        !usedBaseIds.has(b.id)
    );
    if (match && typeof match.id === "string") {
      usedBaseIds.add(match.id);
      t[sourceKey] = match.id;
    } else {
      t[sourceKey] = null;
    }
  }
}

async function readItemAttributes(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<Row | null> {
  const [item, cost] = await Promise.all([
    client
      .from("item")
      .select(ITEM_ATTRIBUTE_COLUMNS)
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
    // The item group lives on itemCost, not item — merge it in so it diffs too.
    client
      .from("itemCost")
      .select("itemPostingGroupId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (!item.data) return null;
  return {
    ...(item.data as Row),
    itemPostingGroupId: cost.data?.itemPostingGroupId ?? null
  };
}

// One item's supplier parts for the diff. Mirrors getSupplierParts
// (items.service) — active rows for the item.
async function readSupplierPartRows(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const res = await client
    .from("supplierPart")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true);
  if (res.error) return { data: [], error: res.error };
  return { data: (res.data ?? []) as Row[], error: null };
}

// Resolve item-group ids → their names for readable diff display.
async function readPostingGroupNames(
  client: SupabaseClient<Database>,
  ids: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const groups = await client
    .from("itemPostingGroup")
    .select("id, name")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const g of groups.data ?? []) {
    if (g.id && g.name) map.set(g.id, g.name);
  }
  return map;
}

// Resolve component item UUIDs → human-readable ids (e.g. `P000123.A`). The diff
// viewer labels each BOM line by its component; a `methodMaterial` row carries only
// the item UUID, and the client `useItems` store can miss a just-minted/placeholder
// component. Resolving here (server-side, guaranteed present) makes the label
// store-independent. Flat select scoped by companyId.
async function readItemReadableIds(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(itemIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const items = await client
    .from("item")
    .select("id, readableIdWithRevision")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const row of items.data ?? []) {
    if (row.id && row.readableIdWithRevision)
      map.set(row.id, row.readableIdWithRevision);
  }
  return map;
}

// Stamp the resolved readable id onto each material diff row (before + after) under
// `itemReadableId`, so the read-only viewer can label the line without a store
// lookup. Applied AFTER diffMethod so it never counts as a business-field change.
function stampMaterialReadableIds(
  materials: MethodDiffEntry<Row>[],
  readableIds: Map<string, string>
): void {
  for (const entry of materials) {
    for (const row of [entry.before, entry.after]) {
      const itemId = (row as { itemId?: string } | null)?.itemId;
      if (row && typeof itemId === "string") {
        const readable = readableIds.get(itemId);
        if (readable) (row as Row).itemReadableId = readable;
      }
    }
  }
}

// A methodOperationTool row references a Tool item by `toolId` (a UUID). Stamp the
// resolved readable id onto each tool child row (before + after) under
// `toolReadableId` so the viewer labels the tool by its readable id, not the UUID.
function stampToolReadableIds(
  operations: OperationDiffEntry[],
  readableIds: Map<string, string>
): void {
  for (const op of operations) {
    for (const entry of op.children?.tools ?? []) {
      for (const row of [entry.before, entry.after]) {
        const toolId = (row as { toolId?: string } | null)?.toolId;
        if (row && typeof toolId === "string") {
          const readable = readableIds.get(toolId);
          if (readable) (row as Row).toolReadableId = readable;
        }
      }
    }
  }
}

// Operation rows reference a process / work center / procedure / supplier process
// by UUID. Resolve those to human names and rewrite them IN PLACE — both the
// changedFields (old→new) and the before/after rows (add/remove property lists) —
// so the diff and merge UIs read "CNC Milling", not a raw id. Display-only, applied
// AFTER diffMethod (so it never counts as a business-field change); the release
// apply re-reads rows by id, so mutating these display rows is safe.
const OPERATION_REF_FIELDS = [
  "processId",
  "workCenterId",
  "procedureId",
  "operationSupplierProcessId",
  "assemblyInstructionId",
  "inspectionDocumentId"
] as const;
const OPERATION_REF_FIELD_SET = new Set<string>(OPERATION_REF_FIELDS);

async function stampOperationRefNames(
  client: SupabaseClient<Database>,
  operations: OperationDiffEntry[],
  companyId: string
): Promise<void> {
  // Gather every referenced id per field, from both the rows and changedFields.
  const collected: Record<string, Set<string>> = {
    processId: new Set(),
    workCenterId: new Set(),
    procedureId: new Set(),
    operationSupplierProcessId: new Set(),
    assemblyInstructionId: new Set(),
    inspectionDocumentId: new Set()
  };
  const addFrom = (row: Row | null) => {
    if (!row) return;
    for (const f of OPERATION_REF_FIELDS) {
      const v = row[f];
      if (typeof v === "string" && v) collected[f].add(v);
    }
  };
  for (const op of operations) {
    addFrom(op.before as Row | null);
    addFrom(op.after as Row | null);
    for (const [f, cf] of Object.entries(op.changedFields ?? {})) {
      if (!OPERATION_REF_FIELD_SET.has(f)) continue;
      if (typeof cf.before === "string" && cf.before)
        collected[f].add(cf.before);
      if (typeof cf.after === "string" && cf.after) collected[f].add(cf.after);
    }
  }

  const names = new Map<string, string>(); // id → display name (any ref type)
  const load = async (
    table: "process" | "workCenter" | "procedure" | "assemblyInstruction",
    ids: Set<string>
  ) => {
    const unique = [...ids];
    if (unique.length === 0) return;
    const rows = await client
      .from(table)
      .select("id, name")
      .in("id", unique)
      .eq("companyId", companyId);
    for (const r of rows.data ?? []) {
      if (r.id && r.name) names.set(r.id, r.name);
    }
  };

  // A supplier process has no name of its own — resolve it to its process name
  // (its underlying process ids join the process lookup below).
  const supplierProcessIds = [...collected.operationSupplierProcessId];
  const supplierProcessToProcess = new Map<string, string>();
  if (supplierProcessIds.length > 0) {
    const sp = await client
      .from("supplierProcess")
      .select("id, processId")
      .in("id", supplierProcessIds)
      .eq("companyId", companyId);
    for (const r of sp.data ?? []) {
      if (r.id && r.processId) {
        supplierProcessToProcess.set(r.id, r.processId);
        collected.processId.add(r.processId);
      }
    }
  }

  await Promise.all([
    load("process", collected.processId),
    load("workCenter", collected.workCenterId),
    load("procedure", collected.procedureId),
    load("assemblyInstruction", collected.assemblyInstructionId)
  ]);

  // Inspection documents have no "name" column — label them by drawing/file name.
  const inspectionDocumentIds = [...collected.inspectionDocumentId];
  if (inspectionDocumentIds.length > 0) {
    const docs = await client
      .from("inspectionDocument")
      .select("id, drawingNumber, fileName")
      .in("id", inspectionDocumentIds)
      .eq("companyId", companyId);
    for (const d of docs.data ?? []) {
      if (d.id) names.set(d.id, d.drawingNumber || d.fileName || d.id);
    }
  }

  for (const [spId, processId] of supplierProcessToProcess) {
    const name = names.get(processId);
    if (name) names.set(spId, name);
  }

  const rewrite = (row: Row | null) => {
    if (!row) return;
    for (const f of OPERATION_REF_FIELDS) {
      const v = row[f];
      if (typeof v === "string" && names.has(v)) row[f] = names.get(v);
    }
  };
  for (const op of operations) {
    rewrite(op.before as Row | null);
    rewrite(op.after as Row | null);
    for (const [f, cf] of Object.entries(op.changedFields ?? {})) {
      if (!OPERATION_REF_FIELD_SET.has(f)) continue;
      if (typeof cf.before === "string" && names.has(cf.before))
        cf.before = names.get(cf.before);
      if (typeof cf.after === "string" && names.has(cf.after))
        cf.after = names.get(cf.after);
    }
  }
}

// For every affected item: read the base (source Active) method as `base` and the
// CO-owned Draft method as `target` (both REAL method tables), correlate by
// natural keys, run the pure `diffMethod`, and collect. Also returns the manual
// supersession declarations. Flat selects scoped by companyId (no embeds).
export async function getChangeNoticeDiff(
  client: SupabaseClient<Database>,
  changeNoticeId: string,
  companyId: string
): Promise<{ data: ChangeNoticeDiff; error: { message: string } | null }> {
  const affected = await getChangeNoticeAffectedItems(
    client,
    changeNoticeId,
    companyId
  );
  if (affected.error) return { data: { items: [] }, error: affected.error };

  const items: ChangeNoticeItemDiff[] = [];

  for (const affectedItem of affected.data) {
    const base = await readMethodRows(
      client,
      affectedItem.baseMakeMethodId,
      companyId
    );
    if (base.error) return { data: { items: [] }, error: base.error };
    const target = await readMethodRows(
      client,
      affectedItem.draftMakeMethodId,
      companyId
    );
    if (target.error) return { data: { items: [] }, error: target.error };

    // Reconstruct source pointers by natural key.
    correlate(base.materials, target.materials, "itemId", MATERIAL_SOURCE_KEY);
    correlate(
      base.operations,
      target.operations,
      "order",
      OPERATION_SOURCE_KEY
    );
    for (const top of target.operations) {
      const baseOpId = top[OPERATION_SOURCE_KEY];
      const topId = top.id;
      if (typeof baseOpId !== "string" || typeof topId !== "string") continue;
      const bKids = base.children[baseOpId];
      const tKids = target.children[topId];
      if (!bKids || !tKids) continue;
      correlate(bKids.steps, tKids.steps, "name", CHILD_SOURCE_KEY);
      correlate(bKids.parameters, tKids.parameters, "key", CHILD_SOURCE_KEY);
      correlate(bKids.tools, tKids.tools, "toolId", CHILD_SOURCE_KEY);
    }

    // A New Part is net-new: no predecessor item, so `newItemId === itemId`.
    // Its whole attribute set + supplier parts are additions, not old→new edits.
    const isNewPart = affectedItem.changeType === "New Part";

    // Attribute diff: base = source item columns; target = the draft item's
    // columns. For a Version the draft is on the same item, so there is no
    // attribute change (Q2) and both sides read the same row. For a New Part
    // there is no predecessor, so we pass a null base to surface every attribute
    // as an addition (see diffAttributes).
    const draftItemId = affectedItem.newItemId ?? affectedItem.itemId;
    const baseAttributes = await readItemAttributes(
      client,
      affectedItem.itemId,
      companyId
    );
    const targetAttributes =
      draftItemId === affectedItem.itemId
        ? baseAttributes
        : await readItemAttributes(client, draftItemId, companyId);

    // Supplier parts on the draft item (Revision/Replacement Part/New Part; a
    // Version shares the live item's suppliers, which are not a CO change). A
    // Revision is diffed against the source revision it was copied from; the
    // other two start with none, so theirs are all additions. A New Part's
    // draft item IS its own item (draftItemId === itemId), so gate on the
    // change type too.
    let draftSupplierParts: Row[] = [];
    let sourceSupplierParts: Row[] | null = null;
    if (draftItemId !== affectedItem.itemId || isNewPart) {
      const draftParts = await readSupplierPartRows(
        client,
        draftItemId,
        companyId
      );
      if (draftParts.error) {
        return { data: { items: [] }, error: draftParts.error };
      }
      draftSupplierParts = draftParts.data;
      if (affectedItem.changeType === "Revision") {
        const sourceParts = await readSupplierPartRows(
          client,
          affectedItem.itemId,
          companyId
        );
        if (sourceParts.error) {
          return { data: { items: [] }, error: sourceParts.error };
        }
        sourceSupplierParts = sourceParts.data;
      }
    }

    const diff = diffMethod({
      baseMaterials: base.materials,
      targetMaterials: target.materials,
      baseOperations: base.operations,
      targetOperations: target.operations,
      baseAttributes: isNewPart ? null : baseAttributes,
      targetAttributes,
      baseOperationChildren: base.children,
      targetOperationChildren: target.children,
      baseSupplierParts: sourceSupplierParts,
      targetSupplierParts: draftSupplierParts
    });

    // Label BOM lines by their component's readable id and BOP tools by the tool
    // item's readable id (both reference item UUIDs) — store-independent. One
    // batch resolve over every referenced item id.
    const componentIds = [...base.materials, ...target.materials]
      .map((m) => m.itemId)
      .filter((id): id is string => typeof id === "string");
    const toolIds = diff.operations.flatMap((op) =>
      (op.children?.tools ?? [])
        .flatMap((tool) => [tool.before, tool.after])
        .map((row) => (row as { toolId?: string } | null)?.toolId)
        .filter((id): id is string => typeof id === "string")
    );
    const readableIds = await readItemReadableIds(
      client,
      [...componentIds, ...toolIds],
      companyId
    );
    stampMaterialReadableIds(diff.materials, readableIds);
    stampToolReadableIds(diff.operations, readableIds);
    await stampOperationRefNames(client, diff.operations, companyId);

    // Resolve the item-group id → name so the attribute diff reads "Group A →
    // Group B" instead of opaque ids. A modified attribute carries the id in
    // `changedFields`; an added/removed one (a New Part) carries it on the raw
    // before/after row that the full-property list renders directly.
    const groupIds = diff.attributes.flatMap((a) => {
      const ids: string[] = [];
      const cf = a.changedFields?.itemPostingGroupId;
      if (cf) {
        if (typeof cf.before === "string") ids.push(cf.before);
        if (typeof cf.after === "string") ids.push(cf.after);
      }
      for (const row of [a.before, a.after]) {
        const gid = (row as { itemPostingGroupId?: unknown } | null)
          ?.itemPostingGroupId;
        if (typeof gid === "string") ids.push(gid);
      }
      return ids;
    });
    if (groupIds.length > 0) {
      const names = await readPostingGroupNames(client, groupIds, companyId);
      for (const a of diff.attributes) {
        const cf = a.changedFields?.itemPostingGroupId;
        if (cf) {
          if (typeof cf.before === "string")
            cf.before = names.get(cf.before) ?? cf.before;
          if (typeof cf.after === "string")
            cf.after = names.get(cf.after) ?? cf.after;
        }
        for (const row of [a.before, a.after]) {
          const r = row as { itemPostingGroupId?: unknown } | null;
          if (r && typeof r.itemPostingGroupId === "string") {
            r.itemPostingGroupId =
              names.get(r.itemPostingGroupId) ?? r.itemPostingGroupId;
          }
        }
      }
    }

    items.push({
      affectedItemId: affectedItem.id,
      itemId: affectedItem.itemId,
      materials: diff.materials,
      operations: diff.operations,
      attributes: diff.attributes,
      supplierParts: diff.supplierParts
    });
  }

  return { data: { items }, error: null };
}

/**
 * Create a presigned upload URL for a CAD model (STEP or another supported
 * format). First step of the two-step model upload: PUT the file bytes to the
 * returned `signedUrl`, then call `insertModelUpload` with the returned `modelId`,
 * `path` and the file's size in bytes. The file is staged in the `temp-staging`
 * bucket, as the browser upload does, so models up to 2.5 GB are accepted.
 */
export async function createModelUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; name: string }
) {
  const extension = args.name.split(".").pop()?.toLowerCase() ?? "";
  if (!supportedModelTypes.includes(extension)) {
    return {
      data: null,
      error: {
        message: `Unsupported model file "${args.name}": use ${supportedModelTypes.join(", ")}`
      }
    };
  }
  const modelId = nanoid();
  const path = `${args.companyId}/models/${modelId}.${extension}`;
  const signed = await storage(client)
    .from(TEMP_STAGING_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error) return { data: null, error: signed.error };
  return { data: { ...signed.data, modelId, path }, error: null };
}

const modelUploadTargets = [
  "item",
  "job",
  "salesRfqLine",
  "quoteLine",
  "salesOrderLine"
] as const;

/** Whether `path` is the one `createModelUploadUrl` minted for this model. */
export function isModelUploadPath(
  companyId: string,
  modelId: string,
  path: string
) {
  return (
    path.startsWith(`${companyId}/models/${modelId}.`) &&
    !isUnsafeStoragePath(path)
  );
}

/**
 * Record a CAD model uploaded with `createModelUploadUrl`, as the CAD model
 * dropzone does, and make it the model of the records named: an item, a job, a
 * sales RFQ line, a quote line and/or a sales order line (a line and its item
 * together, as the dropzone does). With none the model is only recorded; pass
 * its id as `modelUploadId` to `upsertPart` or `upsertJob` later. The new row
 * starts the optimisation job itself (the `queue_model_pipeline` handler on
 * `modelUpload`), which also renders the thumbnail. Set `convert` for a STEP
 * file whose assembly structure is needed (assembly instructions, step slides).
 */
export async function insertModelUpload(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    createdBy: string;
    modelId: string;
    /** The `path` returned by `createModelUploadUrl`. */
    path: string;
    /** The file name, shown in the viewer. */
    name: string;
    /** The file's size in bytes. */
    size: number;
    itemId?: string;
    jobId?: string;
    salesRfqLineId?: string;
    quoteLineId?: string;
    salesOrderLineId?: string;
    /** Convert a STEP file into an assembly (GLB + graph) now, not on first use. */
    convert?: boolean;
  }
) {
  const { companyId, createdBy, modelId, path, name, size } = args;
  // The path comes from the caller: it must be the one minted for this model,
  // inside this tenant's storage prefix.
  if (!isModelUploadPath(companyId, modelId, path)) {
    return { data: null, error: { message: "Invalid model path" } };
  }

  const ids = {
    item: args.itemId,
    job: args.jobId,
    salesRfqLine: args.salesRfqLineId,
    quoteLine: args.quoteLineId,
    salesOrderLine: args.salesOrderLineId
  };
  const targets = modelUploadTargets.flatMap((table) => {
    const id = ids[table];
    return id ? [{ table, id }] : [];
  });

  // Check the records first, so a wrong id does not leave an unattached model.
  const found = await Promise.all(
    targets.map(({ table, id }) =>
      client
        .from(table)
        .select("id")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle()
    )
  );
  for (const [index, result] of found.entries()) {
    if (result.error) return { data: null, error: result.error };
    if (!result.data) {
      return {
        data: null,
        error: { message: `${targets[index]!.table} not found` }
      };
    }
  }

  const inserted = await client.from("modelUpload").insert({
    id: modelId,
    modelPath: path,
    name,
    size,
    // Frozen as-uploaded bytes: `size` is later overwritten with the compacted
    // (.zst) stored size, but the viewer's reduction badge compares the original.
    originalSize: size,
    // Frozen as-uploaded path: `modelPath` is later repointed at the compacted
    // artifact (STEP → `.xbf.zst`), but downloads must serve the original bytes.
    // Mesh compaction nulls this again (its `.zst` decompresses to the original).
    originalPath: path,
    companyId,
    createdBy
  });
  if (inserted.error) return { data: null, error: inserted.error };

  const linked = await Promise.all(
    targets.map(({ table, id }) =>
      client
        .from(table)
        .update({ modelUploadId: modelId })
        .eq("id", id)
        .eq("companyId", companyId)
        .select("id")
        .maybeSingle()
    )
  );
  const failed = linked.findIndex((result) => result.error || !result.data);
  const failedTable = failed === -1 ? null : targets[failed]!.table;
  if (failedTable) {
    logger.error("Failed to attach a model upload", {
      companyId,
      modelUploadId: modelId,
      table: failedTable,
      error: linked[failed]!.error
    });
  }

  const { trigger } = await import("@carbon/jobs");
  const isStep = [".step", ".stp"].some((ext) =>
    path.toLowerCase().endsWith(ext)
  );
  if (args.convert && isStep) {
    // Skipped by the job when no assembler is configured; the viewer then
    // parses the raw model.
    try {
      await trigger("assembly-convert", {
        companyId,
        modelUploadId: modelId,
        userId: createdBy
      });
    } catch (e) {
      logger.error("Failed to start model conversion", {
        companyId,
        modelUploadId: modelId,
        error: e
      });
    }
  }

  if (failedTable) {
    // The model row stands (and is processed); only the link is missing.
    return {
      data: null,
      error: linked[failed]!.error ?? {
        message: `The model ${modelId} was saved but could not be attached to the ${failedTable}`
      }
    };
  }
  return { data: { modelUploadId: modelId }, error: null };
}

const thumbnailExtensions = ["png", "jpg", "jpeg", "webp"];

/**
 * Create a presigned upload URL for an item's own thumbnail image (PNG, JPEG or
 * WebP). PUT the bytes to `signedUrl`, then call `updateItemThumbnail` with the
 * returned `path`. An item thumbnail is shown in place of the one rendered from
 * its model.
 */
export async function createItemThumbnailUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemId: string; name: string }
) {
  const extension = args.name.split(".").pop()?.toLowerCase() ?? "";
  if (!thumbnailExtensions.includes(extension)) {
    return {
      data: null,
      error: {
        message: `Unsupported thumbnail "${args.name}": use ${thumbnailExtensions.join(", ")}`
      }
    };
  }
  const path = `${args.companyId}/thumbnails/${args.itemId}/${nanoid()}.${extension}`;
  const signed = await storage(client)
    .company(args.companyId)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error) return { data: null, error: signed.error };
  return { data: { ...signed.data, path }, error: null };
}

/**
 * Set an item's thumbnail to an image uploaded with
 * `createItemThumbnailUploadUrl`, or clear it (`thumbnailPath: null`) to show
 * the one rendered from its model.
 */
export async function updateItemThumbnail(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemId: string;
    thumbnailPath: string | null;
    updatedBy: string;
  }
) {
  const { companyId, itemId, thumbnailPath, updatedBy } = args;
  if (
    thumbnailPath !== null &&
    (!thumbnailPath.startsWith(`${companyId}/thumbnails/${itemId}/`) ||
      isUnsafeStoragePath(thumbnailPath))
  ) {
    return { data: null, error: { message: "Invalid thumbnail path" } };
  }
  return client
    .from("item")
    .update({ thumbnailPath, updatedBy })
    .eq("id", itemId)
    .eq("companyId", companyId)
    .select("id, thumbnailPath")
    .single();
}

/**
 * Create a presigned upload URL for an item (part/material/tool/consumable/service)
 * document. First step of the two-step upload flow: PUT the file bytes to the
 * returned `signedUrl`, then call `documents_insertUploadedDocument` with the
 * returned `path`, the item's type as `sourceDocument`, and
 * `sourceDocumentId: itemId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createItemDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "parts",
    entityId: args.itemId,
    name: args.name
  });
}
// An item page's layout and its tab loaders run in ONE request and each read the
// item's methods and change notices. These share that read across the loaders;
// on a mutation they are plain calls, so a revalidation never sees stale rows.

export const getMakeMethodsOnce = (
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) =>
  oncePerRead(`makeMethods:${companyId}:${itemId}`, () =>
    getMakeMethods(client, itemId, companyId)
  );

export const getMakeMethodByIdOnce = (
  client: SupabaseClient<Database>,
  makeMethodId: string,
  companyId: string
) =>
  oncePerRead(`makeMethod:${companyId}:${makeMethodId}`, () =>
    getMakeMethodById(client, makeMethodId, companyId)
  );

export const findChangeNoticesForItemOnce = (
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
) =>
  oncePerRead(`changeNotices:${args.companyId}:${args.itemId}`, () =>
    findChangeNoticesForItem(client, args)
  );

export async function getItemChangeNoticeDataOnce(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeNotices, changeNoticeTypes] = await Promise.all([
    findChangeNoticesForItemOnce(client, { itemId, companyId }),
    getChangeNoticeTypesList(client, companyId)
  ]);
  return {
    changeNotices: changeNotices.data,
    changeNoticeTypes: changeNoticeTypes.data ?? []
  };
}

// Release-lock helpers — gate BOM/BOP mutations on a released (Production)
// revision. A Production revision is the controlled, released make method;
// changes must flow through a change notice. The pending revision an ECO creates
// is Design/Prototype (NOT Production), so it stays editable.

export type ReleaseControl = (typeof plmReleaseControl)[number];

type ItemRevisionStatus = Database["public"]["Enums"]["itemRevisionStatus"];

export const LOCKED_REVISION_MESSAGE =
  "This revision is released (Production). Open a change notice to modify it.";

export type LockKind =
  | "item"
  | "makeMethod"
  | "material"
  | "operation"
  | "step"
  | "tool"
  | "parameter";

export type RevisionLock = {
  isLocked: boolean;
  releaseControl: ReleaseControl;
  revisionStatus: ItemRevisionStatus | null;
};

export type LockCheck =
  | { ok: true; warn: false }
  | { ok: true; warn: true; message: string }
  | { ok: false; warn: false; message: string };

export function getLockVerdict(lock: {
  isLocked: boolean;
  releaseControl: ReleaseControl;
}): LockCheck {
  if (!lock.isLocked || lock.releaseControl === "off") {
    return { ok: true, warn: false };
  }
  if (lock.releaseControl === "warn") {
    return { ok: true, warn: true, message: LOCKED_REVISION_MESSAGE };
  }
  return { ok: false, warn: false, message: LOCKED_REVISION_MESSAGE };
}

type MethodLock = {
  revisionStatus: ItemRevisionStatus | null;
  changeNoticeId: string | null;
  changeNoticeStatus: string | null;
};

const NO_LOCK: MethodLock = {
  revisionStatus: null,
  changeNoticeId: null,
  changeNoticeStatus: null
};

// The FK chain from each lock kind up to its owning make method, expressed once.
// The two lock inputs (the item's revisionStatus and the owning change notice's
// status) hang off that method, so one nested select answers both — walking the
// chain twice would double a query that runs on every BOM/BOP mutation.
// `methodMaterial` has two FKs to `makeMethod` (makeMethodId and
// materialMakeMethodId); the parent method is methodMaterial_methodId_fkey.
const METHOD_LOCK_SOURCE = "changeOrder(id, status), item(revisionStatus)";

const methodLockQueries = {
  makeMethod: ["makeMethod", METHOD_LOCK_SOURCE],
  material: [
    "methodMaterial",
    `makeMethod!methodMaterial_methodId_fkey(${METHOD_LOCK_SOURCE})`
  ],
  operation: ["methodOperation", `makeMethod(${METHOD_LOCK_SOURCE})`],
  step: [
    "methodOperationStep",
    `methodOperation(makeMethod(${METHOD_LOCK_SOURCE}))`
  ],
  tool: [
    "methodOperationTool",
    `methodOperation(makeMethod(${METHOD_LOCK_SOURCE}))`
  ],
  parameter: [
    "methodOperationParameter",
    `methodOperation(makeMethod(${METHOD_LOCK_SOURCE}))`
  ]
} as const satisfies Partial<Record<LockKind, readonly [string, string]>>;

// Every base query is scoped by companyId (defense-in-depth; the id is a global
// UUID but tenant scoping is a golden rule). The lock is advisory — RLS +
// requirePermissions are the real boundary — so a null/unresolvable status
// leaves the gate open by design (see checkRevisionLock).
async function resolveMethodLock(
  client: SupabaseClient<Database>,
  kind: LockKind,
  id: string,
  companyId: string
): Promise<MethodLock> {
  if (kind === "item") {
    const item = await client
      .from("item")
      .select("revisionStatus")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    // item.changeOrderId is a PERMANENT back-link stamped at release (not cleared
    // like makeMethod's), so it means "was created by" — never "is owned by".
    // Resolving it would lock every CO-created item forever once its CO hit Done.
    return { ...NO_LOCK, revisionStatus: item.data?.revisionStatus ?? null };
  }

  const [table, select] = methodLockQueries[kind];
  const result = await client
    .from(table)
    .select(select)
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();

  // The select is built from a lookup, so PostgREST's row typing degrades to a
  // generic shape — narrow it once, here, rather than at each read below.
  const method = unwrapMakeMethod(result.data as MethodLockRow | null, kind);
  return {
    revisionStatus: method?.item?.revisionStatus ?? null,
    changeNoticeId: method?.changeOrder?.id ?? null,
    changeNoticeStatus: method?.changeOrder?.status ?? null
  };
}

type MakeMethodLockRow = {
  changeOrder: { id: string; status: string | null } | null;
  item: { revisionStatus: ItemRevisionStatus | null } | null;
};

type MethodLockRow =
  | MakeMethodLockRow
  | { makeMethod: MakeMethodLockRow | null }
  | { methodOperation: { makeMethod: MakeMethodLockRow | null } | null };

function unwrapMakeMethod(
  row: MethodLockRow | null,
  kind: LockKind
): MakeMethodLockRow | null {
  if (!row) return null;
  if (kind === "makeMethod") return row as MakeMethodLockRow;
  if (kind === "tool" || kind === "parameter" || kind === "step") {
    return (
      (row as { methodOperation: { makeMethod: MakeMethodLockRow | null } })
        .methodOperation?.makeMethod ?? null
    );
  }
  return (row as { makeMethod: MakeMethodLockRow | null }).makeMethod ?? null;
}

async function getReleaseControl(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<ReleaseControl> {
  const settings = await getCompanySettings(client, companyId);
  return (settings.data?.plmReleaseControl ?? "enforce") as ReleaseControl;
}

// Read variant for loaders that need the raw lock state (revisionStatus +
// releaseControl) to drive read-only UI. A revision is locked ONLY when it is
// "Production".
export async function getRevisionLock(
  client: SupabaseClient<Database>,
  args: { itemId: string | null; companyId: string }
): Promise<RevisionLock> {
  const [lock, releaseControl] = await Promise.all([
    args.itemId
      ? resolveMethodLock(client, "item", args.itemId, args.companyId)
      : Promise.resolve(NO_LOCK),
    getReleaseControl(client, args.companyId)
  ]);

  return {
    isLocked: lock.revisionStatus === "Production",
    releaseControl,
    revisionStatus: lock.revisionStatus
  };
}

// The single guard entry point for mutation routes: resolves the entity's
// parent item and returns the enforce/warn/off verdict. A missing/null id
// (cannot resolve) leaves the lock unlocked, so the gate is safely skipped.
export async function checkRevisionLock(
  client: SupabaseClient<Database>,
  args: { kind: LockKind; id: string | null | undefined; companyId: string }
): Promise<LockCheck> {
  const [lock, releaseControl] = await Promise.all([
    args.id
      ? resolveMethodLock(client, args.kind, args.id, args.companyId)
      : Promise.resolve(NO_LOCK),
    getReleaseControl(client, args.companyId)
  ]);

  // Hard block, independent of releaseControl — releaseControl only governs the
  // revision lock.
  const changeNoticeLock = lock.changeNoticeId
    ? await getChangeNoticeEngineeringLock(
        lock.changeNoticeId,
        lock.changeNoticeStatus
      )
    : null;
  if (changeNoticeLock) {
    return { ok: false, warn: false, message: changeNoticeLock };
  }

  return getLockVerdict({
    isLocked: lock.revisionStatus === "Production",
    releaseControl
  });
}

/**
 * The first refusal among several locks, else the first warning. An update
 * that can move a row checks both the method it leaves and the one it joins.
 */
/**
 * The one make method that every row in `ids` belongs to, or null when the
 * rows are missing or span several methods. A bulk bill of material or bill of
 * process write checks one method's lock, so its rows must share it.
 */
export async function getSingleMakeMethodId(
  client: SupabaseClient<Database>,
  companyId: string,
  table: "methodMaterial" | "methodOperation",
  ids: string[]
) {
  const rows = await client
    .from(table)
    .select("makeMethodId")
    .in("id", ids)
    .eq("companyId", companyId);
  const makeMethodIds = new Set(
    (rows.data ?? []).map((row) => row.makeMethodId)
  );
  return {
    data: makeMethodIds.size === 1 ? [...makeMethodIds][0] : null,
    error: rows.error
  };
}

export async function checkRevisionLocks(
  client: SupabaseClient<Database>,
  companyId: string,
  targets: { kind: LockKind; id: string | null | undefined }[]
): Promise<LockCheck> {
  const checks = await Promise.all(
    targets.map((target) => checkRevisionLock(client, { ...target, companyId }))
  );
  return (
    checks.find((check) => !check.ok) ??
    checks.find((check) => check.warn) ?? { ok: true, warn: false }
  );
}

/**
 * Why a step, a slide or a step link cannot change, or null. Only a Draft
 * method's steps change. The release lock is the caller's: its warning is
 * returned with the write.
 */
export async function methodStepRefusal(
  client: SupabaseClient<Database>,
  companyId: string,
  ref: { operationId: string } | { stepId: string } | { slideId: string }
): Promise<string | null> {
  let operationId: string | null = null;
  if ("operationId" in ref) {
    operationId = ref.operationId;
  } else if ("stepId" in ref) {
    const step = await client
      .from("methodOperationStep")
      .select("operationId")
      .eq("id", ref.stepId)
      .eq("companyId", companyId)
      .maybeSingle();
    operationId = step.data?.operationId ?? null;
  } else {
    const slide = await client
      .from("methodOperationStepSlide")
      .select("methodOperationStep(operationId)")
      .eq("id", ref.slideId)
      .eq("companyId", companyId)
      .maybeSingle();
    operationId = slide.data?.methodOperationStep?.operationId ?? null;
  }
  if (!operationId) return "Failed to find method operation";

  try {
    await assertMethodOperationIsDraft(client, operationId);
    return null;
  } catch (err) {
    return err instanceof Error
      ? err.message
      : "Failed to find method operation";
  }
}

// =============================================================================
// Change Notices — server-only helpers (imports @carbon/jobs).
// =============================================================================

type ChangeNoticeEditScope = "engineering" | "workflow";

// Why a change notice's engineering content cannot be edited, or null. An
// approval request can only be pending at Engineering Complete (approval gates
// the move to Implementation), so only that stage pays for the lookup;
// approvalRequest is service-role only.
async function getChangeNoticeEngineeringLock(
  changeNoticeId: string,
  status: string | null | undefined
): Promise<string | null> {
  return engineeringLockMessage(
    status,
    needsApprovalLookup(status) &&
      (await hasPendingApproval(
        getCarbonServiceRole(),
        "changeOrder",
        changeNoticeId
      ))
  );
}

/**
 * getChangeNoticeEngineeringLock for several notices, with one approval
 * lookup for all of them: notice id → why it is locked, or null.
 */
export async function getChangeNoticeEngineeringLocks(
  companyId: string,
  notices: Array<{ id: string; status: string | null }>
): Promise<Map<string, string | null>> {
  const awaitingApproval = await pendingApprovalDocumentIds(
    getCarbonServiceRole(),
    {
      documentType: "changeOrder",
      documentIds: notices
        .filter((notice) => needsApprovalLookup(notice.status))
        .map((notice) => notice.id),
      companyId
    }
  );
  return new Map(
    notices.map((notice) => [
      notice.id,
      engineeringLockMessage(notice.status, awaitingApproval.has(notice.id))
    ])
  );
}

const needsApprovalLookup = (status: string | null | undefined) =>
  status === "Engineering Complete";

function engineeringLockMessage(
  status: string | null | undefined,
  awaitingApproval: boolean
): string | null {
  if (!canEditChangeNoticeEngineering(status)) {
    return changeNoticeLockedMessage(status);
  }
  return awaitingApproval ? changeNoticeAwaitingApprovalMessage : null;
}

// One status read + predicate. Mutation routes call this before writing; the
// UI disable is cosmetic on top of it.
export async function requireChangeNoticeEditable(
  client: SupabaseClient<Database>,
  args: {
    changeNoticeId: string;
    companyId: string;
    scope: ChangeNoticeEditScope;
  }
): Promise<{ error: { message: string }; data: null } | null> {
  const existing = await client
    .from("changeOrder")
    .select("status")
    .eq("id", args.changeNoticeId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (existing.error || !existing.data) {
    return { error: { message: "Could not find change notice" }, data: null };
  }

  const { status } = existing.data;
  const message =
    args.scope === "engineering"
      ? await getChangeNoticeEngineeringLock(args.changeNoticeId, status)
      : canEditChangeNoticeWorkflow(status)
        ? null
        : changeNoticeLockedMessage(status);

  return message ? { error: { message }, data: null } : null;
}

// A child row (affected item, action task) is addressed by its own id, so its
// notice is the one the row belongs to, not one the caller names.
export async function requireChangeNoticeChildEditable(
  client: SupabaseClient<Database>,
  args: {
    table: "changeOrderAffectedItem" | "changeOrderActionTask";
    id: string;
    companyId: string;
    scope: ChangeNoticeEditScope;
  }
): Promise<{ error: { message: string }; data: null } | null> {
  const row = await client
    .from(args.table)
    .select("changeOrderId")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (row.error || !row.data) {
    return {
      error: { message: "Could not find the change notice record" },
      data: null
    };
  }
  return requireChangeNoticeEditable(client, {
    changeNoticeId: row.data.changeOrderId,
    companyId: args.companyId,
    scope: args.scope
  });
}

// The inverse gate: an item owned by an open change notice must not get a manual
// revision, because the notice authors it. Fails closed — a lookup we couldn't
// read cannot prove the item is free.
export async function requireItemChangeNoticeUnlocked(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<{ error: { message: string }; data: null } | null> {
  const open = await findChangeNoticesForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeNoticeOpenStatuses
  });

  if (open.error) {
    return {
      error: { message: "Could not check open change notices for this item" },
      data: null
    };
  }

  if (open.data.length === 0) return null;

  const ids = open.data.map((co) => co.changeOrderId).join(", ");
  return {
    error: {
      message: `This item is open in change notice ${ids}. Release it to create new revisions.`
    },
    data: null
  };
}

// Child rows (affected items, action tasks) are addressed by their own id, so
// authorizing the change notice in the URL proves nothing about the row being
// mutated — an editable notice's URL would otherwise let a user mutate a frozen
// notice's rows. Same failure contract as requireEditableChangeNoticeRoute;
// null means the route may proceed.
export async function requireChangeNoticeChildRoute(
  request: Request,
  args: {
    client: SupabaseClient<Database>;
    table: "changeOrderAffectedItem" | "changeOrderActionTask";
    id: string;
    changeNoticeId: string;
    companyId: string;
  }
) {
  const row = await args.client
    .from(args.table)
    .select("id")
    .eq("id", args.id)
    .eq("changeOrderId", args.changeNoticeId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (row.error || !row.data) {
    const message = "Record does not belong to this change notice";
    return data(
      { success: false },
      await flash(request, error(row.error, message))
    );
  }

  return null;
}

// The route-level guard: resolves the change notice from the URL, checks the
// scope, and returns the flashed failure response so all eight mutation routes
// share one failure contract. Returns null when the route may proceed.
export async function requireEditableChangeNoticeRoute(
  request: Request,
  args: {
    client: SupabaseClient<Database>;
    changeNoticeId: string | undefined;
    companyId: string;
    scope: ChangeNoticeEditScope;
  }
) {
  if (!args.changeNoticeId) throw new Error("Could not find id");

  const locked = await requireChangeNoticeEditable(args.client, {
    changeNoticeId: args.changeNoticeId,
    companyId: args.companyId,
    scope: args.scope
  });
  if (!locked) return null;

  return data(
    { success: false },
    await flash(request, error(locked.error, locked.error.message))
  );
}

// Maps a notifying stage to its notification event. Only Start / Implementation
// / Done notify; Draft / Engineering Complete are silent, so callers simply
// don't invoke this for those stages.
export const changeNoticeStageEvent: Record<string, NotificationEvent> = {
  Start: NotificationEvent.ChangeNoticeStarted,
  Implementation: NotificationEvent.ChangeNoticeImplementation,
  Done: NotificationEvent.ChangeNoticeDone
};

// Notifies the people involved in the CO — its assignee plus every action-task
// assignee — on a stage entry (best-effort). Deliberately NOT a company-wide
// broadcast; the notify function dedupes and drops the acting user itself.
export async function notifyChangeNoticeTransition(args: {
  client: SupabaseClient<Database>;
  event: NotificationEvent;
  changeNoticeId: string;
  companyId: string;
  userId: string;
}): Promise<void> {
  try {
    const [changeNotice, actionTasks] = await Promise.all([
      args.client
        .from("changeOrder")
        .select("assignee")
        .eq("id", args.changeNoticeId)
        .eq("companyId", args.companyId)
        .single(),
      args.client
        .from("changeOrderActionTask")
        .select("assignee")
        .eq("changeOrderId", args.changeNoticeId)
        .eq("companyId", args.companyId)
        .not("assignee", "is", null)
    ]);

    if (changeNotice.error) {
      logger.error("Failed to resolve change notice for CO notification", {
        error: changeNotice.error,
        changeNoticeId: args.changeNoticeId,
        companyId: args.companyId
      });
      return;
    }

    if (actionTasks.error) {
      logger.error("Failed to resolve CO action-task assignees", {
        error: actionTasks.error,
        changeNoticeId: args.changeNoticeId,
        companyId: args.companyId
      });
    }

    const userIds = [
      ...new Set(
        [
          changeNotice.data?.assignee,
          ...(actionTasks.data ?? []).map((task) => task.assignee)
        ].filter((id): id is string => !!id)
      )
    ];

    if (userIds.length === 0) return;

    await trigger("notify", {
      event: args.event,
      companyId: args.companyId,
      documentId: args.changeNoticeId,
      recipient: { type: "users", userIds },
      from: args.userId
    });
  } catch (e) {
    logger.error("Failed to trigger change notice notification", { error: e });
  }
}

// =============================================================================
// applyChangeNotice — the top-to-bottom "release", run on the Implementation →
// Done transition (this function IS that transition). It materializes each
// affected item's CO-staged end-state onto a NEW inactive revision, activates
// it, then auto-writes the oldRev → newRev supersession (Q1/Q2/Q5).
//
// Atomicity (G2): createRevision + activateMethodVersion call the get-method /
// convert operations, each of which commits its own transaction, so this CANNOT
// be one Kysely transaction. The apply is therefore an idempotent, CAS-guarded orchestration:
//   - PER-AFFECTED-ITEM idempotency: each changeOrderAffectedItem gets its
//     created revision id stamped into `newItemId` at the END of its processing.
//     A re-run skips any affected item whose `newItemId` is already set, so a
//     partial failure re-run resumes at the first unprocessed item instead of
//     re-creating revisions.
//   - CO-LEVEL idempotency: the final flip to 'Done' is a compare-and-swap on
//     status='Implementation', so a re-run can't double-transition the CO; only
//     the closing status flip is transactional.
// =============================================================================
export async function applyChangeNotice(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    changeNoticeId: string;
    userId: string;
    companyId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { changeNoticeId, userId, companyId } = args;

  const cn = await client
    .from("changeOrder")
    .select("id, status")
    .eq("id", changeNoticeId)
    .eq("companyId", companyId)
    .single();
  if (cn.error || !cn.data) {
    return { data: null, error: ruleError("Change notice not found") };
  }
  if (cn.data.status !== "Implementation") {
    return { data: null, error: { message: changeNoticeUpdatedElsewhere } };
  }

  // Load the affected items with change type + draft refs + cutover config.
  // v2: the draft make method already holds the edited BOM/BOP; release just
  // activates it (and reveals the new item for Revision/New Part). Idempotency
  // is per-item inside releaseAffectedItem (skip once the draft is no longer
  // CO-owned).
  const affectedItems = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, itemId, changeType, draftMakeMethodId, baseMakeMethodId, newItemId, supersessionMode, discontinuationDate, successorEffectivityDate"
    )
    .eq("changeOrderId", changeNoticeId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
  if (affectedItems.error) {
    return { data: null, error: affectedItems.error };
  }

  // Release New Part (net-new) items first, so a parent assembly whose draft BOM
  // references a new part resolves to an already-active item when its own method
  // activates. Stable sort preserves the sortOrder/createdAt order within groups.
  const ordered = [...(affectedItems.data ?? [])].sort(
    (a, b) =>
      (a.changeType === "New Part" ? 0 : 1) -
      (b.changeType === "New Part" ? 0 : 1)
  );

  for (const affected of ordered) {
    const result = await releaseAffectedItem(client, db, {
      changeNoticeId,
      companyId,
      userId,
      affected
    });
    if (result.error) return { data: null, error: result.error };
  }

  // Final compare-and-swap: Implementation → Done (the only transactional write).
  try {
    const updated = await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable("changeOrder")
        .set({ status: "Done", updatedBy: userId })
        .where("id", "=", changeNoticeId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Implementation")
        .executeTakeFirst();
      return Number(res.numUpdatedRows);
    });
    if (updated === 0) {
      return { data: null, error: { message: changeNoticeUpdatedElsewhere } };
    }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Apply failed" }
    };
  }

  return { data: { id: changeNoticeId }, error: null };
}

// -----------------------------------------------------------------------------
// releaseAffectedItem (v2) — dispatch by change type. The CO-owned Draft make
// method already holds the edited BOM/BOP, so release just:
//   Version          → activate the Draft on the SAME item (prior Active →
//                      Archived); no new item, no supersession.
//   Revision         → activate the Draft + reveal the new revision item + auto
//                      oldRev→newRev supersession.
//   Replacement Part → activate the Draft + reveal the new part + auto
//                      affected→new supersession.
//   New Part         → activate the Draft + reveal the net-new part; NO
//                      supersession (no predecessor).
// Idempotent: once the Draft's changeOrderId is cleared it counts as released.
// -----------------------------------------------------------------------------
async function releaseAffectedItem(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    changeNoticeId: string;
    companyId: string;
    userId: string;
    affected: {
      id: string;
      itemId: string;
      changeType: Database["public"]["Enums"]["changeOrderChangeType"];
      draftMakeMethodId: string | null;
      baseMakeMethodId: string | null;
      newItemId: string | null;
      supersessionMode: Database["public"]["Enums"]["supersessionMode"] | null;
      discontinuationDate: string | null;
      successorEffectivityDate: string | null;
    };
  }
): Promise<{ error: { message: string } | null }> {
  const { changeNoticeId, companyId, userId, affected } = input;
  const { changeType, draftMakeMethodId, newItemId } = affected;
  const sourceItemId = affected.itemId;

  if (!draftMakeMethodId) {
    return { error: { message: "Affected item has no draft make method" } };
  }

  // Idempotency: a Draft still owned by this CO has not been released yet; once
  // released we clear changeOrderId, so a re-run skips it.
  const draft = await client
    .from("makeMethod")
    .select("changeOrderId")
    .eq("id", draftMakeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (draft.error) return { error: draft.error };
  if (!draft.data || !draft.data.changeOrderId) {
    return { error: null };
  }

  // Activate the Draft method (Draft → Active; prior Active → Archived). A
  // Version simply appends a new Active version and archives the prior one — the
  // prior version's rows are preserved as method history, so there is nothing to
  // merge even if another CO released a newer version in the meantime.
  const activated = await activateMethodVersion(client, db, {
    id: draftMakeMethodId,
    companyId,
    userId
  });
  if (activated.error) {
    return {
      error: {
        message: activated.error.message || "Failed to activate method"
      }
    };
  }

  // Reveal the new item for Revision / New Part (Version edits the same item).
  if (newItemId) {
    const reveal = await client
      .from("item")
      .update({
        active: true,
        changeOrderId: changeNoticeId,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (reveal.error) return { error: reveal.error };
  }

  // Auto supersession: Revision (oldRev→newRev) / Replacement Part (affected→new).
  // Version edits the SAME item, and a net-new New Part has NO predecessor — so
  // neither writes a supersession (they still reveal their item above). This runs
  // BEFORE clearing the CO-ownership marker so a supersession failure leaves the
  // draft still owned by the CO (changeOrderId set) — the item is re-attempted on
  // retry instead of the CO silently completing without its required supersession.
  // Re-runs are safe: activate/reveal are idempotent and upsertItemSupersession is
  // an upsert.
  if (
    (changeType === "Revision" || changeType === "Replacement Part") &&
    newItemId
  ) {
    const sup = await upsertItemSupersession(client, {
      itemId: sourceItemId,
      successorItemId: newItemId,
      supersessionMode: normalizeSupersessionMode(affected.supersessionMode),
      // Empty per-item dates mean "effective immediately at release" — the
      // supersession redirect map treats a null successorEffectivityDate as
      // always-effective. Cutover timing is driven purely per affected item now.
      discontinuationDate: affected.discontinuationDate ?? undefined,
      successorEffectivityDate: affected.successorEffectivityDate ?? undefined,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
    if (sup.error) {
      logger.error("Failed to write revision supersession", {
        error: sup.error
      });
      return { error: sup.error };
    }
  }

  // Clear CO ownership on the Draft — the FINAL, idempotency-marking step. Once
  // cleared the draft is normal method history and a re-run skips this item.
  const clear = await client
    .from("makeMethod")
    .update({ changeOrderId: null })
    .eq("id", draftMakeMethodId)
    .eq("companyId", companyId);
  if (clear.error) return { error: clear.error };

  return { error: null };
}

// Coerce a possibly-null DB supersession mode to a valid enum member, defaulting
// to 'Consume First' (Q3 default) when unset/invalid.
function normalizeSupersessionMode(
  mode: string | null | undefined
): Database["public"]["Enums"]["supersessionMode"] {
  return (supersessionModes as readonly string[]).includes(mode ?? "")
    ? (mode as Database["public"]["Enums"]["supersessionMode"])
    : "Consume First";
}

// -----------------------------------------------------------------------------
// Unreleased-change-order guard.
//
// Release is what activates a change notice's items: `applyChangeNotice` flips
// `active` on the revisions and parts the notice minted. Nothing stops a user
// switching the Active toggle on by hand first, and once it is on the item is
// selectable everywhere — carrying the notice's un-approved draft BOM, since a
// minted revision's only make method is that Draft and `activeMakeMethods` falls
// back to it when no Active version exists.
//
// So two kinds of write ask this question: one that would ACTIVATE such an item,
// and one that would CONSUME it (a sales order line, a purchase order line, a
// job).
//
// `item.changeOrderId` is NOT a draft marker on its own — release leaves it in
// place as a provenance back-link, so the owning change order's status decides.
// Release IS the Implementation -> Done transition, so every other status means
// the item is still a draft.
//
// Pass a service-role client: reading `changeOrder` requires `parts_view`, which
// the caller need not have.
// -----------------------------------------------------------------------------
const RELEASED_CHANGE_ORDER_STATUS = "Done";

export type UnreleasedChangeOrderItem = {
  itemId: string;
  itemName: string;
  changeOrderReadableId: string;
};

// Both reads go through fetchAllByIds: an `in` filter rides in the URL and a
// response stops at PostgREST's row cap. Truncating either one would drop an
// item from the answer, and a missing row reads as "no change order holds it".

// Two queries per batch of ids — the bulk item update can carry a whole table
// selection.
//
// `error` is a message to show the user, not a thrown failure — a read that did
// not answer says nothing about the items, so callers block on it rather than
// wave the write through on a database blip.
export async function getUnreleasedChangeOrderItems(
  client: SupabaseClient<Database>,
  args: { itemIds: string[]; companyId: string }
): Promise<{ data: UnreleasedChangeOrderItem[]; error: string | null }> {
  if (args.itemIds.length === 0) return { data: [], error: null };

  const items = await fetchAllByIds(args.itemIds, (batch) =>
    client
      .from("item")
      .select("id, readableIdWithRevision, changeOrderId")
      .in("id", batch)
      .eq("companyId", args.companyId)
      .order("id")
  );

  if (items.error) {
    logger.error("Failed to read items for change order check", {
      error: items.error,
      itemIds: args.itemIds
    });
    return {
      data: [],
      error: "These items could not be checked against their change orders."
    };
  }

  const owned = (items.data ?? []).filter(
    (item): item is typeof item & { changeOrderId: string } =>
      !!item.changeOrderId
  );
  if (owned.length === 0) return { data: [], error: null };

  const changeOrders = await fetchAllByIds(
    [...new Set(owned.map((item) => item.changeOrderId))],
    (batch) =>
      client
        .from("changeOrder")
        .select("id, changeOrderId, status")
        .in("id", batch)
        .eq("companyId", args.companyId)
        .order("id")
  );

  if (changeOrders.error) {
    logger.error("Failed to read change orders for change order check", {
      error: changeOrders.error,
      itemIds: args.itemIds
    });
    return {
      data: [],
      error: "These items could not be checked against their change orders."
    };
  }

  const unreleased = new Map(
    (changeOrders.data ?? [])
      .filter((co) => co.status !== RELEASED_CHANGE_ORDER_STATUS)
      .map((co) => [co.id, co.changeOrderId])
  );

  return {
    data: owned.flatMap((item) => {
      const changeOrderReadableId = unreleased.get(item.changeOrderId);
      if (!changeOrderReadableId) return [];
      return [
        {
          itemId: item.id,
          itemName: item.readableIdWithRevision ?? "This item",
          changeOrderReadableId
        }
      ];
    }),
    error: null
  };
}

// Single-item form for the loaders that only need to know whether to lock the
// Active toggle on this one item's page. Best-effort: a failed read leaves the
// toggle unlocked, and the action behind it still refuses the write.
export async function getUnreleasedChangeOrderForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<UnreleasedChangeOrderItem | null> {
  const unreleased = await getUnreleasedChangeOrderItems(client, {
    itemIds: [args.itemId],
    companyId: args.companyId
  });
  return unreleased.data[0] ?? null;
}

// Single-item form for the actions that put an item into circulation. Returns
// the reason to refuse, or null. Unlike the loader form this fails closed: a
// read that did not answer says nothing about the item.
//
// Deliberately does NOT judge `active`. Plain inactive items are allowed onto
// these documents today, and changing that is a separate decision from closing
// the change order hole.
export async function getUnreleasedChangeOrderIssue(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<string | null> {
  const unreleased = await getUnreleasedChangeOrderItems(client, {
    itemIds: [args.itemId],
    companyId: args.companyId
  });
  if (unreleased.error) return unreleased.error;
  if (unreleased.data.length === 0) return null;
  return unreleasedChangeOrderItemsMessage(unreleased.data);
}

// Names every offending item so a bulk edit says which row to fix.
export function unreleasedChangeOrderItemsMessage(
  unreleased: UnreleasedChangeOrderItem[]
) {
  return unreleased
    .map(
      (item) =>
        `${item.itemName} was created by change order ${item.changeOrderReadableId}, which has not been released yet.`
    )
    .join(" ");
}

// Not awaited by the item layouts: only the header badge and the properties
// sidebar read these, so they stream instead of holding the page.
export function streamItemSupersession(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return {
    supersession: getItemSupersession(client, itemId, companyId).then(
      (result) => result.data,
      (error) => {
        logger.error("Failed to load item supersession", {
          companyId,
          itemId,
          error
        });
        return null;
      }
    ),
    supersededBy: getItemSupersededBy(client, itemId, companyId).then(
      (result) => result.data ?? [],
      (error) => {
        logger.error("Failed to load item predecessors", {
          companyId,
          itemId,
          error
        });
        return [];
      }
    )
  };
}

export function priceBreakRows(
  ctx: ServiceContext,
  supplierPartId: string,
  priceBreaks: z.output<typeof supplierPartPriceBreaksValidator>
) {
  return priceBreaks.map((priceBreak) => ({
    supplierPartId,
    quantity: priceBreak.quantity,
    supplierUnitPrice: priceBreak.supplierUnitPrice,
    leadTime: priceBreak.leadTime ?? 0,
    sourceType: "Manual Entry" as const,
    companyId: ctx.company.id,
    createdBy: ctx.auditUserId,
    updatedBy: ctx.auditUserId
  }));
}

// ── Make methods ────────────────────────────────────────────────────────────

export const isMakeMethodId = (id: string) => id.startsWith("make_");

// ── Change notices ──────────────────────────────────────────────────────────

// Reason and description arrive as Markdown; the columns are tiptap JSON, so
// non-empty text becomes a doc the detail page's editor can edit.
export function toRichText(value: string | undefined): Json | undefined {
  if (!value) return undefined;
  return TiptapText(value).toDocument() as unknown as Json;
}

const onShapeDataValidator = z.object({
  index: z.string(),
  id: z.string().optional(),
  readableId: z.string().optional(),
  revision: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  replenishmentSystem: z.enum(["Make", "Buy", "Buy and Make"]),
  defaultMethodType: z.enum([
    "Make to Order",
    "Purchase to Order",
    "Pull from Inventory"
  ]),
  data: z.record(z.string(), z.any())
});

export const syncInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("onshape"),
    makeMethodId: z.string(),
    data: onShapeDataValidator.array()
  })
]);

interface MakeMethodInfo {
  id: string;
  itemId: string;
  version: number;
  status: "Draft" | "Active" | "Archived";
}

async function copyMakeMethodOperations(
  trx: Transaction<KyselyDatabase>,
  sourceMakeMethodId: string,
  targetMakeMethodId: string,
  companyId: string,
  userId: string
) {
  // Fetch source operations
  const sourceOperations = await trx
    .selectFrom("methodOperation")
    .selectAll()
    .where("makeMethodId", "=", sourceMakeMethodId)
    .where("companyId", "=", companyId)
    .execute();

  if (sourceOperations.length === 0) return;

  // Insert operations and copy related records
  for (const operation of sourceOperations) {
    const {
      id: oldOpId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      updatedBy: _updatedBy,
      ...opData
    } = operation;

    const newOperation = await trx
      .insertInto("methodOperation")
      .values({
        ...opData,
        makeMethodId: targetMakeMethodId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirst();

    if (!newOperation) continue;

    // Copy tools
    const tools = await trx
      .selectFrom("methodOperationTool")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (tools.length > 0) {
      await trx
        .insertInto("methodOperationTool")
        .values(
          tools.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...tool
            }) => ({
              ...tool,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }

    // Copy parameters
    const parameters = await trx
      .selectFrom("methodOperationParameter")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (parameters.length > 0) {
      await trx
        .insertInto("methodOperationParameter")
        .values(
          parameters.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...param
            }) => ({
              ...param,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }

    // Copy steps
    const steps = await trx
      .selectFrom("methodOperationStep")
      .selectAll()
      .where("operationId", "=", oldOpId)
      .execute();

    if (steps.length > 0) {
      await trx
        .insertInto("methodOperationStep")
        .values(
          steps.map(
            ({
              id: _id,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              updatedBy: _updatedBy,
              ...step
            }) => ({
              ...step,
              operationId: newOperation.id,
              createdBy: userId
            })
          )
        )
        .execute();
    }
  }
}

export const syncMakeMethodPermission = {
  update: "resources"
} satisfies PermissionRule<z.output<typeof syncInput>>;

/** Syncs an external CAD structure (Onshape) into a make method's BOM, per `type`. */
export async function syncMakeMethod(
  ctx: ServiceContext,
  raw: z.input<typeof syncInput>
) {
  const payload = syncInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  switch (payload.type) {
    case "onshape": {
      const { type, makeMethodId, data } = payload;

      logger.info({
        type,
        makeMethodId,
        data,
        companyId,
        userId
      });

      // Check if top-level make method is Active and find or create a Draft
      const topLevelMakeMethod = await maybeSingle(
        db,
        "makeMethod",
        { id: makeMethodId, companyId },
        { columns: ["id", "itemId", "version", "status"] }
      );

      // Service-role client: a make method outside companyId is a 404.
      if (!topLevelMakeMethod.data) {
        throw new NotFoundError("Make method not found");
      }

      const existingItemIds = new Set(
        data.map((item) => item.id).filter((id): id is string => Boolean(id))
      );

      const existingItems = await many(
        db,
        "item",
        { companyId, id: Array.from(existingItemIds) },
        {
          columns: [
            "id",
            "readableId",
            "readableIdWithRevision",
            "unitOfMeasureCode",
            "type",
            "revision"
          ]
        }
      );
      if (existingItems.error) throw new Error("Failed to fetch items");

      const existingItemsByItemId = new Map(
        existingItems.data?.map((item) => [item.id, item]) ?? []
      );

      // Every item id in the body is updated by id alone below, so each must
      // have come back from the companyId-scoped read above. Checked before
      // anything is written (the Draft make method below).
      for (const itemId of existingItemIds) {
        if (!existingItemsByItemId.has(itemId as string)) {
          throw new NotFoundError("Item not found");
        }
      }

      let activeMakeMethodId = makeMethodId;
      let topLevelSourceMakeMethodId: string | null = null;

      if (topLevelMakeMethod.data?.status === "Active") {
        // Check if there's already a Draft version we can use
        const existingDraft = await maybeSingle(
          db,
          "makeMethod",
          {
            itemId: topLevelMakeMethod.data.itemId,
            status: "Draft",
            companyId
          },
          {
            columns: ["id", "version"],
            orderBy: [{ desc: "version" }],
            limit: 1
          }
        );

        if (existingDraft.data) {
          // Use the existing Draft
          activeMakeMethodId = existingDraft.data.id;
        } else {
          // Get max version across ALL make methods for this item
          const allVersions = await maybeSingle(
            db,
            "makeMethod",
            { itemId: topLevelMakeMethod.data.itemId, companyId },
            { columns: ["version"], orderBy: [{ desc: "version" }], limit: 1 }
          );

          const maxVersion = Number(allVersions.data?.version ?? 0);
          const newVersion = maxVersion + 1;

          logger.info({
            action: "creating_top_level_draft",
            itemId: topLevelMakeMethod.data.itemId,
            maxVersion,
            newVersion
          });

          const newTopLevelMakeMethod = await insertRows(db, "makeMethod", {
            itemId: topLevelMakeMethod.data.itemId,
            version: newVersion,
            status: "Draft",
            companyId,
            createdBy: userId
          });

          const inserted = newTopLevelMakeMethod.data[0];
          if (inserted) {
            activeMakeMethodId = inserted.id;
            topLevelSourceMakeMethodId = makeMethodId;
          }
        }
      }

      // Read after the Draft above may have been created, as before.
      const existingMakeMethods = await many(
        db,
        "activeMakeMethods",
        { companyId, itemId: Array.from(existingItemIds) },
        { columns: ["id", "itemId", "version", "status"] }
      );
      if (existingMakeMethods.error) {
        throw new Error("Failed to fetch make methods");
      }

      logger.info({
        action: "fetched_active_make_methods",
        count: existingMakeMethods.data?.length ?? 0,
        data: existingMakeMethods.data
      });

      const existingMakeMethodsByItemId = new Map<string, MakeMethodInfo>(
        existingMakeMethods.data?.map((makeMethod) => [
          makeMethod.itemId!,
          {
            id: makeMethod.id!,
            itemId: makeMethod.itemId!,
            version: Number(makeMethod.version),
            status: makeMethod.status as "Draft" | "Active" | "Archived"
          }
        ]) ?? []
      );

      {
        interface TreeNode {
          data: z.infer<typeof onShapeDataValidator>;
          children: TreeNode[];
          level: number;
        }

        // Sort the data by index to ensure parent nodes come before children
        const sortedData = [...data].sort((a, b) => {
          const aIndices = a.index.toString().split(".");
          const bIndices = b.index.toString().split(".");

          // Compare each level of the index
          for (let i = 0; i < Math.min(aIndices.length, bIndices.length); i++) {
            const aVal = parseInt(aIndices[i]!);
            const bVal = parseInt(bIndices[i]!);
            if (aVal !== bVal) {
              return aVal - bVal;
            }
          }

          // If one index is a prefix of the other, the shorter one comes first
          return aIndices.length - bIndices.length;
        });

        // Build the tree
        const buildTree = (
          d: z.infer<typeof onShapeDataValidator>[]
        ): TreeNode[] => {
          const result: TreeNode[] = [];
          const nodeMap = new Map<string, TreeNode>();

          d.forEach((item) => {
            const indexStr = item.index.toString();
            const node: TreeNode = {
              data: item,
              children: [],
              level: indexStr.split(".").length
            };

            nodeMap.set(indexStr, node);

            // Find parent node
            const lastDotIndex = indexStr.lastIndexOf(".");
            if (lastDotIndex === -1) {
              // This is a root node
              result.push(node);
            } else {
              // This is a child node
              const parentIndex = indexStr.substring(0, lastDotIndex);
              const parentNode = nodeMap.get(parentIndex);
              if (parentNode) {
                parentNode.children.push(node);
              }
            }
          });

          return result;
        };

        const tree = buildTree(sortedData);

        await db
          .transaction()
          .execute(async (trx: Transaction<KyselyDatabase>) => {
            // If we created a new draft for the top-level, copy operations from the active version
            if (topLevelSourceMakeMethodId) {
              await copyMakeMethodOperations(
                trx,
                topLevelSourceMakeMethodId,
                activeMakeMethodId,
                companyId,
                userId
              );
            }

            await trx
              .deleteFrom("methodMaterial")
              .where("makeMethodId", "=", activeMakeMethodId)
              .where("companyId", "=", companyId)
              .execute();

            // Track newly created items and make methods to avoid duplicate inserts
            const newlyCreatedItemsByPartId = new Map<string, string>();
            const newlyCreatedMakeMethodsByItemId = new Map<
              string,
              MakeMethodInfo
            >();

            async function traverseTree(
              node: TreeNode,
              parentMakeMethodId: string,
              index: number
            ) {
              const { data, children } = node;
              const {
                id,
                readableId,
                revision,
                name,
                quantity,
                replenishmentSystem,
                defaultMethodType
              } = data;

              const partId = readableId || name;
              if (!partId) return;

              const externalPartId = getReadableIdWithRevision(
                partId,
                revision
              );

              const isMade = children.length > 0;
              let itemId = id;

              if (itemId) {
                // Update existing item
                await trx
                  .updateTable("item")
                  .set({
                    updatedBy: userId,
                    updatedAt: datetime.timestamp()
                  })
                  .where("id", "=", itemId)
                  .where("companyId", "=", companyId)
                  .execute();

                await trx
                  .deleteFrom("externalIntegrationMapping")
                  .where("entityType", "=", "item")
                  .where("entityId", "=", itemId)
                  .where("integration", "=", "onshapeData")
                  .where("companyId", "=", companyId)
                  .execute();

                await trx
                  .insertInto("externalIntegrationMapping")
                  .values({
                    entityType: "item",
                    entityId: itemId,
                    integration: "onshapeData",
                    externalId: externalPartId,
                    metadata: data.data,
                    companyId,
                    allowDuplicateExternalId: false
                  })
                  .onConflict((oc) =>
                    oc
                      .columns([
                        "integration",
                        "externalId",
                        "entityType",
                        "companyId"
                      ])
                      .where("allowDuplicateExternalId", "=", false)
                      .doUpdateSet({
                        entityId: itemId,
                        metadata: data.data,
                        updatedAt: datetime.timestamp()
                      })
                  )
                  .execute();
              } else {
                // Check if we've already created this part in this transaction
                itemId = newlyCreatedItemsByPartId.get(partId);

                if (!itemId) {
                  // Create new item and part
                  const item = await trx
                    .insertInto("item")
                    .values({
                      readableId: partId,
                      revision: revision ?? "0",
                      name,
                      type: "Part",
                      unitOfMeasureCode: "EA",
                      itemTrackingType: "Inventory",
                      replenishmentSystem,
                      defaultMethodType,
                      companyId,
                      createdBy: userId
                    })
                    .returning(["id"])
                    .executeTakeFirst();

                  itemId = item?.id;

                  // Create OnShape mapping for the new item
                  if (itemId) {
                    await trx
                      .insertInto("externalIntegrationMapping")
                      .values({
                        entityType: "item",
                        entityId: itemId,
                        integration: "onshapeData",
                        externalId: externalPartId,
                        metadata: data.data,
                        companyId,
                        allowDuplicateExternalId: false
                      })
                      .onConflict((oc) =>
                        oc
                          .columns([
                            "integration",
                            "externalId",
                            "entityType",
                            "companyId"
                          ])
                          .where("allowDuplicateExternalId", "=", false)
                          .doUpdateSet({
                            entityId: itemId,
                            metadata: data.data,
                            updatedAt: datetime.timestamp()
                          })
                      )
                      .execute();
                  }

                  await trx
                    .insertInto("part")
                    .values({
                      id: partId,
                      companyId,
                      createdBy: userId
                    })
                    .onConflict((oc) =>
                      oc.columns(["id", "companyId"]).doUpdateSet({
                        updatedBy: userId,
                        updatedAt: datetime.timestamp()
                      })
                    )
                    .execute();

                  // Store the newly created item to avoid duplicate inserts
                  if (itemId) {
                    newlyCreatedItemsByPartId.set(partId, itemId);
                    // Also update our existing items map for later reference
                    existingItemsByItemId.set(itemId, {
                      id: itemId,
                      readableId: partId,
                      readableIdWithRevision: getReadableIdWithRevision(
                        partId,
                        revision
                      ),
                      revision: revision ?? "0",
                      unitOfMeasureCode: "EA",
                      type: "Part"
                    });
                  }
                }
              }

              if (!itemId) throw new Error("Failed to create item");

              let materialMakeMethodId: string | undefined;
              const existingMakeMethod =
                existingMakeMethodsByItemId.get(itemId) ||
                newlyCreatedMakeMethodsByItemId.get(itemId);

              logger.info({
                action: "processing_item",
                itemId,
                partId,
                isMade,
                defaultMethodType,
                existingMakeMethod: existingMakeMethod ?? null
              });

              if (defaultMethodType === "Make to Order" || isMade) {
                if (existingMakeMethod) {
                  if (existingMakeMethod.status === "Draft") {
                    // Draft - use existing make method directly
                    materialMakeMethodId = existingMakeMethod.id;
                  } else {
                    // Active - check if there's already a Draft we can use
                    const existingDraft = await trx
                      .selectFrom("makeMethod")
                      .select(["id", "version"])
                      .where("itemId", "=", itemId)
                      .where("status", "=", "Draft")
                      .where("companyId", "=", companyId)
                      .orderBy("version", "desc")
                      .executeTakeFirst();

                    logger.info({
                      action: "check_existing_draft",
                      itemId,
                      companyId,
                      existingDraft: existingDraft ?? null
                    });

                    if (existingDraft) {
                      // Use the existing Draft
                      materialMakeMethodId = existingDraft.id;
                      const makeMethodInfo: MakeMethodInfo = {
                        id: existingDraft.id,
                        itemId,
                        version: Number(existingDraft.version),
                        status: "Draft"
                      };
                      newlyCreatedMakeMethodsByItemId.set(
                        itemId,
                        makeMethodInfo
                      );
                      existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                    } else {
                      // Get max version across ALL make methods for this item
                      const maxVersionRow = await trx
                        .selectFrom("makeMethod")
                        .select(["version"])
                        .where("itemId", "=", itemId)
                        .where("companyId", "=", companyId)
                        .orderBy("version", "desc")
                        .executeTakeFirst();

                      const maxVersion = Number(maxVersionRow?.version ?? 0);
                      const newVersion = maxVersion + 1;

                      logger.info({
                        action: "creating_child_draft",
                        itemId,
                        companyId,
                        maxVersionRow: maxVersionRow ?? null,
                        maxVersion,
                        newVersion
                      });

                      const newMakeMethod = await trx
                        .insertInto("makeMethod")
                        .values({
                          itemId,
                          version: newVersion,
                          status: "Draft",
                          companyId,
                          createdBy: userId
                        })
                        .returning(["id"])
                        .executeTakeFirst();

                      if (newMakeMethod) {
                        materialMakeMethodId = newMakeMethod.id;

                        // Copy operations from active version to new draft
                        await copyMakeMethodOperations(
                          trx,
                          existingMakeMethod.id,
                          newMakeMethod.id,
                          companyId,
                          userId
                        );

                        // Update tracking maps
                        const newMakeMethodInfo: MakeMethodInfo = {
                          id: newMakeMethod.id,
                          itemId,
                          version: newVersion,
                          status: "Draft"
                        };
                        newlyCreatedMakeMethodsByItemId.set(
                          itemId,
                          newMakeMethodInfo
                        );
                        existingMakeMethodsByItemId.set(
                          itemId,
                          newMakeMethodInfo
                        );
                      }
                    }
                  }
                } else {
                  // No existing make method - check if trigger created one, or create new
                  const triggerCreatedMakeMethod = await trx
                    .selectFrom("makeMethod")
                    .select(["id", "version", "status"])
                    .where("itemId", "=", itemId)
                    .executeTakeFirst();

                  if (triggerCreatedMakeMethod) {
                    materialMakeMethodId = triggerCreatedMakeMethod.id;
                    const makeMethodInfo: MakeMethodInfo = {
                      id: triggerCreatedMakeMethod.id,
                      itemId,
                      version: Number(triggerCreatedMakeMethod.version),
                      status: triggerCreatedMakeMethod.status as
                        | "Draft"
                        | "Active"
                        | "Archived"
                    };
                    newlyCreatedMakeMethodsByItemId.set(itemId, makeMethodInfo);
                    existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                  } else {
                    // Create a new make method if needed
                    const newMakeMethod = await trx
                      .insertInto("makeMethod")
                      .values({
                        itemId,
                        companyId,
                        createdBy: userId
                      })
                      .returning(["id"])
                      .executeTakeFirst();

                    materialMakeMethodId = newMakeMethod?.id;

                    if (materialMakeMethodId) {
                      const makeMethodInfo: MakeMethodInfo = {
                        id: materialMakeMethodId,
                        itemId,
                        version: 1,
                        status: "Draft"
                      };
                      newlyCreatedMakeMethodsByItemId.set(
                        itemId,
                        makeMethodInfo
                      );
                      existingMakeMethodsByItemId.set(itemId, makeMethodInfo);
                    }
                  }
                }
              }

              await trx
                .insertInto("methodMaterial")
                .values({
                  itemId,
                  quantity: quantity ?? 1,
                  makeMethodId: parentMakeMethodId,
                  materialMakeMethodId,
                  methodType: defaultMethodType,
                  order: index,
                  itemType: existingItemsByItemId.get(itemId)?.type ?? "Part",
                  unitOfMeasureCode:
                    existingItemsByItemId.get(itemId)?.unitOfMeasureCode ??
                    "EA",
                  companyId,
                  createdBy: userId
                })
                .execute();

              if (materialMakeMethodId) {
                await trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "=", materialMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute();

                for await (const child of children) {
                  const childIndex = children.indexOf(child);
                  await traverseTree(child, materialMakeMethodId, childIndex);
                }
              }
            }

            let index = 0;
            for await (const node of tree) {
              await traverseTree(node, activeMakeMethodId, index);
              index++;
            }
          });
      }

      return {
        success: true,
        makeMethodId: activeMakeMethodId
      };
    }
  }
}

// ── Service function helpers ────────────────────────────────────────────────

/** The write's result, with the release lock's warning when release control only warns. */
export function withLockNotice<T>(lock: LockCheck, result: T | CarbonError) {
  if (result instanceof CarbonError || !lock.warn) return result;
  return Object.assign({}, result, { notice: lock.message });
}

/** A change notice write's own refusal, passed through; anything else is internal. */
export function changeNoticeRefusal(
  ctx: ServiceContext,
  error: { message: string; code?: string } | null,
  fallback: string
) {
  if (error?.message === changeNoticeUpdatedElsewhere) {
    return ctx.error("conflict", error.message);
  }
  if (error?.code === SERVICE_RULE_ERROR_CODE) {
    return ctx.error("rule", error.message);
  }
  return ctx.error("internal", fallback, error);
}

/**
 * Write a drag-sort of one make method's materials or operations: one
 * statement, scoped to the company and the method, all or nothing.
 */
export async function reorderMethodRows(
  ctx: ServiceContext,
  table: "methodMaterial" | "methodOperation",
  updates: { id: string; order: number }[]
) {
  if (updates.length === 0) return { ids: [] as string[], notice: undefined };
  const companyId = ctx.company.id;
  // Both tables carry makeMethodId; the cast only gives supabase-js one table to type.
  const rows = await ctx.asCaller.supabase
    .from(table as "methodMaterial")
    .select("makeMethodId")
    .in(
      "id",
      updates.map((update) => update.id)
    )
    .eq("companyId", companyId);
  if (rows.error) {
    return ctx.error("internal", "Failed to update sort order", rows.error);
  }
  const [makeMethodId, ...others] = pluckUnique(
    rows.data,
    (row) => row.makeMethodId
  );
  if (
    !makeMethodId ||
    others.length > 0 ||
    rows.data.length !== updates.length
  ) {
    return ctx.error("rule", "The rows must belong to one make method");
  }

  const lock = await checkRevisionLock(ctx.asCaller.supabase, {
    kind: "makeMethod",
    id: makeMethodId,
    companyId
  });
  if (!lock.ok) return ctx.error("rule", lock.message);

  await updateSortOrder(ctx.asSystem.pg, {
    table,
    column: "order",
    companyId,
    userId: ctx.auditUserId,
    parent: { column: "makeMethodId", id: makeMethodId },
    updates: updates.map(({ id, order }) => ({ id, sortOrder: order }))
  });
  return {
    ids: updates.map((update) => update.id),
    notice: lock.warn ? lock.message : undefined
  };
}

/**
 * Why a job cannot be created from these records, or null: every id must be
 * this company's (the job is written with the service role), the item must
 * not be one an unreleased change notice holds (the job would take its draft
 * method), and a Make to Asset item must be able to complete to its asset.
 * The last is checked here, not only at release, so the form says why while
 * the item is still being chosen.
 */
export async function jobCreationRefusal(
  ctx: ServiceContext,
  job: {
    itemId: string;
    quantity?: number;
    locationId?: string | null;
    customerId?: string | null;
    modelUploadId?: string | null;
    fixedAssetClassId?: string | null;
    fixedAssetId?: string | null;
    storageUnitId?: string | null;
    salesOrderId?: string | null;
    salesOrderLineId?: string | null;
    quoteId?: string | null;
    quoteLineId?: string | null;
  }
): Promise<CarbonError | null> {
  const owned = await productionPostings.requireOwnRecords(ctx, [
    ["item", job.itemId, "item"],
    ["location", job.locationId, "location"],
    ["customer", job.customerId, "customer"],
    ["modelUpload", job.modelUploadId, "model"],
    ["fixedAssetClass", job.fixedAssetClassId, "fixed asset class"],
    ["fixedAsset", job.fixedAssetId, "fixed asset"],
    ["storageUnit", job.storageUnitId, "storage unit"],
    ["salesOrder", job.salesOrderId, "sales order"],
    ["salesOrderLine", job.salesOrderLineId, "sales order line"],
    ["quote", job.quoteId, "quote"],
    ["quoteLine", job.quoteLineId, "quote line"]
  ]);
  if (owned) return owned;

  const unreleasedIssue = await getUnreleasedChangeOrderIssue(
    ctx.asSystem.supabase,
    { itemId: job.itemId, companyId: ctx.company.id }
  );
  if (unreleasedIssue) {
    return ctx.error("rule", `${unreleasedIssue} A job cannot be made for it.`);
  }

  if (job.fixedAssetClassId || job.fixedAssetId) {
    const item = await ctx.asSystem.supabase
      .from("item")
      .select("itemTrackingType")
      .eq("id", job.itemId)
      .eq("companyId", ctx.company.id)
      .single();
    const itemError = makeToAssetItemError({
      ...job,
      itemTrackingType: item.data?.itemTrackingType
    });
    if (itemError) return ctx.error("rule", itemError);
  }
  return null;
}

/**
 * Why a job's method cannot be saved onto make method `targetId`, or null:
 * the item's revision is released and release control enforces it, or a
 * change notice holds the method. The same lock as the items' Save Method.
 */
export async function saveMethodRefusal(ctx: ServiceContext, targetId: string) {
  const lock = await checkRevisionLock(ctx.asSystem.supabase, {
    kind: "makeMethod",
    id: targetId,
    companyId: ctx.company.id
  });
  return lock.ok ? null : ctx.error("rule", lock.message);
}
