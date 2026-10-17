// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  buildBatchSplitRecords,
  datetime,
  EPSILON,
  pick,
  resolveTrackedEntityBin,
  round
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";

const logger = getLogger("erp", "quality");

import { openai } from "@ai-sdk/openai";
import { NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import * as engine from "@carbon/database/quality";
import {
  errResult,
  lockIssueDispositions,
  type Result
} from "@carbon/database/quality";
import { inOrder, many, single } from "@carbon/database/rows";
import { openApprovalRequests } from "@carbon/ee/approvals/document.server";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import { generateText, Output } from "ai";
import template from "lodash.template";
import { nanoid } from "nanoid";
import { systemContext } from "~/modules/service-context.server";
import { getCachedCompanyIntegrations } from "~/modules/settings/settings.service";
import {
  type AdjustmentItemCost,
  assertCompanyRecords,
  bookAdjustment,
  createAdjustmentJournal,
  getCurrentAccountingPeriod,
  getDefaultPostingGroup,
  getExternalLink,
  invokeCreate,
  invokePosting
} from "~/modules/shared/shared.service";
import type { inspectionStatus } from "../shared/shared.models";
import type {
  gaugeCalibrationRecordValidator,
  gaugeCalibrationStatus,
  gaugeRole,
  gaugeTypeValidator,
  inspectionDocumentSamplingValidator,
  inspectionDocumentValidator,
  issueTypeValidator,
  issueWorkflowValidator,
  itemInspectionDocumentAssignmentValidator,
  nonConformanceApprovalRequirement,
  nonConformanceReviewerValidator,
  nonConformanceStatus,
  qualityDocumentValidator,
  riskRegisterValidator,
  riskSource,
  riskStatus
} from "./quality.models";
import {
  type BalloonRegionAnalysis,
  balloonRegionAnalysisResultSchema,
  type inspectionDispositionValidator,
  type inspectionMeasurementValidator,
  type inspectionSampleValidator,
  type inspectionSaveAnchorsPayloadValidator,
  type inspectionSaveBalloonsGeometryPayloadValidator,
  type inspectionSaveBalloonsPayloadValidator,
  type inspectionSaveFeaturesPayloadValidator,
  isIssueLocked
} from "./quality.models";

export async function activateGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client
    .from("gauges")
    .update({ gaugeStatus: "Active" })
    .eq("id", gaugeId);
}

export async function deactivateGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client
    .from("gauges")
    .update({ gaugeStatus: "Inactive" })
    .eq("id", gaugeId);
}

export async function deleteGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client.from("gauges").delete().eq("id", gaugeId);
}

export async function deleteGaugeCalibrationRecord(
  client: SupabaseClient<Database>,
  gaugeCalibrationRecordId: string
) {
  return client
    .from("gaugeCalibrationRecord")
    .delete()
    .eq("id", gaugeCalibrationRecordId);
}

export async function deleteGaugeType(
  client: SupabaseClient<Database>,
  gaugeTypeId: string
) {
  return client.from("gaugeType").delete().eq("id", gaugeTypeId);
}

export async function deleteIssue(
  client: SupabaseClient<Database>,
  nonConformanceId: string
) {
  return client.from("nonConformance").delete().eq("id", nonConformanceId);
}

export async function deleteIssueAssociation(
  client: SupabaseClient<Database>,
  type: string,
  associationId: string
) {
  switch (type) {
    case "items":
      return await client
        .from("nonConformanceItem")
        .delete()
        .eq("id", associationId);
    case "customers":
      return await client
        .from("nonConformanceCustomer")
        .delete()
        .eq("id", associationId);
    case "suppliers":
      return await client
        .from("nonConformanceSupplier")
        .delete()
        .eq("id", associationId);
    case "jobOperations":
      return await client
        .from("nonConformanceJobOperation")
        .delete()
        .eq("id", associationId);
    case "purchaseOrderLines":
      return await client
        .from("nonConformancePurchaseOrderLine")
        .delete()
        .eq("id", associationId);
    case "salesOrderLines":
      return await client
        .from("nonConformanceSalesOrderLine")
        .delete()
        .eq("id", associationId);
    case "shipmentLines":
      return await client
        .from("nonConformanceShipmentLine")
        .delete()
        .eq("id", associationId);
    case "receiptLines":
      return await client
        .from("nonConformanceReceiptLine")
        .delete()
        .eq("id", associationId);
    case "salesReturnOrderLines":
      return await client
        .from("nonConformanceSalesReturnOrderLine")
        .delete()
        .eq("id", associationId);
    case "purchaseReturnOrderLines": {
      // This association row carries the per-quantity coverage that reduces
      // closeIssue's write-off. Deleting it after the linked return line has
      // shipped would make closeIssue write the same goods off AGAIN (the
      // return shipment already relieved inventory) — double relief for
      // untracked stock. Cancel or void the return instead.
      const association = await client
        .from("nonConformancePurchaseReturnOrderLine")
        .select("id, purchaseReturnOrderLine(quantityShipped)")
        .eq("id", associationId)
        .maybeSingle();
      if (association.error) return association;
      const shipped = Number(
        (
          association.data?.purchaseReturnOrderLine as {
            quantityShipped: number | null;
          } | null
        )?.quantityShipped ?? 0
      );
      if (shipped > 0) {
        return {
          data: null,
          error: {
            message:
              "Cannot remove this supplier-return link: quantity has already shipped against it, and the Issue's write-off depends on that coverage. Void the return shipment first."
          } as PostgrestError
        };
      }
      return await client
        .from("nonConformancePurchaseReturnOrderLine")
        .delete()
        .eq("id", associationId);
    }
    case "trackedEntities":
      return await client
        .from("nonConformanceTrackedEntity")
        .delete()
        .eq("id", associationId);
    case "inspections":
      return await (client as any)
        .from("nonConformanceInspection")
        .delete()
        .eq("id", associationId);
    default:
      throw new Error(`Invalid type: ${type}`);
  }
}

export async function deleteIssueType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .delete()
    .eq("id", nonConformanceTypeId);
}

export async function deleteIssueWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflowId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .update({ active: false })
    .eq("id", nonConformanceWorkflowId);
}

export async function deleteRequiredAction(
  client: SupabaseClient<Database>,
  requiredActionId: string
) {
  return client
    .from("nonConformanceRequiredAction")
    .delete()
    .eq("id", requiredActionId);
}

export async function deleteQualityDocument(
  client: SupabaseClient<Database>,
  qualityDocumentId: string
) {
  return client.from("qualityDocument").delete().eq("id", qualityDocumentId);
}

export async function deleteRisk(
  client: SupabaseClient<Database>,
  riskId: string
) {
  return client.from("riskRegister").delete().eq("id", riskId);
}

export async function getIssueFromExternalLink(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("nonConformanceSupplier")
    .select("*, nonConformance(*)")
    .eq("id", id)
    .single();
}

export async function getGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client.from("gauges").select("*").eq("id", gaugeId).single();
}

export async function getGauges(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("gauges")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `gaugeId.ilike.%${args.search}%,description.ilike.%${args.search}%,modelNumber.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "gaugeId", ascending: false }
    ]);
  }

  return query;
}

export async function getGaugesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    gaugeId: string;
    description: string;
  }>(client, "gauge", "id, name:gaugeId, description", (query) =>
    query.eq("companyId", companyId)
  );
}

export async function getGaugeCalibrationRecord(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("gaugeCalibrationRecords")
    .select("*")
    .eq("id", id)
    .single();
}

export async function getGaugeCalibrationRecords(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("gaugeCalibrationRecords")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `gaugeId.ilike.%${args.search}%,description.ilike.%${args.search}%,modelNumber.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false },
      { column: "dateCalibrated", ascending: false }
    ]);
  }

  return query;
}

export async function getGaugeCalibrationRecordsByGaugeId(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client
    .from("gaugeCalibrationRecords")
    .select("*")
    .eq("gaugeId", gaugeId)
    .order("createdAt", { ascending: false });
}

export async function getGaugeTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("gaugeType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getGaugeType(
  client: SupabaseClient<Database>,
  gaugeTypeId: string
) {
  return client.from("gaugeType").select("*").eq("id", gaugeTypeId).single();
}

export async function getGaugeTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("gaugeType")
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

export async function getIssue(
  client: SupabaseClient<Database>,
  nonConformanceId: string
) {
  return client
    .from("nonConformance")
    .select("*")
    .eq("id", nonConformanceId)
    .single();
}

