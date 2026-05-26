import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getPurchaseOrderStatus } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import type {
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import { z } from "zod";
import { getEmployeeJob } from "~/modules/people/people.service.server";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.service.server";
import type { PurchaseInvoice } from "../invoicing/types";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument,
  upsertExternalLink
} from "../shared/shared.service.server";
import type {
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderStatusType,
  purchaseOrderValidator,
  purchasingRfqStatusType,
  selectedLinesValidator,
  supplierAccountingValidator,
  supplierContactValidator,
  supplierPaymentValidator,
  supplierProcessValidator,
  supplierQuoteLineValidator,
  supplierQuoteStatusType,
  supplierQuoteValidator,
  supplierShippingValidator,
  supplierTaxValidator,
  supplierTypeValidator,
  supplierValidator
} from "./purchasing.models";
import type { PurchaseOrder, PurchasingRFQ, SupplierQuote } from "./types";
export const closePurchaseOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function closePurchaseOrder(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("purchaseOrder")
      .update({
        closed: true,
        closedAt: today(getLocalTimeZone()).toString(),
        closedBy: userId
      })
      .eq("id", purchaseOrderId)
      .select("id")
      .single();
  }
);

export const convertSupplierQuoteToOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function convertSupplierQuoteToOrder(payload: {
    id: string;
    selectedLines: z.infer<typeof selectedLinesValidator>;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client.functions.invoke<{ convertedId: string }>("convert", {
      body: {
        type: "supplierQuoteToPurchaseOrder",
        ...payload,
        companyId,
        userId
      }
    });
  }
);

export const deletePurchaseOrder = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchaseOrder(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("purchaseOrder").delete().eq("id", purchaseOrderId);
  }
);

export const deletePurchaseOrderLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchaseOrderLine(purchaseOrderLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderLine")
      .delete()
      .eq("id", purchaseOrderLineId);
  }
);

export const deleteSupplier = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplier(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplier").delete().eq("id", supplierId);
  }
);

export const deleteSupplierContact = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierContact(
    supplierId: string,
    supplierContactId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const supplierContact = await client
      .from("supplierContact")
      .select("contactId")
      .eq("supplierId", supplierId)
      .eq("id", supplierContactId)
      .single();
    if (supplierContact.data) {
      const contactDelete = await client
        .from("contact")
        .delete()
        .eq("id", supplierContact.data.contactId);

      if (contactDelete.error) {
        return contactDelete;
      }
    }
    return supplierContact;
  }
);

export const deleteSupplierLocation = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierLocation(
    supplierId: string,
    supplierLocationId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { data: supplierLocation } = await client
      .from("supplierLocation")
      .select("addressId")
      .eq("supplierId", supplierId)
      .eq("id", supplierLocationId)
      .single();

    if (supplierLocation?.addressId) {
      return client
        .from("address")
        .delete()
        .eq("id", supplierLocation.addressId);
    } else {
      // The supplierLocation should always have an addressId, but just in case
      return client
        .from("supplierLocation")
        .delete()
        .eq("supplierId", supplierId)
        .eq("id", supplierLocationId);
    }
  }
);

export const deleteSupplierProcess = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierProcess(supplierProcessId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierProcess")
      .delete()
      .eq("id", supplierProcessId)
      .single();
  }
);

export const deleteSupplierQuote = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierQuote(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplierQuote").delete().eq("id", supplierQuoteId);
  }
);

export const deleteSupplierQuoteLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierQuoteLine(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplierQuoteLine").delete().eq("id", id);
  }
);

export const deleteSupplierType = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSupplierType(supplierTypeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplierType").delete().eq("id", supplierTypeId);
  }
);

export const getPurchaseOrder = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrder(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrders")
      .select("*")
      .eq("id", purchaseOrderId)
      .single();
  }
);

export const finalizeSupplierQuote = mcpTool(
  {
    classification: "WRITE"
  },
  async function finalizeSupplierQuote(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const quoteUpdate = await client
      .from("supplierQuote")
      .update({
        status: "Active",
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId
      })
      .eq("id", supplierQuoteId);

    if (quoteUpdate.error) {
      return quoteUpdate;
    }

    return { data: null, error: null };
  }
);

export const getPurchaseOrders = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrders(
    args: GenericQueryFilters & {
      search: string | null;
      status: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("purchaseOrders")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.or(
        `purchaseOrderId.ilike.%${args.search}%,supplierReference.ilike.%${args.search}%`
      );
    }

    if (args.supplierId) {
      query = query.eq("supplierId", args.supplierId);
    }

    query = setGenericQueryFilters(query, args, [
      { column: "purchaseOrderId", ascending: false }
    ]);

    return query;
  }
);

export const getPurchaseOrderDelivery = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderDelivery(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderDelivery")
      .select("*")
      .eq("id", purchaseOrderId)
      .single();
  }
);

export const getPurchaseOrderLocations = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderLocations(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderLocations")
      .select("*")
      .eq("id", purchaseOrderId)
      .single();
  }
);

export const getPurchaseOrderPayment = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderPayment(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderPayment")
      .select("*")
      .eq("id", purchaseOrderId)
      .single();
  }
);

export const getPurchaseOrderLines = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderLines(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderLines")
      .select("*")
      .eq("purchaseOrderId", purchaseOrderId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true });
  }
);

export const getPurchaseOrderLine = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderLine(purchaseOrderLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderLines")
      .select("*")
      .eq("id", purchaseOrderLineId)
      .single();
  }
);

