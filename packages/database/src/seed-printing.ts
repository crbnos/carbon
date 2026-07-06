/**
 * Printing seed data for Carbon
 *
 * Seeds test data for the Print Manager: printer routes, printing settings,
 * items with tracking, receipts, shipments, kanbans, jobs, and a second
 * location with a location override for testing printer routing.
 *
 * This is called within an existing transaction — do NOT commit or rollback.
 *
 * Usage:
 *   import { seedPrinting } from "./seed-printing.ts";
 *   await seedPrinting(client, { companyId, userId, locationId });
 */

import type { PoolClient } from "pg";

export async function seedPrinting(
  client: PoolClient,
  ctx: {
    companyId: string;
    userId: string;
    locationId: string;
  }
) {
  const { companyId, userId, locationId } = ctx;

  console.log("  Seeding printing test data...");

  // --- Shared test data ---

  // Supplier
  const supplierResult = await client.query(
    `INSERT INTO supplier (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
    ["Test Parts Supplier", companyId, userId]
  );
  const supplierId = supplierResult.rows[0].id;

  // Customer (for shipments)
  const customerResult = await client.query(
    `INSERT INTO customer (name, "companyId", "createdBy") VALUES ($1, $2, $3) RETURNING id`,
    ["Test Customer", companyId, userId]
  );
  const customerId = customerResult.rows[0].id;

  // Items
  const itemDefs = [
    {
      readableId: "WIDGET-001",
      name: "Precision Widget",
      trackingType: "Serial",
      replenishment: "Buy"
    },
    {
      readableId: "BRACKET-002",
      name: "Mounting Bracket",
      trackingType: "Serial",
      replenishment: "Buy"
    },
    {
      readableId: "FASTENER-003",
      name: "Hex Fastener Kit",
      trackingType: "Batch",
      replenishment: "Buy"
    },
    {
      readableId: "GEAR-004",
      name: "Drive Gear Assembly",
      trackingType: "Serial",
      replenishment: "Make"
    }
  ];

  const methodTypeMap: Record<string, string> = {
    Buy: "Purchase to Order",
    Make: "Make to Order"
  };

  const itemIds: string[] = [];
  for (const item of itemDefs) {
    const result = await client.query(
      `INSERT INTO item (
        "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", active, "companyId", "createdBy"
      ) VALUES ($1, $2, 'Part', $3, $4, $5, 'EA', true, $6, $7) RETURNING id`,
      [
        item.readableId,
        item.name,
        item.replenishment,
        methodTypeMap[item.replenishment] ?? "Pull from Inventory",
        item.trackingType,
        companyId,
        userId
      ]
    );
    itemIds.push(result.rows[0].id);
  }

  // Item costs (required by post-receipt and post-shipment)
  for (const itemId of itemIds) {
    await client.query(
      `INSERT INTO "itemCost" ("itemId", "costingMethod", "companyId", "createdBy") VALUES ($1, 'Standard', $2, $3)`,
      [itemId, companyId, userId]
    );
  }

  // Supplier interaction (required FK for purchase orders)
  const siResult = await client.query(
    `INSERT INTO "supplierInteraction" ("companyId", "supplierId") VALUES ($1, $2) RETURNING id`,
    [companyId, supplierId]
  );
  const supplierInteractionId = siResult.rows[0].id;

  // --- Flow 1: Receipt (auto-print receipt labels) ---
  console.log("   Flow 1: Receipt RE000001...");

  const poResult = await client.query(
    `INSERT INTO "purchaseOrder" (
      "purchaseOrderId", "supplierId", "supplierInteractionId", status, "purchaseOrderType",
      "exchangeRate", "companyId", "createdBy"
    ) VALUES ('PO000001', $1, $2, 'To Receive', 'Purchase', 1, $3, $4) RETURNING id`,
    [supplierId, supplierInteractionId, companyId, userId]
  );
  const purchaseOrderId = poResult.rows[0].id;

  await client.query(
    `INSERT INTO "purchaseOrderDelivery" (id, "companyId") VALUES ($1, $2)`,
    [purchaseOrderId, companyId]
  );

  // Bump sequences past the seeded data to avoid conflicts
  await client.query(
    `UPDATE sequence SET next = 3 WHERE "table" IN ('purchaseOrder', 'receipt') AND "companyId" = $1`,
    [companyId]
  );
  await client.query(
    `UPDATE sequence SET next = 2 WHERE "table" = 'job' AND "companyId" = $1`,
    [companyId]
  );

  const poLineIds: string[] = [];
  const receiptQuantities = [2, 1, 5];
  for (let i = 0; i < 3; i++) {
    const lineResult = await client.query(
      `INSERT INTO "purchaseOrderLine" (
        "purchaseOrderId", "purchaseOrderLineType", "itemId",
        "purchaseQuantity", "quantityReceived", "quantityInvoiced",
        "supplierUnitPrice", "supplierShippingCost", "supplierTaxAmount",
        "exchangeRate", "setupPrice", "conversionFactor",
        "purchaseUnitOfMeasureCode", "inventoryUnitOfMeasureCode",
        "companyId", "createdBy"
      ) VALUES ($1, 'Part', $2, $3, 0, 0, 10.00, 0, 0, 1, 0, 1, 'EA', 'EA', $4, $5) RETURNING id`,
      [purchaseOrderId, itemIds[i], receiptQuantities[i], companyId, userId]
    );
    poLineIds.push(lineResult.rows[0].id);
  }

  const receiptResult = await client.query(
    `INSERT INTO receipt (
      "receiptId", "supplierId", "sourceDocument", "sourceDocumentId",
      "locationId", status, "companyId", "createdBy"
    ) VALUES ('RE000001', $1, 'Purchase Order', $2, $3, 'Draft', $4, $5) RETURNING id`,
    [supplierId, purchaseOrderId, locationId, companyId, userId]
  );
  const receiptId = receiptResult.rows[0].id;

  for (let i = 0; i < 3; i++) {
    const trackingType = itemDefs[i]?.trackingType;
    const isSerial = trackingType === "Serial";
    await client.query(
      `INSERT INTO "receiptLine" (
        "receiptId", "lineId", "itemId", "orderQuantity", "receivedQuantity", "unitPrice",
        "unitOfMeasure", "locationId",
        "requiresSerialTracking", "requiresBatchTracking",
        "companyId", "createdBy"
      ) VALUES ($1, $2, $3, $4, $4, 10.00, 'EA', $5, $6, $7, $8, $9)`,
      [
        receiptId,
        poLineIds[i],
        itemIds[i],
        receiptQuantities[i],
        locationId,
        isSerial,
        !isSerial && trackingType === "Batch",
        companyId,
        userId
      ]
    );
  }

  // Pre-populate tracked entities for receipt (serial/batch numbers)
  const receiptLinesResult = await client.query(
    `SELECT id, "itemId" FROM "receiptLine" WHERE "receiptId" = $1 ORDER BY "createdAt"`,
    [receiptId]
  );
  const receiptLines = receiptLinesResult.rows as {
    id: string;
    itemId: string;
  }[];

  const widgetLine = receiptLines.find((rl) => rl.itemId === itemIds[0]);
  if (widgetLine) {
    for (let i = 0; i < 2; i++) {
      await client.query(
        `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, "companyId", "createdBy")
         VALUES ($1, 1, 'Item', $2, $3, $4, $5)`,
        [
          `SN-W${1001 + i}`,
          itemIds[0],
          JSON.stringify({
            Receipt: receiptId,
            "Receipt Line": widgetLine.id,
            "Receipt Line Index": i
          }),
          companyId,
          userId
        ]
      );
    }
  }
  const bracketLine = receiptLines.find((rl) => rl.itemId === itemIds[1]);
  if (bracketLine) {
    await client.query(
      `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, "companyId", "createdBy")
       VALUES ($1, 1, 'Item', $2, $3, $4, $5)`,
      [
        "SN-B3001",
        itemIds[1],
        JSON.stringify({
          Receipt: receiptId,
          "Receipt Line": bracketLine.id,
          "Receipt Line Index": 0
        }),
        companyId,
        userId
      ]
    );
  }
  const fastenerLine = receiptLines.find((rl) => rl.itemId === itemIds[2]);
  if (fastenerLine) {
    await client.query(
      `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, "companyId", "createdBy")
       VALUES ($1, 5, 'Item', $2, $3, $4, $5)`,
      [
        "BATCH-7042",
        itemIds[2],
        JSON.stringify({
          Receipt: receiptId,
          "Receipt Line": fastenerLine.id
        }),
        companyId,
        userId
      ]
    );
  }

  // --- Flow 2: Shipment (auto-print shipment labels) ---
  console.log("   Flow 2: Shipment SH000001...");

  // Sales order (source document for shipment)
  const soResult = await client.query(
    `INSERT INTO "salesOrder" (
      "salesOrderId", "customerId", "currencyCode", status, "companyId", "createdBy"
    ) VALUES ('SO000001', $1, 'USD', 'To Ship', $2, $3) RETURNING id`,
    [customerId, companyId, userId]
  );
  const salesOrderId = soResult.rows[0].id;

  await client.query(
    `INSERT INTO "salesOrderShipment" (id, "companyId") VALUES ($1, $2)`,
    [salesOrderId, companyId]
  );

  await client.query(
    `INSERT INTO "salesOrderLine" (
      "salesOrderId", "salesOrderLineType", "itemId",
      "saleQuantity", "unitPrice", "unitOfMeasureCode",
      "companyId", "createdBy"
    ) VALUES ($1, 'Part', $2, 1, 10.00, 'EA', $3, $4)`,
    [salesOrderId, itemIds[0], companyId, userId]
  );

  const shipmentResult = await client.query(
    `INSERT INTO shipment (
      "shipmentId", "locationId", status, "companyId", "createdBy"
    ) VALUES ('SH000001', $1, 'Draft', $2, $3) RETURNING id`,
    [locationId, companyId, userId]
  );
  const shipmentId = shipmentResult.rows[0].id;

  await client.query(
    `INSERT INTO "shipmentLine" (
      "shipmentId", "itemId",
      "orderQuantity", "unitOfMeasure", "unitPrice", "locationId",
      "requiresSerialTracking",
      "companyId", "createdBy"
    ) VALUES ($1, $2, 1, 'EA', 10.00, $3, true, $4, $5)`,
    [shipmentId, itemIds[0], locationId, companyId, userId]
  );

  // Pre-populate tracked entity for shipment
  const shipmentLinesResult = await client.query(
    `SELECT id FROM "shipmentLine" WHERE "shipmentId" = $1 LIMIT 1`,
    [shipmentId]
  );
  const shipmentLineId = shipmentLinesResult.rows[0]?.id;
  if (shipmentLineId) {
    await client.query(
      `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, "companyId", "createdBy")
       VALUES ($1, 1, 'Item', $2, $3, $4, $5)`,
      [
        "SN-W1001",
        itemIds[0],
        JSON.stringify({
          Shipment: shipmentId,
          "Shipment Line": shipmentLineId,
          "Shipment Line Index": 0
        }),
        companyId,
        userId
      ]
    );
  }

  // --- Flow 3: Kanban (auto-print kanban cards) ---
  console.log("   Flow 3: Kanban for FASTENER-003...");

  await client.query(
    `INSERT INTO kanban (
      "itemId", "replenishmentSystem", quantity, "locationId",
      "supplierId", "companyId", "createdBy"
    ) VALUES ($1, 'Buy', 100, $2, $3, $4, $5)`,
    [itemIds[2], locationId, supplierId, companyId, userId]
  );

  // --- Flow 4: MES Operation Completion (auto-print operation labels) ---
  console.log("   Flow 4: Job J000001 with operation...");

  const workCenterResult = await client.query(
    `INSERT INTO "workCenter" (name, "locationId", "companyId", "createdBy") VALUES ($1, $2, $3, $4) RETURNING id`,
    ["Assembly Station 1", locationId, companyId, userId]
  );
  const workCenterId = workCenterResult.rows[0].id;

  const processResult = await client.query(
    `INSERT INTO process (name, "defaultStandardFactor", "companyId", "createdBy") VALUES ($1, 'Hours/Piece', $2, $3) RETURNING id`,
    ["Assembly", companyId, userId]
  );
  const processId = processResult.rows[0].id;

  const jobResult = await client.query(
    `INSERT INTO job (
      "jobId", "itemId", quantity, "locationId", status,
      "unitOfMeasureCode", "companyId", "createdBy"
    ) VALUES ('J000001', $1, 2, $2, 'In Progress', 'EA', $3, $4) RETURNING id`,
    [itemIds[3], locationId, companyId, userId]
  );
  const jobId = jobResult.rows[0].id;

  // Get auto-created jobMakeMethod (created by DB trigger on job insert)
  const jmmResult = await client.query(
    `SELECT id FROM "jobMakeMethod" WHERE "jobId" = $1 LIMIT 1`,
    [jobId]
  );
  let methodId: string;
  if (jmmResult.rows.length > 0) {
    methodId = jmmResult.rows[0].id;
  } else {
    const jmmInsert = await client.query(
      `INSERT INTO "jobMakeMethod" ("jobId", "itemId", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [jobId, itemIds[3], companyId, userId]
    );
    methodId = jmmInsert.rows[0].id;
  }

  const opResult = await client.query(
    `INSERT INTO "jobOperation" (
      "jobId", "jobMakeMethodId", "processId", "workCenterId",
      "operationQuantity", status,
      "companyId", "createdBy"
    ) VALUES ($1, $2, $3, $4, 2, 'In Progress', $5, $6) RETURNING id`,
    [jobId, methodId, processId, workCenterId, companyId, userId]
  );
  const operationId = opResult.rows[0].id;

  // Pre-create tracked entity for serial completion in MES
  await client.query(
    `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, status, "companyId", "createdBy")
     VALUES ($1, 1, 'Item', $2, $3, 'Reserved', $4, $5)`,
    [
      "SN-G4001",
      itemIds[3],
      JSON.stringify({
        "Job Make Method": methodId,
        "Job Operation": operationId
      }),
      companyId,
      userId
    ]
  );

  // --- Configure printing ---
  console.log("  Configuring printing settings...");
  await client.query(
    `UPDATE "companySettings" SET printing = $1, "productLabelSize" = 'label2x1', "kanbanOutput" = 'url' WHERE id = $2`,
    [
      JSON.stringify({
        assignments: {}
      }),
      companyId
    ]
  );
  const printerRouteResult = await client.query(
    `INSERT INTO "printerRoute" ("companyId", "name", "format", "mediaSizeId", "printerUrl", "templateId")
     VALUES ($1, 'Zebra 2x1', 'zpl', 'label2x1', 'https://your-proxybox-address.pbxz.cloud/api/v1/print/tag_2x1', 'carbon:product-label-2x1'),
            ($1, 'Document Printer', 'pdf', NULL, 'https://your-proxybox-address.pbxz.cloud/api/v1/print/tag_BWLASER', NULL)
     RETURNING id, name`,
    [companyId]
  );

  const zplRouteId = printerRouteResult.rows.find(
    (r: { name: string }) => r.name === "Zebra 2x1"
  )?.id;

  // Wire the default location to use the ZPL printer with auto-print enabled
  await client.query(
    `UPDATE "companySettings" SET printing = $1 WHERE id = $2`,
    [
      JSON.stringify({
        assignments: {
          [locationId]: {
            defaultPrinterRouteId: zplRouteId,
            defaultAutoPrint: true,
            shipping: { printerRouteId: null, autoPrint: true },
            receiving: { printerRouteId: null, autoPrint: true },
            workCenters: {}
          }
        }
      }),
      companyId
    ]
  );

  // --- Second location + receipt for testing location overrides ---
  console.log("  Creating second location and receipt for override testing...");

  const location2Result = await client.query(
    `INSERT INTO location (name, "addressLine1", city, "stateProvince", "postalCode", "countryCode", timezone, "companyId", "createdBy")
     VALUES ('Warehouse B', '456 Industrial Blvd', 'Round Rock', 'TX', '78664', 'US', 'America/Chicago', $1, 'system') RETURNING id`,
    [companyId]
  );
  const location2Id = location2Result.rows[0].id;

  // Add a second printer route at Warehouse B
  const route2Result = await client.query(
    `INSERT INTO "printerRoute" ("companyId", "locationId", "name", "format", "mediaSizeId", "printerUrl")
     VALUES ($1, $2, 'Warehouse B Rollo', 'pdf', 'label2x1', 'https://your-proxybox-address.pbxz.cloud/api/v1/print/tag_ROLLO-LABELS')
     RETURNING id`,
    [companyId, location2Id]
  );
  const route2Id = route2Result.rows[0].id;

  // Add Warehouse B assignment with the Rollo as default
  await client.query(
    `UPDATE "companySettings" SET printing = jsonb_set(
      printing, '{assignments,${location2Id}}', $1::jsonb
    ) WHERE id = $2`,
    [
      JSON.stringify({
        defaultPrinterRouteId: route2Id,
        defaultAutoPrint: false,
        shipping: { printerRouteId: null, autoPrint: false },
        receiving: { printerRouteId: null, autoPrint: true },
        workCenters: {}
      }),
      companyId
    ]
  );

  // Second PO + Receipt at Warehouse B
  const po2Result = await client.query(
    `INSERT INTO "purchaseOrder" (
      "purchaseOrderId", "supplierId", "supplierInteractionId", status, "purchaseOrderType",
      "exchangeRate", "companyId", "createdBy"
    ) VALUES ('PO000002', $1, $2, 'To Receive', 'Purchase', 1, $3, $4) RETURNING id`,
    [supplierId, supplierInteractionId, companyId, userId]
  );
  const purchaseOrder2Id = po2Result.rows[0].id;

  await client.query(
    `INSERT INTO "purchaseOrderDelivery" (id, "companyId") VALUES ($1, $2)`,
    [purchaseOrder2Id, companyId]
  );

  const po2LineResult = await client.query(
    `INSERT INTO "purchaseOrderLine" (
      "purchaseOrderId", "purchaseOrderLineType", "itemId",
      "purchaseQuantity", "quantityReceived", "quantityInvoiced",
      "supplierUnitPrice", "supplierShippingCost", "supplierTaxAmount",
      "exchangeRate", "setupPrice", "conversionFactor",
      "purchaseUnitOfMeasureCode", "inventoryUnitOfMeasureCode",
      "companyId", "createdBy"
    ) VALUES ($1, 'Part', $2, 1, 0, 0, 10.00, 0, 0, 1, 0, 1, 'EA', 'EA', $3, $4) RETURNING id`,
    [purchaseOrder2Id, itemIds[0], companyId, userId]
  );
  const po2LineId = po2LineResult.rows[0].id;

  const receipt2Result = await client.query(
    `INSERT INTO receipt (
      "receiptId", "supplierId", "sourceDocument", "sourceDocumentId",
      "locationId", status, "companyId", "createdBy"
    ) VALUES ('RE000002', $1, 'Purchase Order', $2, $3, 'Draft', $4, $5) RETURNING id`,
    [supplierId, purchaseOrder2Id, location2Id, companyId, userId]
  );
  const receipt2Id = receipt2Result.rows[0].id;

  const receipt2LineResult = await client.query(
    `INSERT INTO "receiptLine" (
      "receiptId", "lineId", "itemId", "orderQuantity", "receivedQuantity", "unitPrice",
      "unitOfMeasure", "locationId",
      "requiresSerialTracking", "requiresBatchTracking",
      "companyId", "createdBy"
    ) VALUES ($1, $2, $3, 1, 1, 10.00, 'EA', $4, true, false, $5, $6) RETURNING id`,
    [receipt2Id, po2LineId, itemIds[0], location2Id, companyId, userId]
  );
  const receipt2LineId = receipt2LineResult.rows[0].id;

  // Pre-populate tracked entity for receipt 2
  await client.query(
    `INSERT INTO "trackedEntity" ("readableId", quantity, "sourceDocument", "sourceDocumentId", attributes, "companyId", "createdBy")
     VALUES ($1, 1, 'Item', $2, $3, $4, $5)`,
    [
      "SN-W2001",
      itemIds[0],
      JSON.stringify({
        Receipt: receipt2Id,
        "Receipt Line": receipt2LineId,
        "Receipt Line Index": 0
      }),
      companyId,
      userId
    ]
  );

  console.log(
    "   Printing: auto-print ON, label2x1 → your-proxybox-address.pbxz.cloud"
  );
  console.log(
    "   Receipt RE000001: WIDGET-001 x2, BRACKET-002 x1, FASTENER-003 x5 (tracking pre-filled)"
  );
  console.log(
    "   Receipt RE000002: WIDGET-001 x1 at Warehouse B (location override test)"
  );
  console.log("   Shipment SH000001: WIDGET-001 x1 (tracking pre-filled)");
  console.log("   Kanban: FASTENER-003 Buy x100");
  console.log(
    "   Job J000001: GEAR-004 x2, operation In Progress (tracked entity SN-G4001)"
  );
}