export async function getIssues(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("issues")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `nonConformanceId.ilike.%${args.search}%,name.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "nonConformanceId", ascending: false }
    ]);
  }

  return query;
}

export async function getIssueWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflowId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .select("*")
    .eq("id", nonConformanceWorkflowId)
    .single();
}

export async function getIssueActionTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string,
  supplierId?: string
) {
  let query = client
    .from("nonConformanceActionTask")
    .select(
      "*, ...nonConformanceRequiredAction(name), nonConformanceActionProcess(processId, ...process(name)), supplier(name)"
    )
    .eq("nonConformanceId", id)
    .eq("companyId", companyId);

  if (supplierId) {
    query = query.eq("supplierId", supplierId);
  }

  const result = await query;

  if (result.error || !result.data) {
    return result;
  }

  // Fetch Linear and Jira mappings for all action task IDs
  const taskIds = result.data.map((t) => t.id);
  let linearMappings: Map<string, unknown> = new Map();
  let jiraMappings: Map<string, unknown> = new Map();

  if (taskIds.length > 0) {
    const [{ data: linearData }, { data: jiraData }] = await Promise.all([
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "nonConformanceActionTask")
        .eq("integration", "linear")
        .in("entityId", taskIds),
      client
        .from("externalIntegrationMapping")
        .select("entityId, metadata")
        .eq("entityType", "nonConformanceActionTask")
        .eq("integration", "jira")
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

export async function getIssueApprovalTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceApprovalTask")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("approvalType", { ascending: true });
}

export async function getIssueItems(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceItem")
    .select("*, ...item(name)")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function getIssueAssociations(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  const [
    items,
    jobOperations,
    jobsFromSteps,
    purchaseOrderLines,
    salesOrderLines,
    shipmentLines,
    receiptLines,
    salesReturnOrderLines,
    purchaseReturnOrderLines,
    trackedEntities,
    customers,
    suppliers,
    inspections
  ] = await Promise.all([
    // Items
    (client as any)
      .from("nonConformanceItem")
      .select(
        `
      id,
      itemId,
      disposition,
      quantity,
      createdAt,
      ...item(
        readableIdWithRevision
      ),
      links:nonConformanceItemTrackedEntity(
        id,
        quantity,
        trackedEntityId,
        trackedEntity(
          id,
          readableId,
          status,
          quantity,
          attributes
        )
      )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: true }),
    // Job Operations
    client
      .from("nonConformanceJobOperation")
      .select(
        `
        id,
        jobOperationId,
        jobId,
        jobReadableId,
        jobOperation (
          id,
          process (
            name
          )
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    client
      .from("jobOperationStep")
      .select(
        `
        id,
        nonConformanceActionTask!inner (
          nonConformanceId
        ),
        jobOperation!inner (
          id,
          jobId,
          job!inner (
            id,
            jobId
          ),
          process (
            name
          )
        )
      `
      )
      .eq("nonConformanceActionTask.nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Purchase Order Lines
    client
      .from("nonConformancePurchaseOrderLine")
      .select(
        `
        id,
        purchaseOrderLineId,
        purchaseOrderId,
        purchaseOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Sales Order Lines
    client
      .from("nonConformanceSalesOrderLine")
      .select(
        `
        id,
        salesOrderLineId,
        salesOrderId,
        salesOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Shipment Lines
    client
      .from("nonConformanceShipmentLine")
      .select(
        `
        id,
        shipmentLineId,
        shipmentId,
        shipmentReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Receipt Lines
    client
      .from("nonConformanceReceiptLine")
      .select(
        `
        id,
        receiptLineId,
        receiptId,
        receiptReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Sales Return Order Lines
    client
      .from("nonConformanceSalesReturnOrderLine")
      .select(
        `
        id,
        salesReturnOrderLineId,
        salesReturnOrderId,
        salesReturnOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Purchase Return Order Lines
    client
      .from("nonConformancePurchaseReturnOrderLine")
      .select(
        `
        id,
        purchaseReturnOrderLineId,
        purchaseReturnOrderId,
        purchaseReturnOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Tracked Entities
    client
      .from("nonConformanceTrackedEntity")
      .select(
        `
        id,
        trackedEntityId,
        trackedEntity:trackedEntity (
          id,
          readableId
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Customers
    client
      .from("nonConformanceCustomer")
      .select(
        `
        id,
        customerId,
        customer:customer (
          id,
          name
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Suppliers
    client
      .from("nonConformanceSupplier")
      .select(
        `
        id,
        supplierId,
        supplier:supplier (
          id,
          name
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Inbound Inspections
    (client as any)
      .from("nonConformanceInspection")
      .select(
        `
        id,
        inspectionId,
        inspection:inspection (
          id,
          inspectionId,
          itemReadableId,
          lotSize,
          status,
          sampleSize,
          acceptanceNumber
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId)
  ]);

  return {
    items:
      items.data?.map((item: any) => ({
        type: "items",
        id: item.id,
        documentId: item.itemId,
        documentReadableId: item.readableIdWithRevision || "",
        documentLineId: "",
        disposition: item.disposition,
        quantity: item.quantity,
        createdAt: item.createdAt,
        links: item.links ?? []
      })) || [],
    jobOperations: [
      // Manually-associated job operations
      ...(jobOperations.data?.map((item) => ({
        type: "jobOperations",
        id: item.id,
        documentId: item.jobId ?? "",
        documentLineId: item.jobOperationId,
        documentReadableId: `${item.jobReadableId || ""} - ${
          item.jobOperation?.process?.name || ""
        }`
      })) || []),
      // Jobs from inspection steps
      ...(jobsFromSteps.data?.map((step) => ({
        type: "jobOperationsInspection",
        id: step.id,
        documentId: step.jobOperation?.job?.id ?? "",
        documentLineId: step.jobOperation?.id ?? "",
        documentReadableId: `${step.jobOperation?.job?.jobId || ""} - ${
          step.jobOperation?.process?.name || ""
        }`
      })) || [])
    ],
    purchaseOrderLines:
      purchaseOrderLines.data?.map((item) => ({
        id: item.id,
        type: "purchaseOrderLines",
        documentId: item.purchaseOrderId ?? "",
        documentLineId: item.purchaseOrderLineId,
        documentReadableId: item.purchaseOrderReadableId || ""
      })) || [],
    salesOrderLines:
      salesOrderLines.data?.map((item) => ({
        id: item.id,
        type: "salesOrderLines",
        documentId: item.salesOrderId ?? "",
        documentLineId: item.salesOrderLineId,
        documentReadableId: item.salesOrderReadableId || ""
      })) || [],
    shipmentLines:
      shipmentLines.data?.map((item) => ({
        id: item.id,
        type: "shipmentLines",
        documentId: item.shipmentId ?? "",
        documentLineId: item.shipmentLineId,
        documentReadableId: item.shipmentReadableId || ""
      })) || [],
    receiptLines:
      receiptLines.data?.map((item) => ({
        id: item.id,
        type: "receiptLines",
        documentId: item.receiptId ?? "",
        documentLineId: item.receiptLineId,
        documentReadableId: item.receiptReadableId || ""
      })) || [],
    salesReturnOrderLines:
      salesReturnOrderLines.data?.map((item) => ({
        id: item.id,
        type: "salesReturnOrderLines",
        documentId: item.salesReturnOrderId ?? "",
        documentLineId: item.salesReturnOrderLineId,
        documentReadableId: item.salesReturnOrderReadableId || ""
      })) || [],
    purchaseReturnOrderLines:
      purchaseReturnOrderLines.data?.map((item) => ({
        id: item.id,
        type: "purchaseReturnOrderLines",
        documentId: item.purchaseReturnOrderId ?? "",
        documentLineId: item.purchaseReturnOrderLineId,
        documentReadableId: item.purchaseReturnOrderReadableId || ""
      })) || [],
    trackedEntities:
      trackedEntities.data?.map((item) => ({
        id: item.id,
        type: "trackedEntities",
        documentId: item.trackedEntityId ?? "",
        documentLineId: "",
        documentReadableId:
          item.trackedEntity?.readableId ?? item.trackedEntityId ?? ""
      })) || [],
    customers:
      customers.data?.map((c) => ({
        id: c.id,
        type: "customers",
        documentId: c.customerId ?? "",
        documentLineId: "",
        documentReadableId: c.customer.name
      })) || [],
    suppliers:
      suppliers.data?.map((item) => ({
        id: item.id,
        type: "suppliers",
        documentId: item.supplierId ?? "",
        documentLineId: "",
        documentReadableId: item.supplier.name
      })) || [],
    inspections: ((inspections as any)?.data ?? []).map((link: any) => ({
      id: link.id,
      type: "inspections",
      documentId: link.inspectionId ?? "",
      documentLineId: "",
      documentReadableId: link.inspection?.inspectionId ?? "",
      quantity: link.inspection?.lotSize ?? 0,
      status: link.inspection?.status ?? null
    }))
  };
}

export async function getIssueReviewers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceReviewer")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("id", { ascending: true });
}

export async function getIssueSuppliers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceSupplier")
    .select("supplierId, externalLinkId")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("id", { ascending: true });
}

export async function getIssueType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .select("*")
    .eq("id", nonConformanceTypeId)
    .single();
}

export async function getIssueTypeByName(
  client: SupabaseClient<Database>,
  companyId: string,
  name: string,
  excludeId?: string
) {
  // Case-insensitive exact match — escape LIKE wildcards in the name
  const pattern = name.replace(/([\\%_])/g, "\\$1");
  let query = client
    .from("nonConformanceType")
    .select("id")
    .eq("companyId", companyId)
    .ilike("name", pattern);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  return query.limit(1).maybeSingle();
}

export async function getIssueTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceType")
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

export async function getIssueWorkflows(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceWorkflow")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("active", true);

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

export async function getIssueWorkflowsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getIssueTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getQualityActions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("qualityActions")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `readableNonConformanceId.ilike.%${args.search}%,nonConformanceName.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getQualityDocument(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("qualityDocument")
    .select("*, qualityDocumentStep(*)")
    .eq("id", id)
    .single();
}

export async function getQualityDocumentSteps(
  client: SupabaseClient<Database>,
  qualityDocumentId: string
) {
  return client
    .from("qualityDocumentStep")
    .select("*")
    .eq("qualityDocumentId", qualityDocumentId);
}

export async function getQualityDocumentVersions(
  client: SupabaseClient<Database>,
  qualityDocument: { name: string; version: number },
  companyId: string
) {
  return client
    .from("qualityDocument")
    .select("*")
    .eq("name", qualityDocument.name)
    .eq("companyId", companyId)
    .neq("version", qualityDocument.version)
    .order("version", { ascending: false });
}

export async function getQualityDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("qualityDocuments")
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

export async function getQualityFiles(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/quality/${id}`);
  return result.data ?? [];
}

export async function getRequiredActionsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceRequiredAction")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getRequiredActions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceRequiredAction")
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

export async function getRequiredAction(
  client: SupabaseClient<Database>,
  requiredActionId: string
) {
  return client
    .from("nonConformanceRequiredAction")
    .select("*")
    .eq("id", requiredActionId)
    .single();
}

export async function getRisk(
  client: SupabaseClient<Database>,
  riskId: string
) {
  return client.from("riskRegister").select("*").eq("id", riskId).single();
}

export async function getRisks(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    status?: typeof riskStatus;
    source?: typeof riskSource;
    // might be needed later for filtering by assignee
    assignee?: string[];
  }
) {
  let query = client
    .from("riskRegisters")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `title.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args?.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  if (args?.source && args.source.length > 0) {
    query = query.in("source", args.source);
  }

  if (args?.assignee && args.assignee.length > 0) {
    query = query.in("assignee", args.assignee);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function insertIssueReviewer(
  client: SupabaseClient<Database>,
  reviewer: z.infer<typeof nonConformanceReviewerValidator> & {
    nonConformanceId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("nonConformanceReviewer").insert(reviewer);
}

export async function updateIssueActionProcesses(
  client: SupabaseClient<Database>,
  args: {
    actionTaskId: string;
    processIds: string[];
    companyId: string;
    createdBy: string;
  }
) {
  const { actionTaskId, processIds, companyId, createdBy } = args;
  // Delete all existing process associations
  const deleteResult = await client
    .from("nonConformanceActionProcess")
    .delete()
    .eq("actionTaskId", actionTaskId);

  if (deleteResult.error) {
    return deleteResult;
  }

  // Insert new process associations
  if (processIds.length > 0) {
    return client.from("nonConformanceActionProcess").insert(
      processIds.map((processId) => ({
        actionTaskId: actionTaskId,
        processId,
        companyId: companyId,
        createdBy: createdBy
      }))
    );
  } else {
    return deleteResult;
  }
}

/** The bare status write; starting, reopening and closing an issue is `setIssueStatus` / `completeIssue`. */
export async function updateIssueStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    status: (typeof nonConformanceStatus)[number];
    assignee: string | null | undefined;
    closeDate: string | null | undefined;
    updatedBy: string;
  }
) {
  const { id, companyId, ...row } = update;
  return client
    .from("nonConformance")
    .update(row)
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id");
}

/** The bare status write; the operation is `setIssueTaskStatus`, which also tells the integrations. */
export async function updateIssueTaskStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: "Pending" | "Completed" | "Skipped" | "In Progress";
    type: "investigation" | "action" | "approval" | "review";
    userId?: string;
    assignee?: string | null;
  }
) {
  const { id, status, type, userId, assignee } = args;
  const table =
    type === "action" || type === "investigation"
      ? "nonConformanceActionTask"
      : type === "review"
        ? "nonConformanceReviewer"
        : "nonConformanceApprovalTask";

  const finalAssignee = assignee || userId;

  // Set completedDate to today when status is "Completed"
  const updateData = {
    status,
    updatedBy: userId,
    assignee: finalAssignee
  };

  if (status === "Completed") {
    const task = await client
      .from(table)
      .select("companyId")
      .eq("id", id)
      .maybeSingle();
    const timezone = task.data?.companyId
      ? await getCompanyTimeZone(client, task.data.companyId)
      : "UTC";
    // @ts-expect-error
    updateData.completedDate = datetime.today(timezone).toString();
  }

  return client
    .from(table)
    .update(updateData)
    .eq("id", id)
    .select("nonConformanceId")
    .single();
}

export async function updateIssueTaskContent(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    type: "action" | "approval" | "review";
    content: JSONContent;
  }
) {
  const { id, content, type } = args;
  const table =
    type === "action"
      ? "nonConformanceActionTask"
      : type === "review"
        ? "nonConformanceReviewer"
        : "nonConformanceApprovalTask";

  return client
    .from(table)
    .update({ notes: content })
    .eq("id", id)
    .select("nonConformanceId")
    .single();
}

export async function insertGauge(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    gaugeId?: string;
    gaugeTypeId: string;
    gaugeRole: (typeof gaugeRole)[number];
    gaugeCalibrationStatus: (typeof gaugeCalibrationStatus)[number];
    supplierId?: string;
    modelNumber?: string;
    serialNumber?: string;
    description?: string;
    dateAcquired?: string;
    lastCalibrationDate?: string;
    nextCalibrationDate?: string;
    locationId?: string;
    storageUnitId?: string;
    calibrationIntervalInMonths?: number;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; gaugeId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let gaugeId: string;
  if (input.gaugeId) {
    gaugeId = input.gaugeId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "gauge",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate gauge sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    gaugeId = seq.data;
  }

  const gauge = await client
    .from("gauges")
    .insert({
      gaugeId,
      gaugeTypeId: input.gaugeTypeId,
      gaugeRole: input.gaugeRole,
      gaugeCalibrationStatus: input.gaugeCalibrationStatus,
      supplierId: input.supplierId ?? null,
      modelNumber: input.modelNumber ?? null,
      serialNumber: input.serialNumber ?? null,
      description: input.description ?? null,
      dateAcquired: input.dateAcquired ?? null,
      lastCalibrationDate: input.lastCalibrationDate ?? null,
      nextCalibrationDate: input.nextCalibrationDate ?? null,
      locationId: input.locationId ?? null,
      storageUnitId: input.storageUnitId ?? null,
      calibrationIntervalInMonths: input.calibrationIntervalInMonths ?? 6,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, gaugeId")
    .single();

  if (gauge.error) return { data: null, error: gauge.error };

  return {
    data: { id: gauge.data.id!, gaugeId: gauge.data.gaugeId! },
    error: null
  };
}

export async function updateGauge(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    gaugeId?: string;
    gaugeTypeId?: string;
    gaugeRole?: (typeof gaugeRole)[number];
    gaugeCalibrationStatus?: (typeof gaugeCalibrationStatus)[number];
    supplierId?: string | null;
    modelNumber?: string | null;
    serialNumber?: string | null;
    description?: string | null;
    dateAcquired?: string | null;
    lastCalibrationDate?: string | null;
    nextCalibrationDate?: string | null;
    locationId?: string | null;
    storageUnitId?: string | null;
    calibrationIntervalInMonths?: number;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("gauges")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id! }, error: null };
}

export async function upsertGaugeCalibrationRecord(
  client: SupabaseClient<Database>,
  gaugeCalibrationRecord:
    | (Omit<z.infer<typeof gaugeCalibrationRecordValidator>, "id"> & {
        companyId: string;
        inspectionStatus: (typeof inspectionStatus)[number];
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof gaugeCalibrationRecordValidator>, "id"> & {
        id: string;
        inspectionStatus: (typeof inspectionStatus)[number];
        updatedBy: string;
        customFields?: Json;
      })
) {
  const userId =
    "updatedBy" in gaugeCalibrationRecord
      ? gaugeCalibrationRecord.updatedBy
      : gaugeCalibrationRecord.createdBy;
  const gauge = await client
    .from("gauge")
    .select("*")
    .eq("id", gaugeCalibrationRecord.gaugeId)
    .single();

  if (gauge.error) return gauge;

  if (
    !gauge.data?.lastCalibrationDate ||
    parseDate(gauge.data.lastCalibrationDate) <=
      parseDate(gaugeCalibrationRecord.dateCalibrated)
  ) {
    const nextCalibrationDate = parseDate(gaugeCalibrationRecord.dateCalibrated)
      .add({
        months: gauge.data.calibrationIntervalInMonths
      })
      .toString();

    const update = await client
      .from("gauge")
      .update({
        gaugeCalibrationStatus:
          gaugeCalibrationRecord.inspectionStatus === "Pass"
            ? "In-Calibration"
            : "Out-of-Calibration",
        lastCalibrationDate: gaugeCalibrationRecord.dateCalibrated,
        nextCalibrationDate: nextCalibrationDate,
        // Reset lastCalibrationStatus when gauge passes calibration to allow future notifications
        lastCalibrationStatus:
          gaugeCalibrationRecord.inspectionStatus === "Pass"
            ? "In-Calibration"
            : gauge.data.lastCalibrationStatus,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", gaugeCalibrationRecord.gaugeId);

    if (update.error) return update;
  }

  if ("createdBy" in gaugeCalibrationRecord) {
    const data = sanitize(gaugeCalibrationRecord);
    if (data.humidity === 0) data.humidity = undefined;
    if (data.temperature === 0) data.temperature = undefined;

    return client
      .from("gaugeCalibrationRecord")
      .insert([data])
      .select("id")
      .single();
  }
  return client
    .from("gaugeCalibrationRecord")
    .update(
      sanitize({
        ...gaugeCalibrationRecord,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
    )
    .eq("id", gaugeCalibrationRecord.id);
}

export async function upsertGaugeType(
  client: SupabaseClient<Database>,
  gaugeType:
    | (Omit<z.infer<typeof gaugeTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof issueTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in gaugeType) {
    return client.from("gaugeType").insert([gaugeType]).select("id");
  } else {
    return client
      .from("gaugeType")
      .update(sanitize(gaugeType))
      .eq("id", gaugeType.id);
  }
}

export async function insertIssue(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    nonConformanceId?: string;
    name: string;
    priority: "Low" | "Medium" | "High" | "Critical";
    source: "Internal" | "External";
    locationId: string;
    nonConformanceTypeId: string;
    openDate?: string;
    description?: string;
    nonConformanceWorkflowId?: string;
    dueDate?: string;
    closeDate?: string;
    quantity?: number;
    requiredActionIds?: string[];
    approvalRequirements?: (typeof nonConformanceApprovalRequirement)[number][];
    items?: string[];
    jobOperationId?: string;
    customerId?: string;
    salesOrderLineId?: string;
    operationSupplierProcessId?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; nonConformanceId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let nonConformanceId: string;
  if (input.nonConformanceId) {
    nonConformanceId = input.nonConformanceId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "nonConformance",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate nonConformance sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    nonConformanceId = seq.data;
  }

  const {
    items,
    jobOperationId,
    customerId,
    salesOrderLineId,
    operationSupplierProcessId,
    ...data
  } = input;

  const result = await client
    .from("nonConformance")
    .insert({
      nonConformanceId,
      name: data.name,
      priority: data.priority,
      source: data.source,
      locationId: data.locationId,
      nonConformanceTypeId: data.nonConformanceTypeId,
      // Matches insertPurchaseOrder / insertSalesOrder, which default their own NOT NULL date.
      openDate:
        data.openDate ??
        datetime
          .today(await getCompanyTimeZone(client, data.companyId))
          .toString(),
      description: data.description ?? null,
      nonConformanceWorkflowId: data.nonConformanceWorkflowId ?? null,
      dueDate: data.dueDate ?? null,
      closeDate: data.closeDate ?? null,
      quantity: data.quantity ?? 1,
      requiredActionIds: data.requiredActionIds ?? [],
      approvalRequirements: data.approvalRequirements ?? [],
      customFields: data.customFields,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id, nonConformanceId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  const ncrId = result.data.id;

  if (items && items.length > 0) {
    const itemInsert = await client.from("nonConformanceItem").insert(
      items.map((item) => ({
        nonConformanceId: ncrId,
        itemId: item,
        companyId: input.companyId,
        createdBy: input.createdBy
      }))
    );
    if (itemInsert.error) {
      logger.error("Failed to insert non-conformance item", {
        error: itemInsert.error
      });
    }
  }

  if (jobOperationId) {
    // Callers pass the service role, so every lookup keyed on a caller id is
    // scoped: a foreign id matches nothing and no link is written.
    const jobOperation = await client
      .from("jobOperation")
      .select("*")
      .eq("id", jobOperationId)
      .eq("companyId", input.companyId)
      .single();
    if (jobOperation?.data) {
      const job = await client
        .from("job")
        .select("*")
        .eq("id", jobOperation.data.jobId)
        .eq("companyId", input.companyId)
        .single();
      if (job.data) {
        const jobOperationInsert = await client
          .from("nonConformanceJobOperation")
          .insert([
            {
              jobId: jobOperation.data.jobId,
              jobOperationId,
              nonConformanceId: ncrId,
              jobReadableId: job.data?.jobId,
              companyId: input.companyId,
              createdBy: input.createdBy
            }
          ]);
        if (jobOperationInsert.error) {
          logger.error("Failed to insert non-conformance job operation", {
            error: jobOperationInsert.error
          });
        }
      }
    }
  }

  if (customerId) {
    const customerInsert = await client.from("nonConformanceCustomer").insert([
      {
        companyId: input.companyId,
        createdBy: input.createdBy,
        customerId: customerId,
        nonConformanceId: ncrId
      }
    ]);
    if (customerInsert.error) {
      logger.error("Failed to insert non-conformance customer", {
        error: customerInsert.error
      });
    }
  }

  if (salesOrderLineId) {
    const salesOrderLine = await client
      .from("salesOrderLine")
      .select("*, salesOrder(salesOrderId)")
      .eq("id", salesOrderLineId)
      .eq("companyId", input.companyId)
      .single();
    if (salesOrderLine.data) {
      const salesOrderLineInsert = await client
        .from("nonConformanceSalesOrderLine")
        .insert([
          {
            companyId: input.companyId,
            createdBy: input.createdBy,
            salesOrderLineId: salesOrderLineId,
            salesOrderId: salesOrderLine.data.salesOrderId,
            salesOrderReadableId: salesOrderLine.data.salesOrder.salesOrderId,
            nonConformanceId: ncrId
          }
        ]);
      if (salesOrderLineInsert.error) {
        logger.error("Failed to insert non-conformance sales order line", {
          error: salesOrderLineInsert.error
        });
      }
    }
  }

  if (operationSupplierProcessId) {
    const operationSupplierProcess = await client
      .from("supplierProcess")
      .select("*")
      .eq("id", operationSupplierProcessId)
      .eq("companyId", input.companyId)
      .single();

    if (operationSupplierProcess.data) {
      const nonConformanceSupplierInsert = await client
        .from("nonConformanceSupplier")
        .insert([
          {
            companyId: input.companyId,
            createdBy: input.createdBy,
            supplierId: operationSupplierProcess.data.supplierId,
            nonConformanceId: ncrId
          }
        ]);
      if (nonConformanceSupplierInsert.error) {
        logger.error("Failed to insert non-conformance supplier", {
          error: nonConformanceSupplierInsert.error
        });
      }
    }
  }

  return {
    data: { id: ncrId, nonConformanceId: result.data.nonConformanceId },
    error: null
  };
}

const issueEditableFields = [
  "nonConformanceId",
  "name",
  "priority",
  "source",
  "locationId",
  "nonConformanceTypeId",
  "nonConformanceWorkflowId",
  "openDate",
  "dueDate",
  "closeDate",
  "description",
  "quantity",
  "requiredActionIds",
  "approvalRequirements",
  "customFields"
] as const;

/**
 * Writes only the fields sent, from `issueEditableFields`: `status` moves
 * only through `setIssueStatus` and `completeIssue`.
 */
export async function updateIssue(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    companyId: string;
    updatedBy: string;
    nonConformanceId?: string;
    name?: string;
    priority?: "Low" | "Medium" | "High" | "Critical";
    source?: "Internal" | "External";
    locationId?: string;
    nonConformanceTypeId?: string;
    nonConformanceWorkflowId?: string | null;
    openDate?: string;
    dueDate?: string | null;
    closeDate?: string | null;
    description?: string | null;
    quantity?: number;
    requiredActionIds?: string[];
    approvalRequirements?: (typeof nonConformanceApprovalRequirement)[number][];
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const result = await client
    .from("nonConformance")
    .update({
      ...sanitize(pick(input, [...issueEditableFields])),
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

export async function upsertIssueWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflow:
    | (Omit<z.infer<typeof issueWorkflowValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof issueWorkflowValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in nonConformanceWorkflow) {
    return client
      .from("nonConformanceWorkflow")
      .insert([nonConformanceWorkflow])
      .select("id")
      .single();
  } else {
    return client
      .from("nonConformanceWorkflow")
      .update(sanitize(nonConformanceWorkflow))
      .eq("id", nonConformanceWorkflow.id);
  }
}

export async function upsertIssueType(
  client: SupabaseClient<Database>,
  nonConformanceType:
    | (Omit<z.infer<typeof issueTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof issueTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in nonConformanceType) {
    return client
      .from("nonConformanceType")
      .insert([nonConformanceType])
      .select("id");
  } else {
    return client
      .from("nonConformanceType")
      .update(sanitize(nonConformanceType))
      .eq("id", nonConformanceType.id);
  }
}

export async function upsertRequiredAction(
  client: SupabaseClient<Database>,
  requiredAction:
    | (Omit<z.infer<typeof issueTypeValidator>, "id"> & {
        companyId: string;
        active?: boolean;
        createdBy: string;
      })
    | (Omit<z.infer<typeof issueTypeValidator>, "id"> & {
        id: string;
        active?: boolean;
        updatedBy: string;
      })
) {
  if ("createdBy" in requiredAction) {
    return client
      .from("nonConformanceRequiredAction")
      .insert([requiredAction])
      .select("id");
  } else {
    return client
      .from("nonConformanceRequiredAction")
      .update(sanitize(requiredAction))
      .eq("id", requiredAction.id);
  }
}

export async function upsertQualityDocument(
  client: SupabaseClient<Database>,
  qualityDocument:
    | (Omit<z.infer<typeof qualityDocumentValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof qualityDocumentValidator>, "id"> & {
        id: string;
        companyId?: string;
        updatedBy: string;
      })
) {
  const { copyFromId, ...rest } = qualityDocument;
  if ("id" in rest) {
    // companyId narrows the match; it must never move the row.
    const { id, companyId, ...update } = rest;
    let query = client
      .from("qualityDocument")
      .update(sanitize(update))
      .eq("id", id);
    if (companyId) query = query.eq("companyId", companyId);
    return query.select("id").single();
  }

  const insert = await client
    .from("qualityDocument")
    .insert([rest])
    .select("id")
    .single();
  if (insert.error) {
    return insert;
  }
  if (copyFromId) {
    const qualityDocument = await client
      .from("qualityDocument")
      .select("*, qualityDocumentStep(*)")
      .eq("id", copyFromId)
      .single();

    if (qualityDocument.error) {
      return qualityDocument;
    }

    const steps = qualityDocument.data.qualityDocumentStep ?? [];
    const workInstruction = (qualityDocument.data.content ?? {}) as JSONContent;

    const [updateWorkInstructions, insertSteps] = await Promise.all([
      client
        .from("qualityDocument")
        .update({
          content: workInstruction,
          tags: qualityDocument.data.tags
        })
        .eq("id", insert.data.id),
      steps.length > 0
        ? client.from("qualityDocumentStep").insert(
            steps.map((step) => {
              // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
              const { id, qualityDocumentId, ...rest } = step;
              return {
                ...rest,
                qualityDocumentId: insert.data.id,
                companyId: qualityDocument.data.companyId!
              };
            })
          )
        : Promise.resolve({ data: null, error: null })
    ]);

    if (updateWorkInstructions.error) {
      return updateWorkInstructions;
    }
    if (insertSteps.error) {
      return insertSteps;
    }
  }
  return insert;
}

/** The bare row write; the operations are `createRisk` / `updateRisk`, which notify the assignee. */
export async function upsertRisk(
  client: SupabaseClient<Database>,
  risk:
    | (Omit<
        z.infer<typeof riskRegisterValidator>,
        "id" | "severity" | "likelihood"
      > & {
        severity: number;
        likelihood: number;
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof riskRegisterValidator>,
        "id" | "severity" | "likelihood"
      > & {
        severity: number;
        likelihood: number;
        id: string;
        updatedBy: string; // This might be used for history/tracking if added
      })
) {
  if ("id" in risk) {
    const { updatedBy, ...data } = risk;
    return client
      .from("riskRegister")
      .update({
        ...sanitize(data),
        updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("id", risk.id)
      .select("id")
      .single();
  } else {
    return client
      .from("riskRegister")
      .insert([
        {
          ...sanitize(risk)
        }
      ])
      .select("id")
      .single();
  }
}

// -------------------------------------------------------------
// Inbound Inspections (lot-based)
// -------------------------------------------------------------

export async function getInspections(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    source: string | null;
  }
) {
  // No receipt embed: the generic sourceDocumentId carries no FK, so the
  // source document is denormalized onto the row (sourceDocumentReadableId).
  let query = client
    .from("inspection")
    .select(
      "*, item(readableId, name), supplier(name), inspectionSample(status)",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `itemReadableId.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%,notes.ilike.%${args.search}%`
    );
  }

  if (args?.status) {
    // @ts-expect-error - status is a valid enum value
    query = query.eq("status", args.status);
  }

  if (args?.source) {
    // @ts-expect-error - source is a valid enum value
    query = query.eq("sourceDocument", args.source);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getInspection(
  client: SupabaseClient<Database>,
  id: string
) {
  return (client as any)
    .from("inspection")
    .select(
      "*, item(readableId, name, type, itemTrackingType), supplier(name), inspectionSample(*, trackedEntity(id, readableId, attributes, status, sourceDocumentReadableId))"
    )
    .eq("id", id)
    .single();
}

// All inspection lots created for a receipt (one per inspected receipt line),
// keyed by the source-generic columns. Powers the receipt header's link/dropdown
// to its inspections.
export async function getReceiptInspections(
  client: SupabaseClient<Database>,
  receiptId: string,
  companyId: string
) {
  return client
    .from("inspection")
    .select("id, inspectionId, itemId, itemReadableId, status")
    .eq("sourceDocument", "Receipt")
    .eq("sourceDocumentId", receiptId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

// Receipt-sourced lots only: the received tracked entities are linked to the
// receipt line through their attributes.
export async function getInspectionTrackedEntities(
  client: SupabaseClient<Database>,
  receiptLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Receipt Line", receiptLineId)
    .eq("companyId", companyId);
}

export async function getInspectionSamplingPlans(
  client: SupabaseClient<Database>,
  inspectionId: string,
  companyId: string
) {
  // Embed by target table name, never alias:fkColumn — composite-FK embeds
  // break with the alias form.
  return client
    .from("inspectionSamplingPlan")
    .select(
      "*, inspectionFeature(id, label, description, pageNumber, type, nominalValue, tolerancePlus, toleranceMinus, unit, gaugeTypeId, gaugeType(name))"
    )
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

// The gauges an inspection lot's view needs: every Active gauge (the
// selectable options — Inactive gauges are retired and never offered, the
// engine refuses them too) plus any gauge already recorded on this lot, even
// if it has since been retired, so the record keeps showing its readable id.
export async function getInspectionGauges(
  client: SupabaseClient<Database>,
  companyId: string,
  inspectionId: string
) {
  const recorded = await client
    .from("inspectionSamplingPlan")
    .select("gaugeId")
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId)
    .not("gaugeId", "is", null);
  const recordedIds = [
    ...new Set((recorded.data ?? []).map((row) => row.gaugeId as string))
  ];

  const query = client
    .from("gauges")
    .select(
      "id, gaugeId, description, gaugeTypeId, gaugeStatus, gaugeCalibrationStatusWithDueDate, nextCalibrationDate"
    )
    .eq("companyId", companyId);

  return (
    recordedIds.length > 0
      ? query.or(
          `gaugeStatus.eq.Active,id.in.(${recordedIds.map((id) => `"${id}"`).join(",")})`
        )
      : query.eq("gaugeStatus", "Active")
  ).order("gaugeId");
}

export async function getInspectionMeasurements(
  client: SupabaseClient<Database>,
  inspectionId: string,
  companyId: string
) {
  return client
    .from("inspectionMeasurement")
    .select("*")
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

export async function getItemInspectionDocumentAssignments(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemInspectionDocumentAssignment")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
}

export async function upsertItemInspectionDocumentAssignment(
  client: SupabaseClient<Database>,
  assignment: z.infer<typeof itemInspectionDocumentAssignmentValidator> & {
    companyId: string;
    userId: string;
  }
) {
  if (!assignment.inspectionDocumentId) {
    return client
      .from("itemInspectionDocumentAssignment")
      .delete()
      .eq("itemId", assignment.itemId)
      .eq("usage", assignment.usage)
      .eq("companyId", assignment.companyId);
  }

  const existing = await client
    .from("itemInspectionDocumentAssignment")
    .select("itemId")
    .eq("itemId", assignment.itemId)
    .eq("usage", assignment.usage)
    .eq("companyId", assignment.companyId)
    .maybeSingle();

  if (existing.data) {
    return client
      .from("itemInspectionDocumentAssignment")
      .update({
        inspectionDocumentId: assignment.inspectionDocumentId,
        updatedBy: assignment.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("itemId", assignment.itemId)
      .eq("usage", assignment.usage)
      .eq("companyId", assignment.companyId);
  }

  return client.from("itemInspectionDocumentAssignment").insert({
    itemId: assignment.itemId,
    usage: assignment.usage,
    inspectionDocumentId: assignment.inspectionDocumentId,
    companyId: assignment.companyId,
    createdBy: assignment.userId
  });
}

// ─── Inspection Documents ─────────────────────────────────────────────────────

function toStoragePath(pdfUrl?: string | null) {
  if (!pdfUrl) return null;
  const previewPrefix = "/file/preview/private/";
  if (pdfUrl.startsWith(previewPrefix)) {
    return pdfUrl.slice(previewPrefix.length);
  }
  return pdfUrl;
}

function toPreviewUrl(storagePath?: string | null) {
  if (!storagePath) return null;
  return storagePath.startsWith("/file/preview/private/")
    ? storagePath
    : `/file/preview/private/${storagePath}`;
}

function fileNameFromPath(storagePath?: string | null) {
  if (!storagePath) return "drawing.pdf";
  return storagePath.split("/").at(-1) ?? "drawing.pdf";
}

function mapInspectionDocument(row: Record<string, unknown>) {
  const drawingNumber = (row.drawingNumber as string | null) ?? null;
  return {
    id: String(row.id),
    name: String(drawingNumber ?? row.fileName ?? "Untitled Diagram"),
    companyId: String(row.companyId),
    partId: (row.partId as string | null) ?? null,
    createdBy: String(row.createdBy),
    updatedBy: (row.updatedBy as string | null) ?? null,
    createdAt: String(row.createdAt),
    updatedAt: (row.updatedAt as string | null) ?? null,
    content: {
      drawingNumber,
      pdfUrl: toPreviewUrl((row.storagePath as string | null) ?? null),
      annotations: [],
      features: []
    },
    // The document's default sampling rule (feature rule -> document default
    // -> All). NUMERIC columns arrive as strings from PostgREST — coerce.
    sampling: {
      samplingPlanType: (row.samplingPlanType as string | null) ?? null,
      samplingSampleSize: (row.samplingSampleSize as number | null) ?? null,
      samplingPercentage:
        row.samplingPercentage == null ? null : Number(row.samplingPercentage),
      samplingAql: row.samplingAql == null ? null : Number(row.samplingAql),
      samplingInspectionLevel:
        (row.samplingInspectionLevel as string | null) ?? null,
      samplingSeverity: (row.samplingSeverity as string | null) ?? null
    }
  };
}

export async function getInspectionDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("inspectionDocuments")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `drawingNumber.ilike.%${args.search}%,fileName.ilike.%${args.search}%,partReadableId.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "drawingNumber", ascending: true }
    ]);
  }

  const result = await query;

  return {
    data: (result.data ?? []).map((row: Record<string, unknown>) =>
      mapInspectionDocument(row)
    ),
    count: result.count ?? 0,
    error: result.error
  };
}

export async function getInspectionDocumentsForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("inspectionDocument")
    .select("id, fileName, drawingNumber, version")
    .eq("companyId", companyId)
    .eq("partId", itemId)
    .order("updatedAt", { ascending: false, nullsFirst: false });
}

export async function getInspectionDocument(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const result = await client
    .from("inspectionDocument")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  return {
    data: result.data ? mapInspectionDocument(result.data) : null,
    error: result.error
  };
}

/**
 * When an inspection plan is created without a drawing number, fall back to the
 * part's readableIdWithRevision. If a plan with that drawing number already
 * exists for the company, append " (1)", " (2)", etc. until it is unique.
 */
async function resolveInspectionDocumentDrawingNumber(
  client: SupabaseClient<Database>,
  companyId: string,
  partId: string
): Promise<string | null> {
  const partResult = await client
    .from("item")
    .select("readableIdWithRevision")
    .eq("id", partId)
    .eq("companyId", companyId)
    .single();

  const base = partResult.data?.readableIdWithRevision?.trim();
  if (!base) return null;

  const existingResult = await client
    .from("inspectionDocument")
    .select("drawingNumber")
    .eq("companyId", companyId)
    .not("drawingNumber", "is", null);

  const taken = new Set(
    (existingResult.data ?? [])
      .map((row) => row.drawingNumber)
      .filter((value): value is string => Boolean(value))
  );

  if (!taken.has(base)) return base;

  let suffix = 1;
  while (taken.has(`${base} (${suffix})`)) {
    suffix += 1;
  }
  return `${base} (${suffix})`;
}

export async function upsertInspectionDocument(
  client: SupabaseClient<Database>,
  diagram:
    | (Omit<z.infer<typeof inspectionDocumentValidator>, "id"> & {
        id?: undefined;
        companyId: string;
        createdBy: string;
        updatedBy?: string;
        pageCount?: number;
        defaultPageWidth?: number;
        defaultPageHeight?: number;
      })
    | (Omit<z.infer<typeof inspectionDocumentValidator>, "id"> & {
        id: string;
        companyId: string;
        createdBy: string;
        updatedBy?: string;
        pageCount?: number;
        defaultPageWidth?: number;
        defaultPageHeight?: number;
      })
) {
  const {
    id,
    partId,
    drawingNumber,
    pdfUrl,
    pageCount,
    defaultPageWidth,
    defaultPageHeight,
    companyId,
    createdBy,
    updatedBy
  } = diagram;

  const storagePath = toStoragePath(pdfUrl);

  if (id) {
    if (!companyId) {
      return {
        data: null,
        error: {
          message: "companyId is required to update inspection plan"
        }
      };
    }

    const existing = await client
      .from("inspectionDocument")
      .select("id")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();

    if (!existing.data) {
      return {
        data: null,
        error: existing.error ?? { message: "Inspection plan not found" }
      };
    }

    const updatePayload: Database["public"]["Tables"]["inspectionDocument"]["Update"] =
      {
        updatedBy: updatedBy ?? createdBy,
        updatedAt: datetime.timestamp()
      };
    if (drawingNumber !== undefined) {
      updatePayload.drawingNumber = drawingNumber ?? null;
    }
    if (partId !== undefined) {
      updatePayload.partId = partId;
    }

    if (storagePath) {
      updatePayload.storagePath = storagePath;
      updatePayload.fileName = fileNameFromPath(storagePath);
    }
    if (pageCount && pageCount > 0) {
      updatePayload.pageCount = pageCount;
    }
    if (defaultPageWidth && defaultPageWidth > 0) {
      updatePayload.defaultPageWidth = defaultPageWidth;
    }
    if (defaultPageHeight && defaultPageHeight > 0) {
      updatePayload.defaultPageHeight = defaultPageHeight;
    }

    return client
      .from("inspectionDocument")
      .update(updatePayload)
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  if (!companyId) {
    return {
      data: null,
      error: { message: "companyId is required to create inspection plan" }
    };
  }

  const resolvedDrawingNumber = drawingNumber?.trim()
    ? drawingNumber.trim()
    : await resolveInspectionDocumentDrawingNumber(client, companyId, partId);

  return client
    .from("inspectionDocument")
    .insert({
      companyId,
      partId,
      drawingNumber: resolvedDrawingNumber ?? null,
      version: 0,
      ...(storagePath
        ? {
            storagePath,
            fileName: fileNameFromPath(storagePath),
            uploadedBy: createdBy
          }
        : {}),
      ...(pageCount && pageCount > 0 ? { pageCount } : {}),
      ...(defaultPageWidth && defaultPageWidth > 0 ? { defaultPageWidth } : {}),
      ...(defaultPageHeight && defaultPageHeight > 0
        ? { defaultPageHeight }
        : {}),
      createdBy
    })
    .select("id")
    .single();
}

export async function deleteInspectionDocument(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const existingResult = await client
    .from("inspectionDocument")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (!existingResult.data) {
    return {
      data: null,
      error: { message: "Inspection plan not found" }
    };
  }

  const storagePath =
    (existingResult.data.storagePath as string | null) ?? null;

  const deleteResult = await client
    .from("inspectionDocument")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);

  if (deleteResult.error) {
    return { data: null, error: deleteResult.error };
  }

  return {
    data: { storagePath },
    error: null
  };
}

function mapInspectionFeature(row: Record<string, unknown>) {
  const balloonIdRaw = row.balloonId ?? row.balloon_id;
  return {
    id: String(row.id),
    inspectionDocumentId: String(row.inspectionDocumentId),
    companyId: String(row.companyId),
    pageNumber: Number(row.pageNumber),
    label: String(row.label),
    description: (row.description as string | null) ?? null,
    nominalValue: (row.nominalValue as string | null) ?? null,
    tolerancePlus: (row.tolerancePlus as string | null) ?? null,
    toleranceMinus: (row.toleranceMinus as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    type: (row.type as string) ?? "Measurement",
    // Per-feature sampling rule (NULL = inherit the document default). NUMERIC
    // columns arrive as strings from PostgREST — coerce, mirroring the document
    // default rule in mapInspectionDocument.
    samplingPlanType: (row.samplingPlanType as string | null) ?? null,
    samplingSampleSize: (row.samplingSampleSize as number | null) ?? null,
    samplingPercentage:
      row.samplingPercentage == null ? null : Number(row.samplingPercentage),
    samplingAql: row.samplingAql == null ? null : Number(row.samplingAql),
    samplingInspectionLevel:
      (row.samplingInspectionLevel as string | null) ?? null,
    samplingSeverity: (row.samplingSeverity as string | null) ?? null,
    gaugeTypeId: (row.gaugeTypeId as string | null) ?? null,
    balloonId:
      typeof balloonIdRaw === "string"
        ? balloonIdRaw
        : balloonIdRaw != null
          ? String(balloonIdRaw)
          : null,
    createdBy: String(row.createdBy),
    updatedBy: (row.updatedBy as string | null) ?? null,
    createdAt: String(row.createdAt),
    updatedAt: (row.updatedAt as string | null) ?? null
  };
}

function mapBalloon(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    inspectionDocumentId: String(row.inspectionDocumentId),
    companyId: String(row.companyId),
    inspectionFeatureId: String(row.inspectionFeatureId),
    pageNumber: Number(row.pageNumber),
    regionX: Number(row.regionX),
    regionY: Number(row.regionY),
    regionWidth: Number(row.regionWidth),
    regionHeight: Number(row.regionHeight),
    xCoordinate: Number(row.xCoordinate),
    yCoordinate: Number(row.yCoordinate),
    createdBy: String(row.createdBy),
    updatedBy: (row.updatedBy as string | null) ?? null,
    createdAt: String(row.createdAt),
    updatedAt: (row.updatedAt as string | null) ?? null,
    balloonAnchorId: String(row.id)
  };
}

export async function getInspectionFeatures(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const [featuresResult, balloonsResult] = await Promise.all([
    getInspectionFeaturesRaw(client, inspectionDocumentId),
    getBalloons(client, inspectionDocumentId)
  ]);

  if (featuresResult.error) {
    return { data: null, error: featuresResult.error };
  }
  if (balloonsResult.error) {
    return { data: null, error: balloonsResult.error };
  }

  const balloonByFeatureId = new Map(
    (balloonsResult.data ?? []).map((b) => [b.inspectionFeatureId, b.id])
  );

  return {
    data: (featuresResult.data ?? []).map((row) =>
      mapInspectionFeature({
        ...row,
        balloonId: balloonByFeatureId.get(String(row.id)) ?? null
      })
    ),
    error: null
  };
}

async function getInspectionFeaturesRaw(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  return client
    .from("inspectionFeature")
    .select("*")
    .eq("inspectionDocumentId", inspectionDocumentId)
    .order("createdAt", { ascending: true });
}

export async function getBalloons(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const result = await client
    .from("balloon")
    .select("*")
    .eq("inspectionDocumentId", inspectionDocumentId)
    .order("createdAt", { ascending: true });

  return {
    data: (result.data ?? []).map(mapBalloon),
    error: result.error
  };
}

export async function getInspectionPlan(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const [featuresResult, balloonsResult] = await Promise.all([
    getInspectionFeaturesRaw(client, inspectionDocumentId),
    getBalloons(client, inspectionDocumentId)
  ]);

  if (featuresResult.error) {
    return { data: null, error: featuresResult.error };
  }
  if (balloonsResult.error) {
    return { data: null, error: balloonsResult.error };
  }

  const balloonByFeatureId = new Map(
    (balloonsResult.data ?? []).map((b) => [b.inspectionFeatureId, b])
  );

  return {
    data: (featuresResult.data ?? []).map((row) => {
      const b = balloonByFeatureId.get(row.id);
      const featureId = row.id;
      return {
        /** Feature id (primary key for plan rows). */
        id: featureId,
        featureId,
        /** Balloon id when placed; null for table-only features. */
        balloonId: b?.id ?? null,
        inspectionDocumentId: row.inspectionDocumentId,
        pageNumber: b?.pageNumber ?? row.pageNumber,
        label: row.label,
        description: row.description,
        nominalValue: row.nominalValue,
        tolerancePlus: row.tolerancePlus,
        toleranceMinus: row.toleranceMinus,
        unit: row.unit,
        regionX: b ? b.regionX : null,
        regionY: b ? b.regionY : null,
        regionWidth: b ? b.regionWidth : null,
        regionHeight: b ? b.regionHeight : null,
        xCoordinate: b ? b.xCoordinate : null,
        yCoordinate: b ? b.yCoordinate : null
      };
    }),
    error: null
  };
}

export async function updateInspectionDocumentSampling(
  client: SupabaseClient<Database>,
  args: z.infer<typeof inspectionDocumentSamplingValidator> & {
    inspectionDocumentId: string;
    companyId: string;
    userId: string;
  }
) {
  const { inspectionDocumentId, companyId, userId, ...sampling } = args;
  return client
    .from("inspectionDocument")
    .update({
      ...sampling,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", inspectionDocumentId)
    .eq("companyId", companyId);
}

export async function saveInspectionDocumentAtomic(
  client: SupabaseClient<Database>,
  args: {
    inspectionDocumentId: string;
    companyId: string;
    userId: string;
    pdfUrl?: string | null;
    pageCount?: number;
    defaultPageWidth?: number;
    defaultPageHeight?: number;
    features: unknown;
    balloons: unknown;
  }
) {
  return (
    client as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{
        data: unknown;
        error: unknown;
      }>;
    }
  ).rpc("save_inspection_document_atomic", {
    p_inspection_document_id: args.inspectionDocumentId,
    p_company_id: args.companyId,
    p_user_id: args.userId,
    p_pdf_url: args.pdfUrl ?? null,
    p_page_count: args.pageCount ?? null,
    p_default_page_width: args.defaultPageWidth ?? null,
    p_default_page_height: args.defaultPageHeight ?? null,
    p_features: args.features,
    p_balloons: args.balloons
  });
}
type TrackedEntityRow = Database["public"]["Tables"]["trackedEntity"]["Row"];

// -------------------------------------------------------------
// assignEntitiesToIssueItem
// -------------------------------------------------------------
// Writes:
//   - nonConformanceItemTrackedEntity (delete moved links, re-insert against target)
//   - nonConformanceItem (decrement source qty, increment target qty)

export async function assignEntitiesToIssueItem(
  db: Kysely<KyselyDatabase>,
  args: {
    nonConformanceItemId: string;
    targetItemId: string;
    assignments: { trackedEntityId: string; quantity: number }[];
    companyId: string;
    userId: string;
  }
): Promise<Result<{ moved: number }>> {
  const { nonConformanceItemId, targetItemId, assignments, companyId, userId } =
    args;

  if (assignments.length === 0) {
    return errResult("No assignments provided");
  }

  // Same source and target would decrement then re-inflate the same row off a
  // stale read, corrupting its quantity.
  if (nonConformanceItemId === targetItemId) {
    return errResult("Cannot move entities onto the same row");
  }

  const nowIso = datetime.timestamp();
  const entityIds = assignments.map((a) => a.trackedEntityId);

  try {
    const result = await db.transaction().execute(async (trx) => {
      // Lock the issue before reading any quantity, so a concurrent quantity
      // edit or link writer on the same issue waits for this move.
      const owner = await trx
        .selectFrom("nonConformanceItem")
        .select(["nonConformanceId"])
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!owner) throw new Error("Source item association not found");
      // Re-check the closed lock inside the transaction: the route check is a
      // separate read and could race with a concurrent close.
      const { status } = await lockIssueDispositions(trx, {
        nonConformanceId: owner.nonConformanceId,
        companyId
      });
      if (isIssueLocked(status)) {
        throw new Error("Cannot modify a closed issue. Reopen it first.");
      }

      const source = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!source) throw new Error("Source item association not found");

      const target = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!target) throw new Error("Target item association not found");

      if (source.nonConformanceId !== target.nonConformanceId) {
        throw new Error("Cannot move entities between different NCRs");
      }

      const existingLinks = await trx
        .selectFrom("nonConformanceItemTrackedEntity")
        .select(["quantity"])
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      // Round PER LINK, then round the sum: each link quantity is itself a
      // persisted value, so the row totals below must net exactly against the
      // link rows rather than against their raw float sum.
      const existingQty = round(
        existingLinks.reduce(
          (acc, l) => acc + round(Number(l.quantity ?? 0)),
          0
        )
      );
      const movingQty = round(
        assignments.reduce((acc, a) => acc + round(Number(a.quantity)), 0)
      );

      await trx
        .deleteFrom("nonConformanceItemTrackedEntity")
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .insertInto("nonConformanceItemTrackedEntity")
        .values(
          assignments.map((a) => ({
            nonConformanceItemId: targetItemId,
            nonConformanceId: target.nonConformanceId,
            trackedEntityId: a.trackedEntityId,
            quantity: round(Number(a.quantity)),
            companyId,
            createdBy: userId
          }))
        )
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: Math.max(
            0,
            round(round(Number(source.quantity ?? 0)) - existingQty)
          ),
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: round(round(Number(target.quantity ?? 0)) + movingQty),
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .execute();

      return { moved: assignments.length };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to move entities"
    );
  }
}

// -------------------------------------------------------------
// updateIssueItemQuantity
// -------------------------------------------------------------
// Writes:
//   - nonConformanceItem.quantity (compare-and-set on expectedQuantity)
//
// Only link-less rows on issues without an inspection link are editable: a
// tracked row's quantity is the sum of its links, and an inspection-originated
// issue already wrote off the lot, which closeIssue restores as row.quantity
// on Use As Is / Rework. The checks and the update run under the issue lock,
// which every link and inspection writer also takes, so a link cannot land
// between the check and the write.

export async function updateIssueItemQuantity(
  db: Kysely<KyselyDatabase>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    quantity: number;
    expectedQuantity: number;
  }
): Promise<Result<{ id: string }>> {
  const { id, companyId, userId, quantity, expectedQuantity } = args;

  try {
    return await db.transaction().execute(async (trx) => {
      const owner = await trx
        .selectFrom("nonConformanceItem")
        .select(["nonConformanceId"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!owner) return errResult("Issue item not found");

      const { status } = await lockIssueDispositions(trx, {
        nonConformanceId: owner.nonConformanceId,
        companyId
      });
      if (isIssueLocked(status)) {
        return errResult("Cannot modify a closed issue. Reopen it first.");
      }

      const link = await trx
        .selectFrom("nonConformanceItemTrackedEntity")
        .select(["id"])
        .where("nonConformanceItemId", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (link) {
        return errResult(
          "This row's quantity comes from its linked tracked entities. Split or move entities instead."
        );
      }

      const inspection = await trx
        .selectFrom("nonConformanceInspection")
        .select(["id"])
        .where("nonConformanceId", "=", owner.nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (inspection) {
        return errResult(
          "Quantity is set by the rejected inspection lot and cannot be edited."
        );
      }

      // Compare-and-set: a stale save (an older request finishing after a
      // newer one) matches no row instead of overwriting it.
      const updated = await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: round(quantity),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .where("quantity", "=", expectedQuantity)
        .returning(["id"])
        .executeTakeFirst();
      if (!updated) {
        return errResult(
          "This quantity changed since the page loaded. Refresh and try again."
        );
      }
      return { data: { id: updated.id }, error: null };
    });
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to update quantity"
    );
  }
}

// -------------------------------------------------------------
// linkEntitiesToIssueItemRow
// -------------------------------------------------------------
// Writes:
//   - nonConformanceItem (find-or-create the item's row, grow its quantity)
//   - nonConformanceItemTrackedEntity (one link per entity not yet on a row)
//
// The caller must hold lockIssueDispositions for the issue. Entities already
// linked to any row of the issue are skipped (an entity sits on at most one
// disposition row per issue). The row quantity grows by the linked entities'
// quantities, so it stays equal to the link sum. With no entities at all, a
// row still at 0 takes `fallbackQuantity` (e.g. an untracked inspection lot
// size); entities that are all already linked change nothing.

export async function linkEntitiesToIssueItemRow(
  trx: KyselyTx,
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    itemId: string;
    entities: { id: string; quantity: number }[];
    fallbackQuantity?: number;
  }
): Promise<void> {
  const { nonConformanceId, companyId, userId, itemId, entities } = args;
  const nowIso = datetime.timestamp();

  // splitIssueItem drops the old (nonConformanceId, itemId) unique constraint's
  // guarantee: a split item has several rows. Link onto the oldest — the row the
  // split shrank, which still holds the un-dispositioned remainder — rather than
  // whichever row Postgres happens to return first.
  let row = await trx
    .selectFrom("nonConformanceItem")
    .select(["id", "quantity"])
    .where("nonConformanceId", "=", nonConformanceId)
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .orderBy("createdAt")
    .orderBy("id")
    .executeTakeFirst();
  if (!row) {
    row = await trx
      .insertInto("nonConformanceItem")
      .values({
        nonConformanceId,
        itemId,
        quantity: 0,
        companyId,
        createdBy: userId
      })
      .returning(["id", "quantity"])
      .executeTakeFirstOrThrow();
  }
  const currentQty = Number(row.quantity ?? 0);

  if (entities.length === 0) {
    const fallback = args.fallbackQuantity ?? 0;
    if (currentQty === 0 && fallback > 0) {
      await trx
        .updateTable("nonConformanceItem")
        .set({ quantity: fallback, updatedBy: userId, updatedAt: nowIso })
        .where("id", "=", row.id)
        .where("companyId", "=", companyId)
        .execute();
    }
    return;
  }

  const alreadyLinked = await trx
    .selectFrom("nonConformanceItemTrackedEntity")
    .select(["trackedEntityId"])
    .where("nonConformanceId", "=", nonConformanceId)
    .where(
      "trackedEntityId",
      "in",
      entities.map((e) => e.id)
    )
    .where("companyId", "=", companyId)
    .execute();
  const alreadyLinkedIds = new Set(alreadyLinked.map((l) => l.trackedEntityId));
  const toLink = entities.filter((e) => !alreadyLinkedIds.has(e.id));
  if (toLink.length === 0) return;

  await trx
    .insertInto("nonConformanceItemTrackedEntity")
    .values(
      toLink.map((e) => ({
        nonConformanceItemId: row.id,
        nonConformanceId,
        trackedEntityId: e.id,
        quantity: round(e.quantity),
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  const addedQty = round(toLink.reduce((acc, e) => acc + round(e.quantity), 0));
  await trx
    .updateTable("nonConformanceItem")
    .set({
      quantity: round(round(currentQty) + addedQty),
      updatedBy: userId,
      updatedAt: nowIso
    })
    .where("id", "=", row.id)
    .where("companyId", "=", companyId)
    .execute();
}

// -------------------------------------------------------------
// splitIssueItem
// -------------------------------------------------------------
// Splits a disposition row into a new row so portions can get different
// dispositions. Whole linked lots are re-pointed to the new row; a quantity
// split that lands mid-lot subdivides the batch entity via subdivideBatchEntity.

// Physically subdivides a batch tracked entity, mirroring the MES issue split:
// creates a new lot for `moveQty` linked to `newRowId`, decrements the original
// lot to the builder's remaining quantity (kept on its existing row), and
// writes split genealogy
// (trackedActivity "Split" + input/output + net-zero "Batch Split" itemLedger,
// which leaves on-hand unchanged).
//
// NOTE: the split record contract (pointer attribute, edge shape, 2-row ledger
// pair) is the shared builder `buildBatchSplitRecords` (@carbon/utils) — the
// same one the issue/post-picking/post-stock-transfer/post-shipment server
// functions use. Don't hand-roll a divergent shape.

async function subdivideBatchEntity(
  trx: KyselyTx,
  args: {
    source: Pick<
      TrackedEntityRow,
      | "id"
      | "readableId"
      | "sourceDocumentId"
      | "sourceDocumentReadableId"
      | "status"
      | "attributes"
      | "itemId"
      | "expirationDate"
    >;
    linkId: string;
    newRowId: string;
    nonConformanceId: string;
    itemId: string;
    readableNc: string;
    locationId: string | null;
    entityQty: number;
    moveQty: number;
    companyId: string;
    userId: string;
    nowIso: string;
  }
): Promise<void> {
  const {
    source,
    linkId,
    newRowId,
    nonConformanceId,
    itemId,
    readableNc,
    locationId,
    entityQty,
    moveQty,
    companyId,
    userId,
    nowIso
  } = args;

  // The bin the source lot actually holds stock in — split ledger entries book
  // against it so per-storage-unit on-hand stays consistent.
  const sourceLedgerRows = await trx
    .selectFrom("itemLedger")
    .select(["trackedEntityId", "storageUnitId", "quantity"])
    .where("trackedEntityId", "=", source.id)
    .where("companyId", "=", companyId)
    .execute();
  const storageUnitId = resolveTrackedEntityBin(sourceLedgerRows, source.id);

  const split = buildBatchSplitRecords({
    parent: {
      id: source.id,
      readableId: source.readableId,
      quantity: entityQty,
      // Matches what this function always stamped on subdivision lots.
      sourceDocument: "Item",
      sourceDocumentId: source.sourceDocumentId,
      sourceDocumentReadableId: source.sourceDocumentReadableId,
      itemId: source.itemId ?? source.sourceDocumentId,
      expirationDate: source.expirationDate ?? null,
      attributes: source.attributes as Record<string, unknown> | null
    },
    drawQuantity: moveQty,
    childId: nanoid(),
    splitActivityId: nanoid(),
    activitySourceDocument: "Non-Conformance",
    activitySourceDocumentId: nonConformanceId,
    bin: { storageUnitId, locationId },
    itemLedgerItemId: itemId,
    companyId,
    userId,
    postingDate: nowIso.slice(0, 10),
    childStatus: "Available"
  });

  const newEntityId = split.childEntityInsert.id;

  await trx
    .insertInto("trackedEntity")
    .values({
      ...split.childEntityInsert,
      // Non-null in the node Insert type; the builder types them nullable.
      sourceDocument: "Item",
      sourceDocumentId: source.sourceDocumentId,
      attributes: split.childEntityInsert.attributes as Json,
      // NC-linked lots may be On Hold — the subdivided half inherits the
      // source's status, not a blanket Available.
      status: source.status ?? "Available"
    })
    .execute();

  // The retained lot is only decremented — no pointer is written on it; the
  // child carries "Split From Entity ID" instead. The remaining quantity comes
  // from the builder (rounded at the persist boundary), never from a separately
  // derived entityQty − moveQty that could round differently.
  await trx
    .updateTable("trackedEntity")
    .set(split.parentUpdate)
    .where("id", "=", source.id)
    .where("companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("nonConformanceItemTrackedEntity")
    .set({
      quantity: split.parentUpdate.quantity,
      updatedBy: userId,
      updatedAt: nowIso
    })
    .where("id", "=", linkId)
    .where("companyId", "=", companyId)
    .execute();

  await trx
    .insertInto("nonConformanceItemTrackedEntity")
    .values({
      nonConformanceItemId: newRowId,
      nonConformanceId,
      trackedEntityId: newEntityId,
      quantity: split.childEntityInsert.quantity,
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("trackedActivity")
    .values({
      ...split.activityInsert,
      sourceDocumentReadableId: readableNc,
      attributes: {
        ...split.activityInsert.attributes,
        "Non-Conformance": nonConformanceId,
        Employee: userId
      }
    })
    .execute();

  await trx
    .insertInto("trackedActivityInput")
    .values(split.activityInputInsert)
    .execute();

  await trx
    .insertInto("trackedActivityOutput")
    .values(split.activityOutputInsert)
    .execute();

  await trx
    .insertInto("itemLedger")
    .values(
      split.ledgerInserts.map((ledger) => ({
        ...ledger,
        // Non-null in the node Insert type; the builder types it nullable.
        itemId,
        comment: `NC ${readableNc} batch split`
      }))
    )
    .execute();
}

export async function splitIssueItem(
  db: Kysely<KyselyDatabase>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    splitQuantity?: number;
    entityAssignments?: { trackedEntityId: string; quantity: number }[];
  }
): Promise<Result<{ id: string }>> {
  const { id, companyId, userId, splitQuantity, entityAssignments } = args;
  const nowIso = datetime.timestamp();

  try {
    const result = await db.transaction().execute(async (trx) => {
      // Lock the issue before reading the row quantity, so a concurrent
      // quantity edit or link writer on the same issue waits for this split.
      const owner = await trx
        .selectFrom("nonConformanceItem")
        .select(["nonConformanceId"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!owner) throw new Error("Item association not found");
      // Re-check inside the transaction: the route lock check is a separate read
      // and could race with a concurrent close.
      const { status } = await lockIssueDispositions(trx, {
        nonConformanceId: owner.nonConformanceId,
        companyId
      });
      if (isIssueLocked(status)) {
        throw new Error("Cannot modify a closed issue. Reopen it first.");
      }

      const item = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "itemId", "quantity"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!item) throw new Error("Item association not found");

      const issue = await trx
        .selectFrom("nonConformance")
        .select(["nonConformanceId", "locationId"])
        .where("id", "=", item.nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const readableNc = issue?.nonConformanceId ?? item.nonConformanceId;
      const locationId = issue?.locationId ?? null;

      // Each NCR link owns a full lot, so a link's quantity always equals its
      // tracked entity's quantity — the greedy fill below relies on that.
      const links = await trx
        .selectFrom("nonConformanceItemTrackedEntity as link")
        .innerJoin("trackedEntity as te", "te.id", "link.trackedEntityId")
        .select([
          "link.id as linkId",
          "link.quantity as linkQuantity",
          "te.id as entityId",
          "te.quantity as entityQuantity",
          "te.status as entityStatus",
          "te.attributes as entityAttributes",
          "te.readableId as entityReadableId",
          "te.sourceDocumentId as entitySourceDocumentId",
          "te.sourceDocumentReadableId as entitySourceDocumentReadableId",
          "te.itemId as entityItemId",
          "te.expirationDate as entityExpirationDate"
        ])
        .where("link.nonConformanceItemId", "=", id)
        .where("link.companyId", "=", companyId)
        .where("te.companyId", "=", companyId)
        .orderBy("te.quantity", "asc")
        .execute();

      // Non-tracked row: no entities to move, so split is a pure quantity split
      // (e.g. scrap N, use-as-is the rest). Create a new Pending row for the
      // split-off quantity and shrink the original — no entity subdivision.
      if (links.length === 0) {
        // Compare at the SAME scale the writes below persist at. Raw operands
        // let a 0.999996 split of a 1 pass this gate and then round to a full
        // draw: the new row takes 1 and the original is set to 0.
        const current = round(Number(item.quantity ?? 0));
        const splitQty = round(
          typeof splitQuantity === "number" ? splitQuantity : NaN
        );
        if (!(splitQty > 0)) {
          throw new Error("Missing split parameters");
        }
        if (splitQty >= current) {
          throw new Error(
            `Split quantity (${splitQty}) must be less than the current quantity (${current})`
          );
        }

        const newRow = await trx
          .insertInto("nonConformanceItem")
          .values({
            nonConformanceId: item.nonConformanceId,
            itemId: item.itemId,
            quantity: round(splitQty),
            disposition: "Pending",
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .updateTable("nonConformanceItem")
          .set({
            quantity: round(round(current) - round(splitQty)),
            updatedBy: userId,
            updatedAt: nowIso
          })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();

        return { id: newRow.id };
      }

      // entityAssignments are whole-lot picks from the multi-entity checkbox UI;
      // splitQuantity fills greedily from the smallest lots, subdividing the
      // last one if it overshoots.
      type Move = { link: (typeof links)[number]; moveQty: number };
      const moves: Move[] = [];

      if (entityAssignments && entityAssignments.length > 0) {
        // Whole-lot picks: trust only the server-side link, not the client's
        // quantity, and reject unknown or duplicated entities.
        const seen = new Set<string>();
        for (const a of entityAssignments) {
          if (seen.has(a.trackedEntityId)) {
            throw new Error("Duplicate entity in split selection");
          }
          seen.add(a.trackedEntityId);
          const link = links.find((l) => l.entityId === a.trackedEntityId);
          if (!link) {
            throw new Error("Selected entity is not linked to this row");
          }
          moves.push({ link, moveQty: Number(link.linkQuantity ?? 0) });
        }
      } else if (typeof splitQuantity === "number" && splitQuantity > 0) {
        let remaining = splitQuantity;
        for (const link of links) {
          if (remaining <= EPSILON) break;
          const q = Number(link.linkQuantity ?? 0);
          if (q <= remaining + EPSILON) {
            moves.push({ link, moveQty: q });
            remaining -= q;
          } else {
            moves.push({ link, moveQty: remaining });
            remaining = 0;
            break;
          }
        }
        if (remaining > EPSILON) {
          throw new Error("Split quantity exceeds the linked entity quantity");
        }
      } else {
        throw new Error("Missing split parameters");
      }

      const effectiveSplitQty = round(
        moves.reduce((acc, m) => acc + round(m.moveQty), 0)
      );
      const current = round(Number(item.quantity ?? 0));
      if (effectiveSplitQty >= current) {
        throw new Error(
          `Split quantity (${effectiveSplitQty}) must be less than the current quantity (${current})`
        );
      }

      // New disposition row that receives the split-off portion.
      const newRow = await trx
        .insertInto("nonConformanceItem")
        .values({
          nonConformanceId: item.nonConformanceId,
          itemId: item.itemId,
          quantity: effectiveSplitQty,
          disposition: "Pending",
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      for (const { link, moveQty } of moves) {
        const entityQty = Number(link.entityQuantity ?? 0);

        if (moveQty >= entityQty - EPSILON) {
          // Whole lot moving — re-point the link, no physical change.
          await trx
            .updateTable("nonConformanceItemTrackedEntity")
            .set({
              nonConformanceItemId: newRow.id,
              updatedBy: userId,
              updatedAt: nowIso
            })
            .where("id", "=", link.linkId)
            .where("companyId", "=", companyId)
            .execute();
          continue;
        }

        await subdivideBatchEntity(trx, {
          source: {
            id: link.entityId,
            readableId: link.entityReadableId,
            sourceDocumentId: link.entitySourceDocumentId,
            sourceDocumentReadableId: link.entitySourceDocumentReadableId,
            status: link.entityStatus,
            attributes: link.entityAttributes,
            itemId: link.entityItemId,
            expirationDate: link.entityExpirationDate
          },
          linkId: link.linkId,
          newRowId: newRow.id,
          nonConformanceId: item.nonConformanceId,
          itemId: item.itemId,
          readableNc,
          locationId,
          entityQty,
          moveQty,
          companyId,
          userId,
          nowIso
        });
      }

      // Shrink the original row by whatever moved out.
      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: round(round(current) - effectiveSplitQty),
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      return { id: newRow.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to split line"
    );
  }
}

// -------------------------------------------------------------
// closeIssue
// -------------------------------------------------------------
// Validates disposition plan (qty sums, no Pending rows, no Consumed entities),
// posts inventory value movements (Scrap/Return write-offs + non-tracked restores)
// through the post-nonconformance operation (itemLedger + cost relief + GL,
// idempotent per NCR), THEN in one transaction re-validates under a row lock,
// writes disposition genealogy (trackedActivity + input), flips trackedEntity
// status (Use As Is / Rework → Available; Scrap / Return to Supplier → Rejected),
// and sets nonConformance.status = Closed. The value posting runs first so a GL
// failure aborts the close; the txn owns only status/genealogy.

type DispositionLink = {
  id: string;
  trackedEntityId: string;
  quantity: number;
  trackedEntityStatus: string | null;
};

type DispositionRow = {
  id: string;
  itemId: string;
  disposition: string | null;
  quantity: number;
  links: DispositionLink[];
};

type IssueClosureBlocker = { nonConformanceItemId: string; reason: string };

export async function closeIssue(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { nonConformanceId: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  const { nonConformanceId, companyId, userId } = args;

  // Preflight reads via Supabase (uses nested selects / RLS-aware service role)
  const planResult = await (client as any)
    .from("nonConformanceItem")
    .select(
      `
        id,
        itemId,
        disposition,
        quantity,
        links:nonConformanceItemTrackedEntity(
          id,
          quantity,
          trackedEntityId,
          trackedEntity(
            id,
            status
          )
        )
      `
    )
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });

  if (planResult.error || !planResult.data) {
    return errResult("Failed to load disposition plan");
  }

  const plan: DispositionRow[] = (planResult.data as any[]).map((row) => ({
    id: row.id,
    itemId: row.itemId,
    disposition: row.disposition,
    quantity: Number(row.quantity ?? 0),
    links: (row.links ?? []).map((link: any) => ({
      id: link.id,
      trackedEntityId: link.trackedEntityId,
      quantity: Number(link.quantity ?? 0),
      trackedEntityStatus: link.trackedEntity?.status ?? null
    }))
  }));

  // Supplier-return bridge state: linked purchaseReturnOrder lines cover
  // 'Return to Supplier' quantities. An OPEN linked return blocks the close
  // (ship, short-close, or cancel it first); shipped coverage reduces the
  // write-off (the return shipment already relieved inventory), and entities
  // that left via a return shipment are exempt from the Consumed guard and
  // the Rejected flip.
  const linkedReturnsResult = await (client as any)
    .from("nonConformancePurchaseReturnOrderLine")
    .select(
      `id, quantity, purchaseReturnOrderLineId,
       purchaseReturnOrderLine(
         id, itemId, quantityShipped,
         purchaseReturnOrder(id, purchaseReturnOrderId, status)
       )`
    )
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId);

  if (linkedReturnsResult.error) {
    return errResult("Failed to load linked supplier returns");
  }
  const linkedReturns = ((linkedReturnsResult.data as any[]) ?? []).filter(
    (row) =>
      row.purchaseReturnOrderLine?.purchaseReturnOrder?.status !== "Cancelled"
  );
  const openLinkedReturns = linkedReturns.filter((row) =>
    ["Draft", "To Ship"].includes(
      row.purchaseReturnOrderLine?.purchaseReturnOrder?.status ?? ""
    )
  );
  // Shipped coverage per item: min(covered quantity, the line's shipped
  // quantity) per association row — one association per line by construction.
  const shippedCoverageByItem = new Map<string, number>();
  for (const row of linkedReturns) {
    const line = row.purchaseReturnOrderLine;
    if (!line?.itemId) continue;
    const covered = Math.min(
      Number(row.quantity ?? 0),
      Number(line.quantityShipped ?? 0)
    );
    if (covered <= 0) continue;
    shippedCoverageByItem.set(
      line.itemId,
      (shippedCoverageByItem.get(line.itemId) ?? 0) + covered
    );
  }
  const linkedReturnLineIds = linkedReturns
    .map((row) => row.purchaseReturnOrderLineId)
    .filter(Boolean) as string[];
  let returnedEntityIds = new Set<string>();
  if (linkedReturnLineIds.length > 0) {
    const picks = await (client as any)
      .from("purchaseReturnOrderLineTrackedEntity")
      .select("trackedEntityId")
      .in("purchaseReturnOrderLineId", linkedReturnLineIds)
      .eq("companyId", companyId);
    if (picks.error) {
      return errResult("Failed to load supplier-return tracked entities");
    }
    returnedEntityIds = new Set(
      ((picks.data as any[]) ?? []).map((p) => p.trackedEntityId)
    );
  }

  const blockers: IssueClosureBlocker[] = [];
  for (const ret of openLinkedReturns) {
    blockers.push({
      nonConformanceItemId: ret.purchaseReturnOrderLineId,
      reason: `Supplier return ${
        ret.purchaseReturnOrderLine?.purchaseReturnOrder
          ?.purchaseReturnOrderId ?? ""
      } is open — ship, short-close, or cancel it first`
    });
  }
  for (const row of plan) {
    // Every row must be dispositioned before closing, tracked or not.
    if (!row.disposition || row.disposition === "Pending") {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: "Disposition is still Pending"
      });
      continue;
    }
    // Non-tracked rows carry no entity links — there is no per-entity quantity
    // sum or status to reconcile, so the disposition alone is enough.
    if (row.links.length === 0) continue;
    const sum = row.links.reduce((acc, l) => acc + l.quantity, 0);
    if (Math.abs(sum - row.quantity) > EPSILON) {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: `Linked entity quantity (${sum}) does not match row quantity (${row.quantity})`
      });
    }
    for (const link of row.links) {
      if (!link.trackedEntityStatus) {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: "Linked tracked entity is missing"
        });
      } else if (
        link.trackedEntityStatus === "Consumed" &&
        !returnedEntityIds.has(link.trackedEntityId)
      ) {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: `Tracked entity ${link.trackedEntityId} is already Consumed`
        });
      }
    }
  }

  if (blockers.length > 0) {
    return errResult(
      `Cannot close: ${blockers.map((b) => b.reason).join("; ")}`,
      blockers
    );
  }

  // Load the issue + disposition origin up front — needed to build the inventory
  // write-off movements and to short-circuit an already-closed NCR.
  const issueResult = await client
    .from("nonConformance")
    .select("id, nonConformanceId, status, locationId")
    .eq("id", nonConformanceId)
    .eq("companyId", companyId)
    .single();
  if (issueResult.error || !issueResult.data) {
    return errResult("Issue not found");
  }
  if (issueResult.data.status === "Closed") {
    return { data: { id: issueResult.data.id }, error: null };
  }
  const readableNc = issueResult.data.nonConformanceId ?? nonConformanceId;
  const locationId = issueResult.data.locationId;

  // Non-tracked origin: an inspection-rejected Inventory lot was already written
  // off at reject (so Use As Is / Rework restores value); a MES/manual non-tracked
  // scrap must be written off now. Detected via the NCR's inspection link (only
  // the reject route creates one).
  const linklessRows = plan.filter((r) => r.links.length === 0);
  const inventoryItemIds = new Set<string>();
  let inspectionOriginated = false;
  if (linklessRows.length > 0) {
    const linklessItemIds = [...new Set(linklessRows.map((r) => r.itemId))];
    const [trackingRes, inspectionRes] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", linklessItemIds)
        .eq("companyId", companyId),
      client
        .from("nonConformanceInspection")
        .select("id")
        .eq("nonConformanceId", nonConformanceId)
        .eq("companyId", companyId)
        .limit(1)
    ]);
    for (const it of trackingRes.data ?? []) {
      if (it.itemTrackingType === "Inventory") inventoryItemIds.add(it.id);
    }
    inspectionOriginated = (inspectionRes.data?.length ?? 0) > 0;
  }

  // Build the inventory value movements: tracked Scrap/Return → one −qty per
  // linked entity; non-tracked Inventory → −qty write-off (MES/manual scrap) or
  // +qty restore (inspection-kept). Use As Is / Rework on tracked, and any
  // Non-Inventory row, move no value.
  const movements: {
    itemId: string;
    locationId: string | null;
    trackedEntityId: string | null;
    quantity: number;
    comment: string;
  }[] = [];
  // Mutable copy: shipped-via-return coverage consumed as it offsets rows.
  const remainingCoverageByItem = new Map(shippedCoverageByItem);
  for (const row of plan) {
    const isScrap =
      row.disposition === "Scrap" || row.disposition === "Return to Supplier";
    const isKeep =
      row.disposition === "Use As Is" || row.disposition === "Rework";
    if (row.links.length > 0) {
      if (isScrap) {
        const suffix =
          row.disposition === "Scrap" ? "scrap" : "return to supplier";
        for (const link of row.links) {
          // Shipped via a linked supplier return: post-shipment already
          // relieved this entity's value — no write-off here.
          if (
            row.disposition === "Return to Supplier" &&
            returnedEntityIds.has(link.trackedEntityId) &&
            link.trackedEntityStatus === "Consumed"
          ) {
            continue;
          }
          movements.push({
            itemId: row.itemId,
            locationId,
            trackedEntityId: link.trackedEntityId,
            quantity: -link.quantity,
            comment: `NC ${readableNc} ${suffix}`
          });
        }
      }
      continue;
    }
    if (!inventoryItemIds.has(row.itemId)) continue; // Non-Inventory: no ledger
    if (isScrap && !inspectionOriginated) {
      let writeOff = row.quantity;
      if (row.disposition === "Return to Supplier") {
        const coverage = remainingCoverageByItem.get(row.itemId) ?? 0;
        const offset = Math.min(writeOff, coverage);
        if (offset > 0) {
          remainingCoverageByItem.set(row.itemId, coverage - offset);
          writeOff -= offset;
        }
      }
      if (writeOff <= EPSILON) continue;
      movements.push({
        itemId: row.itemId,
        locationId,
        trackedEntityId: null,
        quantity: -writeOff,
        comment: `NC ${readableNc} scrap`
      });
      continue;
    }
    if (isKeep && inspectionOriginated) {
      movements.push({
        itemId: row.itemId,
        locationId,
        trackedEntityId: null,
        quantity: row.quantity,
        comment: `NC ${readableNc} ${
          row.disposition === "Rework" ? "rework" : "use as is"
        } — restore on-hand`
      });
    }
  }

  // Post the inventory value movements (itemLedger + cost relief + GL) through
  // the operation BEFORE flipping statuses / closing. Idempotent per NCR, so
  // a retry after a later failure is safe; a posting failure aborts the close.
  if (movements.length > 0) {
    const post = await invokePosting(
      { db, companyId, userId },
      "post-nonconformance",
      {
        documentType: "Non-Conformance",
        documentId: nonConformanceId,
        description: `NC ${readableNc} disposition`,
        movements
      },
      postNonconformance
    );
    if (post.error) {
      return errResult(
        post.error.message || "Failed to post disposition to the ledger"
      );
    }
  }

  try {
    const result = await db.transaction().execute(async (trx) => {
      const issue = await trx
        .selectFrom("nonConformance")
        .select(["id", "status"])
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!issue) throw new Error("Issue not found");
      if (issue.status === "Closed") return { id: issue.id };

      const nowIso = datetime.timestamp();
      const today = nowIso.slice(0, 10);

      // The preflight plan above was read outside this transaction and can be
      // stale (a concurrent split/move changes rows and link quantities). Re-read
      // the plan under a row lock and re-validate the correctness-critical
      // invariants before posting, so a race rolls back instead of posting a
      // ledger off stale quantities. `forUpdate` on the item rows serializes
      // against split/move, which update the same rows.
      const itemRows = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "itemId", "disposition", "quantity"])
        .where("nonConformanceId", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();

      const linkRows = await trx
        .selectFrom("nonConformanceItemTrackedEntity as link")
        .innerJoin("trackedEntity as te", (join) =>
          join
            .onRef("te.id", "=", "link.trackedEntityId")
            .onRef("te.companyId", "=", "link.companyId")
        )
        .select([
          "link.nonConformanceItemId as nonConformanceItemId",
          "link.id as id",
          "link.trackedEntityId as trackedEntityId",
          "link.quantity as quantity",
          "te.status as trackedEntityStatus"
        ])
        .where("link.nonConformanceId", "=", nonConformanceId)
        .where("link.companyId", "=", companyId)
        .execute();

      const linksByItem = new Map<string, DispositionLink[]>();
      for (const link of linkRows) {
        const arr = linksByItem.get(link.nonConformanceItemId) ?? [];
        arr.push({
          id: link.id,
          trackedEntityId: link.trackedEntityId,
          quantity: Number(link.quantity ?? 0),
          trackedEntityStatus: link.trackedEntityStatus ?? null
        });
        linksByItem.set(link.nonConformanceItemId, arr);
      }

      // The supplier-return bridge was read in the preflight too, and it moves
      // independently of this issue: a linked return can ship (or be voided, or
      // confirmed) between that read and here. The write-off was computed from
      // the stale coverage, so posting it now would relieve the same goods the
      // return shipment already relieved — the double relief AC 15 forbids.
      // Re-read the linked return state and refuse if it moved.
      if (linkedReturnLineIds.length > 0) {
        const freshReturnLines = await trx
          .selectFrom("purchaseReturnOrderLine as prol")
          .innerJoin("purchaseReturnOrder as pro", (join) =>
            join
              .onRef("pro.id", "=", "prol.purchaseReturnOrderId")
              .onRef("pro.companyId", "=", "prol.companyId")
          )
          .select([
            "prol.id as id",
            "prol.quantityShipped as quantityShipped",
            "pro.status as status"
          ])
          .where("prol.id", "in", linkedReturnLineIds)
          .where("prol.companyId", "=", companyId)
          .forUpdate()
          .execute();

        const shippedAtPreflight = new Map(
          linkedReturns.map((row: any) => [
            row.purchaseReturnOrderLineId as string,
            Number(row.purchaseReturnOrderLine?.quantityShipped ?? 0)
          ])
        );
        for (const fresh of freshReturnLines) {
          if (["Draft", "To Ship"].includes(fresh.status ?? "")) {
            throw new Error(
              "A linked supplier return was reopened while closing; please retry."
            );
          }
          const before = shippedAtPreflight.get(fresh.id) ?? 0;
          if (Math.abs(Number(fresh.quantityShipped ?? 0) - before) > EPSILON) {
            throw new Error(
              "A linked supplier return shipped while closing; please retry."
            );
          }
        }
      }

      const freshPlan: DispositionRow[] = itemRows.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        disposition: row.disposition,
        quantity: Number(row.quantity ?? 0),
        links: linksByItem.get(row.id) ?? []
      }));

      for (const row of freshPlan) {
        if (!row.disposition || row.disposition === "Pending") {
          throw new Error("Disposition changed while closing; please retry.");
        }
        if (row.links.length === 0) continue;
        const sum = row.links.reduce((acc, l) => acc + l.quantity, 0);
        if (Math.abs(sum - row.quantity) > EPSILON) {
          throw new Error("Quantities changed while closing; please retry.");
        }
        for (const link of row.links) {
          if (
            !link.trackedEntityStatus ||
            (link.trackedEntityStatus === "Consumed" &&
              !returnedEntityIds.has(link.trackedEntityId))
          ) {
            throw new Error(
              "A tracked entity changed while closing; please retry."
            );
          }
        }
      }

      // Inventory value movements (write-offs / restores) were already posted by
      // post-nonconformance above. Here we only write disposition genealogy and
      // flip tracked-entity statuses; non-tracked rows have no entities, so they
      // need nothing further.
      for (const row of freshPlan) {
        if (row.links.length === 0) continue;

        const activity = await trx
          .insertInto("trackedActivity")
          .values({
            type: "Disposition",
            sourceDocument: "Non-Conformance",
            sourceDocumentId: nonConformanceId,
            sourceDocumentReadableId: readableNc,
            attributes: {
              "Non-Conformance": nonConformanceId,
              Disposition: row.disposition ?? "",
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("trackedActivityInput")
          .values(
            row.links.map((link) => ({
              trackedActivityId: activity.id,
              trackedEntityId: link.trackedEntityId,
              quantity: link.quantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();

        if (row.disposition === "Use As Is" || row.disposition === "Rework") {
          const idsToFlip = row.links
            .filter((l) => l.trackedEntityStatus !== "Available")
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Available" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
          continue;
        }

        if (
          row.disposition === "Scrap" ||
          row.disposition === "Return to Supplier"
        ) {
          // Entities that left via a linked supplier-return shipment are
          // Consumed with a closed genealogy — they stay Consumed.
          const idsToFlip = row.links
            .filter(
              (l) =>
                l.trackedEntityStatus !== "Rejected" &&
                !(
                  returnedEntityIds.has(l.trackedEntityId) &&
                  l.trackedEntityStatus === "Consumed"
                )
            )
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Rejected" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      }

      const updated = await trx
        .updateTable("nonConformance")
        .set({
          status: "Closed",
          closeDate: today,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return { id: updated.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to close NCR"
    );
  }
}
export type { Result } from "@carbon/database/quality";

export async function upsertInspectionSample(
  db: Kysely<KyselyDatabase>,
  sample: z.infer<typeof inspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
) {
  return engine.upsertInspectionSample(db, sample);
}

export async function dispositionInspection(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof inspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  } & Pick<engine.InspectionDispositionInput, "requireOpen" | "requireSource">
) {
  return engine.dispositionInspection(db, args);
}

export async function upsertInspectionMeasurement(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof inspectionMeasurementValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return engine.upsertInspectionMeasurement(db, args);
}

export async function reconcileInspectionSamplingPlans(
  db: Kysely<KyselyDatabase>,
  inspectionId: string,
  companyId: string
) {
  return engine.reconcileInspectionSamplingPlans(db, inspectionId, companyId);
}

export async function changeInspectionDocument(
  db: Kysely<KyselyDatabase>,
  args: {
    inspectionId: string;
    inspectionDocumentId: string | null;
    companyId: string;
    userId: string;
  }
) {
  return engine.changeInspectionDocument(db, args);
}

export async function recordInspectionGauge(
  db: Kysely<KyselyDatabase>,
  args: Parameters<typeof engine.recordInspectionGauge>[1]
) {
  return engine.recordInspectionGauge(db, args);
}

export async function getRecentInspectionGauges(
  db: Kysely<KyselyDatabase>,
  args: Parameters<typeof engine.getRecentInspectionGauges>[1]
) {
  return engine.getRecentInspectionGauges(db, args);
}

// ─── Inspection plan save ────────────────────────────────────────────────────

/** Maps persisted balloon ids to inspectionFeature ids for legacy save payloads. */
async function mapBalloonIdsToFeatureIdsForDocument(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const mapped = new Map<string, string>();
  for (const id of unique) {
    mapped.set(id, id);
  }

  const [balloons, features] = await Promise.all([
    client
      .from("balloon")
      .select("id, inspectionFeatureId")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId),
    client
      .from("inspectionFeature")
      .select("id")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId)
  ]);

  for (const balloon of balloons.data ?? []) {
    if (mapped.has(balloon.id)) {
      mapped.set(balloon.id, balloon.inspectionFeatureId);
    }
  }
  for (const row of features.data ?? []) {
    if (mapped.has(row.id)) {
      mapped.set(row.id, row.id);
    }
  }

  return mapped;
}

export type InspectionSaveFeaturesPayload = ReturnType<
  typeof inspectionSaveFeaturesPayloadValidator.parse
>;

export type InspectionSaveBalloonsGeometryPayload = ReturnType<
  typeof inspectionSaveBalloonsGeometryPayloadValidator.parse
>;

type LegacyAnchors = ReturnType<
  typeof inspectionSaveAnchorsPayloadValidator.parse
>;

type LegacyBalloons = ReturnType<
  typeof inspectionSaveBalloonsPayloadValidator.parse
>;

export function isTempInspectionId(id: string) {
  return id.startsWith("temp-");
}

/** Maps legacy anchors + metadata balloons save shape to features + geometry balloons. */
export function translateLegacyInspectionSavePayload(
  anchors: LegacyAnchors,
  balloons: LegacyBalloons
): {
  features: InspectionSaveFeaturesPayload;
  balloons: InspectionSaveBalloonsGeometryPayload;
} {
  const anchorByTempId = new Map(anchors.create.map((a) => [a.tempId, a]));

  const featuresCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      label: b.label,
      description: b.description ?? null,
      nominalValue: b.nominalValue ?? null,
      tolerancePlus: b.tolerancePlus ?? null,
      toleranceMinus: b.toleranceMinus ?? null,
      unit: b.unit ?? null
    };
  });

  for (const anchor of anchors.create) {
    if (featuresCreate.some((f) => f.tempId === anchor.tempId)) continue;
    featuresCreate.push({
      tempId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      label: "0",
      description: null,
      nominalValue: null,
      tolerancePlus: null,
      toleranceMinus: null,
      unit: null
    });
  }

  const balloonsCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempInspectionFeatureId: b.tempBalloonAnchorId,
      tempBalloonAnchorId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      regionX: anchor?.xCoordinate ?? 0,
      regionY: anchor?.yCoordinate ?? 0,
      regionWidth: anchor?.width ?? 0.1,
      regionHeight: anchor?.height ?? 0.1,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    };
  });

  for (const anchor of anchors.create) {
    if (balloons.create.some((b) => b.tempBalloonAnchorId === anchor.tempId)) {
      continue;
    }
    balloonsCreate.push({
      tempInspectionFeatureId: anchor.tempId,
      tempBalloonAnchorId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      regionX: anchor.xCoordinate,
      regionY: anchor.yCoordinate,
      regionWidth: anchor.width,
      regionHeight: anchor.height,
      xCoordinate: Math.min(
        1 - 0.04,
        Math.max(0, anchor.xCoordinate + anchor.width + 0.02)
      ),
      yCoordinate: Math.min(1 - 0.04, Math.max(0, anchor.yCoordinate))
    });
  }

  const featuresUpdate = balloons.update.map((b) => ({
    id: b.id,
    label: b.label,
    description: b.description ?? null,
    nominalValue: b.nominalValue ?? null,
    tolerancePlus: b.tolerancePlus ?? null,
    toleranceMinus: b.toleranceMinus ?? null,
    unit: b.unit ?? null
  }));

  const balloonsUpdate = [
    ...anchors.update.map((a) => ({
      id: a.id,
      pageNumber: a.pageNumber,
      regionX: a.xCoordinate,
      regionY: a.yCoordinate,
      regionWidth: a.width,
      regionHeight: a.height
    })),
    ...balloons.update.map((b) => ({
      id: b.id,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    }))
  ];

  const mergedBalloonUpdates = new Map<
    string,
    (typeof balloonsUpdate)[number]
  >();
  for (const item of balloonsUpdate) {
    const existing = mergedBalloonUpdates.get(item.id);
    mergedBalloonUpdates.set(item.id, { ...existing, ...item });
  }

  return {
    features: {
      create: featuresCreate,
      update: featuresUpdate,
      delete: [...new Set([...balloons.delete, ...anchors.delete])]
    },
    balloons: {
      create: balloonsCreate,
      update: [...mergedBalloonUpdates.values()],
      delete: []
    }
  };
}

export function mergeInspectionFeaturesPayload(
  base: InspectionSaveFeaturesPayload,
  extra: InspectionSaveFeaturesPayload
): InspectionSaveFeaturesPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export function mergeInspectionBalloonsPayload(
  base: InspectionSaveBalloonsGeometryPayload,
  extra: InspectionSaveBalloonsGeometryPayload
): InspectionSaveBalloonsGeometryPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export async function resolveInspectionFeaturePayloadIds(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  features: InspectionSaveFeaturesPayload
): Promise<InspectionSaveFeaturesPayload> {
  const ids = [
    ...features.update.map((row) => row.id),
    ...features.delete
  ].filter((rowId) => !isTempInspectionId(rowId));

  if (ids.length === 0) {
    return features;
  }

  const idMap = await mapBalloonIdsToFeatureIdsForDocument(
    client,
    inspectionDocumentId,
    companyId,
    ids
  );

  return {
    create: features.create,
    update: features.update.map((row) => ({
      ...row,
      id: idMap.get(row.id) ?? row.id
    })),
    delete: [
      ...new Set(features.delete.map((rowId) => idMap.get(rowId) ?? rowId))
    ]
  };
}

// ─── Balloon region vision analysis ──────────────────────────────────────────

/** Decoded image size limit for vision analyze (bytes). */
export const INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const BALLOON_REGION_ANALYSIS_SYSTEM = `You assist with mechanical inspection ballooning on technical CAD drawings.

You receive one raster image: a crop of a single callout region from a sheet.

Return ONLY the JSON object matching the schema (field names and allowed enum values exactly).

type (required, exactly one of):
- linear — linear length/width/height dimension without ⌀ or R prefix.
- diameter — nominal is the value for a diameter callout (⌀ or equivalent).
- radius — nominal is the value for a radius callout (R or equivalent).
- angle — nominal is the numeric angle; set unit to degree or rad only when °, deg, or rad is visible in the crop; otherwise unit null.
- unknown — not clearly one of the above, or unreadable / ambiguous.

unit (nullable, exactly one of the allowed enum strings or null):
- Default is null. Set unit ONLY when this crop visibly shows a unit indicator (e.g. mm, cm, m, um, µm, in, ", IN, ft, °, DEG, RAD, or equivalent text/symbols next to the dimension).
- Do NOT infer unit from decimal places, title block, drawing "standard," locale, or anything outside visible pixels in this crop. A bare number with tolerances but no unit text/symbol → unit null.
- For type angle: use degree or rad only when that angle notation is visible; otherwise unit null.

nominal / tolerances:
- Prefer numbers from the print; use null (not zero) when not shown or unreadable.
- Bilateral ±T: tol_plus = +T, tol_minus = -T (e.g. ±0.02 → tol_plus 0.02, tol_minus -0.02).
- Unilateral stacked +0.005 / -0.000 (plus above, minus below nominal): tol_plus = 0.005, tol_minus = 0 (minus side is zero additional tolerance below nominal).
- Other asymmetric +a / −b (both non-zero): tol_plus = +a, tol_minus = -b using the signed values as printed relative to nominal.

Do not invent title-block or revision data outside the crop.
`;

const BALLOON_REGION_ANALYSIS_USER_MESSAGE =
  "Extract nominal, tol_plus, tol_minus, unit, and type per the system rules. For unit: use null unless a unit symbol or unit letters are literally visible in this crop; do not guess. Use only allowed enum literals for type and for unit when non-null.";

const BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION =
  "Drawing crop: nominal, tolerances, type enum; unit enum only when a unit symbol/text is visible in the crop, otherwise null";

/**
 * Runs vision extraction on a prepared PNG/JPEG/WebP buffer (caller validates size and auth).
 */
export async function runInspectionBalloonRegionVisionAnalysis(args: {
  imageBytes: Buffer;
  mediaType: string;
}): Promise<BalloonRegionAnalysis> {
  const { imageBytes, mediaType } = args;
  const { output: object } = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({
      schema: balloonRegionAnalysisResultSchema,
      name: "balloon_region_analysis",
      description: BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION
    }),
    instructions: BALLOON_REGION_ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: BALLOON_REGION_ANALYSIS_USER_MESSAGE },
          {
            type: "image",
            image: imageBytes,
            mediaType
          }
        ]
      }
    ],
    temperature: 0.1
  });
  return object;
}

export const issueLocked = "Cannot modify a closed issue. Reopen it first.";

/** The issue's integrations told, never failing the write that came first. */
export async function notifyIssue(
  ctx: ServiceContext,
  send: (
    integrations: Awaited<ReturnType<typeof getCachedCompanyIntegrations>>
  ) => Promise<unknown>,
  failure: string
) {
  try {
    await send(
      await getCachedCompanyIntegrations(ctx.asCaller.supabase, ctx.company.id)
    );
  } catch (error) {
    logger.error(failure, { error });
  }
}

/** The issue's action tasks, from its required actions and approvals. */
export function createIssueTasks(ctx: ServiceContext, issueId: string) {
  return invokeCreate(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    { type: "nonConformanceTasks", id: issueId }
  );
}

/**
 * Links the lot a job operation's make method produced to a new issue: the
 * issue-level tracked-entity links, then the item's disposition row (found
 * or created) under the issue lock every link writer shares. Failures are
 * logged, never returned: the issue already exists.
 */
export async function linkJobOperationLot(
  ctx: ServiceContext,
  {
    nonConformanceId,
    jobOperationId
  }: { nonConformanceId: string; jobOperationId: string }
) {
  const client = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const makeMethod = await client
    .from("jobMakeMethod")
    .select("itemId")
    .eq("id", jobMakeMethodId)
    .eq("companyId", companyId)
    .single();
  const itemId = makeMethod.data?.itemId ?? null;
  if (!itemId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id, quantity")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", companyId);
  const lotEntities = (entities.data ?? []) as {
    id: string;
    quantity: number | null;
  }[];
  if (lotEntities.length === 0) return;

  const entityIds = lotEntities.map((e) => e.id);
  const existingLinks = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", entityIds);
  const alreadyLinked = new Set(
    (existingLinks.data ?? []).map((r) => r.trackedEntityId as string)
  );
  const linkRows = entityIds
    .filter((id) => !alreadyLinked.has(id))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      companyId,
      createdBy: userId
    }));
  if (linkRows.length > 0) {
    const inserted = await client
      .from("nonConformanceTrackedEntity")
      .insert(linkRows);
    if (inserted.error) {
      logger.error("Issue creation step failed", { error: inserted.error });
      return;
    }
  }

  try {
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      await lockIssueDispositions(trx, { nonConformanceId, companyId });
      await linkEntitiesToIssueItemRow(trx, {
        nonConformanceId,
        companyId,
        userId,
        itemId,
        entities: lotEntities.map((e) => ({
          id: e.id,
          quantity: Number(e.quantity ?? 1)
        }))
      });
    });
  } catch (err) {
    logger.error("Issue creation step failed", { error: err });
  }
}

/** The header a line association names: its id and readable id. */
export const associationHeaders = {
  jobOperations: { table: "job", readable: "jobId", noun: "job operation" },
  purchaseOrderLines: {
    table: "purchaseOrder",
    readable: "purchaseOrderId",
    noun: "purchase order line"
  },
  salesOrderLines: {
    table: "salesOrder",
    readable: "salesOrderId",
    noun: "sales order line"
  },
  shipmentLines: {
    table: "shipment",
    readable: "shipmentId",
    noun: "shipment line"
  },
  receiptLines: {
    table: "receipt",
    readable: "receiptId",
    noun: "receipt line"
  },
  salesReturnOrderLines: {
    table: "salesReturnOrder",
    readable: "salesReturnOrderId",
    noun: "sales return order line"
  },
  purchaseReturnOrderLines: {
    table: "purchaseReturnOrder",
    readable: "purchaseReturnOrderId",
    noun: "purchase return order line"
  }
} as const;

/** One insert per line association type: each table names its columns. */
export function insertLineAssociation(
  ctx: ServiceContext,
  type: keyof typeof associationHeaders,
  row: {
    nonConformanceId: string;
    companyId: string;
    createdBy: string;
    lineId: string;
    headerId: string;
    readableId: string | null;
  }
) {
  const client = ctx.asCaller.supabase;
  const { lineId, headerId, readableId, ...audit } = row;
  switch (type) {
    case "jobOperations":
      return client.from("nonConformanceJobOperation").insert({
        ...audit,
        jobOperationId: lineId,
        jobId: headerId,
        jobReadableId: readableId
      });
    case "purchaseOrderLines":
      return client.from("nonConformancePurchaseOrderLine").insert({
        ...audit,
        purchaseOrderLineId: lineId,
        purchaseOrderId: headerId,
        purchaseOrderReadableId: readableId
      });
    case "salesOrderLines":
      return client.from("nonConformanceSalesOrderLine").insert({
        ...audit,
        salesOrderLineId: lineId,
        salesOrderId: headerId,
        salesOrderReadableId: readableId
      });
    case "shipmentLines":
      return client.from("nonConformanceShipmentLine").insert({
        ...audit,
        shipmentLineId: lineId,
        shipmentId: headerId,
        shipmentReadableId: readableId
      });
    case "receiptLines":
      return client.from("nonConformanceReceiptLine").insert({
        ...audit,
        receiptLineId: lineId,
        receiptId: headerId,
        receiptReadableId: readableId
      });
    case "salesReturnOrderLines":
      return client.from("nonConformanceSalesReturnOrderLine").insert({
        ...audit,
        salesReturnOrderLineId: lineId,
        salesReturnOrderId: headerId,
        salesReturnOrderReadableId: readableId ?? ""
      });
    case "purchaseReturnOrderLines":
      return client.from("nonConformancePurchaseReturnOrderLine").insert({
        ...audit,
        purchaseReturnOrderLineId: lineId,
        purchaseReturnOrderId: headerId,
        purchaseReturnOrderReadableId: readableId ?? "",
        quantity: 0
      });
  }
}

// Auto-linking after a job operation association: it surfaces context into
// the issue explorer (the job's item, the tracked entities its make method
// produced), so its failures are logged, never returned.
export async function linkJobOperationContext(
  ctx: ServiceContext,
  args: {
    nonConformanceId: string;
    jobItemId: string | null;
    jobOperationId: string;
  }
) {
  const client = ctx.asCaller.supabase;
  const { nonConformanceId, jobItemId, jobOperationId } = args;

  if (jobItemId) {
    const existing = await client
      .from("nonConformanceItem")
      .select("id")
      .eq("nonConformanceId", nonConformanceId)
      .eq("itemId", jobItemId)
      .maybeSingle();
    if (!existing.data) {
      const result = await client.from("nonConformanceItem").insert({
        itemId: jobItemId,
        nonConformanceId,
        createdBy: ctx.auditUserId,
        companyId: ctx.company.id,
        quantity: 0
      });
      if (result.error) {
        logger.error("Failed to create association", { error: result.error });
      }
    }
  }

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", ctx.company.id);
  await linkMissingTrackedEntities(ctx, {
    nonConformanceId,
    trackedEntityIds: (entities.data ?? []).map((e) => e.id)
  });
}

async function linkMissingTrackedEntities(
  ctx: ServiceContext,
  {
    nonConformanceId,
    trackedEntityIds
  }: { nonConformanceId: string; trackedEntityIds: string[] }
) {
  if (trackedEntityIds.length === 0) return;
  const client = ctx.asCaller.supabase;

  const existing = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", trackedEntityIds);
  const already = new Set(
    (existing.data ?? []).map((r) => r.trackedEntityId as string)
  );
  const rows = trackedEntityIds
    .filter((id) => !already.has(id))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      createdBy: ctx.auditUserId,
      companyId: ctx.company.id
    }));
  if (rows.length === 0) return;

  const result = await client.from("nonConformanceTrackedEntity").insert(rows);
  if (result.error) {
    logger.error("Failed to create association", { error: result.error });
  }
}

/**
 * Links an inspection to the issue with its whole lot, and seeds the item's
 * disposition row with it. The inspection link and the row writes share one
 * transaction under the issue lock, so a concurrent quantity edit either
 * lands before (and the row write overwrites it) or sees the inspection link
 * and is refused. False when any step failed.
 */
export async function linkInspectionToIssue(
  ctx: ServiceContext,
  {
    nonConformanceId,
    inspectionId
  }: { nonConformanceId: string; inspectionId: string }
): Promise<boolean> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const inspection = await client
    .from("inspection")
    .select(
      "id, itemId, lotSize, sourceDocument, sourceDocumentLineId, inspectionSample(trackedEntityId)"
    )
    .eq("id", inspectionId)
    // The link below is written through Kysely (no RLS), so scope here.
    .eq("companyId", companyId)
    .single();
  if (inspection.error) {
    logger.error("Failed to create association", { error: inspection.error });
    return false;
  }

  const sampledIds = (
    (inspection.data.inspectionSample ?? []) as {
      trackedEntityId: string | null;
    }[]
  )
    .map((s) => s.trackedEntityId)
    .filter((id): id is string => Boolean(id));
  // The rest of the lot too: un-sampled entities are still part of the lot
  // the MRB needs to disposition.
  let lotEntityIds: string[] = sampledIds;
  if (
    inspection.data.sourceDocument === "Receipt" &&
    inspection.data.sourceDocumentLineId
  ) {
    const receiptLineEntities = await client
      .from("trackedEntity")
      .select("id")
      .eq("attributes ->> Receipt Line", inspection.data.sourceDocumentLineId)
      .eq("companyId", companyId);
    // A failed read would link only the sampled part of the lot.
    if (receiptLineEntities.error) {
      logger.error("Failed to create association", {
        error: receiptLineEntities.error
      });
      return false;
    }
    lotEntityIds = [
      ...new Set([
        ...sampledIds,
        ...(receiptLineEntities.data ?? []).map((r) => r.id)
      ])
    ];
  }

  // Read before writing anything: a failed read would seed the row with
  // wrong quantities and still report success.
  const entityQuantities =
    lotEntityIds.length > 0
      ? await client
          .from("trackedEntity")
          .select("id, quantity")
          .in("id", lotEntityIds)
          .eq("companyId", companyId)
      : { data: [], error: null };
  if (entityQuantities.error) {
    logger.error("Failed to create association", {
      error: entityQuantities.error
    });
    return false;
  }

  await linkMissingTrackedEntities(ctx, {
    nonConformanceId,
    trackedEntityIds: lotEntityIds
  });

  const quantityById = new Map(
    (entityQuantities.data ?? []).map((e) => [e.id, Number(e.quantity ?? 1)])
  );
  const itemId = inspection.data.itemId ?? null;

  try {
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      const { status } = await lockIssueDispositions(trx, {
        nonConformanceId,
        companyId
      });
      if (isIssueLocked(status)) throw new Error(issueLocked);

      await trx
        .insertInto("nonConformanceInspection")
        .values({
          nonConformanceId,
          inspectionId: inspection.data.id,
          companyId,
          createdBy: userId
        })
        .execute();

      if (itemId) {
        await linkEntitiesToIssueItemRow(trx, {
          nonConformanceId,
          companyId,
          userId,
          itemId,
          entities: lotEntityIds.map((id) => ({
            id,
            quantity: quantityById.get(id) ?? 1
          })),
          fallbackQuantity: Number(inspection.data.lotSize ?? 0)
        });
      }
    });
    return true;
  } catch (err) {
    logger.error("Failed to create association", { error: err });
    return false;
  }
}

/** A document-driven lot's failed features, measured values against spec. */
export async function failedFeatureLines(
  ctx: ServiceContext,
  inspectionId: string
) {
  const [lotFeatures, lotMeasurements] = await Promise.all([
    getInspectionSamplingPlans(
      ctx.asSystem.supabase,
      inspectionId,
      ctx.company.id
    ),
    getInspectionMeasurements(
      ctx.asSystem.supabase,
      inspectionId,
      ctx.company.id
    )
  ]);
  const lines: string[] = [];
  for (const lotFeature of lotFeatures.data ?? []) {
    const feature = lotFeature.inspectionFeature;
    if (!feature) continue;
    const measurements = (lotMeasurements.data ?? []).filter(
      (m) => m.inspectionFeatureId === feature.id
    );
    const recorded = measurements.filter((m) => m.status !== "Pending").length;
    const failed = measurements.filter((m) => m.status === "Failed");
    if (failed.length === 0) continue;
    const failedValues = failed
      .map((m) => (m.value == null ? "F" : String(m.value)))
      .join(", ");
    const spec = [
      feature.nominalValue,
      feature.tolerancePlus != null || feature.toleranceMinus != null
        ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
        : null,
      feature.unit
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      spec
        ? `- ${feature.label}: nominal ${spec} — failed values: ${failedValues} (${failed.length}/${recorded} failed, n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
        : `- ${feature.label}: ${failed.length}/${recorded} failed (n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
    );
  }
  return lines;
}

/** The message of an RPC error, which may not be an `Error`. */
export function rpcErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * Draft or Archived → Active. With an approval rule, each document opens a
 * request and waits in Draft (an Archived one moves to Draft) until it is
 * approved; without one it goes Active at once.
 */
export async function activateQualityDocuments(
  ctx: ServiceContext,
  ids: string[],
  documents: { id: string; status: string | null }[]
) {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const audit = { updatedBy: userId, updatedAt: datetime.timestamp() };

  const transitioning = documents.filter(
    (doc) => doc.status === "Draft" || doc.status === "Archived"
  );
  const opened =
    transitioning.length > 0
      ? await openApprovalRequests(ctx.asSystem.supabase, {
          documentType: "qualityDocument",
          documentIds: transitioning.map((doc) => doc.id),
          companyId,
          userId
        })
      : ({ status: "not-required" } as const);
  if (opened.status === "failed") {
    return ctx.error("internal", "Failed to submit for approval");
  }

  const awaitingApproval = new Set(
    opened.status === "opened" ? transitioning.map((doc) => doc.id) : []
  );
  if (opened.status === "opened" && opened.requested.length > 0) {
    if (opened.approverIds.length > 0) {
      for (const documentId of opened.requested) {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId,
          documentType: "qualityDocument",
          recipient: { type: "users", userIds: opened.approverIds },
          from: userId
        }).catch((e) =>
          logger.error("Failed to trigger approval notification", {
            companyId,
            documentId,
            error: e
          })
        );
      }
    }

    const archivedToDraft = transitioning
      .filter(
        (doc) => doc.status === "Archived" && opened.requested.includes(doc.id)
      )
      .map((doc) => doc.id);
    if (archivedToDraft.length > 0) {
      await client
        .from("qualityDocument")
        .update({ status: "Draft", ...audit })
        .in("id", archivedToDraft)
        .eq("companyId", companyId);
    }
  }

  const activate = ids.filter((id) => !awaitingApproval.has(id));
  if (activate.length > 0) {
    const update = await client
      .from("qualityDocument")
      .update({ status: "Active", ...audit })
      .in("id", activate)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the document",
        update.error
      );
    }
  }
  return { ids, awaitingApproval: [...awaitingApproval] };
}

/** Fills `<%= company.name %>` in every text of a template document. */
export function interpolateTemplate(
  content: unknown,
  data: { company: { name: string } }
): unknown {
  if (typeof content === "string") return template(content)(data);
  if (Array.isArray(content)) {
    return content.map((item) => interpolateTemplate(item, data));
  }
  if (content && typeof content === "object") {
    return Object.fromEntries(
      Object.entries(content).map(([key, value]) => [
        key,
        key === "text" && typeof value === "string"
          ? template(value)(data)
          : interpolateTemplate(value, data)
      ])
    );
  }
  return content;
}

/** Tell a risk's assignee it is theirs. A failure never fails the save. */
export async function notifyRiskAssignee(
  ctx: ServiceContext,
  riskId: string,
  assignee: string
) {
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: riskId,
      event: NotificationEvent.RiskAssignment,
      recipient: { type: "user", userId: assignee },
      from: ctx.auditUserId
    });
  } catch (err) {
    logger.error("Failed to notify assignee", { error: err });
  }
}

// --- Supplier corrective action (SCAR) share link -----------------------------------

/**
 * The context for a SCAR share link: a system actor in the link's company,
 * acting for whoever linked the supplier to the issue. Null when the link is
 * not a SCAR link, or names an issue of another company.
 */
export async function scarLinkContext(
  externalLinkId: string
): Promise<ServiceContext | null> {
  const serviceRole = getCarbonServiceRole();
  const link = await getExternalLink(serviceRole, externalLinkId);
  if (
    !link.data?.documentId ||
    link.data.documentType !== "Non-Conformance Supplier"
  ) {
    return null;
  }
  const [issueSupplier, company] = await Promise.all([
    getIssueFromExternalLink(serviceRole, link.data.documentId),
    serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", link.data.companyId)
      .single()
  ]);
  if (
    !issueSupplier.data ||
    issueSupplier.data.companyId !== link.data.companyId ||
    !company.data?.companyGroupId
  ) {
    return null;
  }
  return systemContext({
    companyId: link.data.companyId,
    companyGroupId: company.data.companyGroupId,
    onBehalfOf: issueSupplier.data.createdBy
  });
}

/**
 * The supplier's action task a SCAR link may change: the link's issue must
 * still be open, and the task one of the supplier's on it.
 */
export async function scarTask(
  ctx: ServiceContext,
  { externalLinkId, taskId }: { externalLinkId: string; taskId: string }
) {
  const serviceRole = ctx.asSystem.supabase;
  const link = await getExternalLink(serviceRole, externalLinkId);
  if (
    !link.data?.documentId ||
    link.data.companyId !== ctx.company.id ||
    link.data.documentType !== "Non-Conformance Supplier"
  ) {
    return ctx.error("notFound", "Could not find id");
  }
  const issue = await getIssueFromExternalLink(
    serviceRole,
    link.data.documentId
  );
  if (!issue.data || issue.data.companyId !== ctx.company.id) {
    return ctx.error("notFound", "Could not find the issue");
  }
  if (issue.data.nonConformance?.status === "Closed") {
    return ctx.error(
      "rule",
      "Issue has been closed already. Unable to make changes"
    );
  }
  const tasks = await getIssueActionTasks(
    serviceRole,
    issue.data.nonConformanceId,
    ctx.company.id,
    issue.data.supplierId
  );
  if (!tasks.data?.some((task) => task.id === taskId)) {
    return ctx.error("notFound", "Invalid task id");
  }
  return taskId;
}
// The GL/cost posting path for inspection-reject and NCR-disposition inventory
// write-offs. The caller (inspection reject route / closeIssue) owns the
// physical/status side — tracked-entity flips, nonConformance.status — and hands
// this function a batch of explicit SIGNED movements. In ONE transaction each
// movement books through the shared core: item ledger + cost layers + a
// balanced journal (Provisional before the accounting cutover, Posted after it)
// against the company's scrapAccount (offset), one shared journal per call. Scrap / Return post a
// Negative Adjmt. (Dr Scrap / Cr Inventory + relieve layers); a kept lot's
// restore posts a Positive Adjmt. (Dr Inventory / Cr Scrap + create a layer).
export const postNonConformanceInput = z.object({
  // Drives both the itemLedger/costLedger documentType and the journal
  // sourceType — 'Non-Conformance' for a disposition close, 'Inbound Inspection'
  // for an inspection reject.
  documentType: z.enum(["Non-Conformance", "Inbound Inspection"]),
  documentId: z.string(),
  description: z.string().optional().nullable(),
  postingDate: z.string().optional().nullable(),
  movements: z
    .array(
      z.object({
        itemId: z.string(),
        locationId: z.string().optional().nullable(),
        trackedEntityId: z.string().optional().nullable(),
        // SIGNED: < 0 removes value (scrap/return), > 0 restores value (kept).
        quantity: z.number(),
        comment: z.string().optional().nullable()
      })
    )
    .min(1)
});

export const postNonconformancePermission = {
  update: "quality"
} satisfies PermissionRule<z.output<typeof postNonConformanceInput>>;

export async function postNonconformance(
  ctx: ServiceContext,
  raw: z.input<typeof postNonConformanceInput>
) {
  const {
    documentType,
    documentId,
    description,
    postingDate: providedPostingDate,
    movements
  } = postNonConformanceInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const postingDate =
    providedPostingDate ||
    datetime.today(await getCompanyTimeZone(db, companyId)).toString();

  // Only movements that actually move stock post anything.
  const effectiveMovements = movements.filter((m) => m.quantity !== 0);
  if (effectiveMovements.length === 0) {
    return { journalId: null };
  }

  // The permission check proves the caller may act in companyId, not that
  // the document or the movements' location / tracked entity belong to it —
  // all three land on this company's ledger rows.
  await assertCompanyRecords(
    db,
    documentType === "Inbound Inspection" ? "inspection" : "nonConformance",
    [documentId],
    companyId,
    documentType === "Inbound Inspection" ? "Inspection" : "Non-conformance"
  );
  await assertCompanyRecords(
    db,
    "location",
    effectiveMovements.map((m) => m.locationId),
    companyId,
    "Location"
  );
  await assertCompanyRecords(
    db,
    "trackedEntity",
    effectiveMovements.map((m) => m.trackedEntityId),
    companyId,
    "Tracked entity"
  );

  const itemIds = [...new Set(effectiveMovements.map((m) => m.itemId))];

  const [itemsResult, itemCostsResult] = await inOrder([
    () =>
      many(
        db,
        "item",
        { id: itemIds, companyId },
        { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
      ),
    () =>
      many(
        db,
        "itemCost",
        { itemId: itemIds, companyId },
        {
          columns: [
            "itemId",
            "costingMethod",
            "unitCost",
            "standardCost",
            "itemPostingGroupId"
          ]
        }
      )
  ]);

  if (itemsResult.error) throw new Error("Failed to fetch items");
  if (itemCostsResult.error) throw new Error("Failed to fetch item costs");

  // The generated types are deep enough that a multi-row .select() infers as
  // {} here; type the projected rows explicitly (the reference sidesteps this
  // via .single()).
  type NcItemRow = {
    id: string;
    itemTrackingType: string | null;
    replenishmentSystem:
      | Database["public"]["Enums"]["itemReplenishmentSystem"]
      | null;
  };
  type NcItemCostRow = {
    itemId: string;
    costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
    unitCost: number | null;
    standardCost: number | null;
    itemPostingGroupId: string | null;
  };
  const itemById = new Map<string, NcItemRow>(
    ((itemsResult.data ?? []) as NcItemRow[]).map((row) => [row.id, row])
  );
  const costByItem = new Map<string, NcItemCostRow>(
    ((itemCostsResult.data ?? []) as NcItemCostRow[]).map((row) => [
      row.itemId,
      row
    ])
  );

  // Every movement that carries value posts a journal: Provisional before the
  // company's accounting cutover, Posted after it. Read here to decide
  // whether to resolve a period, and again inside the transaction.
  const postingStatus = await journalPostingStatus(db, companyId);
  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  // Active dimensions for the company group — journal lines get
  // Item / ItemPostingGroup / Location tags (post-adjustment precedent).
  const dimensionMap: Record<string, string> = {};
  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );
  if (companyRecord.error) throw new Error("Failed to fetch company");
  const companyGroupId = companyRecord.data.companyGroupId;
  if (companyGroupId) {
    const dimensions = await many(
      db,
      "dimension",
      {
        companyGroupId,
        active: true,
        entityType: ["Item", "ItemPostingGroup", "Location"]
      },
      { columns: ["id", "entityType"] }
    );
    if (dimensions.error) throw new Error("Failed to fetch dimensions");
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
    }
  }

  // Resolve the accounting period BEFORE opening the transaction —
  // getCurrentAccountingPeriod uses the REST client and calling it
  // mid-transaction parks the (size 1) pool in idle-in-transaction. A
  // Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, db, postingDate)
      : null;

  const journalDescription =
    description?.trim() ||
    (documentType === "Inbound Inspection"
      ? "Inbound Inspection write-off"
      : "Non-Conformance disposition");

  let journalId: string | null = null;

  await db.transaction().execute(async (trx) => {
    // Idempotent per (documentType, documentId): a reject posts one write-off
    // per inspection, a disposition close posts once per NCR (reopen is blocked
    // after posting). A retry after a partial route failure — e.g. the caller's
    // status/NCR step failed after this already committed — must not double-post.
    const alreadyPosted = await trx
      .selectFrom("itemLedger")
      .select("id")
      .where("companyId", "=", companyId)
      .where("documentType", "=", documentType)
      .where("documentId", "=", documentId)
      .limit(1)
      .executeTakeFirst();
    if (alreadyPosted) return;

    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    // One shared journal per call (per reject / per disposition close), a line
    // pair per movement — created lazily so an all-zero-value run posts none.
    // Cost of quality: offset to scrapAccount, or to the variance account
    // when it is empty.
    const scrapAccountId = resolveDefaultAccount(
      accountDefaults.data,
      "scrapAccount",
      postingStatus
    ).accountId;
    const accounting = {
      postingStatus,
      accountingPeriodId,
      accountDefaults: {
        rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
        finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
        inventoryAdjustmentVarianceAccount:
          accountDefaults.data.inventoryAdjustmentVarianceAccount
      },
      offsetAccount: scrapAccountId,
      offsetDescription: "Scrap / Cost of Quality",
      sourceType: documentType,
      description: journalDescription,
      userId,
      dimensions: dimensionMap,
      getJournalId: async () => {
        if (!journalId) {
          journalId = await createAdjustmentJournal(trx, {
            companyId,
            accountingPeriodId,
            status: postingStatus,
            description: journalDescription,
            postingDate,
            userId,
            sourceType: documentType
          });
        }
        return journalId;
      }
    };

    for (const movement of effectiveMovements) {
      const itemRow = itemById.get(movement.itemId);
      if (!itemRow)
        throw new NotFoundError(`Item ${movement.itemId} not found`);
      const costRow = costByItem.get(movement.itemId);
      // Missing itemCost (rare) — post the ledger movement at zero value so a
      // disposition is never blocked; no journal results from a zero cost.
      const itemCost: AdjustmentItemCost = costRow
        ? {
            costingMethod: costRow.costingMethod,
            unitCost: costRow.unitCost,
            standardCost: costRow.standardCost
          }
        : { costingMethod: "Average", unitCost: 0, standardCost: 0 };

      await bookAdjustment(trx, {
        ledger: {
          postingDate,
          itemId: movement.itemId,
          quantity: movement.quantity,
          locationId: movement.locationId ?? null,
          storageUnitId: null,
          trackedEntityId: movement.trackedEntityId ?? null,
          entryType:
            movement.quantity < 0 ? "Negative Adjmt." : "Positive Adjmt.",
          documentType,
          documentId,
          comment: movement.comment ?? null,
          companyId,
          createdBy: userId
        },
        item: {
          itemTrackingType: itemRow.itemTrackingType,
          replenishmentSystem: itemRow.replenishmentSystem,
          itemPostingGroupId: costRow?.itemPostingGroupId ?? null
        },
        itemCost,
        accounting
      });
    }
  });

  return { journalId: journalId as string | null };
}