export const getPurchaseOrderSuppliers = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseOrderSuppliers() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("purchaseOrderSuppliers")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getPurchasingDocumentsAssignedToMe = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingDocumentsAssignedToMe() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    const [purchaseOrders, supplierQuotes, purchaseInvoices] =
      await Promise.all([
        client
          .from("purchaseOrder")
          .select("*")
          .eq("assignee", userId)
          .eq("companyId", companyId),
        client
          .from("supplierQuote")
          .select("*")
          .eq("assignee", userId)
          .eq("companyId", companyId),
        client
          .from("purchaseInvoice")
          .select("*")
          .eq("assignee", userId)
          .eq("companyId", companyId)
      ]);

    const merged = [
      ...(purchaseOrders.data?.map((doc) => ({
        ...doc,
        type: "purchaseOrder"
      })) ?? []),
      ...(supplierQuotes.data?.map((doc) => ({
        ...doc,
        type: "supplierQuote"
      })) ?? []),
      ...(purchaseInvoices.data?.map((doc) => ({
        ...doc,
        type: "purchaseInvoice"
      })) ?? [])
    ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

    return merged;
  }
);

export const getPurchasingPlanning = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingPlanning(
    locationId: string,
    periods: string[],
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client.rpc(
      "get_purchasing_planning",
      {
        location_id: locationId,
        company_id: companyId,
        periods
      },
      {
        count: "exact"
      }
    );

    if (args?.search) {
      query = query.or(
        `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "quantityToOrder", ascending: false }
    ]);

    return query;
  }
);

export const getPurchasingTerms = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingTerms() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("terms")
      .select("purchasingTerms")
      .eq("id", companyId)
      .single();
  }
);

export const getSupplier = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplier(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("suppliers").select("*").eq("id", supplierId).single();
  }
);

type ApprovalContext = {
  approvalRequest: { id: string } | null;
  canApprove: boolean;
  decision: {
    status: "Approved" | "Rejected";
    decisionBy: string;
    decisionAt: string;
  } | null;
};

export const getSupplierApprovalContext = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierApprovalContext(
    serviceRole: SupabaseClient<Database>,
    supplierId: string,
    status: string | null
  ): Promise<ApprovalContext> {
    const { companyId } = AuthContextHolder.get();
    const latest = await getLatestApprovalRequestForDocument(
      "supplier",
      supplierId
    );

    const req = latest.data;

    const canApprove = await canApproveRequest({
      amount: req?.amount ?? null,
      documentType: "supplier",
      companyId
    });

    // Look for the latest terminal decision (Approved or Rejected)
    let decision: ApprovalContext["decision"] = null;
    const terminalRequest = await serviceRole
      .from("approvalRequest")
      .select("status, decisionBy, decisionAt")
      .eq("documentType", "supplier")
      .eq("documentId", supplierId)
      .in("status", ["Approved", "Rejected"])
      .order("decisionAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      terminalRequest.data?.decisionBy &&
      terminalRequest.data?.decisionAt &&
      (terminalRequest.data.status === "Approved" ||
        terminalRequest.data.status === "Rejected")
    ) {
      decision = {
        status: terminalRequest.data.status,
        decisionBy: terminalRequest.data.decisionBy,
        decisionAt: terminalRequest.data.decisionAt
      };
    }

    if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
      return {
        approvalRequest: null,
        canApprove,
        decision
      };
    }

    return {
      approvalRequest: { id: req.id },
      canApprove,
      decision
    };
  }
);

export const getSupplierContact = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierContact(supplierContactId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierContact")
      .select(
        "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
      )
      .eq("id", supplierContactId)
      .single();
  }
);

export const getSupplierContacts = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierContacts(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierContact")
      .select(
        "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
      )
      .eq("supplierId", supplierId);
  }
);

export const getSupplierInteraction = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierInteraction(opportunityId: string | null): Promise<
    PostgrestSingleResponse<{
      id: string;
      companyId: string;
      purchasingRfq: PurchasingRFQ | null;
      supplierQuotes: SupplierQuote[];
      purchaseOrders: PurchaseOrder[];
      purchaseInvoices: PurchaseInvoice[];
    } | null>
  > {
    const client = getAuthClient<SupabaseClient<Database>>();
    if (!opportunityId) {
      // @ts-expect-error
      return {
        data: null,
        error: null
      };
    }

    const response = await client.rpc(
      "get_supplier_interaction_with_related_records",
      {
        supplier_interaction_id: opportunityId
      }
    );

    return {
      data: response.data?.[0],
      error: response.error
    } as unknown as PostgrestSingleResponse<{
      id: string;
      companyId: string;
      purchasingRfq: PurchasingRFQ;
      supplierQuotes: SupplierQuote[];
      purchaseOrders: PurchaseOrder[];
      purchaseInvoices: PurchaseInvoice[];
    }>;
  }
);

export const getSupplierInteractionDocuments = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierInteractionDocuments(interactionId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const result = await client.storage
      .from("private")
      .list(`${companyId}/supplier-interaction/${interactionId}`);

    if (result.error) {
      console.error(
        "Failed to list supplier interaction documents",
        result.error
      );
      return [];
    }

    return (
      result.data?.map((f) => ({ ...f, bucket: "supplier-interaction" })) ?? []
    );
  }
);

export const getSupplierInteractionLineDocuments = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierInteractionLineDocuments(lineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const result = await client.storage
      .from("private")
      .list(`${companyId}/supplier-interaction-line/${lineId}`);

    if (result.error) {
      console.error(
        "Failed to list supplier interaction line documents",
        result.error
      );
      return [];
    }

    return (
      result.data?.map((f) => ({
        ...f,
        bucket: "supplier-interaction-line"
      })) ?? []
    );
  }
);

export const getSupplierLocations = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierLocations(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierLocation")
      .select(
        "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
      )
      .eq("supplierId", supplierId);
  }
);

export const getSupplierLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierLocation(supplierContactId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierLocation")
      .select(
        "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
      )
      .eq("id", supplierContactId)
      .single();
  }
);

export const getSupplierPayment = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierPayment(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierPayment")
      .select("*")
      .eq("supplierId", supplierId)
      .single();
  }
);

export const getSupplierProcessById = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierProcessById(supplierProcessId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierProcesses")
      .select("*")
      .eq("id", supplierProcessId)
      .single();
  }
);

export const getSupplierProcessesByProcess = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierProcessesByProcess(processId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierProcesses")
      .select("*")
      .eq("processId", processId);
  }
);

export const getSupplierProcessesBySupplier = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierProcessesBySupplier(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierProcesses")
      .select("*")
      .eq("supplierId", supplierId);
  }
);

export const getSupplierQuote = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuote(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuotes")
      .select("*")
      .eq("id", supplierQuoteId)
      .single();
  }
);

export const getSupplierQuoteByInteractionId = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteByInteractionId(interactionId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuotes")
      .select("*")
      .eq("supplierInteractionId", interactionId)
      .single();
  }
);

export const getSupplierQuoteByExternalLinkId = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteByExternalLinkId(externalLinkId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuote")
      .select("*")
      .eq("externalLinkId", externalLinkId)
      .single();
  }
);

export const getSupplierQuotes = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuotes(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("supplierQuotes")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.or(
        `supplierQuoteId.ilike.%${args.search}%,name.ilike.%${args.search}%,supplierReference.ilike%${args.search}%`
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "supplierQuoteId", ascending: false }
    ]);
    return query;
  }
);

export const getSupplierQuoteLine = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteLine(supplierQuoteLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuoteLines")
      .select("*")
      .eq("id", supplierQuoteLineId)
      .single();
  }
);

export const getSupplierQuoteLines = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteLines(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuoteLines")
      .select("*")
      .eq("supplierQuoteId", supplierQuoteId)
      .order("sortOrder", { ascending: true });
  }
);

export const getSupplierQuoteLinePrices = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteLinePrices(supplierQuoteLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuoteLinePrice")
      .select("*")
      .eq("supplierQuoteLineId", supplierQuoteLineId);
  }
);

export const getSupplierQuoteLinePricesByQuoteId = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuoteLinePricesByQuoteId(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierQuoteLinePrice")
      .select("*")
      .eq("supplierQuoteId", supplierQuoteId)
      .order("supplierQuoteLineId", { ascending: true });
  }
);

export const getSupplierQuotesList = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuotesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return fetchAllFromTable<{
      id: string;
      supplierQuoteId: string;
    }>(client, "supplierQuote", "id, supplierQuoteId", (query) =>
      query.eq("companyId", companyId).order("createdAt", { ascending: false })
    );
  }
);

export const getSupplierShipping = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierShipping(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierShipping")
      .select("*")
      .eq("supplierId", supplierId)
      .single();
  }
);

export const getSuppliers = mcpTool(
  {
    classification: "READ"
  },
  async function getSuppliers(
    args: GenericQueryFilters & {
      search: string | null;
      type: string | null;
      status: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("suppliers")
      .select("*", {
        count: "exact"
      })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    if (args.type) {
      query = query.eq("supplierTypeId", args.type);
    }

    if (args.status) {
      query = query.eq(
        "status",
        args.status as "Active" | "Inactive" | "Pending" | "Rejected"
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
    return query;
  }
);

export const getSuppliersList = mcpTool(
  {
    classification: "READ"
  },
  async function getSuppliersList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return fetchAllFromTable<{
      id: string;
      name: string;
    }>(client, "supplier", "id, name", (query) =>
      query.eq("companyId", companyId).order("name")
    );
  }
);

export const getSupplierType = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierType(supplierTypeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierType")
      .select("*")
      .eq("id", supplierTypeId)
      .single();
  }
);

export const getSupplierTypes = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierTypes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("supplierType")
      .select("*", { count: "exact" })
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
);

export const getSupplierTypesList = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierTypesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("supplierType")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const insertSupplier = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertSupplier(
    supplier: Omit<z.infer<typeof supplierValidator>, "id"> & {
      companyId: string;
      createdBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplier").insert([supplier]).select("*").single();
  }
);

export const insertSupplierContact = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertSupplierContact(supplierContact: {
    supplierId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const insertContact = await client
      .from("contact")
      .insert([
        {
          ...supplierContact.contact,
          companyId: companyId,
          isCustomer: false
        }
      ])
      .select("id")
      .single();

    if (insertContact.error) {
      return insertContact;
    }

    const contactId = insertContact.data?.id;
    if (!contactId) {
      return { data: null, error: new Error("Contact ID not found") };
    }

    return client
      .from("supplierContact")
      .insert([
        {
          supplierId: supplierContact.supplierId,
          contactId,
          supplierLocationId: supplierContact.supplierLocationId,
          customFields: supplierContact.customFields
        }
      ])
      .select("id")
      .single();
  }
);

export const insertSupplierInteraction = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertSupplierInteraction(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("supplierInteraction")
      .insert([{ companyId, supplierId }])
      .select("id")
      .single();
  }
);

export const insertSupplierLocation = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertSupplierLocation(supplierLocation: {
    supplierId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      postalCode?: string;
      countryCode?: string;
    };
    customFields?: Json;
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const insertAddress = await client
      .from("address")
      .insert([{ ...supplierLocation.address, companyId: companyId }])
      .select("id")
      .single();
    if (insertAddress.error) {
      return insertAddress;
    }

    const addressId = insertAddress.data?.id;
    if (!addressId) {
      return { data: null, error: new Error("Address ID not found") };
    }

    return client
      .from("supplierLocation")
      .insert([
        {
          supplierId: supplierLocation.supplierId,
          addressId,
          name: supplierLocation.name,
          customFields: supplierLocation.customFields
        }
      ])
      .select("id")
      .single();
  }
);

export const finalizePurchaseOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function finalizePurchaseOrder(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const [purchaseOrder, lines] = await Promise.all([
      getPurchaseOrder(purchaseOrderId),
      getPurchaseOrderLines(purchaseOrderId)
    ]);
    const { status } = getPurchaseOrderStatus(lines.data || []);

    const updateData: Database["public"]["Tables"]["purchaseOrder"]["Update"] =
      {
        status,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId
      };

    // Only set orderDate if it's not already set
    if (!purchaseOrder.data?.orderDate) {
      updateData.orderDate = today(getLocalTimeZone()).toString();
    }

    return client
      .from("purchaseOrder")
      .update(updateData)
      .eq("id", purchaseOrderId);
  }
);

export const sendSupplierQuote = mcpTool(
  {
    classification: "WRITE"
  },
  async function sendSupplierQuote(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    // Send keeps status as Draft, just updates timestamp
    const quoteUpdate = await client
      .from("supplierQuote")
      .update({
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId
      })
      .eq("id", supplierQuoteId);

    if (quoteUpdate.error) {
      return quoteUpdate;
    }

    return { data: null, error: null };
  }
);

export const updatePurchaseOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchaseOrder(purchaseOrder: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrder")
      .update(purchaseOrder)
      .eq("id", purchaseOrder.id);
  }
);

export const updatePurchaseOrderExchangeRate = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchaseOrderExchangeRate(data: {
    id: string;
    exchangeRate: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const update = {
      id: data.id,
      exchangeRate: data.exchangeRate,
      exchangeRateUpdatedAt: new Date().toISOString()
    };

    return client.from("purchaseOrder").update(update).eq("id", update.id);
  }
);

export const updatePurchaseOrderFavorite = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({ id: z.string(), favorite: z.boolean() })
    })
  },
  async function updatePurchaseOrderFavorite(args: {
    id: string;
    favorite: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const { id, favorite } = args;
    if (!favorite) {
      return client
        .from("purchaseOrderFavorite")
        .delete()
        .eq("purchaseOrderId", id)
        .eq("userId", userId);
    } else {
      return client
        .from("purchaseOrderFavorite")
        .insert({ purchaseOrderId: id, userId: userId });
    }
  }
);

export const updatePurchaseOrderStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchaseOrderStatus(update: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
    assignee: null | undefined;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("purchaseOrder").update(update).eq("id", update.id);
  }
);

export const updateSupplierAccounting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierAccounting(
    supplierAccounting: z.infer<typeof supplierAccountingValidator> & {
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplier")
      .update(sanitize(supplierAccounting))
      .eq("id", supplierAccounting.id);
  }
);

export const updateSupplierContact = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierContact(supplierContact: {
    contactId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if (supplierContact.customFields) {
      const customFieldUpdate = await client
        .from("supplierContact")
        .update({
          customFields: supplierContact.customFields,
          supplierLocationId: supplierContact.supplierLocationId
        })
        .eq("contactId", supplierContact.contactId);

      if (customFieldUpdate.error) {
        return customFieldUpdate;
      }
    }
    return client
      .from("contact")
      .update(sanitize(supplierContact.contact))
      .eq("id", supplierContact.contactId)
      .select("id")
      .single();
  }
);

export const updateSupplierLocation = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierLocation(supplierLocation: {
    addressId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      countryCode?: string;
      postalCode?: string;
    };
    customFields?: Json;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if (supplierLocation.customFields) {
      const customFieldUpdate = await client
        .from("supplierLocation")
        .update({
          name: supplierLocation.name,
          customFields: supplierLocation.customFields
        })
        .eq("addressId", supplierLocation.addressId);

      if (customFieldUpdate.error) {
        return customFieldUpdate;
      }
    }
    return client
      .from("address")
      .update(sanitize(supplierLocation.address))
      .eq("id", supplierLocation.addressId)
      .select("id")
      .single();
  }
);

export const updateSupplierPayment = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierPayment(
    supplierPayment: z.infer<typeof supplierPaymentValidator> & {
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierPayment")
      .update(sanitize(supplierPayment))
      .eq("supplierId", supplierPayment.supplierId);
  }
);

export const updateSupplierQuoteExchangeRate = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierQuoteExchangeRate(data: {
    id: string;
    exchangeRate: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const update = {
      id: data.id,
      exchangeRate: data.exchangeRate,
      exchangeRateUpdatedAt: new Date().toISOString()
    };

    return client.from("supplierQuote").update(update).eq("id", update.id);
  }
);

export const updateSupplierQuoteFavorite = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({ id: z.string(), favorite: z.boolean() })
    })
  },
  async function updateSupplierQuoteFavorite(args: {
    id: string;
    favorite: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const { id, favorite } = args;
    if (!favorite) {
      return client
        .from("supplierQuoteFavorite")
        .delete()
        .eq("supplierQuoteId", id)
        .eq("userId", userId);
    } else {
      return client
        .from("supplierQuoteFavorite")
        .insert({ supplierQuoteId: id, userId: userId });
    }
  }
);

export const updateSupplierQuoteStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierQuoteStatus(update: {
    id: string;
    status: (typeof supplierQuoteStatusType)[number];
    assignee: null | undefined;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("supplierQuote").update(update).eq("id", update.id);
  }
);

export const updateSupplierShipping = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierShipping(
    supplierShipping: z.infer<typeof supplierShippingValidator> & {
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierShipping")
      .update(sanitize(supplierShipping))
      .eq("supplierId", supplierShipping.supplierId);
  }
);

export const getSupplierTax = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierTax(supplierId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierTax")
      .select("*")
      .eq("supplierId", supplierId)
      .maybeSingle();
  }
);

export const updateSupplierTax = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierTax(
    supplierTax: z.infer<typeof supplierTaxValidator> & {
      companyId: string;
      updatedBy: string;
      taxExemptionCertificatePath?: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("supplierTax")
      .update(sanitize(supplierTax))
      .eq("supplierId", supplierTax.supplierId);
  }
);

export const upsertPurchaseOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseOrder(
    purchaseOrder:
      | (Omit<
          z.infer<typeof purchaseOrderValidator>,
          "id" | "purchaseOrderId"
        > & {
          purchaseOrderId: string;
          status?: (typeof purchaseOrderStatusType)[number];
          companyId: string;
          companyGroupId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<
          z.infer<typeof purchaseOrderValidator>,
          "id" | "purchaseOrderId"
        > & {
          id: string;
          purchaseOrderId: string;
          updatedBy: string;
          customFields?: Json;
        }),
    receiptRequestedDate?: string
  ) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in purchaseOrder) {
      return client
        .from("purchaseOrder")
        .update(sanitize(purchaseOrder))
        .eq("id", purchaseOrder.id)
        .select("id, purchaseOrderId");
    }

    const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
      await Promise.all([
        insertSupplierInteraction(purchaseOrder.supplierId),
        getSupplierPayment(purchaseOrder.supplierId),
        getSupplierShipping(purchaseOrder.supplierId),
        getEmployeeJob(userId)
      ]);

    if (supplierInteraction.error) return supplierInteraction;
    if (supplierPayment.error) return supplierPayment;
    if (supplierShipping.error) return supplierShipping;

    const {
      paymentTermId,
      invoiceSupplierId,
      invoiceSupplierContactId,
      invoiceSupplierLocationId
    } = supplierPayment.data;

    const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
      supplierShipping.data;

    if (purchaseOrder.currencyCode) {
      const currency = await getCurrencyByCode(
        purchaseOrder.companyGroupId,
        purchaseOrder.currencyCode
      );
      if (currency.data) {
        purchaseOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
        purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
      }
    } else {
      purchaseOrder.exchangeRate = 1;
      purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
    }

    const locationId =
      purchaseOrder.locationId ?? purchaser?.data?.locationId ?? null;

    // locationId is not a column on purchaseOrder -- it belongs on the delivery record
    const {
      locationId: _locationId,
      companyGroupId: _companyGroupId,
      ...purchaseOrderData
    } = purchaseOrder;

    const order = await client
      .from("purchaseOrder")
      .insert([
        {
          ...purchaseOrderData,
          supplierInteractionId: supplierInteraction.data?.id,
          status: purchaseOrder.status ?? "Draft"
        }
      ])
      .select("id, purchaseOrderId");

    if (order.error) return order;

    const purchaseOrderId = order.data[0].id;

    const [delivery, payment] = await Promise.all([
      client.from("purchaseOrderDelivery").insert([
        {
          id: purchaseOrderId,
          receiptRequestedDate: receiptRequestedDate ?? null,
          locationId: locationId,
          shippingMethodId: shippingMethodId,
          shippingTermId: shippingTermId,
          incoterm: incoterm,
          incotermLocation: incotermLocation,
          companyId: companyId
        }
      ]),
      client.from("purchaseOrderPayment").insert([
        {
          id: purchaseOrderId,
          invoiceSupplierId: invoiceSupplierId,
          invoiceSupplierContactId: invoiceSupplierContactId,
          invoiceSupplierLocationId: invoiceSupplierLocationId,
          paymentTermId: paymentTermId,
          companyId: companyId
        }
      ])
    ]);

    if (delivery.error) {
      await deletePurchaseOrder(purchaseOrderId);
      return payment;
    }
    if (payment.error) {
      await deletePurchaseOrder(purchaseOrderId);
      return payment;
    }

    return order;
  }
);

export const upsertPurchaseOrderDelivery = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseOrderDelivery(
    purchaseOrderDelivery:
      | (z.infer<typeof purchaseOrderDeliveryValidator> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (z.infer<typeof purchaseOrderDeliveryValidator> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in purchaseOrderDelivery) {
      return client
        .from("purchaseOrderDelivery")
        .update(sanitize(purchaseOrderDelivery))
        .eq("id", purchaseOrderDelivery.id)
        .select("id")
        .single();
    }
    return client
      .from("purchaseOrderDelivery")
      .insert([purchaseOrderDelivery])
      .select("id")
      .single();
  }
);

export const upsertPurchaseOrderLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseOrderLine(
    purchaseOrderLine:
      | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in purchaseOrderLine) {
      return client
        .from("purchaseOrderLine")
        .update(sanitize(purchaseOrderLine))
        .eq("id", purchaseOrderLine.id)
        .select("id")
        .single();
    }

    const existing = await client
      .from("purchaseOrderLine")
      .select("sortOrder")
      .eq("purchaseOrderId", purchaseOrderLine.purchaseOrderId);

    const maxSortOrder = (existing.data ?? []).reduce(
      (max, row) => Math.max(max, row.sortOrder ?? 0),
      0
    );

    return client
      .from("purchaseOrderLine")
      .insert([{ ...purchaseOrderLine, sortOrder: maxSortOrder + 1 }])
      .select("id")
      .single();
  }
);

export async function updatePurchaseOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseOrderLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export const upsertPurchaseOrderPayment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseOrderPayment(
    purchaseOrderPayment:
      | (z.infer<typeof purchaseOrderPaymentValidator> & {
          createdBy: string;
          customFields?: Json;
        })
      | (z.infer<typeof purchaseOrderPaymentValidator> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in purchaseOrderPayment) {
      return client
        .from("purchaseOrderPayment")
        .update(sanitize(purchaseOrderPayment))
        .eq("id", purchaseOrderPayment.id)
        .select("id")
        .single();
    }
    return client
      .from("purchaseOrderPayment")
      .insert([purchaseOrderPayment])
      .select("id")
      .single();
  }
);

export const upsertSupplier = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplier(
    supplier:
      | (Omit<z.infer<typeof supplierValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof supplierValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in supplier) {
      return client
        .from("supplier")
        .insert([supplier])
        .select("id, name")
        .single();
    }
    return client
      .from("supplier")
      .update({
        ...sanitize(supplier),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", supplier.id)
      .select("id")
      .single();
  }
);

export const upsertSupplierProcess = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplierProcess(
    supplierProcess:
      | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in supplierProcess) {
      return client
        .from("supplierProcess")
        .insert([supplierProcess])
        .select("id")
        .single();
    }
    return client
      .from("supplierProcess")
      .update(sanitize(supplierProcess))
      .eq("id", supplierProcess.id)
      .select("id")
      .single();
  }
);

export const upsertSupplierQuote = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplierQuote(
    supplierQuote:
      | (Omit<
          z.infer<typeof supplierQuoteValidator>,
          "id" | "supplierQuoteId"
        > & {
          supplierQuoteId: string;
          companyId: string;
          companyGroupId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<
          z.infer<typeof supplierQuoteValidator>,
          "id" | "supplierQuoteId"
        > & {
          id: string;
          supplierQuoteId: string;
          companyGroupId: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in supplierQuote) {
      if (supplierQuote.currencyCode) {
        const currency = await getCurrencyByCode(
          supplierQuote.companyGroupId,
          supplierQuote.currencyCode
        );
        if (currency.data) {
          supplierQuote.exchangeRate = currency.data.exchangeRate ?? undefined;
          supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
        }
      } else {
        supplierQuote.exchangeRate = 1;
        supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
      }

      const supplierInteraction = await insertSupplierInteraction(
        supplierQuote.supplierId
      );

      if (supplierInteraction.error) return supplierInteraction;

      const { companyGroupId: _companyGroupId, ...supplierQuoteData } =
        supplierQuote;
      const insert = await client
        .from("supplierQuote")
        .insert([
          {
            ...supplierQuoteData,
            status: supplierQuoteData.status ?? "Draft",
            supplierInteractionId: supplierInteraction.data?.id
          }
        ])
        .select("id, supplierQuoteId, externalLinkId")
        .single();

      if (insert.error) {
        return insert;
      }

      const supplierQuoteId = insert.data?.id;
      if (!supplierQuoteId) return insert;

      // Only create external link if one doesn't exist
      if (!insert.data.externalLinkId) {
        const externalLink = await upsertExternalLink({
          documentType: "SupplierQuote",
          documentId: supplierQuoteId,
          supplierId: supplierQuote.supplierId,
          expiresAt: supplierQuote.expirationDate,
          companyId: companyId
        });

        if (externalLink.data) {
          const update = await client
            .from("supplierQuote")
            .update({ externalLinkId: externalLink.data.id })
            .eq("id", supplierQuoteId);

          if (update.error) {
            return update;
          }
        }
      }

      return insert;
    } else {
      // Only update the exchange rate if the currency code has changed
      const existingQuote = await client
        .from("supplierQuote")
        .select("currencyCode, status")
        .eq("id", supplierQuote.id)
        .single();

      if (existingQuote.error) return existingQuote;

      const { currencyCode, status: existingStatus } = existingQuote.data;

      if (
        supplierQuote.currencyCode &&
        currencyCode !== supplierQuote.currencyCode
      ) {
        const currency = await getCurrencyByCode(
          supplierQuote.companyGroupId,
          supplierQuote.currencyCode
        );
        if (currency.data) {
          supplierQuote.exchangeRate = currency.data.exchangeRate ?? undefined;
          supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
        }
      }
      const { companyGroupId: _companyGroupId2, ...supplierQuoteUpdateData } =
        supplierQuote;
      return client
        .from("supplierQuote")
        .update({
          ...sanitize(supplierQuoteUpdateData),
          status:
            supplierQuote.expirationDate &&
            today(getLocalTimeZone()).toString() > supplierQuote.expirationDate
              ? "Expired"
              : (supplierQuote.status ?? existingStatus ?? "Draft"),
          updatedAt: today(getLocalTimeZone()).toString()
        })
        .eq("id", supplierQuote.id);
    }
  }
);

export const upsertSupplierQuoteLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplierQuoteLine(
    supplierQuoteLine:
      | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in supplierQuoteLine) {
      return client
        .from("supplierQuoteLine")
        .update(sanitize(supplierQuoteLine))
        .eq("id", supplierQuoteLine.id)
        .select("id")
        .single();
    }

    const existing = await client
      .from("supplierQuoteLine")
      .select("sortOrder")
      .eq("supplierQuoteId", supplierQuoteLine.supplierQuoteId);

    const maxSortOrder = (existing.data ?? []).reduce(
      (max, row) => Math.max(max, row.sortOrder ?? 0),
      0
    );

    return client
      .from("supplierQuoteLine")
      .insert([
        {
          ...supplierQuoteLine,
          description: supplierQuoteLine.description ?? "",
          sortOrder: maxSortOrder + 1
        }
      ])
      .select("id")
      .single();
  }
);

export async function updateSupplierQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("supplierQuoteLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export const upsertSupplierType = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSupplierType(
    supplierType:
      | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in supplierType) {
      return client
        .from("supplierType")
        .insert([supplierType])
        .select("id")
        .single();
    } else {
      return client
        .from("supplierType")
        .update(sanitize(supplierType))
        .eq("id", supplierType.id);
    }
  }
);

// ============================================================
// PURCHASING RFQ FUNCTIONS
// ============================================================

export const deletePurchasingRFQ = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchasingRFQ(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("purchasingRfq").delete().eq("id", purchasingRfqId);
  }
);

export const deletePurchasingRFQLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchasingRFQLine(purchasingRfqLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqLine")
      .delete()
      .eq("id", purchasingRfqLineId);
  }
);

export const getPurchasingRFQ = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQ(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("purchasingRfqs").select("*").eq("id", id).single();
  }
);

export const getPurchasingRFQs = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQs(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("purchasingRfqs")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.ilike("rfqId", `%${args.search}%`);
    }

    query = setGenericQueryFilters(query, args, [
      { column: "rfqId", ascending: false }
    ]);
    return query;
  }
);

export const getPurchasingRFQLine = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQLine(lineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqLines")
      .select("*")
      .eq("id", lineId)
      .single();
  }
);

export const getPurchasingRFQLines = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQLines(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqLines")
      .select("*")
      .eq("purchasingRfqId", purchasingRfqId)
      .order("order", { ascending: true });
  }
);

export const getPurchasingRFQSuppliers = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQSuppliers(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqSupplier")
      .select("*, supplier:supplierId(id, name)")
      .eq("purchasingRfqId", purchasingRfqId);
  }
);

export const upsertPurchasingRFQ = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchasingRFQ(purchasingRfq: {
    id?: string;
    rfqId: string;
    rfqDate: string;
    expirationDate?: string;
    locationId?: string;
    employeeId?: string;
    status?: (typeof purchasingRfqStatusType)[number];
    customFields?: Json;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId } = AuthContextHolder.get();
    if (purchasingRfq.id) {
      return client
        .from("purchasingRfq")
        .update(sanitize({ ...purchasingRfq, updatedBy: userId }))
        .eq("id", purchasingRfq.id)
        .select("id")
        .single();
    }
    return client
      .from("purchasingRfq")
      .insert([{ ...purchasingRfq, companyId, createdBy: userId }])
      .select("id")
      .single();
  }
);

export const upsertPurchasingRFQLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchasingRFQLine(
    purchasingRfqLine:
      | {
          purchasingRfqId: string;
          itemId: string;
          description?: string;
          quantity: number[];
          purchaseUnitOfMeasureCode: string;
          inventoryUnitOfMeasureCode: string;
          conversionFactor?: number;
          order: number;
          companyId: string;
          createdBy: string;
          customFields?: Json;
        }
      | {
          id: string;
          purchasingRfqId: string;
          itemId: string;
          description?: string;
          quantity: number[];
          purchaseUnitOfMeasureCode: string;
          inventoryUnitOfMeasureCode: string;
          conversionFactor?: number;
          order: number;
          companyId: string;
          updatedBy: string;
          customFields?: Json;
        }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in purchasingRfqLine) {
      return client
        .from("purchasingRfqLine")
        .update(sanitize(purchasingRfqLine))
        .eq("id", purchasingRfqLine.id)
        .select("id")
        .single();
    }
    return client
      .from("purchasingRfqLine")
      .insert([purchasingRfqLine])
      .select("id")
      .single();
  }
);

export async function updatePurchasingRFQLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchasingRfqLine")
        .set({ order: sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export const upsertPurchasingRFQSuppliers = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchasingRFQSuppliers(
    purchasingRfqId: string,
    supplierIds: string[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    // Delete existing suppliers for this RFQ
    await client
      .from("purchasingRfqSupplier")
      .delete()
      .eq("purchasingRfqId", purchasingRfqId);

    // Insert new suppliers
    if (supplierIds.length === 0) {
      return { data: [], error: null };
    }

    const suppliersToInsert = supplierIds.map((supplierId) => ({
      purchasingRfqId,
      supplierId,
      companyId,
      createdBy
    }));

    return client
      .from("purchasingRfqSupplier")
      .insert(suppliersToInsert)
      .select("id");
  }
);

export const updatePurchasingRFQStatus = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({
        id: z.string(),
        status: z.any(),
        assignee: z.string().nullable().optional()
      })
    })
  },
  async function updatePurchasingRFQStatus(args: {
    id: string;
    status: (typeof purchasingRfqStatusType)[number];
    assignee?: string | null;
  }) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfq")
      .update({
        status: args.status,
        assignee: args.assignee,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", args.id)
      .select("id")
      .single();
  }
);

export const getLinkedSupplierQuotes = mcpTool(
  {
    classification: "READ"
  },
  async function getLinkedSupplierQuotes(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqToSupplierQuote")
      .select(
        `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
    `
      )
      .eq("purchasingRfqId", purchasingRfqId);
  }
);

export const getLinkedPurchasingRfqs = mcpTool(
  {
    classification: "READ"
  },
  async function getLinkedPurchasingRfqs(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqToSupplierQuote")
      .select(
        `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
      )
      .eq("supplierQuoteId", supplierQuoteId);
  }
);

