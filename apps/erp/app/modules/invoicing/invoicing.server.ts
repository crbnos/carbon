import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_SALES_ORDER_STATUSES } from "../sales/sales.models";
import type { DepositDocument } from "./invoicing.models";

// Documents a customer payment can be a deposit for — or a refund of: every
// open sales order and Draft/Active rental agreement (a new deposit), plus
// every document a posted deposit receipt already references (a refund of a
// Closed agreement's deposit) and any ids the caller must keep listed. Loaded
// company-wide with the customer on each row because the form's customer can
// change before the payment is saved; the picker narrows to that customer.
export async function getDepositDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  keepSalesOrderIds: (string | null | undefined)[] = []
): Promise<DepositDocument[]> {
  const [deposits, rentalAgreements, openOrders] = await Promise.all([
    client
      .from("payment")
      .select("salesOrderId")
      .eq("companyId", companyId)
      .eq("paymentType", "Receipt")
      .eq("status", "Posted")
      .not("salesOrderId", "is", null),
    client
      .from("rentalAgreement")
      .select("id, rentalAgreementId, customerId, status")
      .eq("companyId", companyId)
      .order("rentalAgreementId", { ascending: false }),
    fetchAllFromTable<{
      id: string;
      salesOrderId: string;
      customerId: string;
      status: string;
    }>(client, "salesOrder", "id, salesOrderId, customerId, status", (query) =>
      query
        .eq("companyId", companyId)
        .in("status", [...OPEN_SALES_ORDER_STATUSES])
        .order("salesOrderId", { ascending: false })
    )
  ]);
  const firstError =
    deposits.error ?? rentalAgreements.error ?? openOrders.error;
  if (firstError) throw new Error(firstError.message);
  const listed = new Set((openOrders.data ?? []).map((order) => order.id));
  const missingOrderIds = [
    ...new Set(
      [
        ...(deposits.data ?? []).map((deposit) => deposit.salesOrderId),
        ...keepSalesOrderIds
      ].filter((id): id is string => Boolean(id) && !listed.has(id!))
    )
  ];
  const closedOrders = missingOrderIds.length
    ? await client
        .from("salesOrder")
        .select("id, salesOrderId, customerId, status")
        .eq("companyId", companyId)
        .in("id", missingOrderIds)
    : { data: [], error: null };
  if (closedOrders.error) throw new Error(closedOrders.error.message);
  return [
    ...(rentalAgreements.data ?? []).map((agreement) => ({
      id: agreement.id,
      readableId: agreement.rentalAgreementId,
      customerId: agreement.customerId,
      kind: "rentalAgreement" as const,
      status: agreement.status,
      open: agreement.status === "Draft" || agreement.status === "Active"
    })),
    ...[...(openOrders.data ?? []), ...(closedOrders.data ?? [])].map(
      (order) => ({
        id: order.id,
        readableId: order.salesOrderId,
        customerId: order.customerId,
        kind: "salesOrder" as const,
        status: order.status,
        open: listed.has(order.id)
      })
    )
  ];
}
