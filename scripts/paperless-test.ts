import * as dotenv from "dotenv";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../packages/database/src/types";
import {
  getCarbonOrderStatus,
  getCustomerIdAndContactId,
  getCustomerLocationIds,
  getEmployeeAndSalesPersonId,
  getOrderLocationId,
  getPaperlessParts,
  insertOrderLines,
} from "../packages/ee/src/paperless-parts/lib/index";
import { OrderSchema } from "../packages/ee/src/paperless-parts/lib/schemas";
const orderNumber = 1387;
const apiKey = "faaa6a989c4daddf74ec88134400404449a7c105";
const companyId = "GuPcNVRbkDYKqjFHsV1LNa";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

(async () => {
  const carbon = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const paperless = await getPaperlessParts(apiKey);
  const company = await carbon
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();

  const order = await paperless.orders.orderDetails(orderNumber);
  if (order.data) {
    const orderData = OrderSchema.parse(order.data);

    const [
      existingOrder,
      { customerId, customerContactId },
      { createdBy, salesPersonId },
      locationId,
    ] = await Promise.all([
      carbon
        .from("salesOrder")
        .select("id")
        .eq("externalId->>paperlessId", orderData.uuid)
        .eq("companyId", companyId)
        .maybeSingle(),
      getCustomerIdAndContactId(carbon, paperless, {
        company: company.data!,
        contact: orderData.contact!,
      }),
      getEmployeeAndSalesPersonId(carbon, {
        company: company.data!,
        estimator: orderData.estimator!,
        salesPerson: orderData.sales_person!,
      }),
      getOrderLocationId(carbon, {
        company: company.data!,
        sendFrom: orderData.send_from_facility,
      }),
    ]);

    if (existingOrder?.data?.id) {
      console.log("Order already exists", existingOrder.data.id);
      return;
    }

    if (!customerId) {
      throw new Error("Failed to get customer ID");
    }
    if (!customerContactId) {
      throw new Error("Failed to get customer contact ID");
    }

    const { shipmentLocationId, invoiceLocationId } =
      await getCustomerLocationIds(carbon, {
        company: company.data!,
        customerId,
        billingInfo: orderData.billing_info ?? undefined,
        shippingInfo: orderData.shipping_info ?? undefined,
      });

    const [customerPayment, customerShipping, sequence, opportunity] =
      await Promise.all([
        getCustomerPayment(carbon, customerId),
        getCustomerShipping(carbon, customerId),
        getNextSequence(carbon, "salesOrder", companyId),
        carbon
          .from("opportunity")
          .insert([
            {
              customerId,
              companyId,
            },
          ])
          .select("id")
          .single(),
      ]);

    if (customerPayment.error) {
      throw new Error("Failed to get customer payment");
    }
    if (customerShipping.error) {
      throw new Error("Failed to get customer shipping");
    }
    if (sequence.error) {
      throw new Error("Failed to get sequence");
    }
    if (opportunity.error) {
      throw new Error("Failed to create opportunity");
    }

    const {
      paymentTermId,
      invoiceCustomerId,
      invoiceCustomerContactId,
      invoiceCustomerLocationId,
    } = customerPayment.data;

    const { shippingMethodId, shippingTermId } = customerShipping.data;

    let salesOrderInsert: Database["public"]["Tables"]["salesOrder"]["Insert"] =
      {
        salesOrderId: sequence.data,
        companyId: companyId,
        createdBy: createdBy,
        currencyCode: company.data?.baseCurrencyCode,
        customerId,
        customerContactId: customerContactId,
        customerLocationId: shipmentLocationId,
        customerReference:
          orderData.payment_details?.purchase_order_number ?? "",
        locationId,
        opportunityId: opportunity.data?.id,
        orderDate: new Date(orderData.created ?? "").toISOString(),
        salesPersonId,
        status: getCarbonOrderStatus(orderData.status),
        internalNotes: orderData.private_notes
          ? {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: orderData.private_notes }],
                },
              ],
            }
          : null,
        externalId: {
          paperlessId: orderData.uuid,
        },
      };

    const insertedSalesOrder = await carbon
      .from("salesOrder")
      .insert([salesOrderInsert])
      .select("id, salesOrderId");

    if (insertedSalesOrder.error) {
      console.error("Failed to create sales order", insertedSalesOrder.error);
      return insertedSalesOrder;
    }

    const salesOrderId = insertedSalesOrder.data[0].id;

    const [shipment, payment] = await Promise.all([
      carbon.from("salesOrderShipment").insert([
        {
          id: salesOrderId,
          locationId: locationId,
          customerId,
          shippingCost: orderData.payment_details?.shipping_cost ?? 0,
          customerLocationId: shipmentLocationId,
          shippingMethodId: shippingMethodId,
          shippingTermId: shippingTermId,
          companyId: companyId,
        },
      ]),
      carbon.from("salesOrderPayment").insert([
        {
          id: salesOrderId,
          invoiceCustomerId: invoiceCustomerId,
          invoiceCustomerContactId: invoiceCustomerContactId,
          invoiceCustomerLocationId:
            invoiceCustomerId === customerId
              ? invoiceLocationId ?? invoiceCustomerLocationId
              : invoiceCustomerLocationId,
          paymentTermId: paymentTermId,
          companyId: companyId,
        },
      ]),
    ]);

    if (shipment.error) {
      console.log("Failed to create shipment", shipment.error);
      await deleteSalesOrder(carbon, salesOrderId);
      return payment;
    }
    if (payment.error) {
      console.log("Failed to create payment", payment.error);
      await deleteSalesOrder(carbon, salesOrderId);
      return payment;
    }

    // Insert order lines after successful sales order creation
    try {
      await insertOrderLines(carbon, {
        salesOrderId,
        opportunityId: opportunity.data?.id,
        locationId: locationId!,
        companyId,
        createdBy,
        orderItems: orderData.order_items || [],
        defaultMethodType: "Buy",
        defaultTrackingType: "Batch",
      });
      console.log("✅ Order and order lines successfully created");
    } catch (error) {
      console.error("Failed to insert order lines:", error);
      await deleteSalesOrder(carbon, salesOrderId);
      return { error };
    }
  } else {
    console.error("No order data found");
    return;
  }
})();

async function getNextSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client.rpc("get_next_sequence", {
    sequence_name: table,
    company_id: companyId,
  });
}

async function getCustomerPayment(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerPayment")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

async function getCustomerShipping(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerShipping")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

async function deleteSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrder").delete().eq("id", salesOrderId);
}