export const getLinkedPurchasingRfqsForInteraction = mcpTool(
  {
    classification: "READ"
  },
  async function getLinkedPurchasingRfqsForInteraction(
    supplierInteractionId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // First get all supplier quote IDs in this interaction
    const { data: quotes, error: quotesError } = await client
      .from("supplierQuote")
      .select("id")
      .eq("supplierInteractionId", supplierInteractionId);

    if (quotesError || !quotes || quotes.length === 0) {
      return { data: [], error: quotesError };
    }

    const quoteIds = quotes.map((q) => q.id);

    // Then get all purchasing RFQs linked to any of these quotes
    return client
      .from("purchasingRfqToSupplierQuote")
      .select(
        `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
      )
      .in("supplierQuoteId", quoteIds);
  }
);

// Get sibling quotes (quotes sharing any RFQ with current quote)
export const getSiblingQuotesForQuote = mcpTool(
  {
    classification: "READ"
  },
  async function getSiblingQuotesForQuote(supplierQuoteId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // First get all RFQ IDs linked to this quote
    const { data: linkedRfqs, error: rfqError } = await client
      .from("purchasingRfqToSupplierQuote")
      .select("purchasingRfqId")
      .eq("supplierQuoteId", supplierQuoteId);

    if (rfqError || !linkedRfqs || linkedRfqs.length === 0) {
      return { data: [], error: rfqError };
    }

    const rfqIds = linkedRfqs.map((r) => r.purchasingRfqId);

    // Get all quotes linked to any of these RFQs (excluding current quote)
    return client
      .from("purchasingRfqToSupplierQuote")
      .select(
        `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
    `
      )
      .in("purchasingRfqId", rfqIds)
      .neq("supplierQuoteId", supplierQuoteId);
  }
);

// Direct Order→RFQ lookup (more efficient than going through interaction)
export const getLinkedPurchasingRfqsForOrder = mcpTool(
  {
    classification: "READ"
  },
  async function getLinkedPurchasingRfqsForOrder(purchaseOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqToPurchaseOrder")
      .select(
        `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
      )
      .eq("purchaseOrderId", purchaseOrderId);
  }
);

