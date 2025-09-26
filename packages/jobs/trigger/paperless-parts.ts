import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  getCarbonOrderStatus,
  getCustomerIdAndContactId,
  getCustomerLocationIds,
  getEmployeeAndSalesPersonId,
  getOrderLocationId,
  getPaperlessParts,
  insertOrderLines,
  OrderSchema,
} from "@carbon/ee/paperless-parts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quote.created"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.sent"),
    created: z.string(),
    object: z.string(),
    data: z.object({
      uuid: z.string(),
      number: z.number(),
      status: z.string(),
      created: z.string(),
      expired: z.boolean(),
      due_date: z.string().nullable(),
      erp_code: z.string().nullable(),
      metadata: z.object({}),
      priority: z.number().nullable(),
      tax_rate: z.string().nullable(),
      estimator: z.string().nullable(),
      sent_date: z.string(),
      contact_id: z.number(),
      rfq_number: z.string().nullable(),
      quote_items: z.array(z.string()),
      quote_notes: z.string().nullable(),
      salesperson: z.string().nullable(),
      expired_date: z.string().nullable(),
      private_notes: z.string().nullable(),
      revision_number: z.number().nullable(),
      supporting_files: z.array(z.string()),
      export_controlled: z.boolean(),
      send_from_facility: z.string(),
      request_for_quote_id: z.string().nullable(),
      digital_last_viewed_on: z.string().nullable(),
      manual_rfq_received_date: z.string().nullable(),
      authenticated_pdf_quote_url: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("order.created"),
    created: z.string(),
    object: z.string(),
    data: z.object({
      uuid: z.string(),
      status: z.string(),
      number: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal("order.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration_action.requested"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_on"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_off"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
]);

const paperlessPartsSchema = z.object({
  apiKey: z.string(),
  companyId: z.string(),
  payload: payloadSchema,
});

const integrationSchema = z.object({
  methodType: z.enum(["Buy", "Pick"]).optional(),
  trackingType: z.enum(["Inventory", "Non-Inventory", "Batch"]).optional(),
});

export const paperlessPartsTask = task({
  id: "paperless-parts",
  retry: {
    maxAttempts: 1,
  },
  maxDuration: 5 * 60,
  run: async (payload: z.infer<typeof paperlessPartsSchema>) => {
    let result: { success: boolean; message: string };

    console.info(
      `🔰 Paperless Parts webhook received: ${payload.payload.type}`
    );
    console.info(`📦 Payload:`, payload);

    const carbon = getCarbonServiceRole();
    const paperless = await getPaperlessParts(payload.apiKey);

    const [company, integration] = await Promise.all([
      carbon.from("company").select("*").eq("id", payload.companyId).single(),
      carbon
        .from("companyIntegration")
        .select("*")
        .eq("companyId", payload.companyId)
        .eq("id", "paperless-parts")
        .single(),
    ]);

    if (company.error || !company.data) {
      throw new Error("Failed to fetch company from Carbon");
    }

    if (integration.error || !integration.data) {
      throw new Error("Failed to fetch integration from Carbon");
    }

    const integrationData = integrationSchema.safeParse(
      integration.data.metadata
    );
    let methodType: "Buy" | "Pick" = "Pick";
    let trackingType: "Inventory" | "Non-Inventory" | "Batch" = "Inventory";
    if (integrationData.success) {
      methodType = integrationData.data.methodType;
      trackingType = integrationData.data.trackingType;
    }

    switch (payload.payload.type) {
      case "quote.created":
        console.info(`📫 Processing quote created event`);
        result = {
          success: true,
          message: "Quote created event processed successfully",
        };
        break;
      case "quote.status_changed":
        console.info(`📫 Processing quote status changed event`);
        result = {
          success: true,
          message: "Quote status changed event processed successfully",
        };
        break;
      case "quote.sent":
        console.info(`📫 Processing quote sent event`);
        const quotePayload = payload.payload.data;

        const ppQuoteNumber = quotePayload.number;
        const ppQuoteRevisionNumber = quotePayload.revision_number;

        const ppQuote = await paperless.quotes.quoteDetails(
          ppQuoteNumber,
          ppQuoteRevisionNumber
            ? { revision: ppQuoteRevisionNumber }
            : undefined
        );

        if (ppQuote.error || !ppQuote.data) {
          throw new Error("Failed to fetch quote details from Paperless Parts");
        }

        if (!ppQuote.data.contact) {
          // This should never happen based on the validation rules in Paperless Parts
          throw new Error(
            "Quote contact not found in Paperless Parts - cannot create Carbon Quote"
          );
        }

        const [
          {
            customerId: quoteCustomerId,
            customerContactId: quoteCustomerContactId,
          },
          { createdBy: quoteCreatedBy },
        ] = await Promise.all([
          getCustomerIdAndContactId(carbon, paperless, {
            company: company.data,
            contact: ppQuote.data.contact,
          }),
          getEmployeeAndSalesPersonId(carbon, {
            company: company.data,
            estimator: ppQuote.data.estimator,
            salesPerson: ppQuote.data.sales_person,
          }),
        ]);

        if (!quoteCustomerId) {
          throw new Error("Failed to get customer ID");
        }
        if (!quoteCustomerContactId) {
          throw new Error("Failed to get customer contact ID");
        }

        // Create a new quote in Carbon
        const nextSequence = await getNextSequence(
          carbon,
          "quote",
          payload.companyId
        );

        if (!nextSequence.data) {
          throw new Error("Failed to get next sequence number for quote");
        }

        // Create a quote object from the Paperless Parts data
        const quote = {
          companyId: payload.companyId,
          customerId: quoteCustomerId,
          customerContactId: quoteCustomerContactId,
          quoteId: nextSequence.data.toString(),
          name: `Quote for ${
            ppQuote.data.contact?.account?.name ||
            `${ppQuote.data.contact?.first_name} ${ppQuote.data.contact?.last_name}`
          }`,
          status: "Draft" as const,
          currencyCode: company.data.baseCurrencyCode,
          createdBy: quoteCreatedBy,
          exchangeRate: 1 as number | undefined,
          exchangeRateUpdatedAt: undefined as string | undefined,
          expirationDate: undefined as string | undefined,
          externalId: {
            paperlessPartsId: quotePayload.uuid,
          },
        };

        const [
          quoteCustomerPayment,
          quoteCustomerShipping,
          quoteEmployee,
          quoteOpportunity,
        ] = await Promise.all([
          getCustomerPayment(carbon, quote.customerId),
          getCustomerShipping(carbon, quote.customerId),
          getEmployeeJob(carbon, quote.createdBy, quote.companyId),
          carbon
            .from("opportunity")
            .insert([
              { companyId: quote.companyId, customerId: quote.customerId },
            ])
            .select("id")
            .single(),
        ]);

        if (quoteCustomerPayment.error) return quoteCustomerPayment;
        if (quoteCustomerShipping.error) return quoteCustomerShipping;

        const {
          paymentTermId: quotePaymentTermId,
          invoiceCustomerId: quoteInvoiceCustomerId,
          invoiceCustomerContactId: quoteInvoiceCustomerContactId,
          invoiceCustomerLocationId: quoteInvoiceCustomerLocationId,
        } = quoteCustomerPayment.data;

        const {
          shippingMethodId: quoteShippingMethodId,
          shippingTermId: quoteShippingTermId,
        } = quoteCustomerShipping.data;

        if (quote.currencyCode) {
          const currency = await getCurrencyByCode(
            carbon,
            quote.companyId,
            quote.currencyCode
          );
          if (currency.data) {
            quote.exchangeRate = currency.data.exchangeRate ?? undefined;
            quote.exchangeRateUpdatedAt = new Date().toISOString();
          }
        } else {
          quote.exchangeRate = 1;
          quote.exchangeRateUpdatedAt = new Date().toISOString();
        }

        const quoteLocationId = quoteEmployee?.data?.locationId ?? null;
        const insert = await carbon
          .from("quote")
          .insert([
            {
              ...quote,
              opportunityId: quoteOpportunity.data?.id,
            },
          ])
          .select("id, quoteId");
        if (insert.error) {
          return insert;
        }

        const quoteId = insert.data?.[0]?.id;
        if (!quoteId) return insert;

        const [quoteShipment, quotePayment, quoteExternalLink] =
          await Promise.all([
            carbon.from("quoteShipment").insert([
              {
                id: quoteId,
                locationId: quoteLocationId,
                shippingMethodId: quoteShippingMethodId,
                shippingTermId: quoteShippingTermId,
                companyId: quote.companyId,
              },
            ]),
            carbon.from("quotePayment").insert([
              {
                id: quoteId,
                invoiceCustomerId: quoteInvoiceCustomerId,
                invoiceCustomerContactId: quoteInvoiceCustomerContactId,
                invoiceCustomerLocationId: quoteInvoiceCustomerLocationId,
                paymentTermId: quotePaymentTermId,
                companyId: quote.companyId,
              },
            ]),
            upsertExternalLink(carbon, {
              documentType: "Quote" as const,
              documentId: quoteId,
              customerId: quote.customerId,
              expiresAt: quote.expirationDate,
              companyId: quote.companyId,
            }),
          ]);

        if (quoteShipment.error) {
          await deleteQuote(carbon, quoteId);
          return quoteShipment;
        }
        if (quotePayment.error) {
          await deleteQuote(carbon, quoteId);
          return quotePayment;
        }
        if (quoteOpportunity.error) {
          await deleteQuote(carbon, quoteId);
          return quoteOpportunity;
        }
        if (quoteExternalLink.data) {
          await carbon
            .from("quote")
            .update({ externalLinkId: quoteExternalLink.data.id })
            .eq("id", quoteId);
        }

        console.info("🔰 New Carbon quote created from Paperless Parts");

        result = {
          success: true,
          message: "Quote sent event processed successfully",
        };
        break;
      case "order.status_changed":
      case "order.created":
        console.info(`📫 Processing order created event`);

        const orderPayload = payload.payload.data;
        const orderNumber = orderPayload.number;

        if (!orderNumber) {
          throw new Error("Order number is required");
        }

        const order = await paperless.orders.orderDetails(orderNumber);

        if (order.error || !order.data) {
          throw new Error("Failed to fetch order details from Paperless Parts");
        }

        const orderData = OrderSchema.parse(order.data);

        // Check if order already exists
        const existingOrder = await carbon
          .from("salesOrder")
          .select("id")
          .eq("externalId->>paperlessId", orderPayload.uuid)
          .eq("companyId", payload.companyId)
          .maybeSingle();

        if (existingOrder?.data?.id) {
          console.log("Order already exists", existingOrder.data.id);

          const status = getCarbonOrderStatus(orderData.status);

          const update = await carbon
            .from("salesOrder")
            .update({ status })
            .eq("id", existingOrder.data.id);

          if (update.error) {
            console.log("Failed to update sales order", update.error);
            result = {
              success: false,
              message: "Failed to update sales order",
            };
            break;
          }

          result = {
            success: true,
            message: "Order already exists",
          };
          break;
        }

        const [
          {
            customerId: orderCustomerId,
            customerContactId: orderCustomerContactId,
          },
          { createdBy: orderCreatedBy, salesPersonId: orderSalesPersonId },
          orderLocationId,
        ] = await Promise.all([
          getCustomerIdAndContactId(carbon, paperless, {
            company: company.data,
            contact: orderData.contact!,
          }),
          getEmployeeAndSalesPersonId(carbon, {
            company: company.data,
            estimator: orderData.estimator!,
            salesPerson: orderData.sales_person!,
          }),
          getOrderLocationId(carbon, {
            company: company.data,
            sendFrom: orderData.send_from_facility,
          }),
        ]);

        if (!orderCustomerId) {
          throw new Error("Failed to get customer ID");
        }
        if (!orderCustomerContactId) {
          throw new Error("Failed to get customer contact ID");
        }

        const {
          shipmentLocationId: orderShipmentLocationId,
          invoiceLocationId: orderInvoiceLocationId,
        } = await getCustomerLocationIds(carbon, {
          company: company.data,
          customerId: orderCustomerId,
          billingInfo: orderData.billing_info,
          shippingInfo: orderData.shipping_info,
        });

        const [
          salesOrderSequence,
          orderCustomerPayment,
          orderCustomerShipping,
          orderOpportunity,
        ] = await Promise.all([
          getNextSequence(carbon, "salesOrder", payload.companyId),
          getCustomerPayment(carbon, orderCustomerId),
          getCustomerShipping(carbon, orderCustomerId),
          carbon
            .from("opportunity")
            .insert([
              {
                customerId: orderCustomerId,
                companyId: payload.companyId,
              },
            ])
            .select("id")
            .single(),
        ]);

        if (salesOrderSequence.error) {
          throw new Error("Failed to get sequence");
        }
        if (orderCustomerPayment.error) {
          throw new Error("Failed to get customer payment");
        }
        if (orderCustomerShipping.error) {
          throw new Error("Failed to get customer shipping");
        }

        const {
          paymentTermId: orderPaymentTermId,
          invoiceCustomerId: orderInvoiceCustomerId,
          invoiceCustomerContactId: orderInvoiceCustomerContactId,
          invoiceCustomerLocationId: orderInvoiceCustomerLocationId,
        } = orderCustomerPayment.data;

        const {
          shippingMethodId: orderShippingMethodId,
          shippingTermId: orderShippingTermId,
        } = orderCustomerShipping.data;
        if (orderOpportunity.error) {
          throw new Error("Failed to create opportunity");
        }

        if (!salesOrderSequence.data) {
          throw new Error("Failed to get next sequence number for sales order");
        }

        const salesOrderInsert = await carbon
          .from("salesOrder")
          .insert([
            {
              salesOrderId: salesOrderSequence.data,
              companyId: payload.companyId,
              createdBy: orderCreatedBy,
              currencyCode: company.data?.baseCurrencyCode,
              customerId: orderCustomerId,
              customerContactId: orderCustomerContactId,
              customerLocationId: orderShipmentLocationId,
              customerReference:
                orderData.payment_details?.purchase_order_number ?? "",
              locationId: orderLocationId,
              opportunityId: orderOpportunity.data?.id,
              orderDate: new Date(orderData.created ?? "").toISOString(),
              salesPersonId: orderSalesPersonId,
              status: getCarbonOrderStatus(orderData.status),
              internalNotes: orderData.private_notes
                ? {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: orderData.private_notes },
                        ],
                      },
                    ],
                  }
                : null,
              externalId: {
                paperlessId: orderData.uuid,
              },
            },
          ])
          .select("id, salesOrderId");

        if (salesOrderInsert.error) {
          console.log("Failed to create sales order", salesOrderInsert.error);
          result = {
            success: false,
            message: "Failed to create sales order",
          };
          break;
        }
        const salesOrderId = salesOrderInsert.data?.[0]?.id;
        if (!salesOrderId) {
          console.log("Failed to get sales order ID");
          result = {
            success: false,
            message: "Failed to get sales order ID",
          };
          break;
        }

        const [orderShipment, orderPayment] = await Promise.all([
          carbon.from("salesOrderShipment").insert([
            {
              id: salesOrderId,
              locationId: orderLocationId,
              customerId: orderCustomerId,
              shippingCost: parseFloat(
                orderData.payment_details?.shipping_cost ?? "0"
              ),
              customerLocationId: orderShipmentLocationId,
              shippingMethodId: orderShippingMethodId,
              shippingTermId: orderShippingTermId,
              companyId: payload.companyId,
            },
          ]),
          carbon.from("salesOrderPayment").insert([
            {
              id: salesOrderId,
              invoiceCustomerId: orderInvoiceCustomerId,
              invoiceCustomerContactId: orderInvoiceCustomerContactId,
              invoiceCustomerLocationId:
                orderInvoiceCustomerId === orderCustomerId
                  ? orderInvoiceLocationId ?? orderInvoiceCustomerLocationId
                  : orderInvoiceCustomerLocationId,
              paymentTermId: orderPaymentTermId,
              companyId: payload.companyId,
            },
          ]),
        ]);

        if (orderShipment.error) {
          console.log("Failed to create shipment", orderShipment.error);
          await deleteSalesOrder(carbon, salesOrderId);
          result = {
            success: false,
            message: "Failed to create shipment",
          };
          break;
        }
        if (orderPayment.error) {
          console.log("Failed to create payment", orderPayment.error);
          await deleteSalesOrder(carbon, salesOrderId);
          result = {
            success: false,
            message: "Failed to create payment",
          };
          break;
        }

        // Insert order lines after successful sales order creation
        try {
          await insertOrderLines(carbon, {
            integration: salesOrderId,
            opportunityId: orderOpportunity.data?.id,
            locationId: orderLocationId!,
            companyId: payload.companyId,
            createdBy: orderCreatedBy,
            orderItems: orderData.order_items || [],
            defaultMethodType: methodType,
            defaultTrackingType: trackingType,
          });
          console.log("✅ Order lines successfully created");
        } catch (error) {
          console.error("Failed to insert order lines:", error);
          await deleteSalesOrder(carbon, salesOrderId);
          result = {
            success: false,
            message: "Failed to insert order lines",
          };
          break;
        }

        console.info("🔰 New Carbon sales order created from Paperless Parts");

        result = {
          success: true,
          message: "Order created event processed successfully",
        };
        break;
      case "integration_action.requested":
        console.info(`📫 Processing integration action requested event`);
        result = {
          success: true,
          message: "Integration action requested event processed successfully",
        };
        break;
      case "integration.turned_on":
        console.info(`📫 Processing integration turned on event`);
        result = {
          success: true,
          message: "Integration turned on event processed successfully",
        };
        break;
      case "integration.turned_off":
        console.info(`📫 Processing integration turned off event`);
        result = {
          success: true,
          message: "Integration turned off event processed successfully",
        };
        break;
      default:
        console.error(`❌ Unsupported event type: ${payload.payload}`);
        result = {
          success: false,
          message: `Unsupported event type`,
        };
        break;
    }

    if (result.success) {
      console.info(`✅ Successfully processed ${payload.payload.type} event`);
    } else {
      console.error(
        `❌ Failed to process ${payload.payload.type} event: ${result.message}`
      );
    }

    return result;
  },
});

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

async function getEmployeeJob(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("employeeJob")
    .select("*")
    .eq("id", employeeId)
    .eq("companyId", companyId)
    .single();
}

async function getCurrencyByCode(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
) {
  return client
    .from("currency")
    .select("exchangeRate")
    .eq("companyId", companyId)
    .eq("code", currencyCode)
    .single();
}

async function deleteQuote(client: SupabaseClient<Database>, quoteId: string) {
  return client.from("quote").delete().eq("id", quoteId);
}

async function deleteSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrder").delete().eq("id", salesOrderId);
}

async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink: {
    documentType: "Quote" | "SupplierQuote" | "Customer";
    documentId: string;
    customerId: string;
    expiresAt?: string;
    companyId: string;
  }
) {
  return client
    .from("externalLink")
    .insert({
      documentType: externalLink.documentType,
      documentId: externalLink.documentId,
      customerId: externalLink.customerId,
      expiresAt: externalLink.expiresAt,
      companyId: externalLink.companyId,
    })
    .select("id")
    .single();
}