export const getSupplierQuotesForComparison = mcpTool(
  {
    classification: "READ"
  },
  async function getSupplierQuotesForComparison(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // 1. Get all supplier quote IDs linked to this RFQ with supplier info
    const { data: links, error: linksError } = await client
      .from("purchasingRfqToSupplierQuote")
      .select(
        `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
    `
      )
      .eq("purchasingRfqId", purchasingRfqId);

    if (linksError || !links?.length) {
      return { data: { quotes: [], lines: [], prices: [] }, error: linksError };
    }

    // Extract all quotes (for comparison header count)
    const allQuotes = links
      .map((l) => l.supplierQuote)
      .filter((q): q is NonNullable<typeof q> => q !== null);

    if (allQuotes.length === 0) {
      return { data: { quotes: [], lines: [], prices: [] }, error: null };
    }

    // Get IDs of Active quotes only (for fetching lines/prices)
    const activeQuoteIds = allQuotes
      .filter((q) => q.status === "Active")
      .map((q) => q.id)
      .filter((id): id is string => !!id);

    // 2. Fetch lines and pricing for active quotes only (if any)
    if (activeQuoteIds.length === 0) {
      return {
        data: { quotes: allQuotes, lines: [], prices: [] },
        error: null
      };
    }

    const lines = await client
      .from("supplierQuoteLines")
      .select("*")
      .in("supplierQuoteId", activeQuoteIds);

    const prices = await client
      .from("supplierQuoteLinePrice")
      .select("*")
      .in("supplierQuoteId", activeQuoteIds);

    return {
      data: {
        quotes: allQuotes,
        lines: lines.data ?? [],
        prices: prices.data ?? []
      },
      error: lines.error || prices.error
    };
  }
);

// Get RFQ suppliers with their supplier info
export const getPurchasingRFQSuppliersWithLinks = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchasingRFQSuppliersWithLinks(purchasingRfqId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchasingRfqSupplier")
      .select("*, supplier:supplierId(id, name)")
      .eq("purchasingRfqId", purchasingRfqId);
  }
);
